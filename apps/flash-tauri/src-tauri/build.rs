use std::path::PathBuf;
use std::process::Command;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_engine();
    }
    tauri_build::build()
}

fn run(command: &mut Command) {
    let status = command.status().unwrap_or_else(|e| panic!("could not run {command:?}: {e}"));
    assert!(status.success(), "{command:?} failed");
}

/// Builds packages/flash-capture's `flash_engine` static library (the C++
/// capture engine behind include/flash_engine.h) and links it with its deps.
fn build_engine() {
    let capture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/flash-capture");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("engine");
    // Same private LGPL static libav as the Electron build (scripts/build-linux-media.sh).
    let media = std::env::var("FLASH_MEDIA_PREFIX")
        .expect("set FLASH_MEDIA_PREFIX to the build/linux-media prefix from scripts/build-linux-media.sh");
    println!("cargo:rerun-if-env-changed=FLASH_MEDIA_PREFIX");
    println!("cargo:rerun-if-changed={}", capture.join("src").display());
    println!("cargo:rerun-if-changed={}", capture.join("CMakeLists.txt").display());

    run(Command::new("cmake").arg("-S").arg(&capture).arg("-B").arg(&out)
        .args(["-DCMAKE_BUILD_TYPE=Release", "-G", "Ninja"])
        .arg(format!("-DFLASH_MEDIA_PREFIX={media}"))
        .env("PKG_CONFIG_PATH", format!("{media}/lib/pkgconfig")));
    run(Command::new("cmake").arg("--build").arg(&out).args(["--target", "flash_engine"]));

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-search=native={media}/lib");
    // Static archives, users before what they use.
    for lib in ["flash_engine", "avformat", "avcodec", "swscale", "swresample", "avutil"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    let libs = Command::new("pkg-config")
        .args(["--libs", "libpipewire-0.3", "gio-2.0", "gio-unix-2.0", "libva", "libva-drm", "openh264", "zlib"])
        .output().expect("pkg-config is required");
    assert!(libs.status.success(), "pkg-config could not find the engine's system libraries");
    for flag in String::from_utf8_lossy(&libs.stdout).split_whitespace() {
        if let Some(dir) = flag.strip_prefix("-L") { println!("cargo:rustc-link-search=native={dir}"); }
        if let Some(lib) = flag.strip_prefix("-l") { println!("cargo:rustc-link-lib={lib}"); }
    }
    println!("cargo:rustc-link-lib=stdc++");
    println!("cargo:rustc-link-lib=m");
}
