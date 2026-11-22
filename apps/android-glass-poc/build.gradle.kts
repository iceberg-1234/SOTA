fun readKeychainSecret(service: String): String {
    return try {
        val proc = ProcessBuilder("security", "find-generic-password", "-s", service, "-w")
            .redirectErrorStream(true)
            .start()
        val out = proc.inputStream.bufferedReader().readText().trim()
        if (proc.waitFor() == 0) out else ""
    } catch (e: Exception) {
        ""
    }
}

plugins {
    id("com.android.application") version "8.4.0"
    id("org.jetbrains.kotlin.android") version "1.9.22"
}

android {
    namespace = "ai.sota.glass"
    compileSdk = 34

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "ai.sota.glass"
        minSdk = 29
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0-poc"

        val devLanUrl = System.getenv("SOTA_DEV_LAN_URL")?.trim()?.takeIf { it.isNotEmpty() } ?: "http://127.0.0.1:4310"
        buildConfigField("String", "GEMINI_API_KEY", "\"${readKeychainSecret("SOTA_GEMINI_API_KEY")}\"")
        buildConfigField("String", "SEOUL_SUBWAY_KEY", "\"${readKeychainSecret("SOTA_SEOUL_SUBWAY_API_KEY")}\"")
        buildConfigField("String", "SEOUL_BUS_KEY", "\"${readKeychainSecret("SOTA_SEOUL_BUS_API_KEY")}\"")
        buildConfigField("String", "TMAP_API_KEY", "\"${readKeychainSecret("SOTA_TMAP_API_KEY")}\"")
        buildConfigField("String", "DEV_LAN_URL", "\"$devLanUrl\"")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
