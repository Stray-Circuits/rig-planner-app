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
// File is gitignored. Absent: debug builds work, release builds fail at
// task-graph-ready time with an actionable message (see gradle.taskGraph
// hookup below). Present-but-partial: throws here at configure time so a
// typo'd field name doesn't surface as an opaque keystore exception deep
// in the assembleRelease task.
data class KeystoreConfig(
    val storeFile: java.io.File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

fun loadKeystoreConfig(): KeystoreConfig? {
    val propFile = rootProject.file("key.properties")
    if (!propFile.exists()) return null
    val props = Properties().apply {
        propFile.inputStream().use { load(it) }
    }
    val required = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    val missing = required.filter { props.getProperty(it).isNullOrBlank() }
    if (missing.isNotEmpty()) {
        throw GradleException(
            "key.properties at ${propFile.absolutePath} is missing required field(s): " +
                "${missing.joinToString(", ")}. All four (storeFile, storePassword, " +
                "keyAlias, keyPassword) must be set."
        )
    }
    val storeFile = file(props.getProperty("storeFile"))
    if (!storeFile.exists()) {
        throw GradleException(
            "key.properties storeFile '${storeFile.absolutePath}' does not exist. " +
                "For containerized release builds the path should be the in-container " +
                "form (e.g. /keystore/rig-planner-release.p12) — the build wrapper " +
                "bind-mounts \$KEYSTORE_DIR at /keystore."
        )
    }
    return KeystoreConfig(
        storeFile,
        props.getProperty("storePassword"),
        props.getProperty("keyAlias"),
        props.getProperty("keyPassword"),
    )
}

val keystoreConfig = loadKeystoreConfig()

// Fail any release-variant build that isn't going to be signed, regardless of
// which entry point invoked Gradle (build.sh, `gradlew` in the container
// shell, Android Studio). Without this, an unsigned APK/AAB would be produced
// with only a buried Gradle warning, and only Play Console would reject it.
gradle.taskGraph.whenReady {
    if (keystoreConfig != null) return@whenReady
    val releaseTask = allTasks.firstOrNull { task ->
        val n = task.name
        (n.startsWith("assemble") || n.startsWith("bundle") || n.startsWith("package")) &&
            n.contains("Release")
    }
    if (releaseTask != null) {
        throw GradleException(
            "Release task ${releaseTask.path} requires a signing config, but " +
                "${rootProject.file("key.properties").absolutePath} is missing. " +
                "Use `pnpm android:container:build:release` (which sets this up) " +
                "or create key.properties manually — see CLAUDE.md."
        )
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
            keystoreConfig?.let {
                storeFile = it.storeFile
                storePassword = it.storePassword
                keyAlias = it.keyAlias
                keyPassword = it.keyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            if (keystoreConfig != null) {
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
