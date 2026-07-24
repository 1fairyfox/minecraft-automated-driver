// Fabric client agent — the L3 client-side control plane (docs/control-protocol.md).
//
// Quality bar (repo CLAUDE.md), adapted to a Java Fabric mod: the pure, client-independent
// logic (semantic screen introspection, the gate, the handshake) is unit-tested and
// JaCoCo-gated ≥90% line; the client-coupled surface (the live Screen wiring, input,
// control server) is proven by the Fabric CLIENT GAMETEST, which launches a real client
// headlessly in CI (XVFB) — the layer a unit test structurally cannot reach.
plugins {
    java
    // Loom 1.13.x is required by the current MC 1.21.11 / fabric-api artifacts
    // (CI: "Mod was built with a newer version of Loom (1.13.3)"). Pin to the 1.13 line.
    id("fabric-loom") version "1.13-SNAPSHOT"
    jacoco
}

version = rootDir.parentFile.parentFile.resolve("VERSION").readText().trim()
group = property("maven_group").toString()

base { archivesName.set(property("archives_base_name").toString()) }

repositories {
    maven("https://maven.fabricmc.net/") { name = "Fabric" }
    mavenCentral()
}

// Fabric Loom's supported test setup: a `gametest` source set with its own fabric.mod.json,
// plus the client-gametest wiring. (docs.fabricmc.net/develop/automatic-testing)
fabricApi {
    configureTests {
        createSourceSet = true
        modId = "minecraft-automated-driver-agent-test"
        enableGameTests = false // this agent is client-only; no server gametests
        enableClientGameTests = true
        eula = true
    }
}

dependencies {
    minecraft("com.mojang:minecraft:${property("minecraft_version")}")
    mappings("net.fabricmc:yarn:${property("yarn_mappings")}:v2")
    modImplementation("net.fabricmc:fabric-loader:${property("loader_version")}")

    // Narrow Fabric API surface — only what the agent touches.
    modImplementation(fabricApi.module("fabric-api-base", "${property("fabric_version")}"))
    modImplementation(fabricApi.module("fabric-screen-api-v1", "${property("fabric_version")}"))
    modImplementation(fabricApi.module("fabric-lifecycle-events-v1", "${property("fabric_version")}"))

    // The client gametest lives in the generated `gametest` source set.
    "gametestImplementation"(fabricApi.module("fabric-client-gametest-api-v1", "${property("fabric_version")}"))

    // Pure-logic unit tests (no Minecraft classes touched → plain JUnit, no loader-junit).
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    // The headless client gametest needs the full Fabric API at runtime.
    "productionRuntimeMods"("net.fabricmc.fabric-api:fabric-api:${property("fabric_version")}")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
    withSourcesJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
    options.encoding = "UTF-8"
}

// Captured OUTSIDE the task closure — inside `tasks.processResources { }` a bare
// property(...) resolves against the TASK, not the project (Kotlin DSL gotcha that
// produced "unknown property 'minecraft_version' for task ':processResources'").
val modProps = mapOf(
    "version" to project.version,
    "minecraft_version" to project.property("minecraft_version"),
    "loader_version" to project.property("loader_version"),
)
tasks.processResources {
    inputs.properties(modProps)
    filesMatching("fabric.mod.json") { expand(modProps) }
}

// The CI-facing headless client gametest (Loom production run task + XVFB).
tasks.register("runProductionClientGameTest", net.fabricmc.loom.task.prod.ClientProductionRunTask::class) {
    jvmArgs.add("-Dfabric.client.gametest")
    // Network-synchronizer flake mitigation (Fabric docs).
    jvmArgs.add("-Dfabric.client.gametest.disableNetworkSynchronizer=true")
    // Enable OUR agent inside the gametest client so the test can drive it over loopback.
    jvmArgs.add("-Dfairyfox.driver.enable=true")
    // XVFB defaults true on Linux+CI; make it explicit.
    useXVFB = true
}

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

// Gate: ≥90% line coverage on the pure, unit-testable logic ONLY. Client-coupled classes
// are excluded here and covered by the client gametest — gating them under a unit-coverage
// tool would be dishonest, not rigorous.
jacoco { toolVersion = "0.8.12" }
tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            element = "CLASS"
            includes = listOf(
                "io.fairyfox.minecraft.automateddriver.fabric.WidgetIntrospector",
                "io.fairyfox.minecraft.automateddriver.fabric.EnableGate",
                "io.fairyfox.minecraft.automateddriver.fabric.Handshake",
            )
            limit {
                counter = "LINE"
                minimum = "0.90".toBigDecimal()
            }
        }
    }
}
tasks.check { dependsOn(tasks.jacocoTestCoverageVerification) }
