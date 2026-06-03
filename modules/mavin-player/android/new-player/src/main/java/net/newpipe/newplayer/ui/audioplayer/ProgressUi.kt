package net.newpipe.newplayer.ui.audioplayer

import androidx.annotation.OptIn
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import net.newpipe.newplayer.ui.common.NewPlayerSeeker
import net.newpipe.newplayer.ui.common.thumb_preview.ThumbPreview
import net.newpipe.newplayer.ui.common.getLocale
import net.newpipe.newplayer.ui.common.getTimeStringFromMs
import net.newpipe.newplayer.ui.seeker.SeekerDefaults
import net.newpipe.newplayer.ui.theme.VideoPlayerDarkTheme
import net.newpipe.newplayer.uiModel.InternalNewPlayerViewModel
import net.newpipe.newplayer.uiModel.NewPlayerUIState
import net.newpipe.newplayer.uiModel.NewPlayerViewModelDummy

/**hide*/
@OptIn(UnstableApi::class)
@Composable
internal fun ProgressUI(
    modifier: Modifier = Modifier,
    viewModel: InternalNewPlayerViewModel,
    uiState: NewPlayerUIState
) {
    val locale = getLocale()

    Column(modifier = modifier) {
        Box(
            modifier = Modifier
                .height(0.dp)
                .fillMaxWidth()
                .wrapContentHeight(unbounded = true, align = Alignment.Bottom)
        ) {
            ThumbPreview(
                modifier = Modifier.offset(y = (-20).dp) /* We have this offset to make space for your thumb */,
                uiState = uiState,
                thumbSize = SeekerDefaults.ThumbRadius * 2,
                previewHeight = 120.dp
            )
        }

        NewPlayerSeeker(viewModel = viewModel, uiState = uiState)
        Row {
            Text(
                getTimeStringFromMs(
                    uiState.playbackPositionInMs,
                    getLocale() ?: locale
                )
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            )
            Text(
                getTimeStringFromMs(
                    uiState.durationInMs,
                    getLocale() ?: locale
                )
            )
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Preview(device = "id:pixel_6")
@Composable
private fun AudioPlayerProgressUIPreview() {
    VideoPlayerDarkTheme {
        ProgressUI(
            viewModel = NewPlayerViewModelDummy(),
            uiState = NewPlayerUIState.DUMMY.copy(playList = emptyList(), isLoading = false)
        )
    }
}