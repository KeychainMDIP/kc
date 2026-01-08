package org.keychain.keymaster;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMapper;

public class WalletCrypto {
    private final KeymasterCrypto crypto;
    private final ObjectMapper mapper;
    private final String passphrase;

    public WalletCrypto(KeymasterCrypto crypto, String passphrase) {
        this.crypto = crypto;
        this.mapper = WalletJsonMapper.mapper();
        this.passphrase = passphrase;
    }

    public WalletCrypto(String passphrase) {
        this(new KeymasterCryptoImpl(), passphrase);
    }

    public WalletEncFile encryptForStorage(WalletFile wallet) {
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("wallet.seed.mnemonicEnc is required");
        }

        Seed safeSeed = new Seed();
        safeSeed.mnemonicEnc = wallet.seed.mnemonicEnc;

        String plaintext = toJson(mapper, walletToMap(wallet));
        String mnemonic = MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
        var master = HdKeyUtil.masterFromMnemonic(mnemonic);
        var jwk = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        String enc = crypto.encryptMessage(jwk.publicJwk, jwk.privateJwk, plaintext);

        WalletEncFile stored = new WalletEncFile();
        stored.version = wallet.version != null ? wallet.version : 1;
        stored.seed = safeSeed;
        stored.enc = enc;
        return stored;
    }

    public WalletFile decryptFromStorage(WalletEncFile stored) {
        if (stored == null || stored.seed == null || stored.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("stored.seed.mnemonicEnc is required");
        }

        String mnemonic = MnemonicEncryption.decrypt(stored.seed.mnemonicEnc, passphrase);
        var master = HdKeyUtil.masterFromMnemonic(mnemonic);
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
}
