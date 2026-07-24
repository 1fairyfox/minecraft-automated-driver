package io.fairyfox.minecraft.automateddriver.fabric;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.client.input.MouseInput;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.ScreenshotRecorder;

/**
 * The client-coupled v1 capabilities (docs/control-protocol.md). Everything here touches
 * the live {@link MinecraftClient}, so it is exercised by the client GAMETEST rather than a
 * unit test; the pure selection/serialisation logic lives in {@link WidgetIntrospector}.
 *
 * All methods assume they run on the client (render) thread — {@link ClientControlServer}
 * marshals them there.
 */
public final class ClientOps {

    private ClientOps() {
    }

    /** Snapshot the current screen into the named-widget JSON tree. */
    public static String describeScreen() {
        MinecraftClient client = MinecraftClient.getInstance();
        Screen screen = client.currentScreen;
        if (screen == null) {
            return "{\"screen\":null,\"widgets\":[]}";
        }
        return WidgetIntrospector.describe(screen.getClass().getSimpleName(), collect(screen));
    }

    /** Click a widget BY NAME (never coordinates). Returns whether it was found + pressed. */
    public static boolean clickByName(String name) {
        MinecraftClient client = MinecraftClient.getInstance();
        Screen screen = client.currentScreen;
        if (screen == null) {
            return false;
        }
        List<ClickableWidget> clickable = clickable(screen);
        List<WidgetIntrospector.Widget> descriptors = describe(clickable);
        Optional<WidgetIntrospector.Widget> match = WidgetIntrospector.resolve(descriptors, name);
        if (match.isEmpty()) {
            return false;
        }
        ClickableWidget widget = clickable.get(match.get().index());
        if (!widget.active || !(widget instanceof PressableWidget pressable)) {
            return false;
        }
        // onPress takes an AbstractInput now; a left-click at the widget centre is a
        // valid one (Click implements AbstractInput). Button 0 = left, no modifiers.
        double cx = widget.getX() + widget.getWidth() / 2.0;
        double cy = widget.getY() + widget.getHeight() / 2.0;
        pressable.onPress(new Click(cx, cy, new MouseInput(0, 0)));
        return true;
    }

    /** Invoke a keybinding by its id (e.g. "key.jump"), pressed for one tick. */
    public static boolean pressKey(String keyId) {
        KeyBinding binding = KeyBinding.byId(keyId);
        if (binding == null) {
            return false;
        }
        binding.setPressed(true);
        return true;
    }

    /** Release a keybinding pressed via {@link #pressKey}. */
    public static boolean releaseKey(String keyId) {
        KeyBinding binding = KeyBinding.byId(keyId);
        if (binding == null) {
            return false;
        }
        binding.setPressed(false);
        return true;
    }

    /**
     * In-process framebuffer screenshot — grabs the client's rendered frame straight off the
     * GPU framebuffer (clean, exact, unaffected by window occlusion, unlike the L0 OS path)
     * and completes {@code future} with the PNG bytes (base64) plus dimensions.
     *
     * <p>The 1.21 render system reads the framebuffer back <em>asynchronously</em>, so
     * {@link ScreenshotRecorder#takeScreenshot} hands the {@link net.minecraft.client.texture.NativeImage}
     * to a callback rather than returning it — this method must therefore be started on the
     * render thread but must NOT block there waiting for the result (that would wedge the very
     * thread the callback needs). {@link ClientControlServer} kicks it off on the render thread
     * and awaits {@code future} on the control thread. {@code NativeImage} exposes no in-memory
     * PNG encoder (only {@code writeTo(Path)}), so we encode via a short-lived temp file.
     */
    public static void captureScreenshot(CompletableFuture<Map<String, Object>> future) {
        MinecraftClient client = MinecraftClient.getInstance();
        Framebuffer framebuffer = client.getFramebuffer();
        if (framebuffer == null) {
            future.completeExceptionally(new IllegalStateException("no framebuffer to capture"));
            return;
        }
        ScreenshotRecorder.takeScreenshot(framebuffer, image -> {
            try (image) {
                Path tmp = Files.createTempFile("mad-screenshot", ".png");
                try {
                    image.writeTo(tmp);
                    byte[] png = Files.readAllBytes(tmp);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("png_base64", Base64.getEncoder().encodeToString(png));
                    out.put("width", image.getWidth());
                    out.put("height", image.getHeight());
                    out.put("bytes", png.length);
                    future.complete(out);
                } finally {
                    Files.deleteIfExists(tmp);
                }
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
    }

    // ── widget extraction (client-coupled) ───────────────────────────────────

    private static List<WidgetIntrospector.Widget> collect(Screen screen) {
        return describe(clickable(screen));
    }

    private static List<ClickableWidget> clickable(Screen screen) {
        List<ClickableWidget> out = new ArrayList<>();
        for (Element element : screen.children()) {
            if (element instanceof ClickableWidget widget) {
                out.add(widget);
            }
        }
        return out;
    }

    private static List<WidgetIntrospector.Widget> describe(List<ClickableWidget> widgets) {
        List<WidgetIntrospector.Widget> out = new ArrayList<>();
        for (int i = 0; i < widgets.size(); i++) {
            ClickableWidget w = widgets.get(i);
            String label = w.getMessage() == null ? "" : w.getMessage().getString();
            out.add(new WidgetIntrospector.Widget(
                label, w.getClass().getSimpleName(), i,
                w.getX(), w.getY(), w.getWidth(), w.getHeight(), w.active));
        }
        return out;
    }
}
