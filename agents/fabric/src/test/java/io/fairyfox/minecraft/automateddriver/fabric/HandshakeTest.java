package io.fairyfox.minecraft.automateddriver.fabric;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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
    void escapesTokenSafely(@TempDir Path dir) throws IOException {
        // Tokens are hex in practice, but the writer must not emit invalid JSON regardless.
        Path file = Handshake.write(dir, 1, "a\"b", 1L);
        assertTrue(Files.readString(file).contains("\"token\":\"a\\\"b\""));
    }
}
