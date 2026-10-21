package com.iampavlo.axon

import android.app.Application
import com.iampavlo.axon.core.di.AppContainer

/** Application entry; owns the single manual-DI [AppContainer]. */
class AxonApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.session.start()
    }
}
