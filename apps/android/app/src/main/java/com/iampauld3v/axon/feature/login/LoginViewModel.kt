package com.iampauld3v.axon.feature.login

import android.app.Activity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampauld3v.axon.core.auth.AuthRepository
import com.iampauld3v.axon.core.auth.AuthResult
import kotlinx.coroutines.launch

/** Port of RN app/login.tsx state: mode, fields, error copy, single busy slot. */
class LoginViewModel(private val auth: AuthRepository) : ViewModel() {

    enum class Mode { SIGN_IN, SIGN_UP }
    enum class Busy { FORM, GOOGLE }

    var mode by mutableStateOf(Mode.SIGN_IN)
        private set
    var firstName by mutableStateOf("")
        private set
    var lastName by mutableStateOf("")
        private set
    var email by mutableStateOf("")
        private set
    var password by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf<Busy?>(null)
        private set

    val configured: Boolean
        get() = auth.configured

    fun onFirstName(v: String) {
        firstName = v
    }

    fun onLastName(v: String) {
        lastName = v
    }

    fun onEmail(v: String) {
        email = v
    }

    fun onPassword(v: String) {
        password = v
    }

    fun switchMode() {
        if (busy != null) return
        error = null
        mode = if (mode == Mode.SIGN_IN) Mode.SIGN_UP else Mode.SIGN_IN
    }

    fun submit() {
        if (busy != null) return
        busy = Busy.FORM
        viewModelScope.launch {
            val result = try {
                if (mode == Mode.SIGN_IN) {
                    auth.signInWithEmail(email, password)
                } else {
                    auth.signUpWithEmail(email, password, firstName, lastName)
                }
            } catch (e: Exception) {
                AuthResult.Failure("Something went wrong — try again.")
            }
            busy = null
            if (result is AuthResult.Failure) error = result.message
            // Success → SessionManager status flips → the auth gate swaps screens.
        }
    }

    fun continueWithGoogle(activity: Activity) {
        if (busy != null) return
        busy = Busy.GOOGLE
        viewModelScope.launch {
            val result = try {
                auth.signInWithGoogle(activity)
            } catch (e: Exception) {
                AuthResult.Failure("Google sign-in failed — try again.")
            }
            busy = null
            if (result is AuthResult.Failure) error = result.message
            // Canceled (picker closed) → silent return, RN parity.
        }
    }
}
