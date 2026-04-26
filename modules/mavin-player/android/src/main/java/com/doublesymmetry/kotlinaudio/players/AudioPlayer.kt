package com.doublesymmetry.kotlinaudio.players

import com.doublesymmetry.trackplayer.engine.MavinRenderersFactory
import android.content.Context
import com.doublesymmetry.kotlinaudio.models.BufferConfig
import com.doublesymmetry.kotlinaudio.models.CacheConfig
import com.doublesymmetry.kotlinaudio.models.PlayerConfig
import com.doublesymmetry.kotlinaudio.models.PlayerOptions

open class AudioPlayer(context: Context, playerConfig: PlayerOptions = PlayerOptions(), renderersFactory: MavinRenderersFactory? = null): BaseAudioPlayer(context, playerConfig, renderersFactory)
