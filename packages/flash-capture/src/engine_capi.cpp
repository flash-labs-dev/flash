// C API for the Rust/Tauri build. Uses the same engine pieces as binding.cpp
// (video/audio sources, encoder, ring buffer, muxer) without N-API.
// shortcut: duplicates binding.cpp's pipeline glue and leaves out its display-switch
// keyframe handoff and dead-encoder rebuild; fold both into one Engine class
// once binding.cpp is free to refactor.
#include "../include/flash_engine.h"
#include "core/platform.h"
#include "core/ring_buffer.h"
#include "core/quality.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>

using namespace flash;

namespace {
struct OwnedAudio { std::vector<float> samples; uint32_t frameCount = 0, channels = 0, sampleRate = 0; int64_t timestampUs = 0; std::string sourceId; };

std::mutex stateMutex, encodeMutex;
std::shared_ptr<VideoSource> video;
std::unique_ptr<AudioSource> audio;
std::unique_ptr<Encoder> encoder;
std::unique_ptr<RingBuffer> ring;
std::deque<OwnedAudio> audioBuffer;
std::string clipsDir, lastError;
uint32_t bufferSeconds = 30, fps = 60, width = 0, height = 0;
std::atomic<int> failureStreak{0};
constexpr int kEncoderDeadAfterFrames = 120;  // two seconds at 60fps, as in binding.cpp

int Fail(char* error, size_t len, const std::string& message) {
    if (error && len) std::snprintf(error, len, "%s", message.c_str());
    std::lock_guard lock(stateMutex); lastError = message;
    return -1;
}

std::string Escape(const std::string& text) {
    std::string out;
    for (const char c : text) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (static_cast<unsigned char>(c) < 0x20) { char hex[8]; std::snprintf(hex, sizeof hex, "\\u%04x", c); out += hex; }
        else out += c;
    }
    return out;
}

size_t Emit(const std::string& json, char* out, size_t len) {
    if (out && len > json.size()) std::memcpy(out, json.c_str(), json.size() + 1);
    return json.size() + 1;
}
} // namespace

extern "C" int flash_engine_start(const FlashEngineConfig* config, char* error, size_t error_len) {
    if (!config || !config->clips_dir || !*config->clips_dir || !config->fps || !config->height || !config->buffer_seconds)
        return Fail(error, error_len, "invalid engine configuration");
    flash_engine_stop();
    try {
        const auto displays = ListPlatformDisplays();
        if (config->display >= displays.size()) return Fail(error, error_len, "display not found");
        const auto& display = displays[config->display];
        const uint32_t outHeight = std::min(config->height, display.height);
        const uint32_t outWidth = ComputeEvenWidth(display.width, display.height, outHeight);
        auto nextVideo = CreateVideoSource();
        if (!nextVideo->Initialize(config->fps, outWidth, outHeight, config->display)) return Fail(error, error_len, "capture initialization failed");
        EncoderConfig encoderConfig; encoderConfig.width = outWidth; encoderConfig.height = outHeight;
        encoderConfig.fps = config->fps; encoderConfig.bitrate = config->bitrate_kbps * 1000;
        auto nextEncoder = CreateEncoder(encoderConfig);
        if (!nextEncoder) return Fail(error, error_len, "no H.264 encoder initialized");
        auto nextAudio = CreateAudioSource(); nextAudio->Initialize();
        {
            std::scoped_lock lock(stateMutex, encodeMutex);
            clipsDir = config->clips_dir; bufferSeconds = config->buffer_seconds; fps = config->fps;
            width = outWidth; height = outHeight; lastError.clear(); failureStreak = 0;
            ring = std::make_unique<RingBuffer>(bufferSeconds, fps); audioBuffer.clear();
            video = std::move(nextVideo); encoder = std::move(nextEncoder); audio = std::move(nextAudio);
        }
        const bool started = video->Start([](const FrameData& frame) {
            std::vector<EncodedPacket> packets;
            std::lock_guard lock(encodeMutex);
            if (!encoder || !ring) return;
            if (!encoder->EncodeFrame(frame, packets)) failureStreak.fetch_add(1); else failureStreak = 0;
            for (const auto& packet : packets) ring->Push(packet);
        });
        if (!started) { flash_engine_stop(); return Fail(error, error_len, "failed to start capture"); }
        audio->Start([](const AudioData& value) {
            if (!value.samples || !value.frameCount || !value.channels) return;
            OwnedAudio owned{std::vector<float>(value.samples, value.samples + static_cast<size_t>(value.frameCount) * value.channels),
                value.frameCount, value.channels, value.sampleRate, value.timestamp_us, value.sourceId};
            std::lock_guard lock(stateMutex);
            audioBuffer.push_back(std::move(owned));
            const int64_t cutoff = value.timestamp_us - static_cast<int64_t>(bufferSeconds) * 1000000;
            while (!audioBuffer.empty() && audioBuffer.front().timestampUs < cutoff) audioBuffer.pop_front();
        });
        return 0;
    } catch (const std::exception& e) {
        flash_engine_stop();
        return Fail(error, error_len, e.what());
    }
}

extern "C" void flash_engine_stop(void) {
    std::shared_ptr<VideoSource> v; AudioSource* a;
    { std::lock_guard lock(stateMutex); v = video; a = audio.get(); }
    // Join the producer threads before freeing what their callbacks use.
    if (v) v->Stop();
    if (a) a->Stop();
    std::scoped_lock lock(stateMutex, encodeMutex);
    encoder.reset(); video.reset(); audio.reset(); ring.reset(); audioBuffer.clear();
}

extern "C" int flash_engine_save_clip(double seconds, const char* game, char* path, size_t path_len, char* error, size_t error_len) {
    if (failureStreak >= kEncoderDeadAfterFrames) return Fail(error, error_len, "the video encoder stopped accepting frames");
    std::vector<EncodedPacket> packets; std::vector<OwnedAudio> sound; std::string out, name = game && *game ? game : "Unknown";
    uint32_t w, h, f;
    {
        std::lock_guard lock(stateMutex);
        if (!ring) return Fail(error, error_len, "capture is not running");
        packets = ring->Flush(seconds > 0 ? seconds : 0.0);
        if (packets.empty()) return Fail(error, error_len, "replay buffer is empty");
        sound.assign(audioBuffer.begin(), audioBuffer.end());
        w = width; h = height; f = fps;
    }
    // Audio outside the video's span hangs the muxer (see binding.cpp's SaveClip).
    const int64_t startUs = packets.front().pts_us, endUs = packets.back().pts_us + 1000000 / f;
    sound.erase(std::remove_if(sound.begin(), sound.end(), [=](const OwnedAudio& p) {
        const int64_t pEnd = p.timestampUs + (p.sampleRate ? static_cast<int64_t>(p.frameCount) * 1000000 / p.sampleRate : 0);
        return !p.sampleRate || p.timestampUs < startUs || pEnd > endUs;
    }), sound.end());
    try {
        auto muxer = CreateClipMuxer();
        { std::lock_guard lock(stateMutex); out = muxer->GenerateClipPath(clipsDir, name); }
        std::vector<AudioData> views;
        for (auto& p : sound) views.push_back({p.samples.data(), p.frameCount, p.channels, p.sampleRate, p.timestampUs, p.sourceId});
        const auto meta = muxer->Write(out, packets, views, w, h, f, name);
        if (path && path_len) std::snprintf(path, path_len, "%s", meta.filePath.c_str());
        return 0;
    } catch (const std::exception& e) {
        return Fail(error, error_len, e.what());
    }
}

extern "C" size_t flash_engine_status(char* json, size_t len) {
    std::lock_guard lock(stateMutex);
    const bool recording = video && video->IsCapturing();
    std::string error = video ? video->GetCaptureError() : lastError;
    if (failureStreak >= kEncoderDeadAfterFrames) error = "the video encoder stopped accepting frames";
    char buffer[1024];
    std::snprintf(buffer, sizeof buffer,
        "{\"recording\":%s,\"captureHealthy\":%s,\"capturePending\":%s,\"captureError\":\"%s\",\"captureBackend\":\"%s\","
        "\"bufferSeconds\":%u,\"encoder\":\"%s\",\"width\":%u,\"height\":%u,\"fps\":%u}",
        recording ? "true" : "false", recording && video->IsHealthy() && failureStreak < kEncoderDeadAfterFrames ? "true" : "false",
        video && video->IsPending() ? "true" : "false", Escape(error).c_str(),
        Escape(video ? video->GetCaptureBackend() : "none").c_str(), bufferSeconds,
        Escape(encoder ? encoder->GetName() : "none").c_str(), width, height, fps);
    return Emit(buffer, json, len);
}

extern "C" size_t flash_engine_displays(char* json, size_t len) {
    std::string out = "[";
    try {
        for (const auto& d : ListPlatformDisplays()) {
            if (out.size() > 1) out += ',';
            char item[512];
            std::snprintf(item, sizeof item, "{\"id\":%u,\"name\":\"%s\",\"width\":%u,\"height\":%u,\"isPrimary\":%s,\"refreshHz\":%u}",
                d.id, Escape(d.name).c_str(), d.width, d.height, d.isPrimary ? "true" : "false", d.refreshHz);
            out += item;
        }
    } catch (const std::exception&) {}
    return Emit(out + "]", json, len);
}
