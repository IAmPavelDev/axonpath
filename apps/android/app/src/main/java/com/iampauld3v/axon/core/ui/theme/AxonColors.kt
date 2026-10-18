package com.iampauld3v.axon.core.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Single source of truth for Axon colors — ported 1:1 from RN `lib/theme.ts`
 * (HSL triplets, verified against `global.css` by the RN lockstep script).
 * Never hardcode colors in screens; reference these or MaterialTheme slots.
 */
object AxonColors {
    // ---- Light ----
    val BackgroundL = Color.hsl(213f, 0.40f, 0.92f)
    val ForegroundL = Color.hsl(221f, 0.39f, 0.11f)
    val CardL = Color.hsl(0f, 0f, 1f)
    val CardForegroundL = Color.hsl(221f, 0.39f, 0.11f)
    val PrimaryL = Color.hsl(221f, 0.83f, 0.47f)
    val PrimaryForegroundL = Color.hsl(0f, 0f, 1f)
    val SecondaryL = Color.hsl(213f, 0.30f, 0.88f)
    val SecondaryForegroundL = Color.hsl(221f, 0.39f, 0.11f)
    val MutedL = Color.hsl(213f, 0.30f, 0.88f)
    val MutedForegroundL = Color.hsl(215f, 0.19f, 0.35f)
    val AccentL = Color.hsl(213f, 0.35f, 0.85f)
    val AccentForegroundL = Color.hsl(221f, 0.39f, 0.11f)
    val DestructiveL = Color.hsl(0f, 0.72f, 0.46f)
    val DestructiveForegroundL = Color.hsl(0f, 0f, 0.98f)
    val SuccessL = Color.hsl(145f, 0.65f, 0.27f)
    val SuccessForegroundL = Color.hsl(0f, 0f, 0.98f)
    val BorderL = Color.hsl(213f, 0.22f, 0.78f)
    val InputL = Color.hsl(213f, 0.25f, 0.74f)
    val RingL = Color.hsl(217f, 0.91f, 0.60f)

    // ---- Dark ----
    val BackgroundD = Color.hsl(221f, 0.39f, 0.12f)
    val ForegroundD = Color.hsl(217f, 0.24f, 0.90f)
    val CardD = Color.hsl(220f, 0.32f, 0.17f)
    val CardForegroundD = Color.hsl(217f, 0.24f, 0.90f)
    val PrimaryD = Color.hsl(213f, 0.94f, 0.68f)
    val PrimaryForegroundD = Color.hsl(221f, 0.39f, 0.10f)
    val SecondaryD = Color.hsl(220f, 0.27f, 0.21f)
    val SecondaryForegroundD = Color.hsl(217f, 0.24f, 0.90f)
    val MutedD = Color.hsl(220f, 0.27f, 0.21f)
    val MutedForegroundD = Color.hsl(216f, 0.16f, 0.70f)
    val AccentD = Color.hsl(220f, 0.25f, 0.25f)
    val AccentForegroundD = Color.hsl(217f, 0.24f, 0.90f)
    val DestructiveD = Color.hsl(0f, 0.65f, 0.60f)
    val DestructiveForegroundD = Color.hsl(221f, 0.39f, 0.10f)
    val SuccessD = Color.hsl(142f, 0.55f, 0.45f)
    val SuccessForegroundD = Color.hsl(221f, 0.39f, 0.10f)
    val BorderD = Color.hsl(220f, 0.18f, 0.26f)
    val InputD = Color.hsl(220f, 0.17f, 0.29f)
    val RingD = Color.hsl(213f, 0.94f, 0.68f)
}
