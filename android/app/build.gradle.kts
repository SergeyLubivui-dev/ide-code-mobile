import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Пароли подписи лежат в keystore.properties рядом с проектом и не попадают в репозиторий.
val signing = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "ru.sergeylubivui.idecode"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.sergeylubivui.idecode"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        resourceConfigurations += listOf("ru", "en")
        // Ключ платформы моделей: приезжает из окружения или local.properties,
        // в настройках приложения его можно заменить своим.
        buildConfigField("String", "CHAT_API_KEY",
            "\"" + (System.getenv("IDECODE_API_KEY") ?: signing.getProperty("chatApiKey") ?: "") + "\"")
    }

    signingConfigs {
        create("release") {
            if (signing.containsKey("storeFile")) {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signing.containsKey("storeFile")) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    packaging {
        resources.excludes += setOf("META-INF/*.version", "DebugProbesKt.bin")
        // Движок исполняется как файл, значит его нужно распаковать из APK.
        jniLibs.useLegacyPackaging = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
