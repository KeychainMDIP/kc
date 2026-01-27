package org.keychain.gatekeeper;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.keychain.gatekeeper.model.GatekeeperError;

public final class GatekeeperErrorParser {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private GatekeeperErrorParser() {}

    public static GatekeeperError parse(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }

        try {
            return MAPPER.readValue(body, GatekeeperError.class);
        } catch (Exception e) {
            GatekeeperError error = new GatekeeperError();
            error.message = body;
            return error;
        }
    }
}
