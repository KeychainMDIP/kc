package org.keychain.keymaster;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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

        walletCache = decryptWalletFromStorage(stored);
        return walletCache;
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        WalletEncFile stored = encryptWalletForStorage(wallet);
        boolean ok = store.saveWallet(stored, overwrite);
        if (ok) {
            walletCache = wallet;
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

    DeterministicKey getHdkeyCache() {
        return hdkeyCache;
    }

    WalletFile getWalletCache() {
        return walletCache;
    }

    private DeterministicKey getHdKeyFromCacheOrMnemonic(WalletFile wallet) {
        if (hdkeyCache != null) {
            return hdkeyCache;
        }

        String mnemonic = MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
        hdkeyCache = HdKeyUtil.masterFromMnemonic(mnemonic);
        return hdkeyCache;
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

    private static Map<String, Object> walletToMap(WalletFile wallet) {
        ObjectMapper mapper = WalletJsonMapper.mapper();
        Map<String, Object> data = mapper.convertValue(wallet, new TypeReference<Map<String, Object>>() {});
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
            return mapper.readValue(data, new TypeReference<Map<String, Object>>() {});
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
