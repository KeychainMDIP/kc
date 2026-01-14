package org.keychain.keymaster;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.bitcoinj.crypto.DeterministicKey;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletStore;

public class KeymasterWalletManager {
    private final WalletStore<WalletEncFile> store;
    private final KeymasterCrypto crypto;
    private final ObjectMapper mapper;
    private final String passphrase;
    private final ReentrantLock writeLock = new ReentrantLock();
    private WalletFile walletCache;
    private DeterministicKey hdkeyCache;

    public KeymasterWalletManager(
        WalletStore<WalletEncFile> store,
        KeymasterCrypto crypto,
        String passphrase
    ) {
        this.store = store;
        this.crypto = crypto;
        this.mapper = WalletJsonMapper.mapper();
        this.passphrase = passphrase;
    }

    public WalletFile loadWallet() {
        if (walletCache != null) {
            return walletCache;
        }

        WalletEncFile stored = store.loadWallet();
        if (stored == null) {
            return null;
        }

        WalletFile wallet;
        if (isLegacyEncrypted(stored)) {
            wallet = decryptLegacyEncrypted(stored);
            wallet = upgradeWallet(wallet);
            store.saveWallet(encryptWalletForStorage(wallet), true);
        } else if (isLegacyV0(stored)) {
            wallet = upgradeWallet(toWalletFile(stored));
            store.saveWallet(encryptWalletForStorage(wallet), true);
        } else if (isV1WithEnc(stored)) {
            wallet = decryptWalletFromStorage(stored);
        } else if (isV1Decrypted(stored)) {
            wallet = toWalletFile(stored);
        } else {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }

        walletCache = wallet;
        return walletCache;
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        WalletFile upgraded = upgradeWallet(wallet);
        WalletEncFile stored = encryptWalletForStorage(upgraded);
        boolean ok = store.saveWallet(stored, overwrite);
        if (ok) {
            walletCache = upgraded;
        }
        return ok;
    }

    boolean saveStoredWallet(WalletEncFile stored, boolean overwrite) {
        boolean ok = store.saveWallet(stored, overwrite);
        if (ok) {
            walletCache = decryptWalletFromStorage(stored);
        }
        return ok;
    }

    void decryptStoredWallet(WalletEncFile stored) {
        decryptWalletFromStorage(stored);
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        writeLock.lock();
        try {
            WalletFile wallet = loadWallet();
            if (wallet == null) {
                throw new IllegalStateException("No wallet loaded");
            }

            WalletFile working = deepCopyWallet(wallet);
            String before = toJson(mapper, walletToMap(working));
            mutator.accept(working);
            String after = toJson(mapper, walletToMap(working));

            if (Objects.equals(before, after)) {
                return false;
            }

            boolean ok = saveWallet(working, true);
            if (ok) {
                walletCache = working;
            }
            return ok;
        } finally {
            writeLock.unlock();
        }
    }

    DeterministicKey getHdKeyFromCacheOrMnemonic(WalletFile wallet) {
        if (hdkeyCache != null) {
            return hdkeyCache;
        }

        String mnemonic = MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
        hdkeyCache = HdKeyUtil.masterFromMnemonic(mnemonic);
        return hdkeyCache;
    }

    WalletFile upgradeWallet(WalletFile wallet) {
        if (wallet == null) {
            throw new IllegalArgumentException("wallet is required");
        }

        if (wallet.version != null && wallet.version == 1 && wallet.seed != null && wallet.seed.mnemonicEnc != null) {
            return wallet;
        }

        boolean legacy = (wallet.version == null || wallet.version == 0)
            && wallet.seed != null
            && wallet.seed.hdkey != null
            && wallet.seed.mnemonic != null;

        if (legacy) {
            DeterministicKey key = HdKeyUtil.fromXpriv(wallet.seed.hdkey.xpriv);
            var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(key));
            String mnemonic = crypto.decryptMessage(jwk.publicJwk, jwk.privateJwk, wallet.seed.mnemonic);

            Seed seed = new Seed();
            seed.mnemonicEnc = MnemonicEncryption.encrypt(mnemonic, passphrase);

            WalletFile upgraded = new WalletFile();
            upgraded.version = 1;
            upgraded.seed = seed;
            upgraded.counter = wallet.counter;
            upgraded.ids = wallet.ids != null ? wallet.ids : new HashMap<>();
            upgraded.current = wallet.current;
            upgraded.names = wallet.names;
            upgraded.extras = wallet.extras;

            hdkeyCache = HdKeyUtil.masterFromMnemonic(mnemonic);
            return upgraded;
        }

        throw new IllegalStateException("Keymaster: Unsupported wallet version.");
    }

    private WalletEncFile encryptWalletForStorage(WalletFile wallet) {
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("wallet.seed.mnemonicEnc is required");
        }

        Seed safeSeed = new Seed();
        safeSeed.mnemonicEnc = wallet.seed.mnemonicEnc;

        String plaintext = toJson(mapper, walletToMap(wallet));
        DeterministicKey master = getHdKeyFromCacheOrMnemonic(wallet);
        var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        String enc = crypto.encryptMessage(jwk.publicJwk, jwk.privateJwk, plaintext);

        WalletEncFile stored = new WalletEncFile();
        stored.version = wallet.version != null ? wallet.version : 1;
        stored.seed = safeSeed;
        stored.enc = enc;
        return stored;
    }

    private WalletFile decryptWalletFromStorage(WalletEncFile stored) {
        if (stored == null || stored.seed == null || stored.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("stored.seed.mnemonicEnc is required");
        }

        WalletFile wallet = new WalletFile();
        wallet.version = stored.version;
        wallet.seed = stored.seed;

        DeterministicKey master = getHdKeyFromCacheOrMnemonic(wallet);
        var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        String plaintext = crypto.decryptMessage(jwk.publicJwk, jwk.privateJwk, stored.enc);

        Map<String, Object> data = fromJson(mapper, plaintext);
        data.put("version", stored.version);
        data.put("seed", stored.seed);

        return mapper.convertValue(data, WalletFile.class);
    }

    private boolean isLegacyEncrypted(WalletEncFile stored) {
        return stored != null && stored.salt != null && stored.iv != null && stored.data != null;
    }

    private boolean isLegacyV0(WalletEncFile stored) {
        return stored != null
            && (stored.version == 0)
            && stored.seed != null
            && stored.seed.hdkey != null
            && stored.seed.mnemonic != null;
    }

    private boolean isV1WithEnc(WalletEncFile stored) {
        return stored != null
            && stored.version == 1
            && stored.enc != null
            && stored.seed != null
            && stored.seed.mnemonicEnc != null;
    }

    private boolean isV1Decrypted(WalletEncFile stored) {
        return stored != null
            && stored.version == 1
            && stored.enc == null
            && stored.seed != null
            && stored.seed.mnemonicEnc != null;
    }

    private WalletFile decryptLegacyEncrypted(WalletEncFile stored) {
        if (passphrase == null || passphrase.isBlank()) {
            throw new IllegalStateException("KC_ENCRYPTED_PASSPHRASE not set");
        }

        try {
            byte[] salt = Base64.getDecoder().decode(stored.salt);
            byte[] iv = Base64.getDecoder().decode(stored.iv);
            byte[] combined = Base64.getDecoder().decode(stored.data);

            SecretKey key = deriveLegacyKey(passphrase, salt);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] plaintext = cipher.doFinal(combined);
            String json = new String(plaintext, StandardCharsets.UTF_8);
            return mapper.readValue(json, WalletFile.class);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Incorrect passphrase.");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse legacy wallet", e);
        }
    }

    private static SecretKey deriveLegacyKey(String passphrase, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, 100_000, 256);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512");
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    private WalletFile toWalletFile(WalletEncFile stored) {
        Map<String, Object> data = new HashMap<>();
        if (stored.extra != null) {
            data.putAll(stored.extra);
        }
        data.put("version", stored.version);
        if (stored.seed != null) {
            data.put("seed", stored.seed);
        }
        return mapper.convertValue(data, WalletFile.class);
    }

    private static Map<String, Object> walletToMap(WalletFile wallet) {
        ObjectMapper mapper = WalletJsonMapper.mapper();
        Map<String, Object> data = mapper.convertValue(wallet, new TypeReference<>() {});
        data.remove("version");
        data.remove("seed");
        return data;
    }

    private static String toJson(ObjectMapper mapper, Map<String, Object> data) {
        try {
            return mapper.writeValueAsString(data);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize wallet", e);
        }
    }

    private static Map<String, Object> fromJson(ObjectMapper mapper, String data) {
        try {
            return mapper.readValue(data, new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse wallet", e);
        }
    }

    private WalletFile deepCopyWallet(WalletFile wallet) {
        try {
            String json = mapper.writeValueAsString(wallet);
            return mapper.readValue(json, WalletFile.class);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to clone wallet", e);
        }
    }
}
