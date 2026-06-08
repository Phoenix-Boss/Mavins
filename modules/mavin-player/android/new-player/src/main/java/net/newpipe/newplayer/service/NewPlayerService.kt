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

package net.newpipe.newplayer.service

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import net.newpipe.newplayer.NewPlayer
import net.newpipe.newplayer.data.PlayMode

private const val TAG = "NewPlayerService"

// ─── What changed from the original ──────────────────────────────────────────
//
// 1. Removed `internal` modifier from the class declaration.
//    The original file had `internal class NewPlayerService`. Since NewPlayerService
//    lives in the `new-player` Gradle module and MavinPlayerModule lives in the
//    `mavin-player` Gradle module, `internal` made it inaccessible across module
//    boundaries — causing the "Cannot access 'class NewPlayerService'" build errors.
//    Making it public (default, no modifier) allows MavinPlayerModule to reference it.
//
// 2. Added companion object with setNewPlayer() / getNewPlayer().
//    MavinPlayerModule calls NewPlayerService.setNewPlayer(instance) after creating
//    the NewPlayerImpl. When Android starts the MediaSessionService for background
//    playback, onCreate() calls getNewPlayer() to retrieve the instance.
//    This decouples service startup from direct instantiation — Android controls
//    when the service starts, so the NewPlayer instance must be pre-stored.
//
// 3. All other logic is unchanged from the original NewPlayer library implementation.
//
// ─────────────────────────────────────────────────────────────────────────────

class NewPlayerService : MediaSessionService() {

    private var mediaSession: MediaSession? = null
    private lateinit var customCommands: List<CustomCommand>
    lateinit var newPlayer: NewPlayer
    private var serviceScope = CoroutineScope(Dispatchers.Main + Job())

    companion object {
        @Volatile
        private var playerInstance: NewPlayer? = null

        /**
         * Store the NewPlayer instance before the service starts.
         * Called by MavinPlayerModule after creating NewPlayerImpl.
         * Android starts the MediaSessionService independently — it needs to
         * find the instance here rather than receiving it via Intent extras.
         */
        fun setNewPlayer(instance: NewPlayer) {
            synchronized(this) {
                playerInstance = instance
                Log.d(TAG, "NewPlayer instance stored in companion holder")
            }
        }

        private fun getNewPlayer(): NewPlayer? = playerInstance
    }

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        // Retrieve the NewPlayer instance stored by MavinPlayerModule before super.onCreate().
        // If not found the service cannot function — stop immediately rather than crash.
        val instance = getNewPlayer()
        if (instance == null) {
            Log.e(TAG, "No NewPlayer instance found in companion holder — service cannot start")
            stopSelf()
            return
        }
        newPlayer = instance
        Log.d(TAG, "NewPlayer instance retrieved from companion holder")

        super.onCreate()

        setMediaNotificationProvider(object : MediaNotification.Provider {
            override fun createNotification(
                mediaSession: MediaSession,
                customLayout: ImmutableList<CommandButton>,
                actionFactory: MediaNotification.ActionFactory,
                onNotificationChangedCallback: MediaNotification.Provider.Callback
            ): MediaNotification {
                val notification = createNewPlayerNotification(
                    service             = this@NewPlayerService,
                    session             = mediaSession,
                    notificationManager = getSystemService(
                        Context.NOTIFICATION_SERVICE
                    ) as NotificationManager,
                    notificationIcon    = newPlayer.notificationIcon,
                    playerActivity      = newPlayer.playerActivityClass
                )
                return MediaNotification(NEW_PLAYER_MEDIA_NOTIFICATION_ID, notification)
            }

            override fun handleCustomCommand(
                session: MediaSession,
                action: String,
                extras: Bundle
            ): Boolean {
                Log.d(TAG, "handleCustomCommand: action=$action")
                return false
            }
        })

        customCommands = buildCustomCommandList(this)

        if (newPlayer.exoPlayer.value != null) {
            mediaSession = MediaSession.Builder(this, newPlayer.exoPlayer.value!!)
                .setCallback(object : MediaSession.Callback {
                    override fun onConnect(
                        session: MediaSession,
                        controller: MediaSession.ControllerInfo
                    ): MediaSession.ConnectionResult {
                        val connectionResult = super.onConnect(session, controller)
                        val availableSessionCommands =
                            connectionResult.availableSessionCommands.buildUpon()
                        customCommands.forEach { command ->
                            command.commandButton.sessionCommand?.let {
                                availableSessionCommands.add(it)
                            }
                        }
                        return MediaSession.ConnectionResult.accept(
                            availableSessionCommands.build(),
                            connectionResult.availablePlayerCommands
                        )
                    }

                    override fun onPostConnect(
                        session: MediaSession,
                        controller: MediaSession.ControllerInfo
                    ) {
                        super.onPostConnect(session, controller)
                        mediaSession?.setCustomLayout(customCommands.map { it.commandButton })
                    }

                    override fun onCustomCommand(
                        session: MediaSession,
                        controller: MediaSession.ControllerInfo,
                        customCommand: SessionCommand,
                        args: Bundle
                    ): ListenableFuture<SessionResult> {
                        return when (customCommand.customAction) {
                            CustomCommand.NEW_PLAYER_NOTIFICATION_COMMAND_CLOSE_PLAYBACK -> {
                                newPlayer.release()
                                Futures.immediateFuture(
                                    SessionResult(SessionResult.RESULT_SUCCESS)
                                )
                            }
                            else -> {
                                Log.e(TAG, "Unknown custom command: ${customCommand.customAction}")
                                Futures.immediateFuture(
                                    SessionResult(SessionError.ERROR_NOT_SUPPORTED)
                                )
                            }
                        }
                    }
                })
                .build()
        } else {
            Log.e(TAG, "ExoPlayer is null at service start — stopping service")
            stopSelf()
        }

        // Stop the service when playback returns to IDLE.
        serviceScope.launch {
            newPlayer.playBackMode.collect { mode ->
                if (mode == PlayMode.IDLE) {
                    Log.d(TAG, "PlayMode=IDLE — stopping service")
                    stopSelf()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        newPlayer.release()
        mediaSession?.release()
        Log.d(TAG, "NewPlayerService destroyed")
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Stop service if player has nothing to play or is not set to play when ready.
        if (newPlayer.exoPlayer.value?.playWhenReady != true ||
            newPlayer.playlist.value.isEmpty()
        ) {
            Log.d(TAG, "onTaskRemoved — stopping service (nothing to play)")
            stopSelf()
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession
}