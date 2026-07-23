package io.fairyfox.minecraft.automateddriver.paper

import com.google.gson.JsonObject
import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions

/** The discovery file (docs/control-protocol.md §Discovery). Owner-only where the OS can. */
object Handshake {
    const val FILE_NAME = "handshake.json"

    fun write(dataFolder: File, port: Int, token: String) {
        dataFolder.mkdirs()
        val json = JsonObject().apply {
            addProperty("v", 1)
            addProperty("port", port)
            addProperty("token", token)
            addProperty("pid", ProcessHandle.current().pid())
            addProperty("agent", "paper")
        }
        val file = File(dataFolder, FILE_NAME)
        file.writeText(json.toString() + "\n")
        runCatching {
            // POSIX-only tightening; Windows ACLs already scope temp/user dirs to the owner.
            Files.setPosixFilePermissions(file.toPath(), PosixFilePermissions.fromString("rw-------"))
        }
    }

    fun delete(dataFolder: File) {
        File(dataFolder, FILE_NAME).delete()
    }
}
