package com.iampauld3v.axon.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Roles with no direct Material 3 slot (ported from the RN token set):
 * success pair, accent press-surface pair, structural border, input border.
 */
@Immutable
data class ExtendedColors(
    val success: Color,
    val onSuccess: Color,
    val accent: Color,
    val onAccent: Color,
    val border: Color,
    val input: Color,
    val ring: Color,
)

val LocalExtendedColors = staticCompositionLocalOf {
    ExtendedColors(
        success = AxonColors.SuccessL,
        onSuccess = AxonColors.SuccessForegroundL,
        accent = AxonColors.AccentL,
        onAccent = AxonColors.AccentForegroundL,
        border = AxonColors.BorderL,
        input = AxonColors.InputL,
        ring = AxonColors.RingL,
    )
}

private fun lightScheme() = lightColorScheme(
    primary = AxonColors.PrimaryL,
    onPrimary = AxonColors.PrimaryForegroundL,
    primaryContainer = AxonColors.AccentL,
    onPrimaryContainer = AxonColors.ForegroundL,
    inversePrimary = AxonColors.PrimaryD,
    secondary = AxonColors.SecondaryL,
    onSecondary = AxonColors.SecondaryForegroundL,
    secondaryContainer = AxonColors.MutedL,
    onSecondaryContainer = AxonColors.ForegroundL,
    tertiary = AxonColors.PrimaryL,
    onTertiary = AxonColors.PrimaryForegroundL,
    tertiaryContainer = AxonColors.AccentL,
    onTertiaryContainer = AxonColors.ForegroundL,
    background = AxonColors.BackgroundL,
    onBackground = AxonColors.ForegroundL,
    surface = AxonColors.CardL,
    onSurface = AxonColors.CardForegroundL,
    surfaceVariant = AxonColors.MutedL,
    onSurfaceVariant = AxonColors.MutedForegroundL,
    surfaceTint = AxonColors.CardL,
    inverseSurface = AxonColors.ForegroundL,
    inverseOnSurface = AxonColors.BackgroundL,
    error = AxonColors.DestructiveL,
    onError = AxonColors.DestructiveForegroundL,
    errorContainer = AxonColors.DestructiveL,
    onErrorContainer = AxonColors.DestructiveForegroundL,
    outline = AxonColors.BorderL,
    outlineVariant = AxonColors.BorderL,
    scrim = AxonColors.ForegroundL,
    surfaceBright = AxonColors.CardL,
    surfaceDim = AxonColors.BackgroundL,
    surfaceContainerLowest = AxonColors.CardL,
    surfaceContainerLow = AxonColors.CardL,
    surfaceContainer = AxonColors.MutedL,
    surfaceContainerHigh = AxonColors.MutedL,
    surfaceContainerHighest = AxonColors.AccentL,
)

private fun darkScheme() = darkColorScheme(
    primary = AxonColors.PrimaryD,
    onPrimary = AxonColors.PrimaryForegroundD,
    primaryContainer = AxonColors.AccentD,
    onPrimaryContainer = AxonColors.ForegroundD,
    inversePrimary = AxonColors.PrimaryL,
    secondary = AxonColors.SecondaryD,
    onSecondary = AxonColors.SecondaryForegroundD,
    secondaryContainer = AxonColors.MutedD,
    onSecondaryContainer = AxonColors.ForegroundD,
    tertiary = AxonColors.PrimaryD,
    onTertiary = AxonColors.PrimaryForegroundD,
    tertiaryContainer = AxonColors.AccentD,
    onTertiaryContainer = AxonColors.ForegroundD,
    background = AxonColors.BackgroundD,
    onBackground = AxonColors.ForegroundD,
    surface = AxonColors.CardD,
    onSurface = AxonColors.CardForegroundD,
    surfaceVariant = AxonColors.MutedD,
    onSurfaceVariant = AxonColors.MutedForegroundD,
    surfaceTint = AxonColors.CardD,
    inverseSurface = AxonColors.ForegroundD,
    inverseOnSurface = AxonColors.BackgroundD,
    error = AxonColors.DestructiveD,
    onError = AxonColors.DestructiveForegroundD,
    errorContainer = AxonColors.DestructiveD,
    onErrorContainer = AxonColors.DestructiveForegroundD,
    outline = AxonColors.BorderD,
    outlineVariant = AxonColors.BorderD,
    scrim = AxonColors.ForegroundD,
    surfaceBright = AxonColors.CardD,
    surfaceDim = AxonColors.BackgroundD,
    surfaceContainerLowest = AxonColors.CardD,
    surfaceContainerLow = AxonColors.CardD,
    surfaceContainer = AxonColors.MutedD,
    surfaceContainerHigh = AxonColors.MutedD,
    surfaceContainerHighest = AxonColors.AccentD,
)

/** Semantic meaning (ported from global.css rules): border = structure only;
 *  muted = inert surface; accent = pressed surface; card = contained content. */
@Composable
fun axonExtended(): ExtendedColors = LocalExtendedColors.current

@Composable
fun AxonTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val scheme: ColorScheme = if (darkTheme) darkScheme() else lightScheme()
    val extended = if (darkTheme) {
        ExtendedColors(
            success = AxonColors.SuccessD,
            onSuccess = AxonColors.SuccessForegroundD,
            accent = AxonColors.AccentD,
            onAccent = AxonColors.AccentForegroundD,
            border = AxonColors.BorderD,
            input = AxonColors.InputD,
            ring = AxonColors.RingD,
        )
    } else {
        ExtendedColors(
            success = AxonColors.SuccessL,
            onSuccess = AxonColors.SuccessForegroundL,
            accent = AxonColors.AccentL,
            onAccent = AxonColors.AccentForegroundL,
            border = AxonColors.BorderL,
            input = AxonColors.InputL,
            ring = AxonColors.RingL,
        )
    }
    CompositionLocalProvider(LocalExtendedColors provides extended) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AxonTypography,
            content = content,
        )
    }
}
