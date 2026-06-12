import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Load the project version from package.json — the single source of truth for
// versionName, with versionCode derived as MAJOR*10000 + MINOR*100 + PATCH.
//
// Validation is deferred: any failure (missing file, unparseable JSON, malformed
// version) is captured in `loadError` rather than thrown at configuration time,
// so non-release flows (IDE sync, `gradlew tasks`, debug builds, clean) keep
// working with sentinel values. The release-task hook below promotes loadError
// into a hard failure only when an actual signed artifact is being built.
data class ProjectVersion(val name: String, val code: Int)
data class ProjectVersionResult(val value: ProjectVersion?, val loadError: String?)

fun loadProjectVersion(): ProjectVersionResult {
    val pkgJson = rootProject.file("../../../package.json")
    if (!pkgJson.exists()) {
        return ProjectVersionResult(null, "package.json not found at ${pkgJson.absolutePath}")
    }
    val parsed = try {
        @Suppress("UNCHECKED_CAST")
        JsonSlurper().parse(pkgJson) as Map<String, Any?>
    } catch (e: Exception) {
        return ProjectVersionResult(null, "package.json failed to parse as a JSON object: ${e.message}")
    }
    val versionName = parsed["version"] as? String
        ?: return ProjectVersionResult(null, "package.json is missing a string \"version\" field")
    val parts = versionName.split(".")
    if (parts.size != 3) {
        return ProjectVersionResult(
            null,
            "package.json version \"$versionName\" must be a 3-component semver " +
                "(prerelease suffixes are not supported for Android release builds — " +
                "they collide on the derived versionCode)",
        )
    }
    val components = parts.map { it.toIntOrNull() }
    if (components.any { it == null }) {
        return ProjectVersionResult(
            null,
            "package.json version \"$versionName\" has a non-numeric component",
        )
    }
    val ints = components.map { it!! }
    if (ints.any { it > 99 }) {
        return ProjectVersionResult(
            null,
            "package.json version \"$versionName\" components must each be ≤ 99 " +
                "(the MAJOR*10000 + MINOR*100 + PATCH versionCode formula caps there)",
        )
    }
    val (major, minor, patch) = ints
    return ProjectVersionResult(
        ProjectVersion(versionName, major * 10_000 + minor * 100 + patch),
        null,
    )
}

val projectVersionResult = loadProjectVersion()

// Same pattern for the release signing config: any failure (missing file, blank
// field, wrong storeFile path) is captured rather than thrown so debug builds,
// IDE sync, and lint don't break when key.properties is mid-edit or absent.
data class KeystoreConfig(
    val storeFile: java.io.File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)
data class KeystoreResult(val value: KeystoreConfig?, val loadError: String?)

fun loadKeystoreConfig(): KeystoreResult {
    val propFile = rootProject.file("key.properties")
    if (!propFile.exists()) {
        return KeystoreResult(null, "key.properties not found at ${propFile.absolutePath}")
    }
    val props = Properties().apply {
        propFile.inputStream().use { load(it) }
    }
    val required = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    val missing = required.filter { props.getProperty(it).isNullOrBlank() }
    if (missing.isNotEmpty()) {
        return KeystoreResult(
            null,
            "key.properties at ${propFile.absolutePath} is missing required field(s): " +
                "${missing.joinToString(", ")}. All four (storeFile, storePassword, " +
                "keyAlias, keyPassword) must be set.",
        )
    }
    val storeFile = file(props.getProperty("storeFile"))
    if (!storeFile.exists()) {
        return KeystoreResult(
            null,
            "key.properties storeFile '${storeFile.absolutePath}' does not exist. " +
                "For containerized release builds the path should be the in-container " +
                "form (e.g. /keystore/rig-planner-release.p12) — the build wrapper " +
                "bind-mounts \$KEYSTORE_DIR at /keystore.",
        )
    }
    return KeystoreResult(
        KeystoreConfig(
            storeFile,
            props.getProperty("storePassword"),
            props.getProperty("keyAlias"),
            props.getProperty("keyPassword"),
        ),
        null,
    )
}

val keystoreResult = loadKeystoreConfig()
val keystoreConfig = keystoreResult.value

// Gate signed-release-producing builds: if assembleRelease or bundleRelease is
// in the task graph, both the version AND the signing config must be valid.
// Restricted to those two exact task names so intermediate/sub-tasks
// (packageReleaseResources, bundleReleaseAar, lintRelease, etc.) don't trip
// the gate. Anything not listed here either doesn't ship signed artifacts or
// isn't a terminal build task we own.
gradle.taskGraph.whenReady {
    val releaseTask = allTasks.firstOrNull { task ->
        task.name == "assembleRelease" || task.name == "bundleRelease"
    } ?: return@whenReady

    projectVersionResult.loadError?.let { msg ->
        throw GradleException("Release task ${releaseTask.path} blocked: $msg")
    }
    if (keystoreConfig == null) {
        throw GradleException(
            "Release task ${releaseTask.path} requires a signing config.\n" +
                "  ${keystoreResult.loadError}\n" +
                "  Use `pnpm android:container:build:release` (which sets this up) " +
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
        // For non-release flows (sync, debug, lint, tasks) we accept sentinel
        // values when projectVersionResult.loadError is set; the gate above
        // ensures real release builds get a valid value or hard-fail.
        versionCode = projectVersionResult.value?.code ?: 1
        versionName = projectVersionResult.value?.name ?: "0.0.0"
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
