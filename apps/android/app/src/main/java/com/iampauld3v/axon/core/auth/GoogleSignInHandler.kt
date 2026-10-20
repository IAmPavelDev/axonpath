package com.iampauld3v.axon.core.auth

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
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
    suspend fun signInIdToken(activity: Activity): String? {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val response = try {
            // Activity context (not app context): the picker result must route
            // back to a live Activity — app-context calls have a history of
            // surfacing routing failures as silent "cancellation".
            credentialManager.getCredential(activity, request)
        } catch (e: GetCredentialCancellationException) {
            Log.i(TAG, "Google credential flow canceled by user")
            return null
        } catch (e: NoCredentialException) {
            throw GoogleSignInException("no Google account on this device")
        } catch (e: GetCredentialException) {
            throw GoogleSignInException(e.javaClass.simpleName)
        }
        return when (val credential = response.credential) {
            is GoogleIdTokenCredential -> credential.idToken
            // Framework may deliver the token wrapped in a CustomCredential
            // (googleid factory missed); parse explicitly instead of dropping.
            is CustomCredential ->
                if (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    try {
                        GoogleIdTokenCredential.createFrom(credential.data).idToken
                    } catch (e: GoogleIdTokenParsingException) {
                        throw GoogleSignInException("invalid Google token payload")
                    }
                } else {
                    Log.w(TAG, "unexpected credential type: ${credential.type}")
                    throw GoogleSignInException("unexpected credential type")
                }
            else -> {
                Log.w(TAG, "unexpected credential: ${credential.javaClass.name}")
                throw GoogleSignInException("unexpected credential response")
            }
        }
    }

    /** Clears the stored credential state so the next sign-in re-offers account choice. */
    suspend fun clear() {
        runCatching { credentialManager.clearCredentialState(ClearCredentialStateRequest()) }
    }

    private companion object {
        private const val TAG = "AxonAuth"
    }
}
