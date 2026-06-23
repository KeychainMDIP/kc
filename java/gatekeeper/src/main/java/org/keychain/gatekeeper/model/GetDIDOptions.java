package org.keychain.gatekeeper.model;

import java.util.List;

public class GetDIDOptions {
    public List<String> dids;
    public String updatedAfter;
    public String updatedBefore;
    public Boolean confirm;
    public Boolean verify;
    public Boolean resolve;

    public GetDIDOptions() {}
}
