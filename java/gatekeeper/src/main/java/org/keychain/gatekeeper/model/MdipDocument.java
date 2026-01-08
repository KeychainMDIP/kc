package org.keychain.gatekeeper.model;

import java.util.List;
import java.util.Map;

public class MdipDocument {
    public DidDocument didDocument;
    public Object didDocumentData;
    public DocumentMetadata didDocumentMetadata;
    public ResolveMetadata didResolutionMetadata;
    public Mdip mdip;

    public MdipDocument() {}

    public static class DidDocument {
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
        public Map<String, Object> publicKeyJwk;

        public VerificationMethod() {}
    }

    public static class ResolveMetadata {
        public String error;
        public String errorMessage;

        public ResolveMetadata() {}
    }
}
