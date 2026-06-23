package org.keychain.gatekeeper.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class MdipDocument {
    public DidDocument didDocument;
    public DocumentMetadata didDocumentMetadata;
    public DidResolutionMetadata didResolutionMetadata;
    public Object didDocumentData;
    public Mdip mdip;

    public MdipDocument() {}

    public static class DidDocument {
        @JsonProperty("@context")
        public List<String> context;
        public String id;
        public String controller;
        public List<VerificationMethod> verificationMethod;
        public List<String> authentication;

        public DidDocument() {}
    }

    public static class VerificationMethod {
        public String id;
        public String controller;
        public String type;
        public EcdsaJwkPublic publicKeyJwk;

        public VerificationMethod() {}
    }

    public static class DidResolutionMetadata {
        public String contentType;
        public String retrieved;
        public String error;

        public DidResolutionMetadata() {}
    }
}
