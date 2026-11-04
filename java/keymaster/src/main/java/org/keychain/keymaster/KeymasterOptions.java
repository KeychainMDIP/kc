package org.keychain.keymaster;

import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletStore;

public class KeymasterOptions {
    public WalletStore<WalletEncFile> wallet;
    public GatekeeperInterface gatekeeper;
    public KeymasterCrypto crypto = new KeymasterCryptoImpl();
    public OperationFactory operationFactory;
    public String passphrase;
    public String defaultRegistry;
    public String didPrefix;
    public int maxNameLength = 32;
}
