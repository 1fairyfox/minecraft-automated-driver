// A SEPARATE Gradle build from the driver and the Paper agent, on purpose: Fabric Loom
// rewrites the whole toolchain around a deobfuscated Minecraft client (its own repos,
// remapping tasks, run configs). Isolating it means a Loom/mappings problem can never
// break the other builds. One repository, three builds, no shared risk.
pluginManagement {
    repositories {
        maven("https://maven.fabricmc.net/") { name = "Fabric" }
        gradlePluginPortal()
    }
}

rootProject.name = "minecraft-automated-driver-fabric-agent"
