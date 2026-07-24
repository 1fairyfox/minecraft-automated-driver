package io.fairyfox.minecraft.automateddriver.fabric;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The security gate: disabled by default; flag OR opt-in enables; opt-in offered only while off. */
class EnableGateTest {

    @Test
    void disabledByDefault() {
        EnableGate gate = new EnableGate(null);
        assertFalse(gate.enabled());
        assertFalse(gate.flagOpen());
        assertFalse(gate.optedIn());
        assertTrue(gate.shouldOfferOptIn());
    }

    @Test
    void nonTrueFlagStaysDisabled() {
        assertFalse(new EnableGate("false").enabled());
        assertFalse(new EnableGate("1").enabled());
        assertFalse(new EnableGate("TRUE").enabled()); // exact "true" only
    }

    @Test
    void launchFlagEnablesAndSuppressesTheOptInButton() {
        EnableGate gate = new EnableGate("true");
        assertTrue(gate.flagOpen());
        assertTrue(gate.enabled());
        assertFalse(gate.shouldOfferOptIn());
    }

    @Test
    void optInEnablesForTheSessionAndIsIdempotent() {
        EnableGate gate = new EnableGate(null);
        gate.optIn();
        assertTrue(gate.optedIn());
        assertTrue(gate.enabled());
        assertFalse(gate.shouldOfferOptIn());
        gate.optIn(); // idempotent
        assertTrue(gate.enabled());
    }
}
