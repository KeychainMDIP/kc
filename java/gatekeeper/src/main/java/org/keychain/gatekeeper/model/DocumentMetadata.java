package org.keychain.gatekeeper.model;

public class DocumentMetadata extends ExtensibleModel {
    public String created;
    public String updated;
    public String canonicalId;
    public String versionId;
    public String version;
    public Boolean confirmed;
    public Boolean deactivated;
    public Boolean isOwned;
    public String deleted;
    public Object timestamp;

    public DocumentMetadata() {}
}
