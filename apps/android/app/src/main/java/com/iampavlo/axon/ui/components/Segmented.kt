package com.iampavlo.axon.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** RN SegmentedControl port: muted track, active segment lifts in card color.
 *  Pass [trackColor] = Color.Transparent to let underlying content show
 *  through the track gaps (floating-tab look). */
@Composable
fun <T> SegmentedControl(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    trackColor: Color? = null,
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .background(trackColor ?: colors.surfaceVariant, RoundedCornerShape(10.dp))
            .padding(2.dp),
    ) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(value) }
                    .padding(3.dp)
                    .background(
                        colors.background,
                        RoundedCornerShape(8.dp),
                    )
                    .padding(vertical = 5.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.onBackground,
                )
            }
        }
    }
}
