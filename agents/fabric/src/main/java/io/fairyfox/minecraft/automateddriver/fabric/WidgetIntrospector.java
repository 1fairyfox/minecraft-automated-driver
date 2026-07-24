package io.fairyfox.minecraft.automateddriver.fabric;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The semantic core (pure logic, unit-tested): turn a screen's widgets into a named tree
 * and resolve a human-supplied NAME to exactly one widget — the "drive by name, never
 * pixels" principle made concrete. The real {@code ClientOps} extracts {@link Widget}
 * descriptors from a live {@code Screen}; everything selection-related lives here so it can
 * be tested without a running client.
 */
public final class WidgetIntrospector {

    /** A flattened, serialisable description of one on-screen widget. */
    public record Widget(String label, String type, int index, int x, int y, int width, int height, boolean active) {
    }

    private WidgetIntrospector() {
    }

    /** JSON-able view of a screen: its class name + widget list. Pure string building. */
    public static String describe(String screenName, List<Widget> widgets) {
        StringBuilder sb = new StringBuilder();
        sb.append('{').append("\"screen\":").append(quote(screenName)).append(",\"widgets\":[");
        for (int i = 0; i < widgets.size(); i++) {
            Widget w = widgets.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append('{')
                .append("\"label\":").append(quote(w.label())).append(',')
                .append("\"type\":").append(quote(w.type())).append(',')
                .append("\"index\":").append(w.index()).append(',')
                .append("\"x\":").append(w.x()).append(',')
                .append("\"y\":").append(w.y()).append(',')
                .append("\"width\":").append(w.width()).append(',')
                .append("\"height\":").append(w.height()).append(',')
                .append("\"active\":").append(w.active())
                .append('}');
        }
        return sb.append("]}").toString();
    }

    /**
     * Resolve a name to a single widget. Matching, most-specific first:
     * exact label (case-insensitive) → unique case-insensitive substring. Ambiguous or
     * absent both return empty, so a caller never acts on a guess.
     */
    public static Optional<Widget> resolve(List<Widget> widgets, String name) {
        String needle = name.toLowerCase(Locale.ROOT).trim();

        List<Widget> exact = new ArrayList<>();
        for (Widget w : widgets) {
            if (w.label() != null && w.label().toLowerCase(Locale.ROOT).equals(needle)) {
                exact.add(w);
            }
        }
        if (exact.size() == 1) {
            return Optional.of(exact.get(0));
        }
        if (exact.size() > 1) {
            return Optional.empty(); // ambiguous exact — refuse rather than pick
        }

        List<Widget> partial = new ArrayList<>();
        for (Widget w : widgets) {
            if (w.label() != null && w.label().toLowerCase(Locale.ROOT).contains(needle)) {
                partial.add(w);
            }
        }
        return partial.size() == 1 ? Optional.of(partial.get(0)) : Optional.empty();
    }

    /** Minimal JSON string escaping — enough for labels/class names, no dependency. */
    static String quote(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }
}
