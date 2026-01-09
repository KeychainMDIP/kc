package org.keychain.keymaster;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Objects;
import org.keychain.crypto.JwkPrivate;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.Signature;

public class OperationSignerImpl implements OperationSigner {
    private static final DateTimeFormatter ISO_MILLIS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private final KeymasterCrypto crypto;
    private final Clock clock;

    public OperationSignerImpl(KeymasterCrypto crypto) {
        this(crypto, Clock.systemUTC());
    }

    public OperationSignerImpl(KeymasterCrypto crypto, Clock clock) {
        this.crypto = Objects.requireNonNull(crypto, "crypto is required");
        this.clock = Objects.requireNonNull(clock, "clock is required");
    }

    @Override
    public Operation sign(Operation operation, JwkPrivate privateJwk, String signerDid) {
        if (operation == null) {
            throw new IllegalArgumentException("operation is required");
        }
        if (privateJwk == null) {
            throw new IllegalArgumentException("privateJwk is required");
        }
        if (signerDid == null || signerDid.isBlank()) {
            throw new IllegalArgumentException("signerDid is required");
        }

        String msgHash = crypto.hashJson(copyWithoutSignature(operation));
        String signatureValue = crypto.signHash(msgHash, privateJwk);

        Signature signature = new Signature();
        signature.signer = signerDid;
        signature.signed = nowIso();
        signature.hash = msgHash;
        signature.value = signatureValue;

        Operation signed = copyOperation(operation);
        signed.signature = signature;
        return signed;
    }

    @Override
    public Operation signCreate(Operation operation, JwkPrivate privateJwk) {
        if (operation == null) {
            throw new IllegalArgumentException("operation is required");
        }
        if (privateJwk == null) {
            throw new IllegalArgumentException("privateJwk is required");
        }

        String msgHash = crypto.hashJson(copyWithoutSignature(operation));
        String signatureValue = crypto.signHash(msgHash, privateJwk);

        Signature signature = new Signature();
        signature.signed = nowIso();
        signature.hash = msgHash;
        signature.value = signatureValue;

        Operation signed = copyOperation(operation);
        signed.signature = signature;
        return signed;
    }

    private String nowIso() {
        return ISO_MILLIS.format(Instant.now(clock));
    }

    private static Operation copyWithoutSignature(Operation operation) {
        Operation copy = copyOperation(operation);
        copy.signature = null;
        return copy;
    }

    private static Operation copyOperation(Operation operation) {
        Operation copy = new Operation();
        copy.type = operation.type;
        copy.created = operation.created;
        copy.blockid = operation.blockid;
        copy.did = operation.did;
        copy.previd = operation.previd;
        copy.mdip = operation.mdip;
        copy.controller = operation.controller;
        copy.data = operation.data;
        copy.doc = operation.doc;
        copy.publicJwk = operation.publicJwk;
        copy.signature = operation.signature;
        return copy;
    }
}
