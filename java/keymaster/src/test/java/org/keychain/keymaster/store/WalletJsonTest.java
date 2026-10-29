package org.keychain.keymaster.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.GroupPrincipal;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletFile;

class WalletJsonTest {
    @TempDir
    Path tempDir;

    @Test
    void saveLoadRoundTrip() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = 0;
        wallet.seed = new Seed();
        wallet.ids = new HashMap<>();

        assertTrue(store.saveWallet(wallet, false));
        WalletFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(1, loaded.version);
        assertEquals(0, loaded.counter);
    }

    @Test
    void overwriteIsRespected() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        WalletFile wallet1 = new WalletFile();
        wallet1.version = 1;
        wallet1.counter = 0;
        wallet1.seed = new Seed();
        wallet1.ids = new HashMap<>();

        WalletFile wallet2 = new WalletFile();
        wallet2.version = 1;
        wallet2.counter = 2;
        wallet2.seed = new Seed();
        wallet2.ids = new HashMap<>();

        assertTrue(store.saveWallet(wallet1, false));
        assertFalse(store.saveWallet(wallet2, false));
        assertTrue(store.saveWallet(wallet2, true));

        WalletFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(2, loaded.counter);
    }

    @Test
    void loadReturnsNullIfMissing() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        assertNull(store.loadWallet());
        assertFalse(Files.exists(tempDir.resolve("wallet.json")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void failedAtomicReplacementKeepsOldWalletAndCleansTemporaryFile(boolean unsupported) throws Exception {
        Path walletPath = tempDir.resolve("wallet.json");
        WalletJson<WalletFile> original = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        assertTrue(original.saveWallet(wallet(1), false));
        String before = Files.readString(walletPath);
        WalletJson<WalletFile> failing = new WalletJson<>(WalletFile.class, tempDir, "wallet.json") {
            @Override
            void replaceWallet(Path temporary) throws IOException {
                assertEquals(walletPath.toAbsolutePath().getParent(), temporary.getParent());
                assertEquals(2, WalletJsonMapper.mapper().readValue(Files.readString(temporary), WalletFile.class).counter);
                if (unsupported) {
                    throw new AtomicMoveNotSupportedException(temporary.toString(), walletPath.toString(), "test filesystem");
                }
                throw new IOException("replacement failed");
            }
        };

        assertThrows(IllegalStateException.class, () -> failing.saveWallet(wallet(2), true));

        assertEquals(before, Files.readString(walletPath));
        assertEquals(1, original.loadWallet().counter);
        try (var files = Files.list(tempDir)) {
            assertEquals(1, files.count());
        }
    }

    @Test
    void successfulReplacementPreservesExistingPermissions() throws Exception {
        assumeTrue(Files.getFileStore(tempDir).supportsFileAttributeView("posix"));
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        assertTrue(store.saveWallet(wallet(1), false));
        Path file = tempDir.resolve("wallet.json");
        var permissions = PosixFilePermissions.fromString("r--r-----");
        Files.setPosixFilePermissions(file, permissions);

        assertTrue(store.saveWallet(wallet(2), true));

        assertEquals(permissions, Files.getPosixFilePermissions(file));
        assertEquals(2, store.loadWallet().counter);
    }

    @Test
    void replacementPreservesTheGroupAllowedToReadTheWallet() throws Exception {
        assumeTrue(Files.getFileStore(tempDir).supportsFileAttributeView("posix"));
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        assertTrue(store.saveWallet(wallet(1), false));
        Path file = tempDir.resolve("wallet.json");
        PosixFileAttributeView view = Files.getFileAttributeView(file, PosixFileAttributeView.class);
        GroupPrincipal initial = view.readAttributes().group();
        GroupPrincipal alternate = null;
        for (String name : new String[] {"docker", "users", "staff", "adm"}) {
            try {
                GroupPrincipal group = file.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByGroupName(name);
                if (!group.equals(initial)) {
                    view.setGroup(group);
                    alternate = group;
                    break;
                }
            } catch (IOException ignored) {
                // An available secondary group depends on the test account.
            }
        }
        assumeTrue(alternate != null, "No writable secondary group available");
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r-----"));

        assertTrue(store.saveWallet(wallet(2), true));

        assertEquals(alternate, view.readAttributes().group());
        assertEquals(2, store.loadWallet().counter);
    }

    @Test
    void nestedWalletUsesItsOwnDirectoryForReplacement() {
        Path directory = tempDir.resolve("nested");
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "nested/wallet.json") {
            @Override
            void replaceWallet(Path temporary) throws IOException {
                assertEquals(directory, temporary.getParent());
                super.replaceWallet(temporary);
            }
        };

        assertTrue(store.saveWallet(wallet(1), false));

        assertEquals(1, store.loadWallet().counter);
    }

    @Test
    void corruptJsonIsNotTreatedAsAnAbsentWallet() throws Exception {
        Path file = tempDir.resolve("wallet.json");
        Files.writeString(file, "broken JSON");
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");

        assertThrows(IllegalStateException.class, store::loadWallet);

        assertEquals("broken JSON", Files.readString(file));
    }

    @Test
    void walletStringsAreNotChangedByUtf8Encoding() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        WalletFile wallet = wallet(1);
        String text = "text" + (char) 0xd800;
        wallet.additionalProperties().put("text", text);

        assertTrue(store.saveWallet(wallet, false));

        assertEquals(text, store.loadWallet().additionalProperties().get("text"));
    }

    private static WalletFile wallet(int counter) {
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = counter;
        wallet.ids = new HashMap<>();
        wallet.seed = new Seed();
        return wallet;
    }
}
