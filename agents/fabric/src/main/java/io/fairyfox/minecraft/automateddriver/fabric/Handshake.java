package io.fairyfox.minecraft.automateddriver.fabric;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

/**
 * The discovery file (docs/control-protocol.md §Discovery), pure + unit-tested. Written to
 * the client's config dir under this agent's own folder; deleted on shutdown. Hand-rolled
 * JSON (fixed tiny shape) so there's no serialisation dependency to test around.
 */
public final class Handshake {
    public static final String FILE_NAME = "handshake.json";

    private Handshake() {
    }

    public static Path write(Path dir, int port, String token, long pid) {
        try {
            Files.createDirectories(dir);
            Path file = dir.resolve(FILE_NAME);
            String json = "{\"v\":1,\"port\":" + port + ",\"token\":" + WidgetIntrospector.quote(token)
                + ",\"pid\":" + pid + ",\"agent\":\"fabric\"}\n";
            Files.writeString(file, json);
            try {
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
            } catch (UnsupportedOperationException ignored) {
                // Windows: ACLs already scope the user config dir to the owner.
            }
            return file;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static void delete(Path dir) {
        try {
            Files.deleteIfExists(dir.resolve(FILE_NAME));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
