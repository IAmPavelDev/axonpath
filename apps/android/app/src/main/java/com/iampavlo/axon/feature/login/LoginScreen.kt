package com.iampavlo.axon.feature.login

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.ui.theme.axonExtended

/**
 * Port of RN app/login.tsx — sign-in/sign-up form + Google button, same copy,
 * same disable rules (single busy slot; submit needs non-empty email+password).
 */
@Composable
fun LoginScreen(
    container: AppContainer,
    vm: LoginViewModel = viewModel(initializer = { LoginViewModel(container.authRepo, container.analytics) }),
) {
    val ext = axonExtended()
    val colors = MaterialTheme.colorScheme
    // ComponentActivity from setContent — Credential Manager needs it to
    // route the picker result back (app context silently loses it).
    val activity = LocalContext.current as? Activity

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Column(
            modifier = Modifier.padding(bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = if (vm.mode == LoginViewModel.Mode.SIGN_IN) "Welcome back" else "Create your account",
                style = com.iampavlo.axon.core.ui.theme.Heading28Medium,
                color = colors.onBackground,
            )
            Text(
                text = if (vm.mode == LoginViewModel.Mode.SIGN_IN) {
                    "Sign in to keep learning where you left off."
                } else {
                    "Name any topic — Axon builds the first lesson."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (vm.mode == LoginViewModel.Mode.SIGN_UP) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LabeledField(
                        label = "First name",
                        value = vm.firstName,
                        onValueChange = vm::onFirstName,
                        placeholder = "Grace",
                        capitalizeWords = true,
                        modifier = Modifier.weight(1f),
                    )
                    LabeledField(
                        label = "Last name",
                        value = vm.lastName,
                        onValueChange = vm::onLastName,
                        placeholder = "Hopper",
                        capitalizeWords = true,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            LabeledField(
                label = "Email",
                value = vm.email,
                onValueChange = vm::onEmail,
                placeholder = "you@example.com",
                keyboardType = KeyboardType.Email,
            )

            LabeledField(
                label = "Password",
                value = vm.password,
                onValueChange = vm::onPassword,
                placeholder = "••••••••",
                secure = true,
            )

            vm.error?.let {
                Text(text = it, style = MaterialTheme.typography.bodyMedium, color = colors.error)
            }

            Button(
                onClick = vm::submit,
                enabled = vm.busy == null && vm.email.isNotEmpty() && vm.password.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(48.dp),
                shape = MaterialTheme.shapes.medium,
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.primary,
                    contentColor = colors.onPrimary,
                ),
            ) {
                Text(
                    text = when {
                        vm.busy == LoginViewModel.Busy.FORM -> "…"
                        vm.mode == LoginViewModel.Mode.SIGN_IN -> "Sign in"
                        else -> "Create account"
                    },
                    style = MaterialTheme.typography.labelLarge,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Hairline(Modifier.weight(1f), ext.border)
                Text(text = "or", style = com.iampavlo.axon.core.ui.theme.MetaStyle, color = colors.onSurfaceVariant)
                Hairline(Modifier.weight(1f), ext.border)
            }

            OutlinedButton(
                onClick = { activity?.let(vm::continueWithGoogle) },
                enabled = vm.busy == null,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = MaterialTheme.shapes.medium,
                border = androidx.compose.foundation.BorderStroke(1.dp, ext.border),
            ) {
                Text(
                    text = if (vm.busy == LoginViewModel.Busy.GOOGLE) "Connecting…" else "Continue with Google",
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.onBackground,
                )
            }

            androidx.compose.material3.TextButton(
                onClick = vm::switchMode,
                enabled = vm.busy == null,
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            ) {
                Text(
                    text = if (vm.mode == LoginViewModel.Mode.SIGN_IN) {
                        "New here? Create an account"
                    } else {
                        "Already have an account? Sign in"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = colors.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    secure: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Unspecified,
    capitalizeWords: Boolean = false,
) {
    val ext = axonExtended()
    val colors = MaterialTheme.colorScheme
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = label,
            style = com.iampavlo.axon.core.ui.theme.LabelStyle,
            color = colors.onSurfaceVariant,
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = {
                Text(text = placeholder, style = MaterialTheme.typography.bodyLarge, color = colors.onSurfaceVariant)
            },
            singleLine = true,
            visualTransformation = if (secure) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (secure) KeyboardType.Password else keyboardType,
            ),
            shape = MaterialTheme.shapes.small,
            colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                focusedBorderColor = ext.ring,
                unfocusedBorderColor = ext.input,
                focusedContainerColor = colors.background,
                unfocusedContainerColor = colors.background,
                focusedTextColor = colors.onBackground,
                unfocusedTextColor = colors.onBackground,
                cursorColor = ext.ring,
            ),
        )
    }
}


@Composable
private fun Hairline(modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .height(1.dp)
            .background(color),
    )
}
