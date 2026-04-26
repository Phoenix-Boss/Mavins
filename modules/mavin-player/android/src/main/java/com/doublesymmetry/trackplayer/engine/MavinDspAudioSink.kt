package com.doublesymmetry.trackplayer.engine

import android.content.Context
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.doublesymmetry.trackplayer.dsp.CompressorProcessor
import com.doublesymmetry.trackplayer.dsp.CrossfeedProcessor
import com.doublesymmetry.trackplayer.dsp.DitherProcessor
import com.doublesymmetry.trackplayer.dsp.EqualizerProcessor
import com.doublesymmetry.trackplayer.dsp.ReplayGainProcessor
import com.doublesymmetry.trackplayer.dsp.SampleRateConverter
import com.doublesymmetry.trackplayer.dsp.FxProcessor
import com.doublesymmetry.trackplayer.dsp.LimiterProcessor
import com.doublesymmetry.trackplayer.dsp.PeakMeterProcessor

@UnstableApi
class MavinDspAudioSink(
    context: Context,
    val replayGain: ReplayGainProcessor,
    val sampleRateConverter: SampleRateConverter,
    val equalizer: EqualizerProcessor,
    val compressor: CompressorProcessor,
    val crossfeed: CrossfeedProcessor,
    val fx: FxProcessor,
    val limiter: LimiterProcessor,
    val peakMeter: PeakMeterProcessor,
    val dither: DitherProcessor
) : AudioSink by buildDelegate(
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
) {
    companion object {
        fun buildDelegate(
            context: Context,
            replayGain: ReplayGainProcessor,
            sampleRateConverter: SampleRateConverter,
            equalizer: EqualizerProcessor,
            compressor: CompressorProcessor,
            crossfeed: CrossfeedProcessor,
            fx: FxProcessor,
            limiter: LimiterProcessor,
            peakMeter: PeakMeterProcessor,
            dither: DitherProcessor
        ): DefaultAudioSink {
            val chain = MavinAudioProcessorChain(
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
            return DefaultAudioSink.Builder(context)
                .setAudioProcessorChain(chain)
                .setEnableFloatOutput(true)
                .build()
        }
    }
}

@UnstableApi
class MavinAudioProcessorChain(
    private val replayGain: ReplayGainProcessor,
    private val sampleRateConverter: SampleRateConverter,
    private val equalizer: EqualizerProcessor,
    private val compressor: CompressorProcessor,
    private val crossfeed: CrossfeedProcessor,
    private val fx: FxProcessor,
    private val limiter: LimiterProcessor,
    private val peakMeter: PeakMeterProcessor,
    private val dither: DitherProcessor
) : DefaultAudioSink.AudioProcessorChain {

    private val processors = arrayOf<AudioProcessor>(
        replayGain,
        equalizer,
        compressor,
        crossfeed,
        fx,
        limiter,
        sampleRateConverter,
        peakMeter,
        dither
    )

    override fun getAudioProcessors(): Array<AudioProcessor> = processors

    override fun applyPlaybackParameters(playbackParameters: PlaybackParameters): PlaybackParameters {
        return playbackParameters
    }

    override fun applySkipSilenceEnabled(skipSilenceEnabled: Boolean): Boolean {
        return skipSilenceEnabled
    }

    override fun getMediaDuration(playoutDuration: Long): Long {
        return playoutDuration
    }

    override fun getSkippedOutputFrameCount(): Long {
        return 0L
    }
}
