package com.iampauld3v.axon.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iampauld3v.axon.core.ui.theme.SourceSans3

private val HeaderTitle = TextStyle(
    fontFamily = SourceSans3,
    fontWeight = FontWeight.SemiBold,
    fontSize = 17.sp,
    lineHeight = 24.sp,
)

/**
 * Port of RN ScreenHeader: 56dp row, optional back chevron, optional one-line
 * 17sp semibold title, right slot.
 */
@Composable
fun ScreenHeader(
    title: String? = null,
    onBack: (() -> Unit)? = null,
    right: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.size(24.dp),
                )
            }
        }
        if (title != null) {
            Text(
                text = title,
                style = HeaderTitle,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
        } else {
            Row(Modifier.weight(1f)) {}
        }
        right()
    }
}
