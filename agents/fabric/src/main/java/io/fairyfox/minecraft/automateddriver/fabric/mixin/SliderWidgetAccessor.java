package io.fairyfox.minecraft.automateddriver.fabric.mixin;

import net.minecraft.client.gui.widget.SliderWidget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

/**
 * Accessor mixin for {@link SliderWidget}: its normalised progress {@code value} (0..1) and the
 * {@code setValue(double)} that clamps + applies it are {@code protected}. A Mixin
 * {@code @Accessor}/{@code @Invoker} is the remap-safe way to reach them from the agent (plain
 * reflection by name breaks against a production client's intermediary names). This is the RAW
 * slider surface — works on ANY slider; for option sliders {@code setValue} also writes the value
 * back to the underlying game option via the widget's {@code applyValue()}.
 */
@Mixin(SliderWidget.class)
public interface SliderWidgetAccessor {

    /** The slider's current normalised progress in [0,1]. */
    @Accessor("value")
    double mad$getValue();

    /** Set the slider's normalised progress in [0,1]; clamps, applies, and updates the message. */
    @Invoker("setValue")
    void mad$setValue(double value);
}
