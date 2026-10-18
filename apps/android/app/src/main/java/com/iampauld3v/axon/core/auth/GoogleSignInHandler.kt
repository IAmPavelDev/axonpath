package com.iampauld3v.axon.core.auth

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.iampauld3v.axon.BuildConfig

/** Google credential flow failure; [detail] is short, user-facing text. */
class GoogleSignInException(val detail: String?) : Exception(detail)

/**
 * Google sign-in via Credential Manager — the Kotlin counterpart of the RN
 * @react-native-google-signin flow. NEVER throws raw platform exceptions:
 * picker-cancel → null, everything else → [GoogleSignInException].
 */
class GoogleSignInHandler(private val appContext: Context) {

    private val credentialManager = CredentialManager.create(appContext)

    /** @return Google ID token for Firebase, null when the user closed the picker. */
    @Throws(GoogleSignInException::class)
    suspend fun signInIdToken(): String? {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val response = try {
            credentialManager.getCredential(appContext, request)
        } catch (e: GetCredentialCancellationException) {
            return null
        } catch (e: NoCredentialException) {
            throw GoogleSignInException("no Google account on this device")
        } catch (e: GetCredentialException) {
            throw GoogleSignInException(e.javaClass.simpleName)
        }
        return when (val credential = response.credential) {
            is GoogleIdTokenCredential -> credential.idToken
            else -> null
        }
    }

    /** Clears the stored credential state so the next sign-in re-offers account choice. */
    suspend fun clear() {
        runCatching { credentialManager.clearCredentialState(ClearCredentialStateRequest()) }
    }
}
