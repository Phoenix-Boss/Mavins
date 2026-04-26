package com.doublesymmetry.trackplayer.extensions

import com.doublesymmetry.kotlinaudio.models.AudioPlayerState
import com.doublesymmetry.trackplayer.model.State

val AudioPlayerState.asLibState: State
    get() = when (this) {
        AudioPlayerState.IDLE      -> State.None
        AudioPlayerState.BUFFERING,
        AudioPlayerState.LOADING   -> State.Buffering
        AudioPlayerState.READY     -> State.Ready
        AudioPlayerState.PLAYING   -> State.Playing
        AudioPlayerState.PAUSED    -> State.Paused
        AudioPlayerState.STOPPED   -> State.Stopped
        AudioPlayerState.ERROR     -> State.Error
        AudioPlayerState.ENDED     -> State.Ended
        else                       -> State.None
    }
