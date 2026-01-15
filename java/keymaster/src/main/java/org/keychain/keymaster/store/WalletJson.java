package org.keychain.keymaster.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public class WalletJson<T> implements WalletStore<T> {
    private final ObjectMapper mapper;
    private final Class<T> type;
    private final Path dataFolder;
    private final Path walletPath;

    public WalletJson(Class<T> type, Path dataFolder, String walletFileName) {
        this.mapper = WalletJsonMapper.mapper();
        this.type = type;
        this.dataFolder = dataFolder;
        this.walletPath = dataFolder.resolve(walletFileName);
    }

    @Override
    public boolean saveWallet(T wallet, boolean overwrite) {
        if (Files.exists(walletPath) && !overwrite) {
            return false;
        }

        try {
            if (!Files.exists(dataFolder)) {
                Files.createDirectories(dataFolder);
            }

            String json = mapper.writeValueAsString(wallet);
            Path tmp = Files.createTempFile(dataFolder, "wallet", ".tmp");
            Files.writeString(tmp, json);
            try {
                Files.move(tmp, walletPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, walletPath, StandardCopyOption.REPLACE_EXISTING);
            }
            return true;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to save wallet", e);
        }
    }

    @Override
    public T loadWallet() {
        if (!Files.exists(walletPath)) {
            return null;
        }

        try {
            String json = Files.readString(walletPath);
            return mapper.readValue(json, type);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load wallet", e);
        }
    }

}
