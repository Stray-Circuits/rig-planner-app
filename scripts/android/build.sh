#!/usr/bin/env bash
#
# Rig Planner — Android container wrapper.
#
# Builds the Android APK inside a Podman container so the host only needs
# Podman + a working machine. The container ships pinned versions of
# JDK 17, Node, pnpm, Rust + Android targets, and the Android SDK/NDK.
#
# Subcommands:
#   build-image           Build (or rebuild) the container image
#   init                  Run `tauri android init` inside the container
#   build [--release]     Build a debug (default) or release APK
#   shell                 Drop into an interactive shell in the container
#   clean                 Remove the gradle + cargo caches we own
#
# Caches persist in named Podman volumes so successive builds are fast.

set -euo pipefail

# Resolve repo root from this script's location so the wrapper works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_NAME="${RIG_PLANNER_ANDROID_IMAGE:-localhost/rig-planner-android:latest}"
CONTAINERFILE="${SCRIPT_DIR}/Containerfile"

# Named volumes — one per cache so they can be inspected/cleared independently.
VOL_PNPM_STORE="rig-planner-pnpm-store"
VOL_CARGO_REGISTRY="rig-planner-cargo-registry"
VOL_CARGO_GIT="rig-planner-cargo-git"
VOL_GRADLE="rig-planner-gradle"

# On Apple silicon hosts the default linux/arm64 platform is fastest. Allow
# override for amd64 hosts or for testing.
PLATFORM="${RIG_PLANNER_ANDROID_PLATFORM:-linux/arm64}"

usage() {
    sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

require_podman() {
    if ! command -v podman >/dev/null 2>&1; then
        echo "error: podman not on PATH" >&2
        exit 1
    fi
}

image_exists() {
    podman image inspect "${IMAGE_NAME}" >/dev/null 2>&1
}

build_image() {
    echo ">> Building ${IMAGE_NAME} (platform=${PLATFORM})"
    podman build \
        --platform "${PLATFORM}" \
        -t "${IMAGE_NAME}" \
        -f "${CONTAINERFILE}" \
        "${SCRIPT_DIR}"
}

ensure_image() {
    if ! image_exists; then
        echo ">> Image ${IMAGE_NAME} not found — building first"
        build_image
    fi
}

# Run a command inside the container with cache volumes mounted.
exec_in_container() {
    ensure_image
    local args=(
        --rm
        --platform "${PLATFORM}"
        -v "${REPO_ROOT}:/workspace"
        -v "${VOL_PNPM_STORE}:/opt/pnpm/store"
        -v "${VOL_CARGO_REGISTRY}:/opt/rust/cargo/registry"
        -v "${VOL_CARGO_GIT}:/opt/rust/cargo/git"
        -v "${VOL_GRADLE}:/root/.gradle"
        -w /workspace
    )
    if [ -t 0 ] && [ -t 1 ]; then
        args+=( -it )
    fi
    podman run "${args[@]}" "${IMAGE_NAME}" "$@"
}

cmd_init() {
    echo ">> Installing JS deps + running 'tauri android init'"
    exec_in_container bash -lc '
        set -euo pipefail
        pnpm install --frozen-lockfile
        pnpm tauri android init
    '
}

cmd_build() {
    local mode="--debug"
    if [ "${1:-}" = "--release" ]; then
        mode="--release"
    fi
    echo ">> Building Android APK (${mode})"
    exec_in_container bash -lc "
        set -euo pipefail
        pnpm install --frozen-lockfile
        pnpm tauri android build ${mode} --apk
        echo
        echo '>> APK output:'
        find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -print
    "
}

cmd_shell() {
    exec_in_container bash
}

cmd_clean() {
    echo ">> Removing named cache volumes (image untouched)"
    for vol in "${VOL_PNPM_STORE}" "${VOL_CARGO_REGISTRY}" "${VOL_CARGO_GIT}" "${VOL_GRADLE}"; do
        podman volume rm "${vol}" 2>/dev/null || true
    done
    echo ">> Done. Re-run 'init' or 'build' to repopulate."
}

main() {
    require_podman
    local cmd="${1:-}"
    if [ -n "${cmd}" ]; then
        shift
    fi
    case "${cmd}" in
        build-image) build_image "$@" ;;
        init)        cmd_init "$@" ;;
        build)       cmd_build "$@" ;;
        shell)       cmd_shell "$@" ;;
        clean)       cmd_clean "$@" ;;
        ""|-h|--help|help) usage ;;
        *)
            echo "error: unknown subcommand: ${cmd}" >&2
            echo >&2
            usage >&2
            exit 2
            ;;
    esac
}

main "$@"
