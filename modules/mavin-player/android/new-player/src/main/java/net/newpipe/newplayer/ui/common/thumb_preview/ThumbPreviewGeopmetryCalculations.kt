package net.newpipe.newplayer.ui.common.thumb_preview

import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import net.newpipe.newplayer.uiModel.NewPlayerUIState

/** @hide */
internal data class ThumbnailGeometry(
    val aspectRatio: Float, val edgeCorrectedPreviewPosition: Int
)

/**hide*/
internal data class ThumbTextPreviewGeometry(
    val text: String,
    val size: Placeable
)

/** hide */
@OptIn(UnstableApi::class)
@Composable
internal fun PlaceRelativeToThumbSliderLayout(
    modifier: Modifier,
    uiState: NewPlayerUIState,
    thumbSize: Dp,
    startOffset: Int,
    endOffset: Int,
    content: @Composable () -> Unit
) {
    val thumbSizePxls = with(LocalDensity.current) { thumbSize.toPx() }.toInt()

    SubcomposeLayout(modifier) { constraints ->
        val placeables = subcompose(null, content).map {
            it.measure(Constraints())
        }


        val xPositions = placeables.map {
            calculateThumbRelativeXCoordinates(
                uiState = uiState,
                thumbSize = thumbSizePxls,
                placeable = it,
                startOffset = startOffset,
                endOffset = endOffset,
                constraints = constraints
            )
        }

        layout(constraints.maxWidth, constraints.maxHeight) {
            placeables.zip(xPositions).map { (placeable, xPosition) ->
                placeable.place(xPosition, 0)
            }
        }
    }
}

/** hide */
@OptIn(UnstableApi::class)
internal fun calculateThumbRelativeXCoordinates(
    uiState: NewPlayerUIState,
    thumbSize: Int,
    placeable: Placeable,
    constraints: Constraints,
    startOffset: Int,
    endOffset: Int,
): Int {

    val thumbCenterLocationX =
        startOffset + thumbSize / 2 + ((constraints.maxWidth - thumbSize - startOffset - endOffset) * uiState.seekerPosition)

    val edgeCorrectedPreviewPosition =
        if (thumbCenterLocationX < (placeable.width / 2)) 0
        else if ((constraints.maxWidth - (placeable.width / 2)) < thumbCenterLocationX) constraints.maxWidth - placeable.width
        else thumbCenterLocationX - (placeable.width / 2)

    return edgeCorrectedPreviewPosition.toInt()
}