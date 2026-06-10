# Rig Planner — Android build container.
#
# Layers the Tauri toolchain on top of Cirrus Labs' maintained Android SDK
# image. The base provides JDK, the Android cmdline-tools, platform-tools,
# platforms;android-36, build-tools;36.0.0, and an already-accepted license
# bundle — none of which we have to reinstall. We add the NDK (not in the
# base), Node + pnpm, and Rust + Android targets.
#
# scripts/check-container-pins.mjs enforces that the base image SDK level
# matches src-tauri/gen/android/app/build.gradle.kts compileSdk, and that
# NODE_VERSION / RUST_VERSION below satisfy the project's actual floors.
#
# The base image is multi-arch (linux/arm64 + linux/amd64) so this runs
# native on both Apple silicon and Intel hosts.

FROM ghcr.io/cirruslabs/android-sdk:36

ARG NODE_VERSION=22.12.0
ARG PNPM_VERSION=9.15.0
ARG ANDROID_NDK_VERSION=26.3.11579264
ARG RUST_VERSION=1.88.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# The base image already ships gcc/make/unzip/curl/git, so we only need
# pkg-config + xz for the Node tarball.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        pkg-config \
        xz-utils \
        python3 \
 && rm -rf /var/lib/apt/lists/*

# --- Node + pnpm -------------------------------------------------------------
# Install Node from the official tarball so we don't depend on NodeSource's
# apt repo signing key. Pick the right arch for the build host.
RUN set -eux; \
    case "$(uname -m)" in \
      aarch64) NODE_ARCH=arm64 ;; \
      x86_64)  NODE_ARCH=x64 ;; \
      *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1; \
    rm "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    node --version; \
    corepack enable; \
    corepack prepare "pnpm@${PNPM_VERSION}" --activate; \
    pnpm --version

# --- Android NDK -------------------------------------------------------------
# ANDROID_HOME is preset by the base image to /opt/android-sdk-linux. We only
# need to add the NDK component (the base image deliberately omits it because
# it doubles image size). Licenses are already accepted in the base.
RUN sdkmanager "ndk;${ANDROID_NDK_VERSION}"

ENV NDK_HOME="${ANDROID_HOME}/ndk/${ANDROID_NDK_VERSION}" \
    ANDROID_NDK_HOME="${ANDROID_HOME}/ndk/${ANDROID_NDK_VERSION}" \
    ANDROID_NDK_ROOT="${ANDROID_HOME}/ndk/${ANDROID_NDK_VERSION}"

# --- Rust + Android targets --------------------------------------------------
ENV RUSTUP_HOME=/opt/rust/rustup \
    CARGO_HOME=/opt/rust/cargo
ENV PATH="${CARGO_HOME}/bin:${PATH}"

RUN set -eux; \
    curl -fsSL https://sh.rustup.rs | sh -s -- \
      -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}"; \
    rustup target add \
      aarch64-linux-android \
      armv7-linux-androideabi \
      i686-linux-android \
      x86_64-linux-android; \
    rustc --version; \
    cargo --version

# --- pnpm store --------------------------------------------------------------
# Note: we deliberately *don't* `cargo install tauri-cli` here — the repo's
# @tauri-apps/cli devDep ships precompiled platform binaries that `pnpm tauri`
# invokes directly, so the source compile would be redundant (and was the
# largest, most I/O-heavy step in earlier iterations of this image).

ENV PNPM_HOME=/opt/pnpm \
    PNPM_STORE_DIR=/opt/pnpm/store
ENV PATH="${PNPM_HOME}:${PATH}"
RUN mkdir -p "${PNPM_HOME}" "${PNPM_STORE_DIR}"

WORKDIR /workspace
CMD ["/bin/bash"]
