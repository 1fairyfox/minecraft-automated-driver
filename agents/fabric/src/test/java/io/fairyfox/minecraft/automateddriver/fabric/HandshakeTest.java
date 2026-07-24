package io.fairyfox.minecraft.automateddriver.fabric;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The discovery file: shape, round-trip, and deletion. */
class HandshakeTest {

    @Test
    void writesTheDiscoveryShapeAndDeletes(@TempDir Path dir) throws IOException {
        Path agentDir = dir.resolve("agent");
        Path file = Handshake.write(agentDir, 54321, "a".repeat(64), 4242L);
        assertTrue(Files.exists(file));
        String json = Files.readString(file).trim();
        assertEquals(
            "{\"v\":1,\"port\":54321,\"token\":\"" + "a".repeat(64) + "\",\"pid\":4242,\"agent\":\"fabric\"}",
            json);

        Handshake.delete(agentDir);
        assertFalse(Files.exists(file));
    }

    @Test
    void deleteIsSafeWhenAbsent(@TempDir Path dir) {
        Handshake.delete(dir.resolve("never-created")); // must not throw
    }

    @Test
    void restrictsToOwnerOnPosix(@TempDir Path dir) throws IOException {
        Path file = Handshake.write(dir, 1, "t", 1L);
        // On POSIX filesystems the handshake (which carries the session token) must be
        // owner-only (rw-------). On non-POSIX (Windows) the call is skipped; ACLs cover it.
        if (file.getFileSystem().supportedFileAttributeViews().contains("posix")) {
            assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(file)));
        }
    }

    @Test
    void escapesTokenSafely(@TempDir Path dir) throws IOException {
        // Tokens are hex in practice, but the writer must not emit invalid JSON regardless.
        Path file = Handshake.write(dir, 1, "a\"b", 1L);
        assertTrue(Files.readString(file).contains("\"token\":\"a\\\"b\""));
    }

    @Test
    void writeWrapsIoErrorsUnchecked(@TempDir Path dir) throws IOException {
        // A FILE where the agent dir should be: createDirectories throws IOException,
        // which the writer must surface as UncheckedIOException (covers the catch).
        Path clash = dir.resolve("clash");
        Files.createFile(clash);
        assertThrows(UncheckedIOException.class, () -> Handshake.write(clash, 1, "t", 1L));
    }

    @Test
    void deleteWrapsIoErrorsUnchecked(@TempDir Path dir) throws IOException {
        // handshake.json exists as a NON-EMPTY directory → deleteIfExists throws
        // DirectoryNotEmptyException, surfaced as UncheckedIOException.
        Path asDir = dir.resolve(Handshake.FILE_NAME);
        Files.createDirectory(asDir);
        Files.createFile(asDir.resolve("blocker"));
        assertThrows(UncheckedIOException.class, () -> Handshake.delete(dir));
    }
}
