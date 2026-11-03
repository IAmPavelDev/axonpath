plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
    alias(libs.plugins.crashlytics)
    alias(libs.plugins.openapi.generator)
}

android {
    namespace = "com.iampavlo.axon"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.iampavlo.axon"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "API_URL", "\"https://t3afkc5pj2.execute-api.eu-central-1.amazonaws.com\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"711087014342-lbakiok82a9i0pi6l17v9kc77pnkbda5.apps.googleusercontent.com\"")
    }

    signingConfigs {
        // Committed RN-template keystore → identical SHA-1 on every machine.
        // Google Play services resolves the Sign-In OAuth client by
        // (package, SHA-1): this fingerprint MUST be registered on the
        // Firebase Android app com.iampavlo.axon or Credential Manager
        // fails with NoCredentialException (see docs/MIGRATION_PLAN.md).
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            ndk {
                // sherpa TTS libs ship arm64-only in release; keeps the APK small.
                abiFilters += "arm64-v8a"
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Parity phase: switch to the production keystore. Debug for now so
            // release APKs install during migration.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
    sourceSets {
        getByName("main") {
            // openapi-generator output (D5) — task wired below via preBuild.
            kotlin.srcDir("$buildDir/generated/openapi/src/main/kotlin")
        }
    }

}
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Generated Retrofit client from the committed contract spec (migration D4/D5):
// packages/api-contract/openapi.json → com.iampavlo.axon.data.generated.*.
// P0-tested flags; spec is the committed artifact — builds never hit a server.
openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-retrofit2")
    inputSpec.set("${project.rootDir}/../../packages/api-contract/openapi.json")
    outputDir.set("$buildDir/generated/openapi")
    cleanupOutput.set(true)
    apiPackage.set("com.iampavlo.axon.data.generated.apis")
    packageName.set("com.iampavlo.axon.data.generated")
    modelPackage.set("com.iampavlo.axon.data.generated.model")
    configOptions.set(
        mapOf(
            "packageName" to "com.iampavlo.axon.data.generated",
            "apiPackage" to "com.iampavlo.axon.data.generated.apis",
            "modelPackage" to "com.iampavlo.axon.data.generated.model",
            "serializationLibrary" to "kotlinx_serialization",
            "dateLibrary" to "string",
            "useCoroutines" to "true",
        ),
    )
}

tasks.named("preBuild") {
    dependsOn("openApiGenerate")
}

// Generator defaults lie about the wire format, and every numeric-typed
// request body 422s on the backend's zod schemas (Ask AI outage 2026-10-29:
// POST /class/qa/ask arrived as {"classId":"2","anchorText":null}). Two
// causes, neither configurable in the generator: BigDecimalAdapter quotes
// ids (contract says bare `type: number`), and encodeDefaults=true emits
// explicit nulls for omitted optionals (zod .optional() rejects null).
// cleanupOutput wipes the output every build, so patch the two generated
// files here — after openApiGenerate, before Kotlin compilation.
tasks.named("openApiGenerate") {
    doLast {
        val infra = file("$buildDir/generated/openapi/src/main/kotlin/com/iampavlo/axon/data/generated/infrastructure")
        File(infra, "BigDecimalAdapter.kt").writeText(
            """
            package com.iampavlo.axon.data.generated.infrastructure

            import kotlinx.serialization.KSerializer
            import kotlinx.serialization.descriptors.PrimitiveKind
            import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
            import kotlinx.serialization.descriptors.SerialDescriptor
            import kotlinx.serialization.encoding.Decoder
            import kotlinx.serialization.encoding.Encoder
            import kotlinx.serialization.json.JsonEncoder
            import kotlinx.serialization.json.JsonPrimitive
            import java.math.BigDecimal

            /** Ids are bare JSON numbers in the contract (`type: number`),
             *  so BigDecimal serializes UNQUOTED. Reads go back through
             *  decodeString() — the client Json is lenient and accepts number
             *  tokens for strings. */
            object BigDecimalAdapter : KSerializer<BigDecimal> {
                override val descriptor: SerialDescriptor =
                    PrimitiveSerialDescriptor("BigDecimal", PrimitiveKind.STRING)

                override fun deserialize(decoder: Decoder): BigDecimal =
                    BigDecimal(decoder.decodeString())

                override fun serialize(encoder: Encoder, value: BigDecimal) {
                    (encoder as JsonEncoder).encodeJsonElement(JsonPrimitive(value))
                }
            }
            """.trimIndent(),
        )
        val serializer = File(infra, "Serializer.kt")
        serializer.writeText(
            serializer.readText().replace(
                "encodeDefaults = true",
                "encodeDefaults = false",
            ),
        )
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.commons.compress)

    // sherpa-onnx: local AAR from k2-fsa GitHub releases (gitignored; see
    // docs/MIGRATION_PLAN.md for the download line).
    implementation(files("libs/sherpa-onnx-1.13.8.aar"))

    implementation(libs.retrofit.core)
    implementation(libs.retrofit.serialization)
    implementation(libs.retrofit.scalars)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.analytics)
    implementation(libs.firebase.crashlytics)
    implementation(libs.images.coil)
    implementation(libs.androidyoutubeplayer)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.googleid)

    testImplementation(libs.junit4)
}
