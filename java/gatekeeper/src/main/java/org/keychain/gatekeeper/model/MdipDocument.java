package org.keychain.gatekeeper.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class MdipDocument extends ExtensibleModel {
    public DidDocument didDocument;
    public DocumentMetadata didDocumentMetadata;
    public DidResolutionMetadata didResolutionMetadata;
    public Object didDocumentData;
    public Mdip mdip;

    public MdipDocument() {}

    public static class DidDocument extends ExtensibleModel {
        @JsonProperty("@context")
        public List<String> context;
        public String id;
        public String controller;
        public List<VerificationMethod> verificationMethod;
        public List<String> authentication;

        public DidDocument() {}
    }

    public static class VerificationMethod extends ExtensibleModel {
        public String id;
        public String controller;
        public String type;
        public EcdsaJwkPublic publicKeyJwk;

        public VerificationMethod() {}
    }

    public static class DidResolutionMetadata extends ExtensibleModel {
        public String contentType;
        public String retrieved;
        public String error;

        public DidResolutionMetadata() {}
    }
}
