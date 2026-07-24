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
            // Restrict to the owner on POSIX filesystems. Guard by capability rather than
            // catching UnsupportedOperationException so control flow is deterministic and the
            // gate can measure it honestly (the exception-driven form left the branch forever
            // uncovered on whichever OS the tests ran — a gap the build cache was hiding). On
            // Windows the user config dir is already owner-scoped by ACLs.
            if (file.getFileSystem().supportedFileAttributeViews().contains("posix")) {
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
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
