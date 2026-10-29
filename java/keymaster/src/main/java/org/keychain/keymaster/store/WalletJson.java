package org.keychain.keymaster.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;

public class WalletJson<T> implements WalletStore<T> {
    private final ObjectMapper mapper;
    private final Class<T> type;
    private final Path walletPath;

    public WalletJson(Class<T> type, Path dataFolder, String walletFileName) {
        this.mapper = WalletJsonMapper.mapper();
        this.type = type;
        this.walletPath = dataFolder.resolve(walletFileName);
    }

    @Override
    public synchronized boolean saveWallet(T wallet, boolean overwrite) {
        if (Files.exists(walletPath) && !overwrite) {
            return false;
        }

        Path temporary = null;
        try {
            Path directory = walletPath.toAbsolutePath().getParent();
            Files.createDirectories(directory);
            byte[] json = mapper.writeValueAsBytes(wallet);
            PosixFileAttributes attributes = null;
            PosixFileAttributeView view = Files.getFileAttributeView(walletPath, PosixFileAttributeView.class);
            if (view != null && Files.exists(walletPath)) {
                attributes = view.readAttributes();
            }

            temporary = Files.createTempFile(directory, "wallet", ".tmp");
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer bytes = ByteBuffer.wrap(json);
                while (bytes.hasRemaining()) {
                    channel.write(bytes);
                }
                if (attributes != null) {
                    PosixFileAttributeView temporaryView = Files.getFileAttributeView(temporary, PosixFileAttributeView.class);
                    temporaryView.setOwner(attributes.owner());
                    temporaryView.setGroup(attributes.group());
                    temporaryView.setPermissions(attributes.permissions());
                }
                channel.force(true);
            }
            replaceWallet(temporary);
            return true;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to save wallet", e);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // Preserve the original write failure if cleanup also fails.
                }
            }
        }
    }

    void replaceWallet(Path temporary) throws IOException {
        Files.move(temporary, walletPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    @Override
    public synchronized T loadWallet() {
        try {
            String json = Files.readString(walletPath);
            return mapper.readValue(json, type);
        } catch (NoSuchFileException e) {
            return null;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load wallet", e);
        }
    }

}
