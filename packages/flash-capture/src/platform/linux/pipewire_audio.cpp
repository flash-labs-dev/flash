// PipeWire graph routing. Hardware validation is still required.
#include "linux_backend.h"
#include "../../core/capture_clock.h"
#include "../../core/audio_tracks.h"
#include "../../core/pipewire_audio_route.h"
#include <pipewire/pipewire.h>
#include <pipewire/node.h>
#include <pipewire/link.h>
#include <pipewire/proxy.h>
#include <pipewire/thread-loop.h>
#include <spa/param/audio/format-utils.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <unistd.h>

namespace flash {
namespace {
std::string Property(const spa_dict* props, const char* key) {
    const char* value = props ? spa_dict_lookup(props, key) : nullptr;
    return value ? value : "";
}
uint32_t Number(const std::string& value) {
    try { return value.empty() ? 0 : static_cast<uint32_t>(std::stoul(value)); }
    catch (...) { return 0; }
}
struct Scan {
    std::vector<AudioDeviceInfo> devices;
    int pending = -1;
    bool done = false;
};
void ScanGlobal(void* data, uint32_t, uint32_t, const char* type, uint32_t, const spa_dict* props) {
    auto& scan = *static_cast<Scan*>(data);
    if (!type || std::strcmp(type, PW_TYPE_INTERFACE_Node) != 0 ||
        Property(props, PW_KEY_MEDIA_CLASS) != "Audio/Source") return;
    const auto id = Property(props, PW_KEY_NODE_NAME);
    if (id.empty() || (id.size() >= 8 && id.compare(id.size() - 8, 8, ".monitor") == 0) ||
        Property(props, "device.class") == "monitor") return;
    if (std::any_of(scan.devices.begin(), scan.devices.end(), [&](const auto& item) { return item.id == id; })) return;
    auto name = Property(props, PW_KEY_NODE_DESCRIPTION);
    if (name.empty()) name = Property(props, PW_KEY_NODE_NICK);
    scan.devices.push_back({id, name.empty() ? id : name});
}
void ScanDone(void* data, uint32_t id, int seq) {
    auto& scan = *static_cast<Scan*>(data);
    if (id == PW_ID_CORE && seq == scan.pending) scan.done = true;
}
std::vector<AudioDeviceInfo> ScanSources() {
    pw_init(nullptr, nullptr);
    auto* loop = pw_main_loop_new(nullptr);
    if (!loop) return {};
    auto* context = pw_context_new(pw_main_loop_get_loop(loop), nullptr, 0);
    if (!context) { pw_main_loop_destroy(loop); return {}; }
    auto* core = pw_context_connect(context, nullptr, 0);
    if (!core) { pw_context_destroy(context); pw_main_loop_destroy(loop); return {}; }
    auto* registry = pw_core_get_registry(core, PW_VERSION_REGISTRY, 0);
    if (!registry) { pw_core_disconnect(core); pw_context_destroy(context); pw_main_loop_destroy(loop); return {}; }
    Scan scan;
    static const pw_registry_events registryEvents = [] { pw_registry_events e{}; e.version = PW_VERSION_REGISTRY_EVENTS; e.global = ScanGlobal; return e; }();
    static const pw_core_events coreEvents = [] { pw_core_events e{}; e.version = PW_VERSION_CORE_EVENTS; e.done = ScanDone; return e; }();
    spa_hook registryHook{}, coreHook{};
    pw_registry_add_listener(registry, &registryHook, &registryEvents, &scan);
    pw_core_add_listener(core, &coreHook, &coreEvents, &scan);
    scan.pending = pw_core_sync(core, PW_ID_CORE, 0);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (!scan.done && std::chrono::steady_clock::now() < deadline)
        if (pw_loop_iterate(pw_main_loop_get_loop(loop), 50) < 0) break;
    spa_hook_remove(&registryHook); spa_hook_remove(&coreHook);
    pw_proxy_destroy(reinterpret_cast<pw_proxy*>(registry));
    pw_core_disconnect(core); pw_context_destroy(context); pw_main_loop_destroy(loop);
    return scan.devices;
}

class PipeWireAudio final : public AudioSource {
    struct Track {
        PipeWireAudio* owner = nullptr;
        pw_stream* stream = nullptr;
        spa_hook hook{};
        std::string id;
        bool enabled = true, active = false;
        float gain = 1;
        std::string error;
    };
    struct Node {
        PipeWireAudio* owner = nullptr;
        uint32_t id = 0, pid = 0;
        pw_node* proxy = nullptr;
        spa_hook hook{};
        std::string mediaClass, binary, application, name;
        bool receivedInfo = false;
    };
    struct Port {
        uint32_t id = 0, node = 0;
        std::string direction, channel;
    };
    std::array<Track, kAudioTrackCount> tracks_{};
    pw_thread_loop* loop_ = nullptr;
    pw_context* context_ = nullptr;
    pw_core* core_ = nullptr;
    pw_registry* registry_ = nullptr;
    spa_hook coreHook_{}, registryHook_{};
    std::map<uint32_t, std::unique_ptr<Node>> nodes_;
    std::map<uint32_t, Port> ports_;
    std::map<std::pair<uint32_t, uint32_t>, pw_proxy*> links_;
    ProcessSnapshot processes_;
    std::chrono::steady_clock::time_point lastProcessScan_{};
    AudioLaneConfig lanes_;
    uint32_t gamePid_ = 0, selfRoot_ = 0, factoryId_ = PW_ID_ANY;
    std::string gameName_, micDeviceId_, processError_;
    bool perApp_ = false, factory_ = false, ready_ = false, capturing_ = false;
    int sync_ = -1;
    mutable std::mutex mutex_;
    AudioCallback callback_;

    static void State(void* data, pw_stream_state, pw_stream_state state, const char* error) {
        auto& track = *static_cast<Track*>(data);
        std::lock_guard lock(track.owner->mutex_);
        track.active = state == PW_STREAM_STATE_STREAMING;
        track.error = error ? error : "";
    }
    static void Process(void* data) {
        auto& track = *static_cast<Track*>(data);
        auto& self = *track.owner;
        auto* buffer = pw_stream_dequeue_buffer(track.stream);
        if (!buffer) return;
        const auto* b = buffer->buffer;
        float gain;
        { std::lock_guard lock(self.mutex_); gain = track.gain; }
        if (b->n_datas && b->datas[0].data && b->datas[0].chunk) {
            const auto& plane = b->datas[0];
            const uint32_t size = plane.chunk->size, offset = plane.chunk->offset;
            if (offset <= plane.maxsize && size <= plane.maxsize - offset) {
                const auto frames = size / (2 * sizeof(float));
                const auto* input = reinterpret_cast<const float*>(static_cast<const uint8_t*>(plane.data) + offset);
                std::vector<float> samples(input, input + frames * 2);
                for (auto& sample : samples) sample *= gain;
                AudioData audio{samples.data(), static_cast<uint32_t>(frames), 2, 48000,
                    CaptureClockUs() - static_cast<int64_t>(frames) * 1000000 / 48000, track.id};
                try { self.callback_(audio); }
                catch (...) { std::lock_guard lock(self.mutex_); track.error = "Audio delivery failed"; }
            }
        }
        pw_stream_queue_buffer(track.stream, buffer);
    }
    static void NodeInfo(void* data, const pw_node_info* info) {
        auto& node = *static_cast<Node*>(data);
        if (!info || !info->props) return;
        node.mediaClass = Property(info->props, PW_KEY_MEDIA_CLASS);
        node.binary = Property(info->props, PW_KEY_APP_PROCESS_BINARY);
        node.application = Property(info->props, PW_KEY_APP_NAME);
        node.name = Property(info->props, PW_KEY_NODE_DESCRIPTION);
        node.pid = Number(Property(info->props, PW_KEY_APP_PROCESS_ID));
        const auto now = std::chrono::steady_clock::now();
        if (!node.receivedInfo || now - node.owner->lastProcessScan_ >= std::chrono::seconds(1)) {
            node.owner->processes_ = ListProcesses();
            node.owner->selfRoot_ = AppRoot(static_cast<uint32_t>(getpid()), node.owner->processes_.processes);
            node.owner->lastProcessScan_ = now;
        }
        node.receivedInfo = true;
        node.owner->Reconcile();
    }
    static void Global(void* data, uint32_t id, uint32_t, const char* type, uint32_t, const spa_dict* props) {
        auto& self = *static_cast<PipeWireAudio*>(data);
        if (!type) return;
        if (std::strcmp(type, PW_TYPE_INTERFACE_Factory) == 0 &&
            Property(props, PW_KEY_FACTORY_NAME) == "link-factory") {
            self.factory_ = true;
            self.factoryId_ = id;
        }
        if (std::strcmp(type, PW_TYPE_INTERFACE_Port) == 0) {
            Port port{id, Number(Property(props, PW_KEY_NODE_ID)), Property(props, PW_KEY_PORT_DIRECTION),
                      Property(props, PW_KEY_AUDIO_CHANNEL)};
            self.ports_[id] = std::move(port);
            self.Reconcile();
        }
        if (std::strcmp(type, PW_TYPE_INTERFACE_Node) == 0) {
            auto node = std::make_unique<Node>();
            node->owner = &self; node->id = id;
            node->mediaClass = Property(props, PW_KEY_MEDIA_CLASS);
            node->binary = Property(props, PW_KEY_APP_PROCESS_BINARY);
            node->application = Property(props, PW_KEY_APP_NAME);
            node->name = Property(props, PW_KEY_NODE_DESCRIPTION);
            node->pid = Number(Property(props, PW_KEY_APP_PROCESS_ID));
            node->proxy = static_cast<pw_node*>(pw_registry_bind(self.registry_, id, PW_TYPE_INTERFACE_Node, PW_VERSION_NODE, 0));
            if (node->proxy) {
                static const pw_node_events events = [] { pw_node_events e{}; e.version = PW_VERSION_NODE_EVENTS; e.info = NodeInfo; return e; }();
                pw_node_add_listener(node->proxy, &node->hook, &events, node.get());
            }
            self.nodes_[id] = std::move(node);
            self.Reconcile();
        }
    }
    static void GlobalRemove(void* data, uint32_t id) {
        auto& self = *static_cast<PipeWireAudio*>(data);
        if (self.factoryId_ != PW_ID_ANY && id == self.factoryId_) {
            self.factory_ = false;
            self.factoryId_ = PW_ID_ANY;
            self.Fallback("link-factory disappeared");
        }
        self.ports_.erase(id);
        auto node = self.nodes_.find(id);
        if (node != self.nodes_.end()) {
            if (node->second->proxy) pw_proxy_destroy(reinterpret_cast<pw_proxy*>(node->second->proxy));
            self.nodes_.erase(node);
        }
        self.Reconcile();
    }
    static void CoreDone(void* data, uint32_t id, int seq) {
        auto& self = *static_cast<PipeWireAudio*>(data);
        if (id == PW_ID_CORE && seq == self.sync_) {
            self.ready_ = true;
            pw_thread_loop_signal(self.loop_, false);
        }
    }
    static void CoreError(void* data, uint32_t id, int, int, const char* message) {
        auto& self = *static_cast<PipeWireAudio*>(data);
        if (!self.ready_) { pw_thread_loop_signal(self.loop_, false); return; }
        if (!self.perApp_) return;
        // Link creation can fail while a port is disappearing. Only a core-wide
        // failure warrants replacing all lane streams with desktop capture.
        if (id == PW_ID_CORE) self.Fallback(message ? message : "PipeWire core failed");
    }
    void DestroyTrack(Track& track) {
        if (!track.stream) return;
        pw_stream_destroy(track.stream);
        track.stream = nullptr;
        std::lock_guard lock(mutex_);
        track.active = false;
    }
    bool CreateTrack(Track& track, bool desktop = false) {
        if (track.stream || !track.enabled) return true;
        auto* props = pw_properties_new(PW_KEY_MEDIA_TYPE, "Audio", PW_KEY_MEDIA_CATEGORY, "Capture",
            PW_KEY_MEDIA_ROLE, "Production", "stream.capture.sink", desktop ? "true" : "false", nullptr);
        if (!props) return false;
        if (track.id != "mic" && !desktop) pw_properties_set(props, "node.autoconnect", "false");
        if (track.id == "mic" && !micDeviceId_.empty()) pw_properties_set(props, PW_KEY_TARGET_OBJECT, micDeviceId_.c_str());
        track.stream = pw_stream_new(core_, "Flash audio", props);
        if (!track.stream) return false;
        static const pw_stream_events events = [] { pw_stream_events e{}; e.version = PW_VERSION_STREAM_EVENTS;
            e.state_changed = State; e.process = Process; return e; }();
        pw_stream_add_listener(track.stream, &track.hook, &events, &track);
        uint8_t bytes[512]; auto builder = SPA_POD_BUILDER_INIT(bytes, sizeof(bytes));
        spa_audio_info_raw format{}; format.format = SPA_AUDIO_FORMAT_F32; format.rate = 48000; format.channels = 2;
        format.position[0] = SPA_AUDIO_CHANNEL_FL; format.position[1] = SPA_AUDIO_CHANNEL_FR;
        const spa_pod* params[] = {spa_format_audio_raw_build(&builder, SPA_PARAM_EnumFormat, &format)};
        const auto flags = static_cast<pw_stream_flags>((track.id == "mic" || desktop ? PW_STREAM_FLAG_AUTOCONNECT : 0) |
                                                        PW_STREAM_FLAG_MAP_BUFFERS);
        if (pw_stream_connect(track.stream, PW_DIRECTION_INPUT, PW_ID_ANY, flags, params, 1) >= 0) return true;
        DestroyTrack(track);
        return false;
    }
    AudioLane Lane(const Node& node) const {
        const bool self = node.pid && IsInProcessTree(node.pid, selfRoot_ ? selfRoot_ : static_cast<uint32_t>(getpid()),
                                                     processes_.processes);
        bool game = node.pid && IsInProcessTree(node.pid, gamePid_, processes_.processes);
        if (!game) game = PipeWireGameNameMatches(gameName_, node.binary, node.application);
        return PipeWireLane(node.binary, node.application, game, self, lanes_);
    }
    void ClearLinks() {
        for (auto& [key, proxy] : links_) pw_proxy_destroy(proxy);
        links_.clear();
    }
    void Fallback(const std::string& reason) {
        if (!perApp_) return;
        perApp_ = false;
        { std::lock_guard lock(mutex_); processError_ = "PipeWire per-app linking unavailable: " + reason; }
        ClearLinks();
        for (auto& track : tracks_) DestroyTrack(track);
        CreateTrack(tracks_[AudioTrackIndex("other")], true);
        CreateTrack(tracks_[AudioTrackIndex("mic")]);
    }
    void Reconcile() {
        if (!capturing_ || !perApp_) return;
        std::set<std::pair<uint32_t, uint32_t>> wanted;
        for (const auto& [id, source] : ports_) {
            if (source.direction != "out") continue;
            const auto node = nodes_.find(source.node);
            if (node == nodes_.end() || node->second->mediaClass != "Stream/Output/Audio") continue;
            const auto lane = Lane(*node->second);
            if (lane == AudioLane::None) continue;
            auto& track = tracks_[AudioTrackIndex(AudioLaneTrack(lane))];
            if (!track.stream) continue;
            const auto side = PipeWireChannel(source.channel);
            if (side == AudioChannelSide::Skip) continue;
            const auto inputNode = pw_stream_get_node_id(track.stream);
            if (inputNode == PW_ID_ANY) continue;
            for (const auto& [inputId, input] : ports_) {
                if (input.node != inputNode || input.direction != "in") continue;
                if ((side == AudioChannelSide::Left && input.channel == "FL") ||
                    (side == AudioChannelSide::Right && input.channel == "FR") ||
                    (side == AudioChannelSide::Both && (input.channel == "FL" || input.channel == "FR")))
                    wanted.emplace(id, inputId);
            }
        }
        for (auto it = links_.begin(); it != links_.end();) {
            if (wanted.count(it->first)) { ++it; continue; }
            pw_proxy_destroy(it->second);
            it = links_.erase(it);
        }
        for (const auto& key : wanted) {
            if (links_.count(key)) continue;
            const auto& output = ports_.at(key.first), &input = ports_.at(key.second);
            auto* props = pw_properties_new(nullptr);
            if (!props) { Fallback("cannot allocate link properties"); return; }
            pw_properties_set(props, PW_KEY_LINK_OUTPUT_NODE, std::to_string(output.node).c_str());
            pw_properties_set(props, PW_KEY_LINK_OUTPUT_PORT, std::to_string(output.id).c_str());
            pw_properties_set(props, PW_KEY_LINK_INPUT_NODE, std::to_string(input.node).c_str());
            pw_properties_set(props, PW_KEY_LINK_INPUT_PORT, std::to_string(input.id).c_str());
            auto* link = static_cast<pw_proxy*>(pw_core_create_object(core_, "link-factory", PW_TYPE_INTERFACE_Link,
                                                                       PW_VERSION_LINK, &props->dict, 0));
            pw_properties_free(props);
            if (!link) { Fallback("link-factory rejected a link"); return; }
            links_[key] = link;
        }
    }
public:
    PipeWireAudio() {
        for (size_t i = 0; i < tracks_.size(); ++i) { tracks_[i].owner = this; tracks_[i].id = kAudioTrackOrder[i]; }
    }
    ~PipeWireAudio() override { Stop(); }
    bool Initialize() override { pw_init(nullptr, nullptr); return true; }
    bool SetGameProcess(uint32_t pid) override {
        auto snapshot = ListProcesses();
        std::string name;
        for (const auto& p : snapshot.processes) if (p.pid == pid) { name = AudioAppName(p.exe); break; }
        if (loop_) pw_thread_loop_lock(loop_);
        gamePid_ = pid; gameName_ = std::move(name); processes_ = std::move(snapshot);
        selfRoot_ = AppRoot(static_cast<uint32_t>(getpid()), processes_.processes);
        Reconcile();
        const bool separate = perApp_;
        if (loop_) pw_thread_loop_unlock(loop_);
        return separate;
    }
    bool Start(AudioCallback callback) override {
        Stop();
        callback_ = std::move(callback);
        loop_ = pw_thread_loop_new("Flash audio", nullptr);
        if (!loop_) return false;
        if (pw_thread_loop_start(loop_) < 0) { pw_thread_loop_destroy(loop_); loop_ = nullptr; return false; }
        pw_thread_loop_lock(loop_);
        context_ = pw_context_new(pw_thread_loop_get_loop(loop_), nullptr, 0);
        if (context_) core_ = pw_context_connect(context_, nullptr, 0);
        if (core_) registry_ = pw_core_get_registry(core_, PW_VERSION_REGISTRY, 0);
        if (!registry_) { pw_thread_loop_unlock(loop_); Stop(); return false; }
        static const pw_registry_events registryEvents = [] { pw_registry_events e{}; e.version = PW_VERSION_REGISTRY_EVENTS;
            e.global = Global; e.global_remove = GlobalRemove; return e; }();
        static const pw_core_events coreEvents = [] { pw_core_events e{}; e.version = PW_VERSION_CORE_EVENTS;
            e.done = CoreDone; e.error = CoreError; return e; }();
        pw_registry_add_listener(registry_, &registryHook_, &registryEvents, this);
        pw_core_add_listener(core_, &coreHook_, &coreEvents, this);
        ready_ = false; factory_ = false; factoryId_ = PW_ID_ANY;
        sync_ = pw_core_sync(core_, PW_ID_CORE, 0);
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (!ready_ && std::chrono::steady_clock::now() < deadline)
            pw_thread_loop_timed_wait(loop_, 1);
        if (!ready_) {
            { std::lock_guard lock(mutex_); processError_ = "PipeWire server did not respond"; }
            pw_thread_loop_unlock(loop_);
            Stop();
            return false;
        }
        perApp_ = ready_ && factory_;
        { std::lock_guard lock(mutex_); processError_ = perApp_ ? "" : "PipeWire link-factory unavailable; recording desktop audio"; }
        capturing_ = true;
        bool ok = true;
        if (perApp_) {
            for (auto& track : tracks_) if (!CreateTrack(track)) { ok = false; break; }
            if (!ok) {
                Fallback("cannot create lane stream");
                ok = tracks_[AudioTrackIndex("other")].stream || tracks_[AudioTrackIndex("mic")].stream;
            }
        } else {
            ok = CreateTrack(tracks_[AudioTrackIndex("other")], true) && CreateTrack(tracks_[AudioTrackIndex("mic")]);
        }
        Reconcile();
        pw_thread_loop_unlock(loop_);
        if (!ok && !perApp_) { Stop(); return false; }
        return true;
    }
    void Stop() override {
        if (loop_) pw_thread_loop_lock(loop_);
        capturing_ = false; perApp_ = false;
        ClearLinks();
        for (auto& track : tracks_) DestroyTrack(track);
        for (auto& [id, node] : nodes_) if (node->proxy) pw_proxy_destroy(reinterpret_cast<pw_proxy*>(node->proxy));
        nodes_.clear(); ports_.clear();
        if (registry_) { spa_hook_remove(&registryHook_); pw_proxy_destroy(reinterpret_cast<pw_proxy*>(registry_)); registry_ = nullptr; }
        if (core_) { spa_hook_remove(&coreHook_); pw_core_disconnect(core_); core_ = nullptr; }
        if (context_) { pw_context_destroy(context_); context_ = nullptr; }
        if (loop_) { pw_thread_loop_unlock(loop_); pw_thread_loop_stop(loop_); pw_thread_loop_destroy(loop_); loop_ = nullptr; }
    }
    bool IsCapturing() const override {
        if (loop_) pw_thread_loop_lock(loop_);
        const bool result = capturing_;
        if (loop_) pw_thread_loop_unlock(loop_);
        return result;
    }
    std::vector<AudioSourceInfo> ListSources() const override {
        if (loop_) pw_thread_loop_lock(loop_);
        std::vector<AudioSourceInfo> result;
        {
            std::lock_guard lock(mutex_);
            for (const auto& t : tracks_) result.push_back({t.id, t.id, t.id == "mic" ? "Microphone" : t.id,
                perApp_ || t.id == "mic" || t.id == "other", t.enabled, t.active, t.gain, 48000, 2, 0,
                t.error.empty() && !perApp_ && t.id == "other" ? processError_ : t.error});
        }
        if (loop_) pw_thread_loop_unlock(loop_);
        return result;
    }
    bool SetSource(const std::string& id, bool enabled, float gain) override {
        const auto index = AudioTrackIndex(id);
        if (index == kAudioTrackCount) return false;
        if (loop_) pw_thread_loop_lock(loop_);
        auto& track = tracks_[index];
        track.enabled = enabled;
        { std::lock_guard lock(mutex_); track.gain = gain; }
        if (core_) {
            if (!enabled || (!perApp_ && id != "mic" && id != "other")) DestroyTrack(track);
            else if (!track.stream && !CreateTrack(track, !perApp_ && id == "other")) {
                if (perApp_) Fallback("cannot enable lane stream");
            }
            Reconcile();
        }
        if (loop_) pw_thread_loop_unlock(loop_);
        return true;
    }
    void SetLanes(const AudioLaneConfig& config) override {
        if (loop_) pw_thread_loop_lock(loop_);
        lanes_ = config; Reconcile();
        if (loop_) pw_thread_loop_unlock(loop_);
    }
    std::vector<AudioAppInfo> ListApps() const override {
        if (loop_) pw_thread_loop_lock(loop_);
        std::vector<AudioAppInfo> result;
        for (const auto& [id, node] : nodes_) {
            if (node->mediaClass != "Stream/Output/Audio") continue;
            const auto lane = Lane(*node);
            if (lane == AudioLane::None) continue;
            auto exe = MatchingAudioEntry(node->binary, node->application, lanes_.discord);
            if (exe.empty()) exe = MatchingAudioEntry(node->binary, node->application, lanes_.music);
            if (exe.empty()) exe = AudioAppName(node->binary.empty() ? node->application : node->binary);
            bool linked = false;
            for (const auto& [portId, port] : ports_) {
                if (port.node != id || port.direction != "out") continue;
                for (const auto& [pair, proxy] : links_) if (pair.first == portId) { linked = true; break; }
                if (linked) break;
            }
            result.push_back({exe, node->name.empty() ? node->application : node->name,
                              std::string(AudioLaneTrack(lane)), node->pid, linked});
        }
        if (loop_) pw_thread_loop_unlock(loop_);
        return result;
    }
    bool SupportsPerApp() const override { if (loop_) pw_thread_loop_lock(loop_); const bool result = perApp_; if (loop_) pw_thread_loop_unlock(loop_); return result; }
    std::vector<AudioDeviceInfo> ListCaptureDevices() const override { return ScanSources(); }
    bool SetCaptureDevice(const std::string& id) override {
        if (loop_) pw_thread_loop_lock(loop_);
        if (micDeviceId_ != id) {
            micDeviceId_ = id;
            auto& mic = tracks_[AudioTrackIndex("mic")];
            if (mic.stream) { DestroyTrack(mic); CreateTrack(mic); }
        }
        if (loop_) pw_thread_loop_unlock(loop_);
        return true;
    }
    std::string GetMode() const override { return SupportsPerApp() ? "separate" : "mixed"; }
    std::string GetProcessError() const override { std::lock_guard lock(mutex_); return processError_; }
};
} // namespace

std::unique_ptr<AudioSource> CreatePipeWireAudio() { return std::make_unique<PipeWireAudio>(); }
} // namespace flash
