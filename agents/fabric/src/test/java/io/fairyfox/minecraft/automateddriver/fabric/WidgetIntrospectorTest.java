package io.fairyfox.minecraft.automateddriver.fabric;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The semantic core: name resolution + serialisation, no client needed. */
class WidgetIntrospectorTest {

    private static WidgetIntrospector.Widget w(String label) {
        return new WidgetIntrospector.Widget(label, "ButtonWidget", 0, 0, 0, 100, 20, true);
    }

    private static List<WidgetIntrospector.Widget> screen() {
        return List.of(
            new WidgetIntrospector.Widget("Singleplayer", "ButtonWidget", 0, 10, 10, 200, 20, true),
            new WidgetIntrospector.Widget("Multiplayer", "ButtonWidget", 1, 10, 40, 200, 20, true),
            new WidgetIntrospector.Widget("Options", "ButtonWidget", 2, 10, 70, 200, 20, true),
            new WidgetIntrospector.Widget("Automated Testing", "ButtonWidget", 3, 2, 2, 140, 20, true));
    }

    @Test
    void exactCaseInsensitiveLabelResolves() {
        Optional<WidgetIntrospector.Widget> m = WidgetIntrospector.resolve(screen(), "multiplayer");
        assertTrue(m.isPresent());
        assertEquals(1, m.get().index());
    }

    @Test
    void uniqueSubstringResolves() {
        Optional<WidgetIntrospector.Widget> m = WidgetIntrospector.resolve(screen(), "Automated");
        assertTrue(m.isPresent());
        assertEquals(3, m.get().index());
    }

    @Test
    void absentNameResolvesToEmpty() {
        assertFalse(WidgetIntrospector.resolve(screen(), "Realms").isPresent());
    }

    @Test
    void ambiguousExactRefusesRatherThanGuess() {
        List<WidgetIntrospector.Widget> two = List.of(w("Play"), w("Play"));
        assertFalse(WidgetIntrospector.resolve(two, "play").isPresent());
    }

    @Test
    void ambiguousSubstringRefuses() {
        // "e" appears in several labels — many substring matches, so refuse.
        assertFalse(WidgetIntrospector.resolve(screen(), "e").isPresent());
    }

    @Test
    void exactWinsOverSubstring() {
        List<WidgetIntrospector.Widget> ws = List.of(w("Options"), w("Options menu"));
        // "Options" exactly matches the first AND is a substring of the second; exact wins.
        Optional<WidgetIntrospector.Widget> m = WidgetIntrospector.resolve(ws, "Options");
        assertTrue(m.isPresent());
        assertEquals("Options", m.get().label());
    }

    @Test
    void nullLabelsAreSkipped() {
        List<WidgetIntrospector.Widget> ws = List.of(
            new WidgetIntrospector.Widget(null, "X", 0, 0, 0, 0, 0, false), w("Play"));
        assertTrue(WidgetIntrospector.resolve(ws, "Play").isPresent());
    }

    @Test
    void describeEmitsScreenAndWidgets() {
        String json = WidgetIntrospector.describe("TitleScreen", screen());
        assertTrue(json.startsWith("{\"screen\":\"TitleScreen\",\"widgets\":["));
        assertTrue(json.contains("\"label\":\"Multiplayer\""));
        assertTrue(json.contains("\"index\":3"));
        assertTrue(json.endsWith("]}"));
    }

    @Test
    void describeHandlesNullScreenNameAndEmptyList() {
        assertEquals("{\"screen\":null,\"widgets\":[]}", WidgetIntrospector.describe(null, List.of()));
    }

    @Test
    void quoteEscapesSpecialsControlCharsAndNull() {
        assertEquals("\"a\\\"b\\\\c\\n\"", WidgetIntrospector.quote("a\"b\\c\n"));
        assertEquals("\"\\u0001\"", WidgetIntrospector.quote(String.valueOf((char) 1)));
        assertEquals("\"\\t\\r\"", WidgetIntrospector.quote("\t\r"));
        assertEquals("\"plain\"", WidgetIntrospector.quote("plain"));
        assertEquals("null", WidgetIntrospector.quote(null));
    }
}
