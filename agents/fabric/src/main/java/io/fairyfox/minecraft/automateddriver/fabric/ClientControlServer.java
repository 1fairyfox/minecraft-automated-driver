package io.fairyfox.minecraft.automateddriver.fabric;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.MinecraftClient;

/**
 * The loopback control plane for the client agent (docs/control-protocol.md): NDJSON over a
 * TCP socket bound to 127.0.0.1 ONLY, ephemeral port, per-session token. Identical protocol
 * to the Paper agent's server. Game-touching ops are marshalled to the client render thread
 * so a request can never wedge the game loop.
 */
public final class ClientControlServer {
    private final String token;
    private final Gson gson = new Gson();
    private ServerSocket socket;
    private volatile boolean running;

    public ClientControlServer(String token) {
        this.token = token;
    }

    public int start() throws java.io.IOException {
        ServerSocket server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
        this.socket = server;
        this.running = true;
        daemon("mad-client-accept", () -> {
            while (running) {
                Socket client;
                try {
                    client = server.accept();
                } catch (Exception e) {
                    break;
                }
                daemon("mad-client-conn", () -> serve(client));
            }
        });
        return server.getLocalPort();
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (Exception ignored) {
            // closing a listening socket that's already down is fine
        }
    }

    private void serve(Socket client) {
        try (client;
             BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(client.getInputStream()));
             BufferedWriter writer = new BufferedWriter(new java.io.OutputStreamWriter(client.getOutputStream()))) {
            if (!authenticate(reader)) {
                return; // close silently — nothing to probe
            }
            Map<String, Object> welcome = new LinkedHashMap<>();
            welcome.put("type", "welcome");
            welcome.put("v", 1);
            welcome.put("agent", "fabric");
            welcome.put("capabilities", List.of(
                "screen", "click", "key", "screenshot", "position", "look", "move", "type", "slots", "close"));
            welcome.put("events", List.of());
            writeLine(writer, welcome);
            String line;
            while ((line = reader.readLine()) != null) {
                writeLine(writer, handle(line));
            }
        } catch (Exception ignored) {
            // a dropped client connection is normal; keep serving others
        }
    }

    private boolean authenticate(BufferedReader reader) throws java.io.IOException {
        String first = reader.readLine();
        if (first == null) {
            return false;
        }
        try {
            JsonObject hello = JsonParser.parseString(first).getAsJsonObject();
            return "hello".equals(str(hello, "type")) && token.equals(str(hello, "token"));
        } catch (Exception e) {
            return false;
        }
    }

    private Map<String, Object> handle(String line) {
        JsonObject req;
        try {
            req = JsonParser.parseString(line).getAsJsonObject();
        } catch (Exception e) {
            return res(-1, false, Map.of("error", "malformed request"));
        }
        int id = req.has("id") ? req.get("id").getAsInt() : -1;
        String op = str(req, "op");
        if (op == null) {
            return res(id, false, Map.of("error", "missing op"));
        }
        return switch (op) {
            case "screen" -> onClient(id, () -> Map.of("tree", ClientOps.describeScreen()));
            case "click" -> onClient(id, () -> Map.of("clicked", ClientOps.clickByName(str(req, "name"))));
            case "key" -> onClient(id, () -> {
                String keyId = str(req, "key");
                boolean down = !req.has("down") || req.get("down").getAsBoolean();
                boolean ok = down ? ClientOps.pressKey(keyId) : ClientOps.releaseKey(keyId);
                return Map.of("applied", ok);
            });
            case "screenshot" -> screenshot(id);
            case "position" -> onClient(id, ClientOps::position);
            case "look" -> onClient(id, () -> ClientOps.look(floatOrNull(req, "yaw"), floatOrNull(req, "pitch")));
            case "type" -> onClient(id, () -> ClientOps.type(str(req, "name"), str(req, "text")));
            case "slots" -> onClient(id, ClientOps::slots);
            case "close" -> onClient(id, ClientOps::closeScreen);
            case "move" -> move(id, str(req, "direction"), intOr(req, "ms", 400));
            default -> res(id, false, Map.of("error", "unknown op: " + op));
        };
    }

    /**
     * Walk by holding a movement keybinding across real game ticks: press on the render thread,
     * let the client tick for {@code ms} (bounded), then release and report the position delta.
     * The wait must be OFF the render thread (holding it would freeze the very ticks that move
     * the player). A failed/timed-out move always releases the key so nothing stays stuck.
     */
    private Map<String, Object> move(int id, String direction, int ms) {
        int hold = Math.max(1, Math.min(ms, 5000));
        try {
            Map<String, Object> from = runOnClient(() -> {
                if (!ClientOps.setMove(direction, true)) {
                    throw new IllegalArgumentException("unknown direction: " + direction);
                }
                return ClientOps.position();
            });
            Thread.sleep(hold);
            Map<String, Object> to = runOnClient(() -> {
                ClientOps.setMove(direction, false);
                return ClientOps.position();
            });
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("direction", direction);
            out.put("ms", hold);
            out.put("from", from);
            out.put("to", to);
            out.put("dist", horizontalDistance(from, to));
            return res(id, true, out);
        } catch (Exception e) {
            try {
                runOnClient(() -> {
                    ClientOps.setMove(direction, false);
                    return Map.of();
                });
            } catch (Exception ignored) {
                // best-effort release; the primary error is reported below
            }
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            return res(id, false, Map.of("error", cause.getMessage() == null ? cause.toString() : cause.getMessage()));
        }
    }

    private static double horizontalDistance(Map<String, Object> from, Map<String, Object> to) {
        if (!(from.get("x") instanceof Number fx) || !(to.get("x") instanceof Number tx)
            || !(from.get("z") instanceof Number fz) || !(to.get("z") instanceof Number tz)) {
            return 0.0;
        }
        double dx = tx.doubleValue() - fx.doubleValue();
        double dz = tz.doubleValue() - fz.doubleValue();
        return Math.sqrt(dx * dx + dz * dz);
    }

    private static Float floatOrNull(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsFloat() : null;
    }

    private static int intOr(JsonObject o, String key, int fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsInt() : fallback;
    }

    /**
     * The framebuffer screenshot: kicked off on the render thread, but its GPU→CPU readback
     * completes asynchronously via a callback (see {@link ClientOps#captureScreenshot}) — so we
     * start it there and await the callback-completed future on THIS (control) thread. Awaiting
     * on the render thread would deadlock the very thread the callback needs. Bounded generously
     * (15s) because the readback can lag a frame or two.
     */
    private Map<String, Object> screenshot(int id) {
        try {
            CompletableFuture<Map<String, Object>> future = new CompletableFuture<>();
            MinecraftClient.getInstance().execute(() -> {
                try {
                    ClientOps.captureScreenshot(future);
                } catch (Throwable t) {
                    future.completeExceptionally(t);
                }
            });
            return res(id, true, future.get(15, TimeUnit.SECONDS));
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            return res(id, false, Map.of("error", cause.getMessage() == null ? cause.toString() : cause.getMessage()));
        }
    }

    /** Marshal an op to the client render thread and await it (bounded), wrapped as a response. */
    private Map<String, Object> onClient(int id, java.util.function.Supplier<Map<String, Object>> work) {
        try {
            return res(id, true, runOnClient(work));
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            return res(id, false, Map.of("error", cause.getMessage() == null ? cause.toString() : cause.getMessage()));
        }
    }

    /** Run work on the client render thread and return its result (bounded); throws on failure. */
    private Map<String, Object> runOnClient(java.util.function.Supplier<Map<String, Object>> work) throws Exception {
        CompletableFuture<Map<String, Object>> future = new CompletableFuture<>();
        MinecraftClient.getInstance().execute(() -> {
            try {
                future.complete(work.get());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
        return future.get(10, TimeUnit.SECONDS);
    }

    private Map<String, Object> res(int id, boolean ok, Map<String, Object> body) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "res");
        out.put("id", id);
        out.put("ok", ok);
        out.putAll(body);
        return out;
    }

    private void writeLine(BufferedWriter writer, Map<String, Object> payload) throws java.io.IOException {
        writer.write(gson.toJson(payload));
        writer.newLine();
        writer.flush();
    }

    private static String str(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : null;
    }

    private void daemon(String name, Runnable body) {
        Thread t = new Thread(body, name);
        t.setDaemon(true);
        t.start();
    }
}
