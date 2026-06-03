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

package net.newpipe.newplayer.ui.videoplayer.gesture_ui

import android.util.Log
import android.view.MotionEvent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInteropFilter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.newpipe.newplayer.ui.common.getPixelsPerCentimeter
import kotlin.math.abs

private const val TAG = "GestureSurface"

private const val ENTER_MULTITAB_MODE_DELAY: Long = 300

@Composable
@OptIn(ExperimentalComposeUiApi::class)

/** @hide */
internal fun GestureSurface(
    modifier: Modifier,
    color: Color = Color.Transparent,
    onMultiTap: (Int) -> Unit = {},
    onMultiTapFinished: () -> Unit = {},
    onRegularTap: () -> Unit = {},
    onUp: () -> Unit = {},
    onMovement: (TouchedPosition) -> Unit = {},
    content: @Composable () -> Unit = {}
) {

    var movementEventsUnlocked by remember {
        mutableStateOf(false)
    }

    var ignoreMovementWhileFingerDown by remember {
        mutableStateOf(false)
    }

    var fingerDownPosition by remember {
        mutableStateOf(TouchedPosition(0f, 0f))
    }

    var lastTouchPosition by remember {
        mutableStateOf(TouchedPosition(0f, 0f))
    }

    var lastFingerDownTime by remember {
        mutableStateOf(0L)
    }

    var lastFingerUpTime by remember {
        mutableStateOf(0L)
    }

    val composableScope = rememberCoroutineScope()
    var regularTabJob: Job? by remember {
        mutableStateOf(null)
    }

    var multitapAmount: Int by remember {
        mutableIntStateOf(0)
    }

    var cancelMultitapJob: Job? by remember {
        mutableStateOf(null)
    }

    val onMultitap = {
        Log.d(TAG, "Trigger multitab")
        regularTabJob?.cancel()
        cancelMultitapJob?.cancel()
        multitapAmount++
        onMultiTap(multitapAmount)
        cancelMultitapJob = composableScope.launch {
            delay(ENTER_MULTITAB_MODE_DELAY)
            multitapAmount = 0
            onMultiTapFinished()
        }
    }

    /*
     * Only use this function in tab down.
     */
    val isAMultitapEvent = {
        val currentTime = System.currentTimeMillis()
        val timeSinceLastFingerDown = currentTime - lastFingerDownTime
        timeSinceLastFingerDown <= ENTER_MULTITAB_MODE_DELAY
    }

    val fingerDownAndUpHappenedInShortEnoughTimeForARegularTab = {
        val current = System.currentTimeMillis()
        val timeSinceLastFingerUp = current - lastFingerUpTime
        timeSinceLastFingerUp < ENTER_MULTITAB_MODE_DELAY
    }

    val startToFigureOutIfItsRegularTab = {
        Log.d(TAG, "    Maybe regular tab?")
        regularTabJob = composableScope.launch {
            delay(ENTER_MULTITAB_MODE_DELAY)

            val isMultitab = isAMultitapEvent();
            val fingerDownUpOk = fingerDownAndUpHappenedInShortEnoughTimeForARegularTab()
            if (multitapAmount <= 0 && fingerDownUpOk) {
                onRegularTap()
                Log.d(TAG, "    Yes Tab")
            } else {
                Log.d(TAG, "    No Tab: multitab: $isMultitab, downUpOk: $fingerDownUpOk")
            }
        }
    }

    val handleActionDown = { event: MotionEvent ->
        Log.d(TAG, "finger down")
        fingerDownPosition = TouchedPosition(event.x, event.y)
        lastTouchPosition = fingerDownPosition
        movementEventsUnlocked = false
        ignoreMovementWhileFingerDown = false

        if (isAMultitapEvent()) {
            onMultitap();
        } else {
            startToFigureOutIfItsRegularTab()
        }
        lastFingerDownTime = System.currentTimeMillis()
        true
    }

    val handleActionUp = { onMultiTap: (Int) -> Unit, onRegularTap: () -> Unit ->
        Log.d(TAG, "finger up")
        onUp()
        lastFingerUpTime = System.currentTimeMillis()
        movementEventsUnlocked = false
        ignoreMovementWhileFingerDown = false
        true
    }

    // prevents detecting movement when actually a tap was intended
    val deadZoneRange = 0.1 * getPixelsPerCentimeter()


    val handleMove =
        { event: MotionEvent, onFilteredMovementEvent: (movement: TouchedPosition) -> Unit ->
            val currentTouchedPosition = TouchedPosition(event.x, event.y)
            val movement = currentTouchedPosition - lastTouchPosition
            val vectorFromFingerDownEvent = currentTouchedPosition - fingerDownPosition

            lastTouchPosition = currentTouchedPosition

            if (!movementEventsUnlocked && deadZoneRange < vectorFromFingerDownEvent.distance()) {
                movementEventsUnlocked = true
                if (regularTabJob?.isActive ?: false) {
                    Log.d(TAG, "    cancel regular tab")
                    regularTabJob?.cancel()
                }
                // if user starts to swipe sideways the movements should be totally ignore
                // for as long as the user keeps the finger on the screen.
                if (abs(vectorFromFingerDownEvent.y) <= abs(vectorFromFingerDownEvent.x)) {
                    ignoreMovementWhileFingerDown = true
                }
            }

            if (movementEventsUnlocked && !ignoreMovementWhileFingerDown) {
                Log.d(TAG, "movement event: distance")
                // filter out left and right movements as these are not important for the app
                if (abs(movement.x) <= abs(movement.y)) {
                    onFilteredMovementEvent(movement)
                }
            }
            true
        }

    Box(modifier = modifier.pointerInteropFilter {
        when (it.action) {
            MotionEvent.ACTION_DOWN -> handleActionDown(it)
            MotionEvent.ACTION_UP -> handleActionUp(onMultiTap, onRegularTap)
            MotionEvent.ACTION_MOVE -> handleMove(it, onMovement)

            else -> false
        }
    }) {
        content()
        Surface(color = color, modifier = Modifier.fillMaxSize()) {}
    }
}

