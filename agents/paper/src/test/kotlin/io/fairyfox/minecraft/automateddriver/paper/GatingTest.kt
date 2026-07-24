package io.fairyfox.minecraft.automateddriver.paper

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The security-critical rule: disabled by default; enabled only through the gate. */
class GatingTest {
    @AfterEach fun tearDown() = AgentTestSupport.teardown()

    @Test
    fun `self-disables and exposes nothing without the flag or config`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = false)
        assertFalse(plugin.isEnabled, "agent must self-disable when the gate is closed")
        assertNull(plugin.control, "no control server when disabled")
        assertFalse(File(plugin.dataFolder, Handshake.FILE_NAME).exists(), "no handshake file when disabled")
    }

    @Test
    fun `enables and publishes a handshake when the launch flag is set`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = true)
        assertTrue(plugin.isEnabled, "agent must enable when -Dfairyfox.driver.enable=true")
        val hs = AgentTestSupport.handshake(plugin)
        assertTrue(hs.get("port").asInt > 0)
        assertTrue(hs.get("token").asString.matches(Regex("[0-9a-f]{64}")), "256-bit hex token")
        assertTrue(hs.get("agent").asString == "paper")
    }

    @Test
    fun `config enabled=true also opens the gate`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = false).let {
            // reload path: simulate config opt-in without the system property
            AgentTestSupport.teardown()
            val server = org.mockbukkit.mockbukkit.MockBukkit.mock()
            val p = org.mockbukkit.mockbukkit.MockBukkit.load(PaperAgent::class.java)
            p.config.set("enabled", true)
            // gateOpen() reads config live
            server to p
        }
        assertTrue(plugin.gateOpen(), "config enabled=true opens the gate")
    }

    @Test
    fun `handshake file is removed on disable`() {
        val (_, plugin) = AgentTestSupport.mockWithGate(open = true)
        val file = File(plugin.dataFolder, Handshake.FILE_NAME)
        assertTrue(file.exists())
        plugin.onDisable()
        assertFalse(file.exists(), "handshake must be deleted on disable")
    }
}
