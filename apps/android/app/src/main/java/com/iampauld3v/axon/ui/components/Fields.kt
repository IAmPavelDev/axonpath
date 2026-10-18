package com.iampauld3v.axon.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.iampauld3v.axon.core.ui.theme.LabelStyle
import com.iampauld3v.axon.core.ui.theme.axonExtended

/** Label-above-field pattern shared by skill review and the QA composer. */
@Composable
fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    secure: Boolean = false,
    enabled: Boolean = true,
) {
    FieldShell(label, modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = {
                Text(
                    placeholder,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
            singleLine = true,
            enabled = enabled,
            visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
            shape = MaterialTheme.shapes.small,
            colors = fieldColors(),
        )
    }
}

/** Multiline textarea (RN Textarea). */
@Composable
fun LabeledArea(
    label: String?,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    minLines: Int = 4,
    minHeight: Dp = 0.dp,
) {
    FieldShell(label, modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .then(if (minHeight > 0.dp) Modifier.height(minHeight) else Modifier),
            placeholder = {
                Text(
                    placeholder,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
            minLines = minLines,
            enabled = enabled,
            shape = MaterialTheme.shapes.medium,
            colors = fieldColors(),
        )
    }
}

@Composable
private fun FieldShell(label: String?, modifier: Modifier, content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) {
            Text(label, style = LabelStyle, color = colors.onSurfaceVariant)
        }
        content()
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = axonExtended().ring,
    unfocusedBorderColor = axonExtended().input,
    focusedContainerColor = MaterialTheme.colorScheme.background,
    unfocusedContainerColor = MaterialTheme.colorScheme.background,
    focusedTextColor = MaterialTheme.colorScheme.onBackground,
    unfocusedTextColor = MaterialTheme.colorScheme.onBackground,
    cursorColor = axonExtended().ring,
)
