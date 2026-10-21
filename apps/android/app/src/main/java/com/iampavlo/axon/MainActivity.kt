package com.iampavlo.axon

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iampavlo.axon.core.auth.AuthStatus
import com.iampavlo.axon.core.data.ThemeMode
import com.iampavlo.axon.core.ui.theme.AxonTheme
import com.iampavlo.axon.feature.login.LoginScreen
import com.iampavlo.axon.feature.nav.AxonNavHost

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as AxonApp).container
        setContent {
            val mode by container.themeMode.mode.collectAsStateWithLifecycle()
            val systemDark = isSystemInDarkTheme()
            AxonTheme(
                darkTheme = when (mode) {
                    ThemeMode.SYSTEM -> systemDark
                    ThemeMode.LIGHT -> false
                    ThemeMode.DARK -> true
                },
            ) {
                val status by container.session.status.collectAsStateWithLifecycle()
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    // Background fills edge-to-edge; content sits inside the
                    // system bars (RN SafeAreaView parity). IME stays
                    // screen-local (screens call imePadding themselves).
                    val insetBounds = WindowInsets.safeDrawing.only(
                        WindowInsetsSides.Horizontal + WindowInsetsSides.Top + WindowInsetsSides.Bottom,
                    )
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(MaterialTheme.colorScheme.background)
                            .windowInsetsPadding(insetBounds),
                    ) {
                        when (status) {
                            // Splash: background shows until the first auth emission.
                            AuthStatus.Initializing -> Box(Modifier.fillMaxSize())
                            is AuthStatus.SignedIn -> AxonNavHost(container)
                            AuthStatus.SignedOut -> LoginScreen(container)
                        }
                    }
                }
            }
        }
    }
}
