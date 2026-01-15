package org.keychain.keymaster.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

public class WalletJsonMemory<T> implements WalletStore<T> {
    private final ObjectMapper mapper;
    private final Class<T> type;
    private String walletCache;

    public WalletJsonMemory(Class<T> type) {
        this.mapper = WalletJsonMapper.mapper();
        this.type = type;
    }

    @Override
    public boolean saveWallet(T wallet, boolean overwrite) {
        if (walletCache != null && !overwrite) {
            return false;
        }

        try {
            walletCache = mapper.writeValueAsString(wallet);
            return true;
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Failed to serialize wallet", e);
        }
    }

    @Override
    public T loadWallet() {
        if (walletCache == null) {
            return null;
        }

        try {
            return mapper.readValue(walletCache, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to parse wallet", e);
        }
    }
}
