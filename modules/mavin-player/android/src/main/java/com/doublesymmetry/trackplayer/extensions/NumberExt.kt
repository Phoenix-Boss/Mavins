package com.doublesymmetry.trackplayer.extensions

class NumberExt {
    companion object {
        fun Double.toMilliseconds(): Long = (this * 1000).toLong()
        fun Long.toSeconds(): Double = this / 1000.0
        fun Double.toSeconds(): Double = this / 1000.0
    }
}
