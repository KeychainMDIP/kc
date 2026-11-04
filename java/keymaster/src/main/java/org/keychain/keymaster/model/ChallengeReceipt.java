package org.keychain.keymaster.model;

public class ChallengeReceipt {
    public int version = 1;
    public String attesterDid;
    public String schemaDid;
    public String requesterDid;
    public String responseCommitment;
}
