package com.iampauld3v.axon.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iampauld3v.axon.BuildConfig
import com.iampauld3v.axon.core.auth.AuthStatus
import com.iampauld3v.axon.core.data.ThemeMode
import com.iampauld3v.axon.core.di.AppContainer
import com.iampauld3v.axon.core.ui.theme.LabelStyle
import com.iampauld3v.axon.core.ui.theme.MetaStyle
import com.iampauld3v.axon.core.ui.theme.axonExtended
import com.iampauld3v.axon.ui.components.ScreenHeader
import kotlinx.coroutines.launch

/** Port of RN settings.tsx — account + appearance (Light/Dark segmented) + version footer. */
@Composable
fun SettingsScreen(container: AppContainer, onBack: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val ext = axonExtended()
    val mode by container.themeMode.mode.collectAsStateWithLifecycle()
    val status by container.session.status.collectAsStateWithLifecycle()
    val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
    val scope = rememberCoroutineScope()

    // 'system' follows the OS until the user picks a side; the switch shows the
    // side currently in effect (RN parity).
    val effective = when (mode) {
        ThemeMode.SYSTEM -> if (systemDark) ThemeMode.DARK else ThemeMode.LIGHT
        else -> mode
    }
    val email = (status as? AuthStatus.SignedIn)?.email

    Column(Modifier.fillMaxSize().background(colors.background)) {
        ScreenHeader(title = "Settings", onBack = onBack)

        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
            Text(
                "Account",
                style = LabelStyle,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    email ?: "Signed in",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                OutlinedButton(
                    onClick = { scope.launch { container.authRepo.signOut() } },
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                    shape = MaterialTheme.shapes.medium,
                    border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
                ) {
                    Text("Sign out", style = MaterialTheme.typography.labelLarge, color = colors.onBackground)
                }
            }

            Text(
                "Appearance",
                style = LabelStyle,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
            )
            ThemeSegmented(effective = effective, onSelect = { container.themeMode.set(it) })
            Text(
                "Leave it untouched and Axon follows your system until you pick a side.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp, start = 8.dp),
            )
        }

        Spacer(Modifier.weight(1f))

        Text(
            "Axon ${BuildConfig.VERSION_NAME}",
            style = MetaStyle,
            color = colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
        )
    }
}

@Composable
private fun ThemeSegmented(effective: ThemeMode, onSelect: (ThemeMode) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surfaceVariant, RoundedCornerShape(10.dp))
            .padding(3.dp),
    ) {
        Segment("Light", effective == ThemeMode.LIGHT, Modifier.weight(1f), colors) { onSelect(ThemeMode.LIGHT) }
        Segment("Dark", effective == ThemeMode.DARK, Modifier.weight(1f), colors) { onSelect(ThemeMode.DARK) }
    }
}

@Composable
private fun Segment(
    label: String,
    selected: Boolean,
    modifier: Modifier,
    colors: androidx.compose.material3.ColorScheme,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(3.dp)
            .background(
                if (selected) colors.background else Color.Transparent,
                RoundedCornerShape(8.dp),
            )
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) colors.onBackground else colors.onSurfaceVariant,
        )
    }
}
