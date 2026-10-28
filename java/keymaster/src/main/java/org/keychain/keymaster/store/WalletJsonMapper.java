package org.keychain.keymaster.store;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.keychain.keymaster.model.WalletFile;

public final class WalletJsonMapper {
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private WalletJsonMapper() {}

    public static ObjectMapper mapper() {
        return MAPPER;
    }

    public static Map<String, Object> walletPayload(WalletFile wallet) {
        WalletFile validated = MAPPER.convertValue(wallet, WalletFile.class);
        Map<String, Object> data = MAPPER.convertValue(validated, new TypeReference<>() {});
        data.remove("version");
        data.remove("seed");
        validatePayload(data);
        return data;
    }

    public static void validatePayload(Map<String, Object> data) {
        if (data == null || data.containsKey("version") || data.containsKey("seed") || data.containsKey("enc")) {
            throw new IllegalArgumentException("Invalid wallet data");
        }
    }
}
