/* C API over the capture engine, for the Rust/Tauri build.
 * One engine per process. Every call is thread-safe. Strings are UTF-8.
 * Calls that can fail return 0 on success and write a message into `error`. */
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct FlashEngineConfig {
    const char* clips_dir;
    uint32_t display;        /* index into flash_engine_displays() */
    uint32_t buffer_seconds; /* replay buffer length */
    uint32_t height;         /* encode height, capped at the display's */
    uint32_t fps;
    uint32_t bitrate_kbps;
} FlashEngineConfig;

/* Builds the pipeline (capture, encoder, audio) and starts the replay buffer. */
int flash_engine_start(const FlashEngineConfig* config, char* error, size_t error_len);
/* Stops capture and frees the pipeline. Safe to call when not started. */
void flash_engine_stop(void);
/* Writes the last `seconds` of the buffer (0 = all of it) to a new clip under
 * clips_dir/<game>/. The clip's path is written into `path`. Blocks until done. */
int flash_engine_save_clip(double seconds, const char* game, char* path, size_t path_len, char* error, size_t error_len);
/* JSON object with recording, captureHealthy, capturePending, captureError,
 * captureBackend, bufferSeconds, encoder, width, height, fps. Returns the
 * length it needs; writes nothing if `len` is too small. */
size_t flash_engine_status(char* json, size_t len);
/* JSON array of {id, name, width, height, isPrimary, refreshHz}. Same sizing rule. */
size_t flash_engine_displays(char* json, size_t len);

#ifdef __cplusplus
}
#endif
