// Paper agent — the L3 server-side control plane (docs/control-protocol.md).
// Quality bar (repo CLAUDE.md): Kover-gated ≥90% line coverage in `check`.
plugins {
    // Kotlin held at 2.4.0 deliberately: CodeQL's extractor supports up to 2.4.0 and
    // hard-rejects newer ("too recent"). Same pin as the sibling node; bump together
    // with CodeQL only.
    kotlin("jvm") version "2.4.10"
    id("com.gradleup.shadow") version "9.6.1"
    id("org.jetbrains.kotlinx.kover") version "0.9.9"
}

group = "io.fairyfox.minecraft.automateddriver"
version = rootDir.parentFile.parentFile.resolve("VERSION").readText().trim()

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
    // Gson ships inside every Paper server (and rides paper-api's compile classpath
    // transitively) — declared explicitly so the compile never depends on transitivity.
    compileOnly("com.google.code.gson:gson:2.14.0")
    // Shaded into the jar (shadowJar below) so the agent is self-contained.
    implementation(kotlin("stdlib"))

    testImplementation("org.mockbukkit.mockbukkit:mockbukkit-v1.21:4.110.0")
    testImplementation("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
    testImplementation("com.google.code.gson:gson:2.14.0")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    jvmToolchain(21)
}

tasks.processResources {
    // plugin.yml carries the repo VERSION — single source of truth.
    val v = version.toString()
    inputs.property("version", v)
    filesMatching("plugin.yml") { expand("version" to v) }
}

tasks.test {
    useJUnitPlatform()
}

kover {
    reports {
        verify {
            rule("Line coverage must stay at or above 90%") {
                minBound(90)
            }
        }
    }
}
tasks.check { dependsOn("koverVerify") }

tasks.shadowJar {
    archiveClassifier.set("") // the shaded jar IS the artifact
}
tasks.build { dependsOn(tasks.shadowJar) }
