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
import io.fairyfox.minecraft.automateddriver.fabric.mixin.OptionSliderWidgetImplAccessor;
import io.fairyfox.minecraft.automateddriver.fabric.mixin.SliderWidgetAccessor;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.Updatable;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.gui.screen.world.WorldListWidget;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.option.SimpleOption;
import net.minecraft.client.input.MouseInput;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.slot.Slot;

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

    /**
     * Press a keybinding by its id (e.g. "key.inventory"). Sets the held state AND fires an
     * edge (`onKeyPressed`) so both continuous bindings (read via {@code isPressed()}) and the
     * edge-triggered ones (read via {@code wasPressed()} — inventory/chat toggles, drop, etc.)
     * actually fire. The key is resolved via the binding's default; a client with rebound keys
     * is a known follow-up (documented in the control protocol).
     */
    public static boolean pressKey(String keyId) {
        KeyBinding binding = KeyBinding.byId(keyId);
        if (binding == null) {
            return false;
        }
        InputUtil.Key key = binding.getDefaultKey();
        KeyBinding.setKeyPressed(key, true);
        KeyBinding.onKeyPressed(key);
        binding.setPressed(true);
        return true;
    }

    /** Release a keybinding pressed via {@link #pressKey}. */
    public static boolean releaseKey(String keyId) {
        KeyBinding binding = KeyBinding.byId(keyId);
        if (binding == null) {
            return false;
        }
        KeyBinding.setKeyPressed(binding.getDefaultKey(), false);
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

    // ── in-world driving (client-coupled) ────────────────────────────────────

    /** Movement directions → their keybinding ids. Driving is by intent, never scancodes. */
    private static final Map<String, String> MOVE_KEYS = Map.of(
        "forward", "key.forward", "back", "key.back", "left", "key.left", "right", "key.right",
        "jump", "key.jump", "sneak", "key.sneak");

    /** Player position + camera, or {@code inWorld:false} when not in a world. */
    public static Map<String, Object> position() {
        ClientPlayerEntity player = MinecraftClient.getInstance().player;
        Map<String, Object> out = new LinkedHashMap<>();
        if (player == null) {
            out.put("inWorld", false);
            return out;
        }
        out.put("inWorld", true);
        out.put("x", player.getX());
        out.put("y", player.getY());
        out.put("z", player.getZ());
        out.put("yaw", player.getYaw());
        out.put("pitch", player.getPitch());
        return out;
    }

    /** Close the current screen (the Escape/dismiss equivalent) — drive menus shut by intent. */
    public static Map<String, Object> closeScreen() {
        boolean had = MinecraftClient.getInstance().currentScreen != null;
        MinecraftClient.getInstance().setScreen(null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("closed", had);
        return out;
    }

    /** Point the camera: set yaw and/or pitch (degrees). Requires being in a world. */
    public static Map<String, Object> look(Float yaw, Float pitch) {
        ClientPlayerEntity player = MinecraftClient.getInstance().player;
        if (player == null) {
            throw new IllegalStateException("not in a world");
        }
        if (yaw != null) {
            player.setYaw(yaw);
        }
        if (pitch != null) {
            player.setPitch(pitch);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("yaw", player.getYaw());
        out.put("pitch", player.getPitch());
        return out;
    }

    /**
     * Hold or release a movement keybinding BY INTENT (forward/back/left/right/jump/sneak).
     * The caller (control server) presses, lets the client tick, then releases — so the walk
     * happens across real game ticks, exactly as a held key would.
     */
    public static boolean setMove(String direction, boolean pressed) {
        String keyId = direction == null ? null : MOVE_KEYS.get(direction);
        if (keyId == null) {
            return false;
        }
        KeyBinding binding = KeyBinding.byId(keyId);
        if (binding == null) {
            return false;
        }
        binding.setPressed(pressed);
        return true;
    }

    /**
     * Type into a text field on the current screen. Prefers the focused field, else the sole
     * field, else one whose narration message contains {@code name}. Text entry is what makes
     * "direct-connect by address" and world naming drivable without pixels.
     */
    public static Map<String, Object> type(String name, String text) {
        Screen screen = MinecraftClient.getInstance().currentScreen;
        Map<String, Object> out = new LinkedHashMap<>();
        if (screen == null) {
            out.put("typed", false);
            out.put("error", "no screen open");
            return out;
        }
        TextFieldWidget field = resolveTextField(screen, name);
        if (field == null) {
            out.put("typed", false);
            out.put("error", "no matching text field");
            return out;
        }
        field.setText(text == null ? "" : text);
        out.put("typed", true);
        out.put("text", field.getText());
        return out;
    }

    /** List a container/handled screen's slots by index (item name + count), or handled:false. */
    public static Map<String, Object> slots() {
        Screen screen = MinecraftClient.getInstance().currentScreen;
        Map<String, Object> out = new LinkedHashMap<>();
        if (!(screen instanceof HandledScreen<?> handled)) {
            out.put("handled", false);
            out.put("slots", List.of());
            return out;
        }
        out.put("handled", true);
        out.put("screen", screen.getClass().getSimpleName());
        List<Map<String, Object>> slotList = new ArrayList<>();
        List<Slot> list = handled.getScreenHandler().slots;
        for (int i = 0; i < list.size(); i++) {
            ItemStack stack = list.get(i).getStack();
            Map<String, Object> slot = new LinkedHashMap<>();
            slot.put("index", i);
            slot.put("empty", stack.isEmpty());
            slot.put("item", stack.isEmpty() ? "" : stack.getName().getString());
            slot.put("count", stack.getCount());
            slotList.add(slot);
        }
        out.put("slots", slotList);
        return out;
    }

    // ── sliders + typed option values (client-coupled, via mixin accessors) ───

    /**
     * Read or set a slider control BY NAME — the raw slider surface the semantic click can't
     * reach. Resolution: exact-or-unique-substring by label, or the sole slider when no name.
     *
     * <ul>
     *   <li>{@code fraction} (0..1) → set the raw normalised progress on ANY slider (via the
     *       {@link SliderWidgetAccessor} mixin), which also applies it to the backing game option.</li>
     *   <li>{@code value} (a number) → set the option's TYPED value directly (e.g. FOV = 70) when
     *       the slider is option-backed ({@link OptionSliderWidgetImplAccessor}); coerced to the
     *       option's own type (int/long/float/double).</li>
     *   <li>neither → just read.</li>
     * </ul>
     *
     * Always returns {@code {handled, label, fraction, value}} — {@code value} being the option's
     * typed value when option-backed, else null. {@code {handled:false,error}} when the named
     * control is absent or isn't a slider.
     */
    public static Map<String, Object> slider(String name, Double fraction, Double value) {
        Screen screen = MinecraftClient.getInstance().currentScreen;
        Map<String, Object> out = new LinkedHashMap<>();
        if (screen == null) {
            out.put("handled", false);
            out.put("error", "no screen open");
            return out;
        }
        List<ClickableWidget> clickable = clickable(screen);
        SliderWidget target = resolveSlider(clickable, name);
        if (target == null) {
            out.put("handled", false);
            out.put("error", (name == null || name.isBlank()) ? "no unique slider on this screen" : "no slider matched '" + name + "'");
            return out;
        }
        SliderWidgetAccessor acc = (SliderWidgetAccessor) target;
        SimpleOption<?> option = (target instanceof OptionSliderWidgetImplAccessor osa) ? osa.mad$getOption() : null;
        if (fraction != null) {
            acc.mad$setValue(Math.max(0.0, Math.min(1.0, fraction)));
        } else if (value != null) {
            if (option == null) {
                out.put("handled", false);
                out.put("error", "typed value needs an option-backed slider; use fraction (0..1) for a raw slider");
                return out;
            }
            setOptionValue(option, value);
            if (target instanceof Updatable updatable) {
                updatable.update(); // re-sync the widget's progress + label from the option
            }
        }
        out.put("handled", true);
        out.put("label", target.getMessage() == null ? "" : target.getMessage().getString());
        out.put("fraction", acc.mad$getValue());
        out.put("value", option == null ? null : option.getValue());
        return out;
    }

    /** Resolve a slider by label (exact-or-unique-substring), or the sole slider when no name. */
    private static SliderWidget resolveSlider(List<ClickableWidget> clickable, String name) {
        if (name != null && !name.isBlank()) {
            Optional<WidgetIntrospector.Widget> match = WidgetIntrospector.resolve(describe(clickable), name);
            if (match.isPresent()) {
                ClickableWidget w = clickable.get(match.get().index());
                return w instanceof SliderWidget slider ? slider : null;
            }
            return null;
        }
        SliderWidget only = null;
        for (ClickableWidget w : clickable) {
            if (w instanceof SliderWidget slider) {
                if (only != null) {
                    return null; // more than one — ambiguous without a name
                }
                only = slider;
            }
        }
        return only;
    }

    /** Set a {@link SimpleOption}'s value from a number, coerced to the option's own value type. */
    @SuppressWarnings("unchecked")
    private static void setOptionValue(SimpleOption<?> option, double v) {
        SimpleOption<Object> o = (SimpleOption<Object>) option;
        Object current = o.getValue();
        if (current instanceof Integer) {
            o.setValue((int) Math.round(v));
        } else if (current instanceof Long) {
            o.setValue((long) Math.round(v));
        } else if (current instanceof Float) {
            o.setValue((float) v);
        } else {
            o.setValue(v); // Double / best-effort
        }
    }

    // ── world lifecycle: the SelectWorldScreen (client-coupled) ───────────────

    /**
     * The saved worlds listed on the current {@code SelectWorldScreen}, by display name. World
     * list entries are NOT clickable widgets on the screen (they live inside the world list),
     * so the {@code screen}/{@code click} primitives can't see or pick them — this op (and
     * {@link #selectWorld}) are the clean capability that can. {@code {worlds:[...]}}, or
     * {@code {worlds:[]}} when the current screen has no world list (or it hasn't loaded yet).
     */
    public static Map<String, Object> listWorlds() {
        WorldListWidget list = findWorldList(MinecraftClient.getInstance().currentScreen);
        List<String> names = new ArrayList<>();
        if (list != null) {
            for (WorldListWidget.Entry entry : list.children()) {
                if (entry instanceof WorldListWidget.WorldEntry world) {
                    names.add(world.getLevelDisplayName());
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("worlds", names);
        return out;
    }

    /**
     * Select a saved world BY NAME on the current {@code SelectWorldScreen} and enter it —
     * matched exact-or-unique-substring by {@link WidgetIntrospector#resolve} (never guessed),
     * then {@code play()}. Returns {@code {selected:true,name}} on entry, else
     * {@code {selected:false,error}} (no world list, list not loaded, or no unique match) so the
     * driver can retry while the async world list loads.
     */
    public static Map<String, Object> selectWorld(String name) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (name == null || name.isBlank()) {
            out.put("selected", false);
            out.put("error", "no world name given");
            return out;
        }
        WorldListWidget list = findWorldList(MinecraftClient.getInstance().currentScreen);
        if (list == null) {
            out.put("selected", false);
            out.put("error", "no world list on the current screen");
            return out;
        }
        List<WorldListWidget.WorldEntry> entries = new ArrayList<>();
        List<WidgetIntrospector.Widget> descriptors = new ArrayList<>();
        for (WorldListWidget.Entry entry : list.children()) {
            if (entry instanceof WorldListWidget.WorldEntry world) {
                descriptors.add(new WidgetIntrospector.Widget(
                    world.getLevelDisplayName(), "WorldEntry", entries.size(), 0, 0, 0, 0, true));
                entries.add(world);
            }
        }
        Optional<WidgetIntrospector.Widget> match = WidgetIntrospector.resolve(descriptors, name);
        if (match.isEmpty()) {
            out.put("selected", false);
            out.put("error", entries.isEmpty() ? "world list not loaded yet" : "no unique world matched '" + name + "'");
            return out;
        }
        entries.get(match.get().index()).play(); // enters the world (no separate Play click needed)
        out.put("selected", true);
        out.put("name", match.get().label());
        return out;
    }

    /** Find the {@link WorldListWidget} among a screen's children, or null if it isn't one. */
    private static WorldListWidget findWorldList(Screen screen) {
        if (screen == null) {
            return null;
        }
        for (Element element : screen.children()) {
            if (element instanceof WorldListWidget list) {
                return list;
            }
        }
        return null;
    }

    private static TextFieldWidget resolveTextField(Screen screen, String name) {
        List<TextFieldWidget> fields = new ArrayList<>();
        for (Element element : screen.children()) {
            if (element instanceof TextFieldWidget field) {
                fields.add(field);
            }
        }
        if (fields.isEmpty()) {
            return null;
        }
        for (TextFieldWidget field : fields) {
            if (field.isFocused()) {
                return field;
            }
        }
        if (name != null && !name.isBlank()) {
            for (TextFieldWidget field : fields) {
                if (field.getMessage() != null && field.getMessage().getString().contains(name)) {
                    return field;
                }
            }
            return null;
        }
        return fields.size() == 1 ? fields.get(0) : null;
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
