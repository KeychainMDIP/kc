package org.keychain.gatekeeper;

import org.keychain.gatekeeper.model.GatekeeperError;

public class GatekeeperClientException extends RuntimeException {
    public final int statusCode;
    public final GatekeeperError error;

    public GatekeeperClientException(String message, int statusCode, GatekeeperError error) {
        super(message);
        this.statusCode = statusCode;
        this.error = error;
    }
}
