package net.newpipe.newplayer.ui.audioplayer

import androidx.annotation.OptIn
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import net.newpipe.newplayer.uiModel.NewPlayerUIState


/**hide*/
@OptIn(UnstableApi::class)
@Composable
internal fun TitleView(modifier: Modifier = Modifier, uiState: NewPlayerUIState) {
    Column(modifier = modifier) {
        Text(
            text = uiState.currentlyPlaying?.mediaMetadata?.title.toString(),
            maxLines = 1,
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.basicMarquee(),
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = uiState.currentlyPlaying?.mediaMetadata?.artist.toString(),
            maxLines = 1,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.basicMarquee(),
        )
    }
}