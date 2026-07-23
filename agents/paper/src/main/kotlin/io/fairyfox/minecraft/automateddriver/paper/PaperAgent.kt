package io.fairyfox.minecraft.automateddriver.paper

import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.plugin.java.JavaPlugin
import java.security.SecureRandom

/**
 * The in-game control-plane agent (docs/control-protocol.md).
 *
 * SECURITY (standing instruction — never weaken):
 *  - Ships disabled. Enables only via -Dfairyfox.driver.enable=true (instanced test
 *    runs) or an explicit `enabled: true` in config.yml. Otherwise it self-disables
 *    through the platform's natural mechanism: [org.bukkit.plugin.PluginManager.disablePlugin].
 *  - When enabled: loopback-only ephemeral port + fresh 256-bit session token,
 *    published through a handshake file in this plugin's own data folder and deleted
 *    on shutdown. No telemetry, no outbound connections, ever.
 */
// `open` so MockBukkit can subclass it under test (Kotlin classes are final by default).
open class PaperAgent : JavaPlugin(), Listener {
    var control: ControlServer? = null
        private set

    internal companion object {
        const val ENABLE_PROPERTY = "fairyfox.driver.enable"
    }

    internal fun gateOpen(): Boolean =
        System.getProperty(ENABLE_PROPERTY) == "true" || config.getBoolean("enabled", false)

    override fun onEnable() {
        saveDefaultConfig()
        if (!gateOpen()) {
            logger.info(
                "Automated-driver agent is present but DISABLED (no -D$ENABLE_PROPERTY=true " +
                    "and config enabled=false). It exposes nothing in this state.",
            )
            server.pluginManager.disablePlugin(this)
            return
        }
        val token = mintToken()
        val server = ControlServer(this, token)
        val port = server.start()
        control = server
        Handshake.write(dataFolder, port = port, token = token)
        logger.info("Automated-driver agent ENABLED — control plane on 127.0.0.1:$port (session token in handshake.json)")
        getServer().pluginManager.registerEvents(this, this)
    }

    override fun onDisable() {
        control?.stop()
        control = null
        Handshake.delete(dataFolder)
    }

    @EventHandler
    fun onJoin(event: PlayerJoinEvent) {
        control?.broadcastEvent("player_join", mapOf("name" to event.player.name))
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        control?.broadcastEvent("player_quit", mapOf("name" to event.player.name))
    }

    private fun mintToken(): String {
        val bytes = ByteArray(32) // 256 bits
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
