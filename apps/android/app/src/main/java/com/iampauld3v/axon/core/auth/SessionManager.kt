package com.iampauld3v.axon.core.auth

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GetTokenResult
import com.google.android.gms.tasks.Task
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed interface AuthStatus {
    data object Initializing : AuthStatus
    data class SignedIn(val uid: String, val email: String?) : AuthStatus
    data object SignedOut : AuthStatus
}

/**
 * Mirrors the RN auth store: an IdTokenListener (onIdTokenChanged equivalent)
 * drives status; uid binds to Crashlytics + Analytics on every fire and clears
 * on sign-out. Token refreshes re-emit while staying SignedIn — navigation
 * gating must not bounce the user to login on refresh.
 */
class SessionManager(private val appContext: Context, private val scope: CoroutineScope) {

    private val _status = MutableStateFlow<AuthStatus>(AuthStatus.Initializing)
    val status: StateFlow<AuthStatus> = _status.asStateFlow()

    // Missing/invalid google-services.json → auth inert, app usable signed out
    // (same degrade path as the RN config-missing branch).
    private val auth: FirebaseAuth? = runCatching { FirebaseAuth.getInstance() }.getOrNull()

    /** False when google-services.json is missing/invalid — auth inert, app usable. */
    val available: Boolean
        get() = auth != null

    fun start() {
        val a = auth ?: run {
            _status.value = AuthStatus.SignedOut
            return
        }
        a.addIdTokenListener(FirebaseAuth.IdTokenListener {
            val user = a.currentUser
            _status.value =
                if (user != null) AuthStatus.SignedIn(user.uid, user.email) else AuthStatus.SignedOut
            bindUserId(user?.uid)
        })
    }

    private fun bindUserId(uid: String?) {
        scope.launch {
            runCatching { FirebaseCrashlytics.getInstance().setUserId(uid ?: "") }
            runCatching { FirebaseAnalytics.getInstance(appContext).setUserId(uid ?: "") }
        }
    }

    /** Fresh-enough Firebase ID token for the Authorization header (auto-refreshes when expired). */
    suspend fun idToken(): String? {
        val user = auth?.currentUser ?: return null
        return runCatching { user.getIdToken(false).awaitToken().token }.getOrNull()
    }

    /** Clears the Google account picker first (parity with RN sign-out order), then Firebase. */
    suspend fun signOut(clearGoogle: suspend () -> Unit) {
        runCatching { clearGoogle() }
        auth?.signOut()
    }

    private suspend fun Task<GetTokenResult>.awaitToken(): GetTokenResult =
        suspendCancellableCoroutine { cont ->
            addOnSuccessListener { if (cont.isActive) cont.resume(it) }
                .addOnFailureListener { if (cont.isActive) cont.resumeWithException(it) }
        }
}
