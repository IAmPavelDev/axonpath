package com.iampavlo.axon.core.di

import android.app.Application
import android.content.Context
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.iampavlo.axon.AxonApp
import com.iampavlo.axon.BuildConfig
import com.iampavlo.axon.core.analytics.Analytics
import com.iampavlo.axon.core.auth.AuthRepository
import com.iampavlo.axon.core.auth.GoogleSignInHandler
import com.iampavlo.axon.core.tts.ModelManager
import com.iampavlo.axon.core.auth.SessionManager
import com.iampavlo.axon.core.data.PinsStore
import com.iampavlo.axon.core.data.ThemeModeStore
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.generated.apis.AuthApi
import com.iampavlo.axon.data.generated.apis.ClassApi
import com.iampavlo.axon.data.generated.apis.QuizApi
import com.iampavlo.axon.data.generated.apis.SkillApi
import com.iampavlo.axon.data.generated.apis.VideoApi
import com.iampavlo.axon.data.generated.infrastructure.ApiClient
import kotlinx.coroutines.runBlocking
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
    val analytics = Analytics(app)

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // API Gateway caps requests at 30 s
        .build()

    // Firebase ID token on every request (all 24 routes are protected). The
    // interceptor blocks briefly to refresh the token — standard Retrofit+OkHttp
    // pattern for suspend token providers.
    private val generatedClient = ApiClient(
        baseUrl = BuildConfig.API_URL,
        okHttpClientBuilder = http.newBuilder()
            .addInterceptor { chain ->
                val token = runBlocking { session.idToken() }
                val request = if (token != null) {
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                chain.proceed(request)
            },
    )

    val api = AxonApi(
        skill = generatedClient.createService(SkillApi::class.java),
        clazz = generatedClient.createService(ClassApi::class.java),
        quiz = generatedClient.createService(QuizApi::class.java),
        video = generatedClient.createService(VideoApi::class.java),
        auth = generatedClient.createService(AuthApi::class.java),
    )
}

/** Service-locator accessor for screens (manual DI — no framework). */
val Context.axonContainer: AppContainer
    get() = (applicationContext as AxonApp).container
