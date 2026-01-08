package org.keychain.gatekeeper.ipfs;

public interface IpfsClient {
    String addText(String text);
    String getText(String cid);
    String addData(byte[] data);
    byte[] getData(String cid);
    String addJSON(Object json);
    Object getJSON(String cid);
}
