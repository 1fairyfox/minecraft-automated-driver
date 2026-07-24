package io.fairyfox.minecraft.automateddriver.fabric;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.option.KeyBinding;

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
        if (!widget.active) {
            return false;
        }
        widget.onPress();
        return true;
    }

    /** Invoke a keybinding by its translation-key id (e.g. "key.jump"), for one tick. */
    public static boolean pressKey(String keyId) {
        for (KeyBinding binding : MinecraftClient.getInstance().options.allKeys) {
            if (binding.getTranslationKey().equals(keyId)) {
                binding.setPressed(true);
                return true;
            }
        }
        return false;
    }

    /** Release a keybinding pressed via {@link #pressKey}. */
    public static boolean releaseKey(String keyId) {
        for (KeyBinding binding : MinecraftClient.getInstance().options.allKeys) {
            if (binding.getTranslationKey().equals(keyId)) {
                binding.setPressed(false);
                return true;
            }
        }
        return false;
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
