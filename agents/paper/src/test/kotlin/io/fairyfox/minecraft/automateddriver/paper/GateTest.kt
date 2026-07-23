package io.fairyfox.minecraft.automateddriver.paper

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The security gate — the single most load-bearing behaviour of the agent. */
class GateTest {
    @AfterEach
    fun tearDown() = AgentTestSupport.teardown()

    @Test
    fun `without the flag and without config the agent self-disables and exposes nothing`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = false)
        assertFalse(plugin.isEnabled, "agent must self-disable when not gated in")
        assertEquals(null, plugin.control, "no control server may exist when disabled")
        assertFalse(
            File(plugin.dataFolder, Handshake.FILE_NAME).exists(),
            "no handshake file may exist when disabled",
        )
    }

    @Test
    fun `with the launch flag the agent enables, binds loopback, and writes the handshake`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = true)
        assertTrue(plugin.isEnabled)
        val handshake = AgentTestSupport.handshake(plugin)
        assertEquals(1, handshake.get("v").asInt)
        assertEquals("paper", handshake.get("agent").asString)
        assertTrue(handshake.get("port").asInt > 0)
        assertEquals(64, handshake.get("token").asString.length, "token must be 256 bits hex")
    }

    @Test
    fun `disabling deletes the handshake and stops the control server`() {
        val (server, plugin) = AgentTestSupport.mockWithGate(open = true)
        val file = File(plugin.dataFolder, Handshake.FILE_NAME)
        assertTrue(file.exists())
        server.pluginManager.disablePlugin(plugin)
        assertFalse(file.exists(), "handshake must be deleted on disable")
        assertEquals(null, plugin.control)
    }

    @Test
    fun `session tokens differ between enables`() {
        val (server, plugin) = AgentTestSupport.mockWithGate(open = true)
        val first = AgentTestSupport.handshake(plugin).get("token").asString
        server.pluginManager.disablePlugin(plugin)
        server.pluginManager.enablePlugin(plugin)
        val second = AgentTestSupport.handshake(plugin).get("token").asString
        assertTrue(first != second, "tokens are per-session")
    }
}
