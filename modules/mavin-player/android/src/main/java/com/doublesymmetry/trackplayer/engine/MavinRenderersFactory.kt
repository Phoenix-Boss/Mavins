package com.doublesymmetry.trackplayer.engine

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import com.doublesymmetry.trackplayer.dsp.CompressorProcessor
import com.doublesymmetry.trackplayer.dsp.CrossfeedProcessor
import com.doublesymmetry.trackplayer.dsp.DitherProcessor
import com.doublesymmetry.trackplayer.dsp.EqualizerProcessor
import com.doublesymmetry.trackplayer.dsp.ReplayGainProcessor
import com.doublesymmetry.trackplayer.dsp.SampleRateConverter
import com.doublesymmetry.trackplayer.dsp.FxProcessor
import com.doublesymmetry.trackplayer.dsp.LimiterProcessor
import com.doublesymmetry.trackplayer.dsp.PeakMeterProcessor

/**
 * MavinRenderersFactory
 *
 * This is the correct Neutron/Poweramp injection pattern.
 *
 * How it works:
 * 1. QueuedAudioPlayer passes this factory to ExoPlayer.Builder
 * 2. ExoPlayer calls buildAudioRenderers() when it needs audio renderers
 * 3. We return a MediaCodecAudioRenderer built with MavinDspAudioSink
 * 4. MavinDspAudioSink has OFFLOAD_MODE_DISABLED â€” forces software decode path
 * 5. Software decode path always routes through AudioProcessorChain
 * 6. AudioProcessorChain contains your full DSP chain
 * 7. Every PCM buffer hits your DSP. No silence. No bypass.
 *
 * Why this works when plain RenderersFactory injection fails:
 * The silence problem comes from offload mode â€” Android routes audio
 * directly to hardware DSP, bypassing the AudioSink entirely.
 * MavinDspAudioSink disables offload at the sink level, which is
 * enforced before ExoPlayer even decides on a render path.
 */
@UnstableApi
class MavinRenderersFactory(
    context: Context,
    private val replayGain: ReplayGainProcessor,
    private val sampleRateConverter: SampleRateConverter,
    private val equalizer: EqualizerProcessor,
    private val compressor: CompressorProcessor,
    private val crossfeed: CrossfeedProcessor,
    private val fx: FxProcessor,
    private val limiter: LimiterProcessor,
    private val peakMeter: PeakMeterProcessor,
    private val dither: DitherProcessor
) : DefaultRenderersFactory(context) {

    // Hold reference so MusicService can access DSP controls at runtime
    lateinit var dspSink: MavinDspAudioSink
        private set

    override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean
    ): AudioSink {
        +
            context,
            replayGain,
            sampleRateConverter,
            equalizer,
            compressor,
            crossfeed,
            fx,
            limiter,
            peakMeter,
            dither
        )
        return dspSink
    }
}