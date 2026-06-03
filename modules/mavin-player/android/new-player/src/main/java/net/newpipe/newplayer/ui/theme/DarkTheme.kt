package net.newpipe.newplayer.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme

import androidx.compose.runtime.Composable

val NewPlayerDarkColorScheme = darkColorScheme(
    primary = video_player_primary_dark,
    onPrimary = video_player_onPrimary_dark,
    primaryContainer = video_player_primaryContainer_dark,
    onPrimaryContainer = video_player_onPrimaryContainer_dark,
    secondary = video_player_secondary_dark,
    onSecondary = video_player_onSecondary_dark,
    secondaryContainer = video_player_secondaryContainer_dark,
    onSecondaryContainer = video_player_onSecondaryContainer_dark,
    tertiary = video_player_tertiary_dark,
    onTertiary = video_player_onTertiary_dark,
    tertiaryContainer = video_player_tertiaryContainer_dark,
    onTertiaryContainer = video_player_onTertiaryContainer_dark,
    error = video_player_error_dark,
    errorContainer = video_player_errorContainer_dark,
    onError = video_player_onError_dark,
    onErrorContainer = video_player_onErrorContainer_dark,
    background = video_player_background_dark,
    onBackground = video_player_onBackground_dark,
    surface = video_player_surface_dark,
    onSurface = video_player_onSurface_dark,
    surfaceVariant = video_player_surfaceVariant_dark,
    onSurfaceVariant = video_player_onSurfaceVariant_dark,
    outline = video_player_outline_dark,
    inverseOnSurface = video_player_inverseOnSurface_dark,
    inverseSurface = video_player_inverseSurface_dark,
    inversePrimary = video_player_inversePrimary_dark,
    surfaceTint = video_player_surfaceTint_dark,
    outlineVariant = video_player_outlineVariant_dark,
    scrim = video_player_scrim_dark,
)

@Composable
/** @hide */
internal fun VideoPlayerDarkTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = NewPlayerDarkColorScheme,
        typography = NewPlayerTypography,
        content = content
    )
}
