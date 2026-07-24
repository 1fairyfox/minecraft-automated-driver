pluginManagement {
    repositories {
        gradlePluginPortal()
        // Kover publishes its plugin marker to Maven Central (not the plugin portal).
        mavenCentral()
    }
}

plugins {
    // Auto-provisions the JDK named by the Kotlin toolchain (Java 21) on any
    // machine or CI runner that lacks it, so the build is reproducible everywhere.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "minecraft-automated-driver-paper-agent"
