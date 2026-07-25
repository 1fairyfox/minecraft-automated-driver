package io.fairyfox.minecraft.automateddriver.fabric.mixin;

import net.minecraft.client.option.SimpleOption;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * Accessor for the concrete option-slider widget ({@code SimpleOption$OptionSliderWidgetImpl}),
 * exposing the {@link SimpleOption} it drives. {@code SimpleOption#getValue()}/{@code setValue(T)}
 * are public, so with the option in hand the agent can read and set the option's TYPED value
 * (e.g. FOV = 70) — the per-option value across sliders/cyclers/toggles — not just the 0..1
 * fraction. Targeted by string because it's an inner class; the mixin makes it implement this
 * interface so an {@code instanceof} check reaches it.
 */
@Mixin(targets = "net.minecraft.client.option.SimpleOption$OptionSliderWidgetImpl")
public interface OptionSliderWidgetImplAccessor {

    /** The {@link SimpleOption} this option-slider reads from / writes to. */
    @Accessor("option")
    SimpleOption<?> mad$getOption();
}
