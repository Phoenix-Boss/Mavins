package net.newpipe.newplayer.uiModel

import android.app.Application
import android.content.Context
import android.media.AudioManager
import android.net.Uri
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import net.newpipe.newplayer.NewPlayer
import net.newpipe.newplayer.data.PlayMode
import net.newpipe.newplayer.data.RepeatMode
import net.newpipe.newplayer.ui.ContentScale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewPlayerViewModelImpltest {
    val mockNewPlayer = mockk<NewPlayer>(relaxed = true)
    val mockExoPlayer = mockk<StateFlow<Player?>>(relaxed = true)
    var playerViewModel: NewPlayerViewModelImpl

    init {
        mockkStatic(Uri::class)
        mockkStatic(ContextCompat::class)
        mockkStatic(Log::class)

        val mockApp = mockk<Application>(relaxed = true)
        val mockAudioManager = mockk<AudioManager>(relaxed = true)

        every { Uri.parse(any()) } returns mockk<Uri>(relaxed = true)
        every { Log.i(any(), any()) } returns 1
        every { Log.d(any(), any()) } returns 1
        every { mockAudioManager.getStreamVolume(any()) } returns 0
        every { mockAudioManager.getStreamMaxVolume(any()) } returns 1
        every { ContextCompat.getSystemService(any(), AudioManager::class.java) } returns mockAudioManager
        every { mockApp.applicationContext } returns mockk<Context>(relaxed = true)
        every { mockNewPlayer.playBackMode } returns MutableStateFlow(PlayMode.IDLE)
        every { mockNewPlayer.playlist } returns MutableStateFlow(listOf(
            mockk<MediaItem>(),
            mockk<MediaItem>(),
            mockk<MediaItem>()
        ))
        every { mockNewPlayer.exoPlayer } returns mockExoPlayer
        every { mockExoPlayer.value?.isPlaying } returns false
        every { mockExoPlayer.value?.isLoading } returns false

        playerViewModel = NewPlayerViewModelImpl(mockApp)
        playerViewModel.newPlayer = mockNewPlayer
    }

    companion object {
        @JvmStatic
        @BeforeClass
        fun init() {
            Dispatchers.setMain(UnconfinedTestDispatcher())
        }

        @JvmStatic
        @BeforeClass
        fun reset() {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun play() {
        playerViewModel.play()
        verify (exactly = 1) { mockNewPlayer.play() }
    }

    @Test
    fun pause() {
        playerViewModel.pause()
        verify (exactly = 1) { mockNewPlayer.pause() }
    }

    @Test
    fun prevStream_decreasesCurrentlyPlayingPlaylistItemValue() {
        every { mockNewPlayer.currentlyPlayingPlaylistItem } returns 4
        playerViewModel.prevStream()
        verify (exactly = 1) { mockNewPlayer.currentlyPlayingPlaylistItem = 3 }
    }

    @Test
    fun prevStream_keepsSameCurrentlyPlayingPlaylistItemValue() {
        every { mockNewPlayer.currentlyPlayingPlaylistItem } returns 0
        playerViewModel.prevStream()
        verify (exactly = 0) { mockNewPlayer.currentlyPlayingPlaylistItem = any() }
    }

    @Test
    fun nextStream_increasesCurrentlyPlayingPlaylistItemValue() {
        every { mockNewPlayer.currentlyPlayingPlaylistItem } returns 4
        every { mockExoPlayer.value?.mediaItemCount } returns 6
        playerViewModel.nextStream()
        verify (exactly = 1) { mockNewPlayer.currentlyPlayingPlaylistItem = 5 }
    }

    @Test
    fun nextStream_keepsSameCurrentlyPlayingPlaylistItemValue() {
        every { mockNewPlayer.currentlyPlayingPlaylistItem } returns 5
        every { mockExoPlayer.value?.mediaItemCount } returns 6
        playerViewModel.nextStream()
        verify (exactly = 0) { mockNewPlayer.currentlyPlayingPlaylistItem = any() }
    }

    @Test
    fun changeUiMode_pipFromAudioMode() {
        playerViewModel.changeUiMode(UIModeState.EMBEDDED_AUDIO, null)
        playerViewModel.changeUiMode(UIModeState.PIP, null)
        assertEquals(UIModeState.EMBEDDED_VIDEO, playerViewModel.uiState.value.uiMode)
        assertTrue(playerViewModel.uiState.value.enteringPip)
    }

    @Test
    fun changeUiMode_pipFromVideoControllerUiVisible() {
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO_CONTROLLER_UI, null)
        playerViewModel.changeUiMode(UIModeState.PIP, null)
        assertEquals(UIModeState.FULLSCREEN_VIDEO, playerViewModel.uiState.value.uiMode)
        assertTrue(playerViewModel.uiState.value.enteringPip)
    }

    @Test
    fun changeUiMode_pip() {
        playerViewModel.changeUiMode(UIModeState.EMBEDDED_VIDEO, null)
        playerViewModel.changeUiMode(UIModeState.PIP, null)
        assertEquals(UIModeState.EMBEDDED_VIDEO, playerViewModel.uiState.value.uiMode)
        assertTrue(playerViewModel.uiState.value.enteringPip)
    }

    @Test
    fun changeUiMode_notFullscreenFromFullscreen() {
        val embeddedUiConfig = EmbeddedUiConfig(true, 0.2f, 1)
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, embeddedUiConfig)
        playerViewModel.changeUiMode(UIModeState.EMBEDDED_VIDEO, null)
        assertEquals(UIModeState.EMBEDDED_VIDEO, playerViewModel.uiState.value.uiMode)
        assertEquals(embeddedUiConfig, playerViewModel.uiState.value.embeddedUiConfig)
    }

    @Test
    fun changeUiMode_fromPipToFullscreenVideo() {
        playerViewModel.changeUiMode(UIModeState.PIP, null)
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, null)
        assertEquals(UIModeState.FULLSCREEN_VIDEO, playerViewModel.uiState.value.uiMode)
    }

    @Test
    fun changeUiMode_keepsSamePlayBackModeValue() {
        mockNewPlayer.playBackMode.value = PlayMode.EMBEDDED_VIDEO
        playerViewModel.changeUiMode(UIModeState.EMBEDDED_VIDEO, null)
        assertEquals(PlayMode.EMBEDDED_VIDEO, mockNewPlayer.playBackMode.value)
    }

    @Test
    fun changeUiMode_updatesPlayBackModeValue() {
        mockNewPlayer.playBackMode.value = PlayMode.IDLE
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, null)
        assertEquals(PlayMode.FULLSCREEN_VIDEO, mockNewPlayer.playBackMode.value)
    }

    @Test
    fun seekPositionChanged() {
        //set an initial value for seekerPosition
        playerViewModel.seekPositionChanged(12f)
        every { mockNewPlayer.duration } returns 56L

        playerViewModel.seekPositionChanged(28f)

        //currentPosition = old seekerPosition * duration
        verify (exactly = 1) { mockNewPlayer.currentPosition = 672L }
        assertEquals(28f, playerViewModel.uiState.value.seekerPosition)
        assertEquals(672L, playerViewModel.uiState.value.playbackPositionInMs)
        assertTrue(playerViewModel.uiState.value.seekPreviewVisible)
    }

    @Test
    fun seekingFinished() {
        playerViewModel.seekPositionChanged(56f)
        every { mockNewPlayer.duration } returns 56L

        playerViewModel.seekingFinished()

        verify (exactly = 1) { mockNewPlayer.currentPosition = 3136L }
        assertFalse(playerViewModel.uiState.value.seekPreviewVisible)
    }

    @Test
    fun fastSeek() {
        every { mockNewPlayer.fastSeekAmountSec } returns 24
        every { mockNewPlayer.currentPosition } returns 10

        playerViewModel.fastSeek(1)

        assertEquals(24, playerViewModel.uiState.value.fastSeekSeconds)
        verify (exactly = 1) { mockNewPlayer.currentPosition = 24010 }
    }

    @Test
    fun finishFastSeek() {
        every { mockNewPlayer.fastSeekAmountSec } returns 24
        //set an initial value for fastSeekSeconds
        playerViewModel.fastSeek(1)

        playerViewModel.finishFastSeek()

        assertEquals(0, playerViewModel.uiState.value.fastSeekSeconds)
    }

    @Test
    fun brightnessChange_updatesBrightnessValueOnFullscreen() {
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, null)
        playerViewModel.brightnessChange(0.5f, 0.1f)
        assertEquals(0.75f, playerViewModel.uiState.value.brightness)
    }

    @Test
    fun brightnessChange_keepsSameBrightnessValueIfNotOnFullscreen() {
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, null)
        playerViewModel.brightnessChange(0.3f, 0.1f)
        val initialBrightness = playerViewModel.uiState.value.brightness
        playerViewModel.changeUiMode(UIModeState.EMBEDDED_VIDEO, null)

        playerViewModel.brightnessChange(0.1f, 0.1f)

        assertEquals(initialBrightness, playerViewModel.uiState.value.brightness)
    }

    @Test
    fun volumeChange() {
        playerViewModel.volumeChange(0.1f)
        assertEquals(0.13f, playerViewModel.uiState.value.soundVolume)
    }

    @Test
    fun onBackPressed() {
        playerViewModel.changeUiMode(UIModeState.FULLSCREEN_VIDEO, null)
        playerViewModel.onBackPressed()
        assertEquals(UIModeState.EMBEDDED_VIDEO, playerViewModel.uiState.value.uiMode)
        assertEquals(PlayMode.EMBEDDED_VIDEO, mockNewPlayer.playBackMode.value)
    }

    @Test
    fun chapterSelected() {
        playerViewModel.chapterSelected(12)
        verify (exactly = 1) { mockNewPlayer.selectChapter(12) }
    }

    @Test
    fun streamSelected() {
        playerViewModel.streamSelected(24)
        verify (exactly = 1) { mockNewPlayer.currentlyPlayingPlaylistItem = 24 }
    }

    @Test
    fun cycleRepeatMode_fromDoNotRepeat() {
        every { mockNewPlayer.repeatMode } returns RepeatMode.DO_NOT_REPEAT
        playerViewModel.cycleRepeatMode()
        verify { mockNewPlayer.repeatMode = RepeatMode.REPEAT_ALL }
    }

    @Test
    fun cycleRepeatMode_fromRepeatAll() {
        every { mockNewPlayer.repeatMode } returns RepeatMode.REPEAT_ALL
        playerViewModel.cycleRepeatMode()
        verify { mockNewPlayer.repeatMode = RepeatMode.REPEAT_ONE }
    }

    @Test
    fun cycleRepeatMode_fromRepeatOne() {
        every { mockNewPlayer.repeatMode } returns RepeatMode.REPEAT_ONE
        playerViewModel.cycleRepeatMode()
        verify { mockNewPlayer.repeatMode = RepeatMode.DO_NOT_REPEAT }
    }

    @Test
    fun cycleContentFitMode() {
        playerViewModel.cycleContentFitMode()
        assertEquals(ContentScale.CROP, playerViewModel.uiState.value.contentFitMode)
        playerViewModel.cycleContentFitMode()
        assertEquals(ContentScale.STRETCHED, playerViewModel.uiState.value.contentFitMode)
        playerViewModel.cycleContentFitMode()
        assertEquals(ContentScale.FIT_INSIDE, playerViewModel.uiState.value.contentFitMode)
        playerViewModel.cycleContentFitMode()
        assertEquals(ContentScale.CROP, playerViewModel.uiState.value.contentFitMode)
    }

    @Test
    fun toggleShuffle() {
        every { mockNewPlayer.shuffle } returns false
        playerViewModel.toggleShuffle()
        verify (exactly = 1) { mockNewPlayer.shuffle = true }
        every { mockNewPlayer.shuffle } returns true
        playerViewModel.toggleShuffle()
        verify (exactly = 1) { mockNewPlayer.shuffle = false }
    }

    @Test
    fun movePlaylistItem() {
        assertEquals(3, playerViewModel.uiState.value.playList.size)
        val firstPlaylistItem = playerViewModel.uiState.value.playList.get(0)
        val secondPlaylistitem = playerViewModel.uiState.value.playList.get(1)
        val thirdPlaylistItem = playerViewModel.uiState.value.playList.get(2)

        playerViewModel.movePlaylistItem(1, 2)

        assertEquals(firstPlaylistItem, playerViewModel.uiState.value.playList.get(0))
        assertEquals(thirdPlaylistItem, playerViewModel.uiState.value.playList.get(1))
        assertEquals(secondPlaylistitem, playerViewModel.uiState.value.playList.get(2))
        assertEquals(3, playerViewModel.uiState.value.playList.size)
    }

    @Test
    fun onStreamItemDragFinished() {
        playerViewModel.movePlaylistItem(1, 2)
        playerViewModel.onStreamItemDragFinished()
        verify (exactly = 1) { mockNewPlayer.movePlaylistItem(1, 2) }
    }

    @Test
    fun dialogVisible_updatesUiMode() {
        playerViewModel.dialogVisible(true)
        assertEquals(UIModeState.PLACEHOLDER, playerViewModel.uiState.value.uiMode)
    }

    @Test
    fun doneEnteringPip() {
        playerViewModel.changeUiMode(UIModeState.PIP, null)
        assertTrue(playerViewModel.uiState.value.enteringPip)
        playerViewModel.doneEnteringPip()
        assertFalse(playerViewModel.uiState.value.enteringPip)
    }

    @Test
    fun onPictureInPictureModeChanged_pipActivated() {
        playerViewModel.onPictureInPictureModeChanged(true)
        assertEquals(UIModeState.PIP, playerViewModel.uiState.value.uiMode)
    }

    @Test
    fun onPictureInPictureModeChanged_pipDeactivated() {
        playerViewModel.onPictureInPictureModeChanged(false)
        assertEquals(UIModeState.FULLSCREEN_VIDEO, playerViewModel.uiState.value.uiMode)
    }

    @Test
    fun removePlaylistItem() {
        playerViewModel.removePlaylistItem(123L)
        verify (exactly = 1) { mockNewPlayer.removePlaylistItem(123L) }
    }

}