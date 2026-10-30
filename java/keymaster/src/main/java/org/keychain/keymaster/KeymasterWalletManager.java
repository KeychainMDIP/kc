package org.keychain.keymaster;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Supplier;
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
    private String hdkeyCacheSeed;

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
        return withWalletLock(this::loadWalletUnlocked);
    }

    private WalletFile loadWalletUnlocked() {
        if (walletCache != null) {
            return walletCache;
        }

        WalletEncFile stored = store.loadWallet();
        if (stored == null) {
            return null;
        }

        WalletFile wallet;
        DeterministicKey master;
        if (isLegacyV0(stored)) {
            if (!saveWallet(toWalletFile(stored), true)) {
                throw new IllegalStateException("save wallet failed");
            }
            return walletCache;
        } else if (isV1WithEnc(stored)) {
            master = getHdKeyForSeed(stored.seed);
            wallet = decryptWalletFromStorage(stored, master);
        } else if (isV1Decrypted(stored)) {
            wallet = toWalletFile(stored);
            master = getHdKeyForSeed(wallet.seed);
        } else {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }

        WalletJsonMapper.walletPayload(wallet);
        publishWallet(wallet, master);
        return walletCache;
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        return withWalletLock(() -> {
            WalletFile upgraded = upgradeWallet(deepCopyWallet(wallet));
            DeterministicKey master = getHdKeyForSeed(upgraded.seed);
            WalletEncFile stored = encryptWalletForStorage(upgraded, master);
            WalletFile candidate = decryptWalletFromStorage(stored, master);
            boolean ok = store.saveWallet(stored, overwrite);
            if (ok) {
                publishWallet(candidate, master);
            }
            return ok;
        });
    }

    boolean saveStoredWallet(WalletEncFile stored, boolean overwrite) {
        return withWalletLock(() -> {
            WalletEncFile candidate = mapper.convertValue(stored, WalletEncFile.class);
            if (!isV1WithEnc(candidate)) {
                throw new IllegalStateException("Keymaster: Unsupported wallet version.");
            }
            DeterministicKey master = getHdKeyForSeed(candidate.seed);
            WalletFile wallet = decryptWalletFromStorage(candidate, master);
            boolean ok = store.saveWallet(candidate, overwrite);
            if (ok) {
                publishWallet(wallet, master);
            }
            return ok;
        });
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        return withWalletLock(() -> {
            WalletFile wallet = loadWallet();
            if (wallet == null) {
                throw new IllegalStateException("No wallet loaded");
            }

            WalletFile working = deepCopyWallet(wallet);
            String before = toJson(working);
            mutator.accept(working);
            String after = toJson(working);

            if (Objects.equals(before, after)) {
                return false;
            }

            if (walletCache != wallet) {
                throw new IllegalStateException("Wallet changed during mutation. Try again.");
            }
            if (!saveWallet(working, true)) {
                throw new IllegalStateException("save wallet failed");
            }
            return true;
        });
    }

    DeterministicKey getHdKeyFromCacheOrMnemonic(WalletFile wallet) {
        return withWalletLock(() -> getHdKeyForSeed(wallet.seed));
    }

    private DeterministicKey getHdKeyForSeed(Seed seed) {
        if (seed == null || seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("wallet.seed.mnemonicEnc is required");
        }
        String fingerprint = toJson(seed.mnemonicEnc);
        if (hdkeyCache != null && Objects.equals(hdkeyCacheSeed, fingerprint)) {
            return hdkeyCache;
        }

        try {
            String mnemonic = MnemonicEncryption.decrypt(seed.mnemonicEnc, passphrase);
            return HdKeyUtil.masterFromMnemonic(mnemonic);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Keymaster: Incorrect passphrase.", e);
        }
    }

    private void publishWallet(WalletFile wallet, DeterministicKey master) {
        String fingerprint = toJson(wallet.seed.mnemonicEnc);
        walletCache = wallet;
        hdkeyCache = master;
        hdkeyCacheSeed = fingerprint;
    }

    <T> T withWalletLock(Supplier<T> action) {
        writeLock.lock();
        try {
            return action.get();
        } finally {
            writeLock.unlock();
        }
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
            org.keychain.crypto.HdKeyJson json = new org.keychain.crypto.HdKeyJson(
                wallet.seed.hdkey.xpriv, wallet.seed.hdkey.xpub, null, null, null, null);
            org.keychain.crypto.HdKey restored = crypto.generateHdKeyJson(json);
            DeterministicKey key = HdKeyUtil.fromXpriv(restored.xpriv);
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

            return upgraded;
        }

        throw new IllegalStateException("Keymaster: Unsupported wallet version.");
    }

    private WalletEncFile encryptWalletForStorage(WalletFile wallet, DeterministicKey master) {
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("wallet.seed.mnemonicEnc is required");
        }

        Seed safeSeed = new Seed();
        safeSeed.mnemonicEnc = wallet.seed.mnemonicEnc;

        String plaintext = toJson(WalletJsonMapper.walletPayload(wallet));
        var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        String enc = crypto.encryptMessage(jwk.publicJwk, jwk.privateJwk, plaintext);

        WalletEncFile stored = new WalletEncFile();
        stored.version = wallet.version != null ? wallet.version : 1;
        stored.seed = safeSeed;
        stored.enc = enc;
        return stored;
    }

    private WalletFile decryptWalletFromStorage(WalletEncFile stored, DeterministicKey master) {
        if (stored == null || stored.seed == null || stored.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("stored.seed.mnemonicEnc is required");
        }

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

    private static String toJson(Object data) {
        try {
            return WalletJsonMapper.stringify(data);
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
