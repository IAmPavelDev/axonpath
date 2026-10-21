package com.iampavlo.axon.core.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore

/** Single DataStore for app preferences (RN used AsyncStorage keys axon.*). */
internal val Context.axonDataStore by preferencesDataStore(name = "axon")
