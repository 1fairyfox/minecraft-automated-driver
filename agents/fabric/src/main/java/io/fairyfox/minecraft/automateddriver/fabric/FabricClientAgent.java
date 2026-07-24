package io.fairyfox.minecraft.automateddriver.fabric;

import java.nio.file.Path;
import java.security.SecureRandom;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.screen.ConfirmScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The Fabric client agent entrypoint.
 *
 * SECURITY (standing instruction — never weaken): DISABLED BY DEFAULT. It enables only via
 * the launch flag {@code -Dfairyfox.driver.enable=true} (instanced runs) or the in-game
 * title-screen "Automated Testing…" opt-in + confirmation (attach mode, process-lifetime
 * only). When enabled it binds 127.0.0.1 ONLY, ephemeral port, per-session 256-bit token
 * in a handshake file deleted on shutdown. No telemetry, no outbound connections.
 */
public class FabricClientAgent implements ClientModInitializer {
    // public: the client gametest (a different package) reads it to locate the handshake.
    // Package-private only ever compiled via Gradle's build cache — an honest cross-package
    // reference needs it public.
    public static final String AGENT_DIR = "minecraft-automated-driver-agent";
    private static final Logger LOG = LoggerFactory.getLogger("mad-fabric-agent");

    private final EnableGate gate = EnableGate.fromSystemProperties();
    private ClientControlServer control;

    @Override
    public void onInitializeClient() {
        // Flag path (instanced): enable as soon as the client is up.
        ClientLifecycleEvents.CLIENT_STARTED.register(client -> {
            if (gate.flagOpen()) {
                enable();
            }
        });
        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> disable());

        // Attach path: offer the opt-in button on the title screen while still disabled.
        ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (screen instanceof TitleScreen && gate.shouldOfferOptIn()) {
                addOptInButton(screen);
            }
        });

        LOG.info("Automated-driver client agent loaded (DISABLED — needs -Dfairyfox.driver.enable=true "
            + "or the title-screen opt-in). It exposes nothing until then.");
    }

    private void addOptInButton(Screen screen) {
        ButtonWidget button = ButtonWidget
            .builder(Text.literal("Automated Testing…"), b -> promptOptIn(screen))
            .dimensions(2, 2, 140, 20)
            .build();
        Screens.getButtons(screen).add(button);
    }

    private void promptOptIn(Screen parent) {
        var client = net.minecraft.client.MinecraftClient.getInstance();
        client.setScreen(new ConfirmScreen(
            confirmed -> {
                if (confirmed) {
                    gate.optIn();
                    enable();
                }
                client.setScreen(parent);
            },
            Text.literal("Enable automated testing?"),
            Text.literal("This lets local automation software on THIS computer drive your client for "
                + "testing, over a loopback-only, token-authenticated channel. It stays on only until "
                + "you close the game. Nothing is exposed to the network.")));
    }

    private synchronized void enable() {
        if (control != null) {
            return; // already enabled this session
        }
        try {
            String token = mintToken();
            ClientControlServer server = new ClientControlServer(token);
            int port = server.start();
            control = server;
            Path dir = FabricLoader.getInstance().getConfigDir().resolve(AGENT_DIR);
            Handshake.write(dir, port, token, ProcessHandle.current().pid());
            LOG.info("Automated-driver client agent ENABLED — control plane on 127.0.0.1:{} (token in handshake.json)", port);
        } catch (Exception e) {
            LOG.error("Automated-driver client agent failed to enable", e);
        }
    }

    private synchronized void disable() {
        if (control != null) {
            control.stop();
            control = null;
        }
        Handshake.delete(FabricLoader.getInstance().getConfigDir().resolve(AGENT_DIR));
    }

    private static String mintToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder(64);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
