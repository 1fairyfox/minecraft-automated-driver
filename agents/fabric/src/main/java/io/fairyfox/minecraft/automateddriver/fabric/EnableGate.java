package io.fairyfox.minecraft.automateddriver.fabric;

/**
 * The security-critical gate (pure logic, unit-tested). The client agent is DISABLED by
 * default and enables only through one of two deliberate acts:
 *
 * <ul>
 *   <li><b>Launch flag</b> {@code -Dfairyfox.driver.enable=true} — for instanced test runs
 *       the driver spawns; on by design for that process only.</li>
 *   <li><b>In-game opt-in</b> — the title-screen "Automated Testing…" button + a
 *       confirmation, which flips {@link #optIn()} for the life of the game process only.
 *       Never persisted; a fresh launch is disabled again.</li>
 * </ul>
 *
 * There is deliberately no config file that leaves it on across launches — the attach path
 * must be an explicit, per-session human gesture.
 */
public final class EnableGate {
    private final String flagValue;
    private boolean optedIn;

    public EnableGate(String flagValue) {
        this.flagValue = flagValue;
    }

    /** Read the real launch flag. */
    public static EnableGate fromSystemProperties() {
        return new EnableGate(System.getProperty("fairyfox.driver.enable"));
    }

    /** True when the launch flag opened the gate (instanced runs). */
    public boolean flagOpen() {
        return "true".equals(flagValue);
    }

    /** The in-game opt-in gesture flipped it on (attach mode; process-lifetime only). */
    public boolean optedIn() {
        return optedIn;
    }

    /** Effective state: enabled if the flag is set OR the user opted in this session. */
    public boolean enabled() {
        return flagOpen() || optedIn;
    }

    /** Record the confirmed in-game opt-in. Idempotent. */
    public void optIn() {
        optedIn = true;
    }

    /** Whether the title-screen opt-in button should even be offered (it's pointless once on). */
    public boolean shouldOfferOptIn() {
        return !enabled();
    }
}
