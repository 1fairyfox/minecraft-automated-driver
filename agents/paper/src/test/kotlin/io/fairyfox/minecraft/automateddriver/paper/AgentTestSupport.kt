package io.fairyfox.minecraft.automateddriver.paper

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.mockbukkit.mockbukkit.MockBukkit
import org.mockbukkit.mockbukkit.ServerMock
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.net.Socket

/**
 * Test-harness lore (repo standard): the agent's socket handlers marshal game work
 * to the main thread via callSyncMethod, and under MockBukkit scheduled sync tasks
 * only run when the test PUMPS the scheduler — so every request/response helper
 * here ticks while it waits. Reuse these helpers; don't hand-roll socket loops.
 */
object AgentTestSupport {
    fun mockWithGate(open: Boolean): Pair<ServerMock, PaperAgent> {
        if (open) System.setProperty(PaperAgent.ENABLE_PROPERTY, "true")
        val server = MockBukkit.mock()
        val plugin = MockBukkit.load(PaperAgent::class.java)
        return server to plugin
    }

    fun teardown() {
        System.clearProperty(PaperAgent.ENABLE_PROPERTY)
        MockBukkit.unmock()
    }

    fun handshake(plugin: PaperAgent): JsonObject {
        val file = File(plugin.dataFolder, Handshake.FILE_NAME)
        check(file.exists()) { "handshake.json missing" }
        return JsonParser.parseString(file.readText()).asJsonObject
    }

    class Session(handshake: JsonObject, token: String = handshake.get("token").asString) : AutoCloseable {
        val socket = Socket("127.0.0.1", handshake.get("port").asInt)
        val reader: BufferedReader = socket.getInputStream().bufferedReader()
        val writer: BufferedWriter = socket.getOutputStream().bufferedWriter()
        private var nextId = 0

        init {
            socket.soTimeout = 10_000
            send("""{"type":"hello","v":1,"token":"$token"}""")
        }

        fun send(line: String) {
            writer.write(line)
            writer.newLine()
            writer.flush()
        }

        /** Read one line, pumping the MockBukkit scheduler so sync tasks can run. */
        fun readPumping(server: ServerMock): JsonObject? {
            val deadline = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < deadline) {
                if (socket.getInputStream().available() > 0) {
                    val line = reader.readLine() ?: return null
                    return JsonParser.parseString(line).asJsonObject
                }
                server.scheduler.performOneTick()
                Thread.sleep(10)
            }
            error("timed out waiting for a line")
        }

        fun request(server: ServerMock, op: String, extra: String = ""): JsonObject {
            val id = ++nextId
            send("""{"type":"req","id":$id,"op":"$op"$extra}""")
            while (true) {
                val msg = readPumping(server) ?: error("connection closed mid-request")
                if (msg.get("type")?.asString == "res" && msg.get("id")?.asInt == id) return msg
            }
        }

        override fun close() {
            runCatching { socket.close() }
        }
    }
}
