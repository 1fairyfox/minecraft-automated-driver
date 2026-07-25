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
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;

/**
 * The REAL end-to-end proof of the Phase 4 exit criteria on a genuine rendering client (no
 * mocks). Two phases, both driven only over the loopback control plane, by name / by intent,
 * never by pixel:
 *
 * <ol>
 *   <li><b>Title screen</b> — introspect into named widgets, click a button by name, grab an
 *       in-process framebuffer screenshot (real PNG), and confirm a wrong token is refused.</li>
 *   <li><b>In a world</b> — create/join a singleplayer world (via the gametest API), then read
 *       the player position, walk (and confirm the position actually changed), point the camera,
 *       open the inventory by intent and read its container slots, type into a focused text
 *       field, and screenshot again — the "walk somewhere, open a container, screenshot it"
 *       half of the exit.</li>
 * </ol>
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

        driveTitleScreen(port, token);
        driveInWorld(context, port, token);
        driveWorldMenu(port, token);

        context.takeScreenshot("after-driving");
    }

    // ── Phase 1: the title screen ────────────────────────────────────────────

    private void driveTitleScreen(int port, String token) {
        try (Socket socket = new Socket("127.0.0.1", port);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
            socket.setSoTimeout(30_000); // generous: the screenshot's GPU→CPU readback can lag

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

            // In-process framebuffer screenshot: prove it is a genuine PNG (magic bytes).
            send(out, "{\"type\":\"req\",\"id\":3,\"op\":\"screenshot\"}");
            String shot = in.readLine();
            require(shot != null && shot.contains("\"ok\":true") && shot.contains("\"png_base64\":\""),
                "screenshot op did not return a png: " + summarise(shot));
            requirePng(decodePng(shot), "title-screen screenshot");

            // A wrong token on a fresh connection must be refused (security check).
            requireWrongTokenRefused(port);
        } catch (AssertionError e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("title-screen drive failed: " + e, e);
        }
    }

    // ── Phase 2: in a world ──────────────────────────────────────────────────

    private void driveInWorld(ClientGameTestContext context, int port, String token) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            try (Socket socket = new Socket("127.0.0.1", port);
                 BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                 BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
                socket.setSoTimeout(30_000);

                send(out, "{\"type\":\"hello\",\"v\":1,\"token\":\"" + token + "\"}");
                require(in.readLine() != null, "no welcome on the in-world connection");

                // The player is really in a world.
                send(out, "{\"type\":\"req\",\"id\":1,\"op\":\"position\"}");
                String pos = in.readLine();
                require(pos != null && pos.contains("\"ok\":true") && pos.contains("\"inWorld\":true"),
                    "position op says not in world: " + pos);

                // Walk forward — and confirm the player actually moved (dist > 0.1 blocks).
                send(out, "{\"type\":\"req\",\"id\":2,\"op\":\"move\",\"direction\":\"forward\",\"ms\":1200}");
                String moved = in.readLine();
                require(moved != null && moved.contains("\"ok\":true"), "move op failed: " + summarise(moved));
                double dist = doubleField(moved, "dist");
                require(dist > 0.1, "player did not walk (dist=" + dist + "): " + summarise(moved));

                // Point the camera by name (yaw/pitch), never a mouse delta.
                send(out, "{\"type\":\"req\",\"id\":3,\"op\":\"look\",\"yaw\":90.0,\"pitch\":15.0}");
                String looked = in.readLine();
                require(looked != null && looked.contains("\"ok\":true") && looked.contains("\"yaw\":"),
                    "look op failed: " + looked);

                // Text entry BY INTENT: open the chat field (key.chat, edge-triggered) and type.
                send(out, "{\"type\":\"req\",\"id\":4,\"op\":\"key\",\"key\":\"key.chat\",\"down\":true}");
                in.readLine();
                String typed = pollForType(out, in, "mad in-world");
                require(typed.contains("\"typed\":true") && typed.contains("mad in-world"),
                    "opening chat by intent + typing failed: " + summarise(typed));

                // Dismiss the chat screen by intent (the Escape equivalent), back to the world.
                send(out, "{\"type\":\"req\",\"id\":6,\"op\":\"close\"}");
                in.readLine();

                // Open the player inventory BY INTENT (key.inventory), then read its container slots.
                send(out, "{\"type\":\"req\",\"id\":7,\"op\":\"key\",\"key\":\"key.inventory\",\"down\":true}");
                in.readLine();
                String slots = pollForHandledSlots(out, in);
                require(slots.contains("\"handled\":true") && slots.contains("\"index\":0"),
                    "opening the inventory by intent did not yield a readable container: " + summarise(slots));

                // A screenshot still works in-world.
                send(out, "{\"type\":\"req\",\"id\":9,\"op\":\"screenshot\"}");
                requirePng(decodePng(in.readLine()), "in-world screenshot");
            }
        } catch (AssertionError e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("in-world drive failed: " + e, e);
        }
    }

    // ── Phase 3: the world-select menu (world_list / world_select ops) ────────

    /**
     * Back at the title screen after leaving the created world, drive the SelectWorldScreen:
     * open Singleplayer by name, poll {@code world_list} until the saved world appears (world-list
     * entries aren't clickable widgets, so this op is the only way to read them), and confirm
     * {@code world_select} refuses an unknown name (the safe no-match path). Entering a world via
     * {@code play()} is left to real use — re-entering here would fight the gametest's own world
     * lifecycle — so this proves the read + resolve logic on a genuine screen.
     */
    private void driveWorldMenu(int port, String token) {
        try (Socket socket = new Socket("127.0.0.1", port);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
            socket.setSoTimeout(30_000);

            send(out, "{\"type\":\"hello\",\"v\":1,\"token\":\"" + token + "\"}");
            require(in.readLine() != null, "no welcome on the world-menu connection");

            // Open Singleplayer BY NAME (never coordinates), reaching the SelectWorldScreen.
            send(out, "{\"type\":\"req\",\"id\":1,\"op\":\"click\",\"name\":\"Singleplayer\"}");
            String click = in.readLine();
            require(click != null && click.contains("\"ok\":true") && click.contains("\"clicked\":true"),
                "click-by-name 'Singleplayer' failed: " + click);

            // The world list loads asynchronously — poll world_list until the created world appears.
            String worlds = pollForWorlds(out, in);
            require(worlds.contains("\"ok\":true") && worlds.contains("\"worlds\":[\""),
                "world_list did not return the created world: " + summarise(worlds));

            // world_select refuses a name that matches nothing (never guesses).
            send(out, "{\"type\":\"req\",\"id\":3,\"op\":\"world_select\",\"name\":\"no-such-world-zzzz\"}");
            String miss = in.readLine();
            require(miss != null && miss.contains("\"ok\":true") && miss.contains("\"selected\":false"),
                "world_select should refuse an unknown world: " + miss);
        } catch (AssertionError e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("world-menu drive failed: " + e, e);
        }
    }

    /** The SelectWorldScreen loads its worlds asynchronously — poll world_list until populated. */
    private static String pollForWorlds(BufferedWriter out, BufferedReader in) throws java.io.IOException {
        String last = "{}";
        for (int i = 0; i < 40; i++) {
            send(out, "{\"type\":\"req\",\"id\":2,\"op\":\"world_list\"}");
            last = in.readLine();
            if (last != null && last.contains("\"worlds\":[\"")) {
                return last;
            }
            sleep(250);
        }
        return last == null ? "null" : last;
    }

    /** After pressing the chat key, the screen opens across a tick or two — retry the type. */
    private static String pollForType(BufferedWriter out, BufferedReader in, String text) throws java.io.IOException {
        String last = "{}";
        for (int i = 0; i < 20; i++) {
            send(out, "{\"type\":\"req\",\"id\":5,\"op\":\"type\",\"text\":\"" + text + "\"}");
            last = in.readLine();
            if (last != null && last.contains("\"typed\":true")) {
                return last;
            }
            sleep(250);
        }
        return last == null ? "null" : last;
    }

    /** After pressing the inventory key, the screen opens across a tick or two — poll briefly. */
    private static String pollForHandledSlots(BufferedWriter out, BufferedReader in) throws java.io.IOException {
        String last = "{\"handled\":false}";
        for (int i = 0; i < 20; i++) {
            send(out, "{\"type\":\"req\",\"id\":5,\"op\":\"slots\"}");
            last = in.readLine();
            if (last != null && last.contains("\"handled\":true")) {
                return last;
            }
            sleep(250);
        }
        return last == null ? "null" : last;
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

    private static void requirePng(byte[] png, String what) {
        require(png.length > 0 && (png[0] & 0xFF) == 0x89 && png[1] == 'P' && png[2] == 'N' && png[3] == 'G',
            what + " is not a real PNG (bad magic), " + png.length + " bytes");
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

    private static double doubleField(String json, String key) {
        String marker = "\"" + key + "\":";
        int i = json.indexOf(marker) + marker.length();
        int j = i;
        while (j < json.length() && "-+.0123456789eE".indexOf(json.charAt(j)) >= 0) {
            j++;
        }
        return Double.parseDouble(json.substring(i, j));
    }

    private static String strField(String json, String key) {
        String marker = "\"" + key + "\":\"";
        int i = json.indexOf(marker) + marker.length();
        int j = json.indexOf('"', i);
        return json.substring(i, j);
    }

    /** Pull the base64 png out of a screenshot response and decode it to raw bytes. */
    private static byte[] decodePng(String json) {
        String b64 = strField(json, "png_base64");
        return java.util.Base64.getDecoder().decode(b64);
    }

    /** A screenshot response is huge (base64 image); trim it for readable assertion messages. */
    private static String summarise(String line) {
        if (line == null) {
            return "null";
        }
        return line.length() <= 200 ? line : line.substring(0, 200) + "…(" + line.length() + " chars)";
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
