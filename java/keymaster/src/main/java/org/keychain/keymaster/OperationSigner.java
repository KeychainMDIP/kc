package org.keychain.keymaster;

import org.keychain.crypto.JwkPrivate;
import org.keychain.gatekeeper.model.Operation;

public interface OperationSigner {
    Operation sign(Operation operation, JwkPrivate privateJwk, String signerDid);

    Operation signCreate(Operation operation, JwkPrivate privateJwk);
}
