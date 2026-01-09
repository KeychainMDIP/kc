package org.keychain.keymaster;

import java.util.Objects;
import org.keychain.crypto.JwkPrivate;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;

public class OperationFactory {
    private final OperationBuilder builder;
    private final OperationSigner signer;

    public OperationFactory(KeymasterCrypto crypto) {
        this(new OperationBuilder(), new OperationSignerImpl(crypto));
    }

    public OperationFactory(OperationBuilder builder, OperationSigner signer) {
        this.builder = Objects.requireNonNull(builder, "builder is required");
        this.signer = Objects.requireNonNull(signer, "signer is required");
    }

    public Operation createSignedCreateIdOperation(
        String registry,
        EcdsaJwkPublic publicJwk,
        JwkPrivate privateJwk,
        String blockid
    ) {
        Operation operation = builder.createIdOperation(registry, publicJwk, blockid);
        return signer.signCreate(operation, privateJwk);
    }

    public Operation createSignedCreateAssetOperation(
        String registry,
        String controller,
        Object data,
        String blockid,
        String validUntil,
        JwkPrivate privateJwk,
        String signerDid
    ) {
        Operation operation = builder.createAssetOperation(registry, controller, data, blockid, validUntil);
        return signer.sign(operation, privateJwk, signerDid);
    }

    public Operation createSignedUpdateDidOperation(
        String did,
        String previd,
        String blockid,
        MdipDocument doc,
        JwkPrivate privateJwk,
        String signerDid
    ) {
        Operation operation = builder.updateDidOperation(did, previd, blockid, doc);
        return signer.sign(operation, privateJwk, signerDid);
    }
}
