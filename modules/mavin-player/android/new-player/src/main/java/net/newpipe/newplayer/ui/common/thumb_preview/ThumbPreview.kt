package net.newpipe.newplayer.ui.common.thumb_preview

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

import android.graphics.BitmapFactory
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import net.newpipe.newplayer.R
import net.newpipe.newplayer.data.Chapter
import net.newpipe.newplayer.ui.seeker.SeekerDefaults
import net.newpipe.newplayer.ui.theme.VideoPlayerDarkTheme
import net.newpipe.newplayer.uiModel.NewPlayerUIState


/** @hide */
internal const val PREVIEW_BOX_PADDING = 4
internal const val PREVIEW_TEXT_TO_HEIGHT_RATIO = 18 / 9

private val PREVIEW_FADE_IN = fadeIn(tween(200))
private val PREVIEW_FADE_OUT = fadeOut(tween(400))


/** @hide */
@OptIn(UnstableApi::class)
@Composable
internal fun ThumbPreview(
    modifier: Modifier = Modifier,
    uiState: NewPlayerUIState,
    thumbSize: Dp = SeekerDefaults.ThumbRadius * 2,
    additionalStartPaddingPxls: Int = 0,
    additionalEndPaddingPxls: Int = 0,
    previewHeight: Dp = 60.dp,
) {

    Column(modifier = modifier) {
        ThumbTextPreview(
            modifier = Modifier,
            uiState = uiState,
            thumbSize = thumbSize,
            startOffset = additionalStartPaddingPxls,
            endOffset = additionalEndPaddingPxls,
            previewHeight = previewHeight,
        )

        ThumbImagePreview(
            modifier = Modifier,
            uiState,
            thumbSize,
            additionalStartPaddingPxls,
            additionalEndPaddingPxls,
            previewHeight,
        )
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun ThumbTextPreview(
    modifier: Modifier = Modifier,
    uiState: NewPlayerUIState,
    thumbSize: Dp,
    startOffset: Int,
    endOffset: Int,
    previewHeight: Dp,
) {

    val textHeight = 30.dp

    AnimatedVisibility(
        modifier = modifier
            .fillMaxWidth()
            .height((2 * PREVIEW_BOX_PADDING).dp + textHeight),
        visible = uiState.seekPreviewVisible && (uiState.currentSeekPreviewText ?: "") != "",
        enter = PREVIEW_FADE_IN,
        exit = PREVIEW_FADE_OUT
    ) {

        PlaceRelativeToThumbSliderLayout(
            Modifier, uiState, thumbSize, startOffset = startOffset, endOffset = endOffset
        ) {
            Text(
                modifier = Modifier.width(previewHeight * PREVIEW_TEXT_TO_HEIGHT_RATIO),
                text = uiState.currentSeekPreviewText ?: "",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyMedium,
                overflow = TextOverflow.Ellipsis,
                maxLines = 2,
            )
        }
    }
}


@OptIn(UnstableApi::class)
@Composable
private fun ThumbImagePreview(
    modifier: Modifier = Modifier,
    uiState: NewPlayerUIState,
    thumbSize: Dp = SeekerDefaults.ThumbRadius * 2,
    additionalStartPaddingPxls: Int = 0,
    additionalEndPaddingPxls: Int = 0,
    previewHeight: Dp = 60.dp,
) {

    AnimatedVisibility(
        modifier = Modifier
            .fillMaxWidth()
            .height(previewHeight + PREVIEW_BOX_PADDING.dp * 2),
        visible = uiState.seekPreviewVisible && uiState.currentSeekPreviewThumbnail != null,
        enter = PREVIEW_FADE_IN,
        exit = PREVIEW_FADE_OUT
    ) {
        // Together with the getHeight() function this Box ensures that the thumbnail
        // does not collapse and glitch during enter and exit animation.

        // this allows the current thumbnail to remain when animated visibility is being hidden
        var lastAvailableImage by remember {
            mutableStateOf(uiState.currentSeekPreviewThumbnail)
        }
        if (uiState.currentSeekPreviewThumbnail != null) {
            lastAvailableImage = uiState.currentSeekPreviewThumbnail
        }

        lastAvailableImage?.let { lastAvailableImage ->
            PlaceRelativeToThumbSliderLayout(
                Modifier.wrapContentSize(),
                uiState = uiState,
                thumbSize = thumbSize,
                startOffset = additionalStartPaddingPxls,
                endOffset = additionalEndPaddingPxls
            ) {
                Box(
                    modifier = Modifier.wrapContentSize()
                ) {
                    Card(
                        modifier = Modifier
                            .padding(PREVIEW_BOX_PADDING.dp)
                            .height(previewHeight)
                            .aspectRatio(lastAvailableImage.width.toFloat() / lastAvailableImage.height.toFloat()),
                        elevation = CardDefaults.cardElevation(PREVIEW_BOX_PADDING.dp)
                    ) {
                        Image(
                            modifier = Modifier.fillMaxSize(),
                            bitmap = lastAvailableImage,
                            contentDescription = stringResource(id = R.string.seek_thumb_preview)
                        )
                    }
                }
            }
        }

        /* This is a little helper block that helps place the thumbnail correctly relative to the
        thumb of the seeker. This is only there for debug reasons.
        Surface(
            modifier = Modifier
                .size(10.dp, 10.dp)
                .offset { IntOffset(previewPosition.toInt(), 200) }, color = Color.Blue
        ) {
        }
        */
    }
}

@OptIn(UnstableApi::class)
@Preview(device = "spec:width=1080px,height=600px,dpi=440")
@Composable
private fun ThumbPreviewPreview() {
    var sliderPosition by remember { mutableFloatStateOf(0f) }

    var startOffset by remember { mutableIntStateOf(0) }
    var endOffset by remember { mutableIntStateOf(0) }

    var thumbDown by remember { mutableStateOf(false) }

    val previewThumbnail =
        BitmapFactory.decodeResource(LocalContext.current.resources, android.R.drawable.ic_menu_gallery)


    VideoPlayerDarkTheme {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Green)
        ) {
            ThumbPreview(
                uiState = NewPlayerUIState.DUMMY.copy(
                    seekerPosition = sliderPosition,
                    seekPreviewVisible = thumbDown,
                    currentSeekPreviewThumbnail = previewThumbnail.asImageBitmap(),
                    currentSeekPreviewText = Chapter(
                        0, "What a wonderfull chapter", null
                    ).chapterTitle
                ),
                additionalStartPaddingPxls = startOffset,
                additionalEndPaddingPxls = endOffset,
                thumbSize = 20.dp // see handle width
            )

            Row(
                modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = "Left", modifier = Modifier.onGloballyPositioned {
                    startOffset = it.size.width
                })
                Slider(modifier = Modifier.weight(1f), value = sliderPosition, onValueChange = {
                    thumbDown = true
                    sliderPosition = it
                }, onValueChangeFinished = { thumbDown = false })
                Text(text = "R", modifier = Modifier.onGloballyPositioned {
                    endOffset = it.size.width
                })
            }
        }
    }
}
