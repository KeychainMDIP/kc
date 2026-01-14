package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveNameTest {
    @TempDir
    Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void addNameCreatesNewName() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        boolean ok = keymaster.addName("Jack", bob);
        WalletFile wallet = keymaster.loadWallet();

        assertTrue(ok);
        assertEquals(bob, wallet.names.get("Jack"));
    }

    @Test
    void addNameUnicodeName() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        String name = "ҽ× ʍɑϲհíղɑ";

        boolean ok = keymaster.addName(name, bob);
        WalletFile wallet = keymaster.loadWallet();

        assertTrue(ok);
        assertEquals(bob, wallet.names.get(name));
    }

    @Test
    void addNameRejectsDuplicate() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");

        keymaster.addName("Jack", alice);
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("Jack", bob)
        );
        assertEquals("Invalid parameter: name already used", error.getMessage());
    }

    @Test
    void addNameRejectsIdName() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("Alice", alice)
        );
        assertEquals("Invalid parameter: name already used", error.getMessage());
    }

    @Test
    void addNameRejectsEmptyName() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String expected = "Invalid parameter: name must be a non-empty string";

        IllegalArgumentException blank = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("", alice)
        );
        assertEquals(expected, blank.getMessage());

        IllegalArgumentException whitespace = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("    ", alice)
        );
        assertEquals(expected, whitespace.getMessage());
    }

    @Test
    void addNameRejectsTooLong() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("1234567890123456789012345678901234567890", alice)
        );
        assertEquals("Invalid parameter: name too long", error.getMessage());
    }

    @Test
    void addNameRejectsUnprintable() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.addName("hello\nworld!", alice)
        );
        assertEquals("Invalid parameter: name contains unprintable characters", error.getMessage());
    }

    @Test
    void getNameReturnsDid() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        boolean ok = keymaster.addName("Jack", bob);
        String did = keymaster.getName("Jack");

        assertTrue(ok);
        assertEquals(bob, did);
    }

    @Test
    void getNameUnknownReturnsNull() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String did = keymaster.getName("Jack");
        assertNull(did);
    }

    @Test
    void removeNameRemovesName() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");

        keymaster.addName("Jack", bob);
        keymaster.removeName("Jack");

        WalletFile wallet = keymaster.loadWallet();
        assertNull(wallet.names.get("Jack"));
    }

    @Test
    void removeNameMissingReturnsTrue() {
        Keymaster keymaster = newKeymaster();
        boolean ok = keymaster.removeName("Jack");

        assertTrue(ok);
    }

    @Test
    void listNamesReturnsAllNames() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");

        for (int i = 0; i < 10; i += 1) {
            keymaster.addName("name-" + i, bob);
        }

        java.util.Map<String, String> names = keymaster.listNames(false);
        assertEquals(10, names.size());
        for (String name : names.keySet()) {
            assertEquals(bob, names.get(name));
        }
    }

    @Test
    void listNamesIncludesIdsWhenRequested() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        String alice = keymaster.createId("Alice");

        for (int i = 0; i < 10; i += 1) {
            keymaster.addName("name-" + i, bob);
        }

        java.util.Map<String, String> names = keymaster.listNames(true);
        assertEquals(12, names.size());
        assertEquals(bob, names.get("Bob"));
        assertEquals(alice, names.get("Alice"));
    }

    @Test
    void listNamesEmptyWhenNoNamesAdded() {
        Keymaster keymaster = newKeymaster();
        java.util.Map<String, String> names = keymaster.listNames(false);
        assertEquals(0, names.size());
    }
}
