#!/usr/bin/env bash
#
# Rig Planner — Android container wrapper.
#
# Builds the Android APK inside a Docker container so the host only needs
# Docker. The container ships pinned versions of JDK + Android SDK + NDK
# (via the Cirrus Labs base image), Node + pnpm, and Rust + Android targets.
#
# Subcommands:
#   build-image           Build (or rebuild) the container image
#   init                  Run `tauri android init` inside the container
#   build [--release]     Build a debug (default) or release APK
#   shell                 Drop into an interactive shell in the container
#   clean                 Remove the gradle + cargo caches we own
#
# Caches persist in named Docker volumes so successive builds are fast.

set -euo pipefail

# Resolve repo root from this script's location so the wrapper works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_NAME="${RIG_PLANNER_ANDROID_IMAGE:-rig-planner-android:latest}"
DOCKERFILE="${SCRIPT_DIR}/Dockerfile"

# Named volumes — one per cache so they can be inspected/cleared independently.
# node_modules gets its own volume so the container's pnpm (Linux, our /opt/pnpm
# store) never collides with the host's pnpm (macOS, ~/Library/pnpm/store) on
# the bind-mounted /workspace. Without this, pnpm wipes node_modules on every
# container run because the on-disk layout doesn't match its expected store.
VOL_NODE_MODULES="rig-planner-node-modules"
VOL_PNPM_STORE="rig-planner-pnpm-store"
VOL_CARGO_REGISTRY="rig-planner-cargo-registry"
VOL_CARGO_GIT="rig-planner-cargo-git"
VOL_GRADLE="rig-planner-gradle"

# Force linux/amd64 even on Apple silicon: the Android NDK only ships an
# x86_64 host toolchain (Google publishes no linux-aarch64 NDK), and those
# clang binaries can't run inside an arm64 container. Docker Desktop on
# Apple silicon runs amd64 containers via Rosetta-for-Linux, which is fast
# enough for our compile workload. Override only if you know what you're
# doing.
PLATFORM="${RIG_PLANNER_ANDROID_PLATFORM:-linux/amd64}"

usage() {
    sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker not on PATH" >&2
        exit 1
    fi
    if ! docker info >/dev/null 2>&1; then
        echo "error: docker daemon not reachable — is Docker Desktop running?" >&2
        exit 1
    fi
}

image_exists() {
    docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1
}

# Render docker CLI flags for an optional --platform override.
platform_flag() {
    if [ -n "${PLATFORM}" ]; then
        echo "--platform ${PLATFORM}"
    fi
}

build_image() {
    echo ">> Building ${IMAGE_NAME}${PLATFORM:+ (platform=${PLATFORM})}"
    # shellcheck disable=SC2046
    docker build \
        $(platform_flag) \
        -t "${IMAGE_NAME}" \
        -f "${DOCKERFILE}" \
        "${SCRIPT_DIR}"
}

ensure_image() {
    if ! image_exists; then
        echo ">> Image ${IMAGE_NAME} not found — building first"
        build_image
    fi
}

# Run a command inside the container with cache volumes mounted.
#
# We mount a container-only pnpm-workspace.yaml override on top of the host's
# file so:
#   - Every pnpm child process (including Tauri's `beforeBuildCommand`) can
#     parse the file (the host yaml lacks `packages:`, which pnpm 9.15+
#     rejects with "packages field missing or empty").
#   - The host yaml's macOS-specific `storeDir` doesn't override our
#     PNPM_STORE_DIR env, so the mounted pnpm cache volume gets used.
# The host file is untouched — the override only exists inside the container.
exec_in_container() {
    ensure_image
    local args=(
        --rm
        # Stop corepack from auto-adding a `packageManager` field to the
        # bind-mounted package.json on first pnpm invocation. Without this,
        # the container's pnpm modifies the host file, which then pins host
        # pnpm to whatever the container has and can break host workflows.
        -e COREPACK_ENABLE_AUTO_PIN=0
        -v "${REPO_ROOT}:/workspace"
        -v "${SCRIPT_DIR}/container-pnpm-workspace.yaml:/workspace/pnpm-workspace.yaml:ro"
        -v "${VOL_NODE_MODULES}:/workspace/node_modules"
        -v "${VOL_PNPM_STORE}:/opt/pnpm/store"
        -v "${VOL_CARGO_REGISTRY}:/opt/rust/cargo/registry"
        -v "${VOL_CARGO_GIT}:/opt/rust/cargo/git"
        -v "${VOL_GRADLE}:/root/.gradle"
        -w /workspace
    )
    if [ -n "${PLATFORM}" ]; then
        args+=( --platform "${PLATFORM}" )
    fi
    if [ -t 0 ] && [ -t 1 ]; then
        args+=( -it )
    fi
    docker run "${args[@]}" "${IMAGE_NAME}" "$@"
}

# --ignore-workspace tells pnpm to treat /workspace as a standalone project.
# This repo has a `pnpm-workspace.yaml` that exists only to carry host-side
# config (storeDir points at a macOS path) — there's no actual workspace.
# Without this flag, container pnpm rejects the file with "packages field
# missing or empty" and we'd also miss our mounted /opt/pnpm/store volume.
cmd_init() {
    echo ">> Installing JS deps + running 'tauri android init'"
    exec_in_container bash -lc '
        set -euo pipefail
        pnpm install --frozen-lockfile --ignore-workspace
        pnpm --ignore-workspace tauri android init
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
        pnpm install --frozen-lockfile --ignore-workspace
        pnpm --ignore-workspace tauri android build ${mode} --apk
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
    for vol in "${VOL_NODE_MODULES}" "${VOL_PNPM_STORE}" "${VOL_CARGO_REGISTRY}" "${VOL_CARGO_GIT}" "${VOL_GRADLE}"; do
        docker volume rm "${vol}" 2>/dev/null || true
    done
    echo ">> Done. Re-run 'init' or 'build' to repopulate."
}

main() {
    require_docker
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
