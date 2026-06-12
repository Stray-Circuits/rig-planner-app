import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Read the project version from package.json — the single source of truth.
// Reading directly here (rather than via tauri.properties, which is autogen
// and can be stale or default to "1.0") means a malformed or missing version
// fails the build loudly instead of silently producing versionCode=1.
data class ProjectVersion(val name: String, val code: Int)

fun loadProjectVersion(): ProjectVersion {
    val pkgJson = rootProject.file("../../package.json")
    if (!pkgJson.exists()) {
        throw GradleException("package.json not found at ${pkgJson.absolutePath}")
    }
    @Suppress("UNCHECKED_CAST")
    val parsed = JsonSlurper().parse(pkgJson) as Map<String, Any?>
    val versionName = parsed["version"] as? String
        ?: throw GradleException("package.json is missing a string \"version\" field")
    val parts = versionName.split(".")
    if (parts.size != 3) {
        throw GradleException(
            "package.json version \"$versionName\" must be a 3-component semver " +
                "(prerelease suffixes are not supported for Android release builds — " +
                "they collide on the derived versionCode)"
        )
    }
    val components = parts.map { part ->
        part.toIntOrNull()
            ?: throw GradleException("package.json version \"$versionName\" component \"$part\" is not numeric")
    }
    if (components.any { it > 99 }) {
        throw GradleException(
            "package.json version \"$versionName\" components must each be ≤ 99 " +
                "(the MAJOR*10000 + MINOR*100 + PATCH versionCode formula caps there)"
        )
    }
    val (major, minor, patch) = components
    return ProjectVersion(versionName, major * 10_000 + minor * 100 + patch)
}

val projectVersion = loadProjectVersion()

// Release signing config — loaded from key.properties at the android gen root.
// File is gitignored; absence is fine for debug builds. Release builds are
// gated separately in buildTypes.release (throws GradleException if missing).
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.straycircuits.rigplanner"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.straycircuits.rigplanner"
        minSdk = 24
        targetSdk = 36
        versionCode = projectVersion.code
        versionName = projectVersion.name
    }
    signingConfigs {
        create("release") {
            val storeFilePath = keystoreProperties.getProperty("storeFile")
            if (storeFilePath != null) {
                storeFile = file(storeFilePath)
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            if (keystoreProperties.getProperty("storeFile") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
