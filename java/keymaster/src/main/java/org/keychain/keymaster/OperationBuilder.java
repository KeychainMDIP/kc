package org.keychain.keymaster;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Objects;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;

public class OperationBuilder {
    private static final DateTimeFormatter ISO_MILLIS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private final Clock clock;

    public OperationBuilder() {
        this(Clock.systemUTC());
    }

    public OperationBuilder(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock is required");
    }

    public Operation createIdOperation(String registry, EcdsaJwkPublic publicJwk, String blockid) {
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }
        if (publicJwk == null) {
            throw new IllegalArgumentException("publicJwk is required");
        }

        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "agent";
        mdip.registry = registry;

        Operation operation = new Operation();
        operation.type = "create";
        operation.created = nowIso();
        operation.blockid = blockid;
        operation.mdip = mdip;
        operation.publicJwk = publicJwk;
        return operation;
    }

    public Operation createAssetOperation(
        String registry,
        String controller,
        Object data,
        String blockid,
        String validUntil
    ) {
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }
        if (controller == null || controller.isBlank()) {
            throw new IllegalArgumentException("controller is required");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }

        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "asset";
        mdip.registry = registry;
        mdip.validUntil = validUntil;

        Operation operation = new Operation();
        operation.type = "create";
        operation.created = nowIso();
        operation.blockid = blockid;
        operation.mdip = mdip;
        operation.controller = controller;
        operation.data = data;
        return operation;
    }

    public Operation updateDidOperation(String did, String previd, String blockid, MdipDocument doc) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        if (doc == null) {
            throw new IllegalArgumentException("doc is required");
        }

        Operation operation = new Operation();
        operation.type = "update";
        operation.did = did;
        operation.previd = previd;
        operation.blockid = blockid;
        operation.doc = stripMetadata(doc);
        return operation;
    }

    private String nowIso() {
        return ISO_MILLIS.format(Instant.now(clock));
    }

    private static MdipDocument stripMetadata(MdipDocument doc) {
        MdipDocument copy = new MdipDocument();
        copy.didDocument = doc.didDocument;
        copy.didDocumentData = doc.didDocumentData;
        copy.mdip = doc.mdip;
        copy.didDocumentMetadata = null;
        copy.didResolutionMetadata = null;
        return copy;
    }
}
