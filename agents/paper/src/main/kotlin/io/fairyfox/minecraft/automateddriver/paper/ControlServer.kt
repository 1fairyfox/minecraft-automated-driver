package io.fairyfox.minecraft.automateddriver.paper

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.bukkit.Bukkit
import java.io.BufferedReader
import java.io.BufferedWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * The loopback control plane (docs/control-protocol.md): NDJSON over TCP, bound to
 * 127.0.0.1 ONLY on an ephemeral port — there is deliberately no way to widen the
 * bind. First line must be a valid hello with the session token or the connection
 * is closed without explanation.
 */
class ControlServer(private val plugin: PaperAgent, private val token: String) {
    private val gson = Gson()
    private var socket: ServerSocket? = null
    private val clients = Collections.synchronizedList(mutableListOf<BufferedWriter>())
    @Volatile private var running = false

    /** Bind + start the accept loop; returns the ephemeral port. */
    fun start(): Int {
        val server = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
        socket = server
        running = true
        thread("mad-agent-accept") {
            while (running) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                thread("mad-agent-conn") { serve(client) }
            }
        }
        return server.localPort
    }

    fun stop() {
        running = false
        runCatching { socket?.close() }
        synchronized(clients) { clients.forEach { runCatching { it.close() } } }
        clients.clear()
    }

    /** Push an event line to every authenticated connection. */
    fun broadcastEvent(name: String, data: Map<String, Any?>) {
        val line = gson.toJson(
            mapOf("type" to "event", "name" to name, "data" to data),
        )
        synchronized(clients) {
            clients.removeAll { writer ->
                runCatching {
                    writer.write(line)
                    writer.newLine()
                    writer.flush()
                }.isFailure
            }
        }
    }

    private fun serve(client: Socket) {
        client.use { sock ->
            val reader = sock.getInputStream().bufferedReader()
            val writer = sock.getOutputStream().bufferedWriter()
            if (!authenticate(reader)) return // close silently — nothing to probe
            // Register BEFORE the welcome so no event fired between welcome-receipt and
            // registration can be lost (a real race the event test caught).
            clients.add(writer)
            writer.writeLine(
                mapOf(
                    "type" to "welcome", "v" to 1, "agent" to "paper",
                    "capabilities" to listOf("state", "exec"),
                    "events" to listOf("player_join", "player_quit"),
                ),
            )
            try {
                while (true) {
                    val line = reader.readLine() ?: break
                    val response = handle(line)
                    writer.writeLine(response)
                }
            } finally {
                clients.remove(writer)
            }
        }
    }

    private fun authenticate(reader: BufferedReader): Boolean {
        val first = reader.readLine() ?: return false
        val hello = runCatching { JsonParser.parseString(first).asJsonObject }.getOrNull() ?: return false
        return hello.get("type")?.asString == "hello" &&
            hello.get("token")?.asString == token
    }

    private fun handle(line: String): Map<String, Any?> {
        val req = runCatching { JsonParser.parseString(line).asJsonObject }.getOrNull()
            ?: return mapOf("type" to "res", "id" to -1, "ok" to false, "error" to "malformed request")
        val id = runCatching { req.get("id").asInt }.getOrDefault(-1)
        return when (val op = req.get("op")?.asString) {
            "state" -> onMain(id) { Ops.state() }
            "exec" -> onMain(id) { Ops.exec(req.get("command")?.asString ?: "") }
            else -> mapOf("type" to "res", "id" to id, "ok" to false, "error" to "unknown op: $op")
        }
    }

    /**
     * Marshal game-state work to the main thread; a stuck request can't wedge the loop.
     * Uses runTask + a CompletableFuture (rather than callSyncMethod) — the former is
     * the broadly-supported path, incl. under MockBukkit's tick-driven scheduler.
     */
    private fun onMain(id: Int, work: () -> Map<String, Any?>): Map<String, Any?> = runCatching {
        val result =
            if (Bukkit.isPrimaryThread()) {
                work()
            } else {
                val future = CompletableFuture<Map<String, Any?>>()
                Bukkit.getScheduler().runTask(
                    plugin,
                    Runnable {
                        runCatching { work() }.fold(
                            onSuccess = { future.complete(it) },
                            onFailure = { future.completeExceptionally(it) },
                        )
                    },
                )
                future.get(10, TimeUnit.SECONDS)
            }
        mapOf("type" to "res", "id" to id, "ok" to true) + result
    }.getOrElse { err ->
        val cause = (err as? java.util.concurrent.ExecutionException)?.cause ?: err
        mapOf("type" to "res", "id" to id, "ok" to false, "error" to (cause.message ?: cause.toString()))
    }

    private fun BufferedWriter.writeLine(payload: Map<String, Any?>) {
        write(gson.toJson(payload))
        newLine()
        flush()
    }

    private fun thread(name: String, body: () -> Unit) {
        Thread(body, name).apply {
            isDaemon = true
            start()
        }
    }
}
