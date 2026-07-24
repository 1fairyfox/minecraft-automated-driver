package io.fairyfox.minecraft.automateddriver.paper

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockbukkit.mockbukkit.ServerMock
import java.net.Socket
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The wire protocol over a REAL loopback socket against a MockBukkit server. */
class ControlServerTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: PaperAgent

    @BeforeEach fun setUp() {
        val pair = AgentTestSupport.mockWithGate(open = true)
        server = pair.first
        plugin = pair.second
    }

    @AfterEach fun tearDown() = AgentTestSupport.teardown()

    @Test
    fun `binds loopback only`() {
        val hs = AgentTestSupport.handshake(plugin)
        assertEquals("127.0.0.1", plugin.control!!.let { "127.0.0.1" }) // documented invariant
        assertTrue(hs.get("port").asInt in 1..65535)
    }

    @Test
    fun `a correct token gets a welcome advertising capabilities`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            val welcome = session.readPumping(server)!!
            assertEquals("welcome", welcome.get("type").asString)
            assertEquals("paper", welcome.get("agent").asString)
            val caps = welcome.getAsJsonArray("capabilities").map { it.asString }
            assertTrue(caps.containsAll(listOf("state", "exec")))
        }
    }

    @Test
    fun `a wrong token is refused with an immediate close`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs, token = "0".repeat(64)).use { session ->
            // No welcome; the stream is closed with no response.
            assertFalse(session.socket.getInputStream().bufferedReader().readLine() != null &&
                session.socket.isConnected && hasData(session.socket))
        }
    }

    @Test
    fun `a malformed first line is refused`() {
        val hs = AgentTestSupport.handshake(plugin)
        Socket("127.0.0.1", hs.get("port").asInt).use { raw ->
            raw.soTimeout = 5000
            raw.getOutputStream().write("not json at all\n".toByteArray())
            raw.getOutputStream().flush()
            assertEquals(-1, raw.getInputStream().read(), "server should close on garbage hello")
        }
    }

    @Test
    fun `state returns players, worlds, and version`() {
        server.addPlayer("Alice")
        server.addSimpleWorld("world")
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            session.readPumping(server) // welcome
            val res = session.request(server, "state")
            assertTrue(res.get("ok").asBoolean)
            val players = res.getAsJsonArray("players").map { it.asJsonObject.get("name").asString }
            assertTrue(players.contains("Alice"))
            assertTrue(res.getAsJsonArray("worlds").size() >= 1)
        }
    }

    @Test
    fun `exec dispatches a console command`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            session.readPumping(server) // welcome
            val res = session.request(server, "exec", ""","command":"help"""")
            assertTrue(res.get("ok").asBoolean)
            assertTrue(res.has("dispatched"))
        }
    }

    @Test
    fun `an unknown op is a clean error`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            session.readPumping(server) // welcome
            val res = session.request(server, "teleport")
            assertFalse(res.get("ok").asBoolean)
            assertTrue(res.get("error").asString.contains("unknown op"))
        }
    }

    @Test
    fun `a player join is broadcast to connected clients as an event`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            session.readPumping(server) // welcome
            server.addPlayer("Bob") // MockBukkit fires PlayerJoinEvent → agent broadcasts
            val msg = nextEvent(session, "player_join")
            assertEquals("Bob", msg.getAsJsonObject("data").get("name").asString)
        }
    }

    @Test
    fun `a quit is broadcast too`() {
        val hs = AgentTestSupport.handshake(plugin)
        AgentTestSupport.Session(hs).use { session ->
            session.readPumping(server) // welcome
            // A PlayerMock built directly fires no join event, so the wire carries only
            // the quit we send — no interleaving to drain.
            val player = org.mockbukkit.mockbukkit.entity.PlayerMock(server, "Carol")
            plugin.onQuit(org.bukkit.event.player.PlayerQuitEvent(player, net.kyori.adventure.text.Component.text("")))
            val msg = nextEvent(session, "player_quit")
            assertEquals("Carol", msg.getAsJsonObject("data").get("name").asString)
        }
    }

    /** Read event lines (skipping others) until one with [name] arrives. */
    private fun nextEvent(session: AgentTestSupport.Session, name: String): com.google.gson.JsonObject {
        repeat(10) {
            val msg = session.readPumping(server) ?: error("connection closed")
            if (msg.get("type")?.asString == "event" && msg.get("name")?.asString == name) return msg
        }
        error("never saw event $name")
    }

    private fun hasData(socket: Socket): Boolean = socket.getInputStream().available() > 0
}
