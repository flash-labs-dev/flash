//! Hardware smoke test for the Linux capture engine: records a few seconds and
//! saves a clip. `cargo run --release -p flash --example engine_smoke -- <clips dir>`
#[path = "../src/engine.rs"]
mod engine;

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| std::env::temp_dir().join("flash-smoke").to_string_lossy().into_owned());
    println!("displays: {}", engine::displays());
    engine::start(&dir, 0, 30, &engine::quality("1080p 60fps")).expect("engine start");
    std::thread::sleep(std::time::Duration::from_secs(6));
    println!("status: {}", engine::status());
    let (path, _) = engine::save_clip(5.0, "Smoke").expect("save clip");
    println!("clip: {path}");
    engine::stop();
}
