package io.fairyfox.minecraft.automateddriver.fabric.gametest;

import io.fairyfox.minecraft.automateddriver.fabric.FabricClientAgent;
import io.fairyfox.minecraft.automateddriver.fabric.Handshake;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.loader.api.FabricLoader;

/**
 * The REAL end-to-end proof of the Phase 4 exit criteria: a headless client boots (agent
 * enabled via the launch flag in the production run task), and this test drives it over the
 * loopback control plane — introspecting the title screen into named widgets and clicking a
 * button BY NAME — then screenshots. No mocks; a genuine rendering client.
 */
@SuppressWarnings("UnstableApiUsage")
public class ClientAgentGameTest implements FabricClientGameTest {

    @Override
    public void runTest(ClientGameTestContext context) {
        context.takeScreenshot("title-screen");

        Path dir = FabricLoader.getInstance().getConfigDir().resolve(FabricClientAgent.AGENT_DIR);
        Path handshake = pollForHandshake(dir);
        String json = readString(handshake);
        int port = intField(json, "port");
        String token = strField(json, "token");
        if (token.length() != 64) {
            throw new AssertionError("handshake token is not a 256-bit hex value: " + token);
        }

        try (Socket socket = new Socket("127.0.0.1", port);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
            socket.setSoTimeout(15_000);

            send(out, "{\"type\":\"hello\",\"v\":1,\"token\":\"" + token + "\"}");
            String welcome = in.readLine();
            require(welcome != null && welcome.contains("\"type\":\"welcome\"") && welcome.contains("\"agent\":\"fabric\""),
                "expected a welcome, got: " + welcome);

            // Introspect the current (title) screen into the named widget tree.
            send(out, "{\"type\":\"req\",\"id\":1,\"op\":\"screen\"}");
            String screen = in.readLine();
            require(screen != null && screen.contains("\"ok\":true") && screen.contains("TitleScreen"),
                "screen op did not return the title screen: " + screen);

            // Click a title-screen button BY NAME (never coordinates). Options is always present.
            send(out, "{\"type\":\"req\",\"id\":2,\"op\":\"click\",\"name\":\"Options\"}");
            String click = in.readLine();
            require(click != null && click.contains("\"ok\":true") && click.contains("\"clicked\":true"),
                "click-by-name 'Options' failed: " + click);

            // A wrong token on a fresh connection must be refused (security check).
            requireWrongTokenRefused(port);
        } catch (AssertionError e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("control-plane round-trip failed: " + e, e);
        }

        context.takeScreenshot("after-driving");
    }

    private static Path pollForHandshake(Path dir) {
        Path file = dir.resolve(Handshake.FILE_NAME);
        long deadline = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < deadline) {
            if (Files.exists(file)) {
                return file;
            }
            sleep(200);
        }
        throw new AssertionError("agent handshake never appeared at " + file + " — did the agent enable?");
    }

    private static void requireWrongTokenRefused(int port) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
            socket.setSoTimeout(5_000);
            send(out, "{\"type\":\"hello\",\"v\":1,\"token\":\"" + "0".repeat(64) + "\"}");
            require(in.readLine() == null, "SECURITY: a wrong token was NOT refused");
        }
    }

    // ── tiny helpers (no JSON dependency needed for these fixed shapes) ────────

    private static void send(BufferedWriter out, String line) throws java.io.IOException {
        out.write(line);
        out.write("\n");
        out.flush();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static String readString(Path p) {
        try {
            return Files.readString(p);
        } catch (Exception e) {
            throw new AssertionError("could not read handshake: " + e, e);
        }
    }

    private static int intField(String json, String key) {
        String marker = "\"" + key + "\":";
        int i = json.indexOf(marker) + marker.length();
        int j = i;
        while (j < json.length() && (Character.isDigit(json.charAt(j)))) {
            j++;
        }
        return Integer.parseInt(json.substring(i, j));
    }

    private static String strField(String json, String key) {
        String marker = "\"" + key + "\":\"";
        int i = json.indexOf(marker) + marker.length();
        int j = json.indexOf('"', i);
        return json.substring(i, j);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
