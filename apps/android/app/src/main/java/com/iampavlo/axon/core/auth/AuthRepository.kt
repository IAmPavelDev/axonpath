package com.iampavlo.axon.core.auth

import android.app.Activity

import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.UserProfileChangeRequest
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** User-facing auth outcome. [Canceled] = closed the Google picker (silent in UI). */
sealed interface AuthResult {
    data object Success : AuthResult
    data object Canceled : AuthResult
    data class Failure(val message: String) : AuthResult
}

/**
 * Email/password + Google auth actions over FirebaseAuth, with the RN app's
 * exact error-code → copy mapping (AUTH_ERRORS in app/login.tsx). Every path
 * is exception-safe: the user sees a message, the app never crashes.
 */
class AuthRepository(
    private val session: SessionManager,
    private val google: GoogleSignInHandler,
) {

    private val auth: FirebaseAuth? = runCatching { FirebaseAuth.getInstance() }.getOrNull()

    /** False when google-services.json is missing/invalid — auth inert, setup hint shown. */
    val configured: Boolean
        get() = auth != null

    suspend fun signInWithEmail(email: String, password: String): AuthResult =
        guarded { a ->
            a.signInWithEmailAndPassword(email.trim(), password).await()
            AuthResult.Success
        }

    /** Signup also sets displayName "First Last" when either name is non-empty (RN parity). */
    suspend fun signUpWithEmail(
        email: String,
        password: String,
        firstName: String,
        lastName: String,
    ): AuthResult = guarded { a ->
        val result = a.createUserWithEmailAndPassword(email.trim(), password).await()
        val displayName = listOf(firstName.trim(), lastName.trim())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
        val user = result.user
        if (displayName.isNotEmpty() && user != null) {
            runCatching {
                user.updateProfile(
                    UserProfileChangeRequest.Builder().setDisplayName(displayName).build(),
                ).await()
            }
        }
        AuthResult.Success
    }

    suspend fun signInWithGoogle(activity: Activity): AuthResult {
        if (auth == null) return AuthResult.Failure(NOT_CONFIGURED)
        val idToken = try {
            google.signInIdToken(activity) ?: return AuthResult.Canceled
        } catch (e: GoogleSignInException) {
            return AuthResult.Failure(
                "Google sign-in failed${e.detail?.let { " — $it" } ?: ""} — try again.",
            )
        } catch (e: Exception) {
            return AuthResult.Failure("Google sign-in failed — Play Services error. Try again.")
        }
        if (idToken.isEmpty()) {
            return AuthResult.Failure("Google did not return a token — try again.")
        }
        return guarded { a ->
            a.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
            AuthResult.Success
        }.let { result ->
            if (result is AuthResult.Failure) {
                result.copy(message = "Google sign-in failed — try again.")
            } else {
                result
            }
        }
    }

    /** Google credential-state cleanup first (parity with RN sign-out order), then Firebase. */
    suspend fun signOut() = session.signOut { google.clear() }

    private suspend fun guarded(block: suspend (FirebaseAuth) -> AuthResult): AuthResult {
        val a = auth ?: return AuthResult.Failure(NOT_CONFIGURED)
        return try {
            block(a)
        } catch (e: FirebaseAuthException) {
            AuthResult.Failure(messageFor(e.errorCode))
        } catch (e: FirebaseNetworkException) {
            AuthResult.Failure("Network error — check your connection.")
        } catch (e: Exception) {
            AuthResult.Failure(messageFor(null))
        }
    }

    private fun messageFor(rawCode: String?): String {
        // Firebase Android codes look like ERROR_EMAIL_ALREADY_IN_USE; the RN
        // map used auth/email-already-in-use. Normalize both to one style.
        val code = rawCode?.lowercase()
            ?.removePrefix("error_")
            ?.replace('_', '-')
            ?.takeIf { it.isNotEmpty() }
        return when (code) {
            "email-already-in-use" -> "That email already has an account — sign in instead."
            "invalid-email" -> "That email address looks wrong."
            "weak-password" -> "Use at least 6 characters for your password."
            "invalid-credential", "user-not-found", "wrong-password" -> "Wrong email or password."
            "user-disabled" -> "This account has been disabled."
            "too-many-requests" -> "Too many attempts — try again in a bit."
            "network-request-failed" -> "Network error — check your connection."
            "invalid-api-key" -> "Firebase is misconfigured — check the API key."
            else -> "Something went wrong — try again."
        }
    }

    private companion object {
        const val NOT_CONFIGURED = "Firebase is not configured yet — see FIREBASE_SETUP.md."
    }
}

private suspend fun <R> Task<R>.await(): R =
    suspendCancellableCoroutine { cont ->
        addOnSuccessListener { if (cont.isActive) cont.resume(it) }
            .addOnFailureListener { if (cont.isActive) cont.resumeWithException(it) }
    }
