package net.newpipe.newplayer.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

val NewPlayerLightColorScheme = lightColorScheme(
    primary = video_player_primary_light,
    onPrimary = video_player_onPrimary_light,
    primaryContainer = video_player_primaryContainer_light,
    onPrimaryContainer = video_player_onPrimaryContainer_light,
    secondary = video_player_secondary_light,
    onSecondary = video_player_onSecondary_light,
    secondaryContainer = video_player_secondaryContainer_light,
    onSecondaryContainer = video_player_onSecondaryContainer_light,
    tertiary = video_player_tertiary_light,
    onTertiary = video_player_onTertiary_light,
    tertiaryContainer = video_player_tertiaryContainer_light,
    onTertiaryContainer = video_player_onTertiaryContainer_light,
    error = video_player_error_light,
    errorContainer = video_player_errorContainer_light,
    onError = video_player_onError_light,
    onErrorContainer = video_player_onErrorContainer_light,
    background = video_player_background_light,
    onBackground = video_player_onBackground_light,
    surface = video_player_surface_light,
    onSurface = video_player_onSurface_light,
    surfaceVariant = video_player_surfaceVariant_light,
    onSurfaceVariant = video_player_onSurfaceVariant_light,
    outline = video_player_outline_light,
    inverseOnSurface = video_player_inverseOnSurface_light,
    inverseSurface = video_player_inverseSurface_light,
    inversePrimary = video_player_inversePrimary_light,
    surfaceTint = video_player_surfaceTint_light,
    outlineVariant = video_player_outlineVariant_light,
    scrim = video_player_scrim_light,
)

@Composable
/** @hide */
internal fun VideoPlayerLightTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = NewPlayerLightColorScheme,
        typography = NewPlayerTypography,
        content = content
    )
}
