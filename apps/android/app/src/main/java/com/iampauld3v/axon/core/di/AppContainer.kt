package com.iampauld3v.axon.core.di

import android.app.Application
import android.content.Context
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.iampauld3v.axon.AxonApp
import com.iampauld3v.axon.BuildConfig
import com.iampauld3v.axon.core.auth.AuthRepository
import com.iampauld3v.axon.core.auth.GoogleSignInHandler
import com.iampauld3v.axon.core.auth.SessionManager
import com.iampauld3v.axon.core.data.PinsStore
import com.iampauld3v.axon.core.data.ThemeModeStore
import com.iampauld3v.axon.core.network.OrpcClient
import com.iampauld3v.axon.core.tts.ModelManager
import com.iampauld3v.axon.data.api.AxonApi
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Background launches must never take the app down: record to Crashlytics. */
private val crashGuard = CoroutineExceptionHandler { _, t ->
    runCatching { FirebaseCrashlytics.getInstance().recordException(t) }
}

/** Manual DI root — one instance owned by [AxonApp]. */
class AppContainer(app: Application) {

    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO + crashGuard)
    val modelManager = ModelManager(app, appScope)
    val session = SessionManager(app, appScope)
    val themeMode = ThemeModeStore(app, appScope)
    val pins = PinsStore(app, appScope)
    val googleSignIn = GoogleSignInHandler(app)
    val authRepo = AuthRepository(session, googleSignIn)

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // API Gateway caps requests at 30 s
        .build()

    val rpc = OrpcClient(
        baseUrl = BuildConfig.API_URL,
        tokenProvider = { session.idToken() },
        http = http,
        scope = appScope,
    )

    val api = AxonApi(rpc)
}

/** Service-locator accessor for screens (manual DI — no framework). */
val Context.axonContainer: AppContainer
    get() = (applicationContext as AxonApp).container
