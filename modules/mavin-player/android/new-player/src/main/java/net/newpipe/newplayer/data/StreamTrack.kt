/* NewPlayer
 *
 * @author Christian Schabesberger
 *
 * Copyright (C) NewPipe e.V. 2024 <code(at)newpipe-ev.de>
 *
 * NewPlayer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * NewPlayer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with NewPlayer.  If not, see <http://www.gnu.org/licenses/>.
 */

package net.newpipe.newplayer.data

/**
 * Media3 does not provide a class to represent individual tracks. So here we go.
 */
sealed interface StreamTrack {
    val fileFormat: String

    fun toShortIdentifierString(): String
    fun toLongIdentifierString(): String

    companion object {
        /** [Comparator] for StreamTracks, sorts VideoStreamTracks before AudioStreamTracks */
         fun compareResolution(t1: StreamTrack, t2: StreamTrack) =
            when {
                // video comes before audio
                t1 is VideoStreamTrack && t2 is AudioStreamTrack -> -1
                // audio comes after video
                t1 is AudioStreamTrack && t2 is VideoStreamTrack -> 1
                // better audio/video first
                t1 is VideoStreamTrack && t2 is VideoStreamTrack -> -VideoStreamTrack.compareResolutions(t1, t2)
                t1 is AudioStreamTrack && t2 is AudioStreamTrack -> -AudioStreamTrack.compareResolutions(t1, t2)
                // should not happen
                else -> 0
            }
    }
}

/**
 * A track representing a video track.
 */
data class VideoStreamTrack(
    val width: Int,
    val height: Int,
    val frameRate: Int,
    override val fileFormat: String,
) : StreamTrack {

    override fun toShortIdentifierString() =
        "${if (width < height) width else height}p${if (frameRate > 30) frameRate else ""}"

    override fun toLongIdentifierString() = "$fileFormat ${toShortIdentifierString()}"

    companion object {
        /**
         * [Comparator] for VideoStreamTrack resolutions
         */
        fun compareResolutions(a: VideoStreamTrack, b: VideoStreamTrack): Int {
            val diff = a.width * a.height - b.width * b.height
            if (diff != 0) {
                return diff
            }
            return a.frameRate - b.frameRate
        }
    }

    override fun toString() = """
        VideoStreamTrack {
            width = $width
            height = $height
            frameRate = $frameRate
            fileFormat = $fileFormat
        }
    """.trimIndent()

}

/**
 * A track representing an audio track.
 */
data class AudioStreamTrack(
    val bitrate: Int,
    override val fileFormat: String,
    val language: String? = null
) : StreamTrack {

    override fun toShortIdentifierString() =
        if (bitrate < 1000) "${bitrate}bps" else "${bitrate / 1000}kbps"

    override fun toLongIdentifierString() = "$fileFormat ${toShortIdentifierString()}"

    companion object {
        /** [Comparator] for AudioStreamTrack bitrates */
        fun compareResolutions(a: AudioStreamTrack, b: AudioStreamTrack) =
            a.bitrate - b.bitrate
    }

    override fun toString() = """
        AudioStreamTrack {
            bitrate = $bitrate
            language = $language
            fileFormat = $fileFormat
        }
    """.trimIndent()
}