# Flash native rewrite

This is the start of a separate Rust implementation. The shipping Electron app and C++ addon remain the reference implementation. Run `cargo test --offline` from this directory. Phase 1 uses the Rust standard library only.

## Phase 1: portable core

The `flash-core` library ports the behavior in `packages/flash-capture/src/core`:

| Rust module | C++ source | Scope |
| --- | --- | --- |
| `ring_buffer` | `ring_buffer.h/.cpp` | Encoded packet history, timestamp windows, keyframe selection, resize |
| `quality` | `quality.h` | Even aspect width |
| `export_budget` | `export_budget.h` | Size planning, retry planning, codec floors, frame grid |
| `audio_tracks` | `audio_tracks.h` | Stable file track order |
| `audio_lanes` | `audio_lanes.h` | Lane routing and process tree logic, using a minimal portable `ProcessInfo` |
| `audio_math` | `audio_math.h` | Stereo resampling and device timestamp arithmetic |
| `lane_mixer` | `lane_mixer.h` | Source alignment, mixing, buffering, packet output |
| `capture_clock` | `capture_clock.h` | Process-local monotonic microsecond clock |
| `pipewire_audio_route` | `pipewire_audio_route.h` | Pure app-name and channel routing rules, no PipeWire API |

The C++ `EncodedPacket` is represented by an owned Rust data struct; encoder and video frame interfaces are not ported. `RingBuffer` leaves synchronization to its owner, which can wrap it in `Mutex` when the daemon needs shared access. No FFmpeg, Media Foundation, PipeWire, or OS capture types enter `flash-core`.

The current tests port the relevant C++ self-check cases and add zero and invalid input checks. For inputs that have undefined behavior in C++, Rust handles them explicitly: a zero-capacity ring ignores pushes; zero sample rate returns `None` from `audio_packet_start_us`; incomplete audio input is rejected; overflowing clock arithmetic is handled without wrapping. Ordinary valid input follows the C++ math and routing rules.

## Planned phases

1. **Portable core** (`flash-core`, this phase).
2. **Capture daemon**: add a `flash-capture-daemon` binary crate and platform adapter crates such as `flash-capture-windows` and `flash-capture-linux`. They will own capture APIs, audio devices, hardware/software encoding, muxing, persistence, and IPC while consuming `flash-core`. Likely external dependencies to evaluate then are `windows` for Windows capture and Media Foundation, `pipewire` for Linux audio, and `ffmpeg-next` or direct FFmpeg bindings for Linux media encoding and muxing. IPC can begin with standard library local sockets or named pipes; choose a protocol crate only if the interface needs one. None are phase 1 dependencies.
3. **Tauri UI**: add a desktop frontend and its Tauri Rust backend, connecting to the daemon over a versioned IPC protocol. Migrate user flows only after capture and export parity is verified.

## C++ issues observed

- `RingBuffer::Push` indexes an empty vector and takes modulo zero when configured with zero seconds or zero fps.
- `AudioPacketStartUs` divides by zero for a zero sample rate and can overflow signed 64-bit intermediate arithmetic for extreme positions.
- `ComputeEvenWidth` can overflow its `uint32_t` rounding step for extreme dimensions.

These observations do not change the C++ code.
