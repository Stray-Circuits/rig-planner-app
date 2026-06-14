fn main() {
    // 16 KB ELF segment alignment for Android. NDK r27 still defaults to 4 KB,
    // and Tauri's mobile build clobbers RUSTFLAGS, so target-specific config in
    // .cargo/config.toml gets overridden. Emitting from build.rs is the one
    // path the override can't reach.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
