package org.keychain.keymaster;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
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
        if (isLegacyV0(stored)) {
            wallet = upgradeWallet(toWalletFile(stored));
            store.saveWallet(encryptWalletForStorage(wallet), true);
        } else if (isV1WithEnc(stored)) {
            wallet = decryptWalletFromStorage(stored);
        } else if (isV1Decrypted(stored)) {
            wallet = toWalletFile(stored);
        } else {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }

        WalletJsonMapper.walletPayload(wallet);
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
        WalletFile wallet = decryptWalletFromStorage(stored);
        boolean ok = store.saveWallet(stored, overwrite);
        if (ok) {
            walletCache = wallet;
            hdkeyCache = null;
        }
        return ok;
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        writeLock.lock();
        try {
            WalletFile wallet = loadWallet();
            if (wallet == null) {
                throw new IllegalStateException("No wallet loaded");
            }

            WalletFile working = deepCopyWallet(wallet);
            String before = toJson(mapper, WalletJsonMapper.walletPayload(working));
            mutator.accept(working);
            String after = toJson(mapper, WalletJsonMapper.walletPayload(working));

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
            WalletJsonMapper.walletPayload(wallet);
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
            upgraded.additionalProperties().putAll(wallet.additionalProperties());

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

        String plaintext = toJson(mapper, WalletJsonMapper.walletPayload(wallet));
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

        String mnemonic;
        try {
            mnemonic = MnemonicEncryption.decrypt(stored.seed.mnemonicEnc, passphrase);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Keymaster: Incorrect passphrase.", e);
        }
        DeterministicKey master = HdKeyUtil.masterFromMnemonic(mnemonic);
        var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        String plaintext = crypto.decryptMessage(jwk.publicJwk, jwk.privateJwk, stored.enc);

        Map<String, Object> data = fromJson(mapper, plaintext);
        WalletJsonMapper.validatePayload(data);
        data.put("version", stored.version);
        data.put("seed", stored.seed);

        return mapper.convertValue(data, WalletFile.class);
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

    private WalletFile toWalletFile(WalletEncFile stored) {
        return mapper.convertValue(stored, WalletFile.class);
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
