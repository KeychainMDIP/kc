package org.keychain.keymaster.testutil;

import com.fasterxml.jackson.core.type.TypeReference;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import org.keychain.keymaster.store.WalletJsonMapper;

public final class CredentialsVectorLoader {
    private CredentialsVectorLoader() {
    }

    public static Map<String, Object> load() {
        try (InputStream input = CredentialsVectorLoader.class.getResourceAsStream("/vectors/credentials-v1.json")) {
            if (input == null) {
                throw new IllegalStateException("credentials-v1.json not found");
            }
            return WalletJsonMapper.mapper().readValue(input, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load credentials-v1.json", e);
        }
    }

    public static List<Map<String, Object>> cases() {
        Map<String, Object> root = load();
        Object casesObj = root.get("cases");
        if (!(casesObj instanceof List<?>)) {
            throw new IllegalStateException("credentials-v1.json cases missing");
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cases = (List<Map<String, Object>>) casesObj;
        return cases;
    }

    public static Map<String, Object> findCase(String name) {
        for (Map<String, Object> entry : cases()) {
            Object caseName = entry.get("name");
            if (name.equals(caseName)) {
                return entry;
            }
        }
        throw new IllegalStateException("credentials-v1.json case not found: " + name);
    }
}
