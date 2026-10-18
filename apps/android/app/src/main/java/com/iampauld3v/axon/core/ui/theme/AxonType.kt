package com.iampauld3v.axon.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.iampauld3v.axon.R

/**
 * Source Sans 3 bundled (400/500/600/700), same faces the RN app loaded via
 * @expo-google-fonts. Sizes/lineHeights ported from the RN Text component's
 * cva variants.
 */
val SourceSans3 = FontFamily(
    Font(R.font.source_sans3_regular, FontWeight.Normal),
    Font(R.font.source_sans3_medium, FontWeight.Medium),
    Font(R.font.source_sans3_semibold, FontWeight.SemiBold),
    Font(R.font.source_sans3_bold, FontWeight.Bold),
)

/** RN "title" variant: 34/40, tracking-tight. */
val TitleStyle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.SemiBold,
    fontSize = 34.sp,
    lineHeight = 40.sp,
    letterSpacing = (-0.85).sp,
)

/** RN "heading" variant: 22/28, tracking-tight. */
val HeadingStyle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.SemiBold,
    fontSize = 22.sp,
    lineHeight = 28.sp,
    letterSpacing = (-0.55).sp,
)

/** RN "label" variant: 11, medium, uppercase, tracked out, muted color applied at call site. */
val LabelStyle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.Medium,
    fontSize = 11.sp,
    lineHeight = 16.sp,
    letterSpacing = 0.88.sp,
)

/** RN "meta" variant: 13, tabular numerals, muted color applied at call site. */
val MetaStyle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.Normal,
    fontSize = 13.sp,
    lineHeight = 18.sp,
    fontFeatureSettings = "tnum",
)

/** RN expanded lesson title on the class screen: 20sp. */
val LessonTitleStyle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
)

val AxonTypography = Typography(
    headlineLarge = TitleStyle,
    headlineMedium = HeadingStyle,
    titleLarge = LessonTitleStyle,
    titleMedium = TextStyle(
        fontFamily = SourceSans3,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = SourceSans3,
        fontWeight = FontWeight.Normal,
        fontSize = 17.sp,
        lineHeight = 29.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = SourceSans3,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = SourceSans3,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = SourceSans3,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    ),
    labelSmall = LabelStyle,
)

/** RN 28/34 medium title (login header, skill detail topic). */
val Heading28Medium = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.Medium,
    fontSize = 28.sp,
    lineHeight = 34.sp,
    letterSpacing = (-0.7).sp,
)
