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

package net.newpipe.newplayer.ui.selection_ui

import androidx.annotation.OptIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import net.newpipe.newplayer.uiModel.NewPlayerUIState
import net.newpipe.newplayer.uiModel.InternalNewPlayerViewModel
import net.newpipe.newplayer.uiModel.NewPlayerViewModelDummy
import net.newpipe.newplayer.ui.theme.VideoPlayerDarkTheme
import net.newpipe.newplayer.ui.common.getEmbeddedUiConfig
import net.newpipe.newplayer.ui.common.getInsets

@OptIn(UnstableApi::class)
@Composable

/** @hide */
internal fun ChapterSelectUI(
    viewModel: InternalNewPlayerViewModel,
    uiState: NewPlayerUIState,
    shownInAudioPlayer: Boolean,
) {
    val insets = getInsets()

    val embeddedUiConfig = getEmbeddedUiConfig()

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(insets),
        containerColor = if (shownInAudioPlayer) {
            MaterialTheme.colorScheme.background
        } else {
            Color.Transparent
        },
        topBar = {
            ChapterSelectTopBar(
                onClose = {
                    viewModel.changeUiMode(
                        uiState.uiMode.getNextModeWhenBackPressed() ?: uiState.uiMode,
                        embeddedUiConfig
                    )
                }
            )
        }
    ) { innerPadding ->
        Box(modifier = Modifier.padding(innerPadding)) {
            LazyColumn(
                modifier = Modifier
                    .padding(start = 5.dp, end = 5.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                items(uiState.chapters.size) { chapterIndex ->
                    val chapter = uiState.chapters[chapterIndex]
                    ChapterItem(
                        id = chapterIndex,
                        chapterTitle = chapter.chapterTitle ?: "",
                        chapterStartInMs = chapter.chapterStartInMs,
                        thumbnail = chapter.thumbnail,
                        onClicked = {
                            if (!uiState.uiMode.isChapterSelect) {
                                // We don't select the chapter when we are not in chapter select mode
                                return@ChapterItem
                            }
                            viewModel.chapterSelected(chapterIndex)
                        },
                        isCurrentChapter = isActiveChapter(
                            chapterId = chapterIndex,
                            uiState.chapters,
                            playbackPosition = uiState.playbackPositionInMs
                        )
                    )
                }
            }
        }
    }
}


@OptIn(UnstableApi::class)
@Preview(device = "id:pixel_5")
@Composable
private fun VideoPlayerChannelSelectUIPreview() {
    VideoPlayerDarkTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = Color.DarkGray) {
            ChapterSelectUI(
                viewModel = NewPlayerViewModelDummy(),
                uiState = NewPlayerUIState.DUMMY,
                shownInAudioPlayer = false
            )
        }
    }
}
