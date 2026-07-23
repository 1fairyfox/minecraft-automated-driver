package io.fairyfox.minecraft.automateddriver.paper

import org.bukkit.Bukkit

/**
 * v1 capabilities (docs/control-protocol.md). Every field degrades to null rather
 * than failing the whole request when a platform (e.g. MockBukkit) can't answer.
 */
object Ops {
    fun state(): Map<String, Any?> = mapOf(
        "tps" to runCatching { Bukkit.getServer().tps.toList() }.getOrNull(),
        "version" to runCatching { Bukkit.getVersion() }.getOrNull(),
        "players" to Bukkit.getOnlinePlayers().map {
            mapOf("name" to it.name, "uuid" to it.uniqueId.toString())
        },
        "worlds" to Bukkit.getWorlds().map { world ->
            mapOf(
                "name" to world.name,
                "entities" to runCatching { world.entities.size }.getOrNull(),
                "loadedChunks" to runCatching { world.loadedChunks.size }.getOrNull(),
            )
        },
    )

    fun exec(command: String): Map<String, Any?> {
        if (command.isBlank()) return mapOf("dispatched" to false, "detail" to "empty command")
        val result = runCatching { Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command) }
        return mapOf(
            "dispatched" to result.getOrDefault(false),
            "detail" to result.exceptionOrNull()?.message,
        )
    }
}
