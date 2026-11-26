// KDE Plasma: record one window or one monitor without the portal dialog,
// through KWin's zkde_screencast_unstable_v1 and plasma window management.
// Both are KDE-private and may change between Plasma releases, so every
// failure here returns false and the caller falls back to the portal.
#include "kwin_screencast.h"
#include "zkde-screencast-unstable-v1-client.h"
#include "plasma-window-management-client.h"
#include <wayland-client.h>
#include <poll.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>

namespace flash {
namespace {
std::atomic<uint32_t> windowPid{0};

void Nop() {}
template <typename T> T NopAs() { return reinterpret_cast<T>(&Nop); }

// Parent of a process, or 0. Used to accept windows opened by a child of the
// detected game process (launch wrappers, Proton's wine children).
uint32_t ParentOf(uint32_t pid) {
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    std::string line; if (!std::getline(stat, line)) return 0;
    const auto close = line.rfind(')'); if (close == std::string::npos) return 0;
    char state = 0; unsigned parent = 0;
    return std::sscanf(line.c_str() + close + 1, " %c %u", &state, &parent) == 2 ? parent : 0;
}
bool DescendsFrom(uint32_t pid, uint32_t ancestor) {
    for (int depth = 0; pid > 1 && depth < 16; ++depth, pid = ParentOf(pid))
        if (pid == ancestor) return true;
    return false;
}
} // namespace

void SetCaptureWindowPid(uint32_t pid) { windowPid = pid; }
uint32_t CaptureWindowPid() { return windowPid; }

struct KWinScreencast::Impl {
    struct Window {
        std::string uuid; uint32_t pid = 0; bool mapped = true; int32_t width = 0, height = 0;
        org_kde_plasma_window* handle = nullptr; Impl* owner = nullptr;
    };
    struct Output { wl_output* handle = nullptr; std::string name, description; int32_t width = 0, height = 0, refresh = 0; };
    wl_display* display = nullptr;
    wl_registry* registry = nullptr;
    org_kde_plasma_window_management* windows = nullptr;
    zkde_screencast_unstable_v1* screencast = nullptr;
    zkde_screencast_stream_unstable_v1* stream = nullptr;
    std::vector<std::unique_ptr<Window>> windowList;
    std::vector<std::unique_ptr<Output>> outputs;
    std::string serial, error; bool settled = false, closed = false;

    static void Global(void* data, wl_registry* registry, uint32_t name, const char* interface, uint32_t version) {
        auto& self = *static_cast<Impl*>(data);
        if (!std::strcmp(interface, org_kde_plasma_window_management_interface.name) && version >= 16) {
            self.windows = static_cast<org_kde_plasma_window_management*>(
                wl_registry_bind(registry, name, &org_kde_plasma_window_management_interface, 16));
            static const org_kde_plasma_window_management_listener listener = {
                NopAs<decltype(listener.show_desktop_changed)>(), NopAs<decltype(listener.window)>(),
                NopAs<decltype(listener.stacking_order_changed)>(), NopAs<decltype(listener.stacking_order_uuid_changed)>(),
                WindowAdded, NopAs<decltype(listener.stacking_order_changed_2)>()};
            org_kde_plasma_window_management_add_listener(self.windows, &listener, &self);
        } else if (!std::strcmp(interface, zkde_screencast_unstable_v1_interface.name) && version >= 6) {
            self.screencast = static_cast<zkde_screencast_unstable_v1*>(
                wl_registry_bind(registry, name, &zkde_screencast_unstable_v1_interface, 6));
        } else if (!std::strcmp(interface, wl_output_interface.name) && version >= 4) {
            auto output = std::make_unique<Output>();
            output->handle = static_cast<wl_output*>(wl_registry_bind(registry, name, &wl_output_interface, 4));
            static const wl_output_listener listener = {
                NopAs<decltype(listener.geometry)>(), OutputMode, NopAs<decltype(listener.done)>(),
                NopAs<decltype(listener.scale)>(), OutputName, OutputDescription};
            wl_output_add_listener(output->handle, &listener, output.get());
            self.outputs.push_back(std::move(output));
        }
    }
    static void OutputMode(void* data, wl_output*, uint32_t flags, int32_t width, int32_t height, int32_t refresh) {
        if (!(flags & WL_OUTPUT_MODE_CURRENT)) return;
        auto& output = *static_cast<Output*>(data); output.width = width; output.height = height; output.refresh = refresh;
    }
    static void OutputName(void* data, wl_output*, const char* name) { static_cast<Output*>(data)->name = name; }
    static void OutputDescription(void* data, wl_output*, const char* text) { static_cast<Output*>(data)->description = text; }

    static void WindowAdded(void* data, org_kde_plasma_window_management* manager, uint32_t, const char* uuid) {
        auto& self = *static_cast<Impl*>(data);
        auto window = std::make_unique<Window>(); window->uuid = uuid; window->owner = &self;
        window->handle = org_kde_plasma_window_management_get_window_by_uuid(manager, uuid);
        static const org_kde_plasma_window_listener listener = {
            NopAs<decltype(listener.title_changed)>(), NopAs<decltype(listener.app_id_changed)>(),
            NopAs<decltype(listener.state_changed)>(), NopAs<decltype(listener.virtual_desktop_changed)>(),
            NopAs<decltype(listener.themed_icon_name_changed)>(), WindowUnmapped,
            NopAs<decltype(listener.initial_state)>(), NopAs<decltype(listener.parent_window)>(), WindowGeometry,
            NopAs<decltype(listener.icon_changed)>(), WindowPid, NopAs<decltype(listener.virtual_desktop_entered)>(),
            NopAs<decltype(listener.virtual_desktop_left)>(), NopAs<decltype(listener.application_menu)>(),
            NopAs<decltype(listener.activity_entered)>(), NopAs<decltype(listener.activity_left)>(),
            NopAs<decltype(listener.resource_name_changed)>()};
        org_kde_plasma_window_add_listener(window->handle, &listener, window.get());
        self.windowList.push_back(std::move(window));
    }
    static void WindowPid(void* data, org_kde_plasma_window*, uint32_t pid) { static_cast<Window*>(data)->pid = pid; }
    static void WindowUnmapped(void* data, org_kde_plasma_window*) { static_cast<Window*>(data)->mapped = false; }
    static void WindowGeometry(void* data, org_kde_plasma_window*, int32_t, int32_t, uint32_t width, uint32_t height) {
        auto& window = *static_cast<Window*>(data); window.width = static_cast<int32_t>(width); window.height = static_cast<int32_t>(height);
    }

    static void StreamClosed(void* data, zkde_screencast_stream_unstable_v1*) { auto& s = *static_cast<Impl*>(data); s.closed = s.settled = true; }
    static void StreamCreated(void* data, zkde_screencast_stream_unstable_v1*, uint32_t node) {
        auto& s = *static_cast<Impl*>(data); if (s.serial.empty()) s.serial = "node:" + std::to_string(node); s.settled = true;
    }
    static void StreamFailed(void* data, zkde_screencast_stream_unstable_v1*, const char* message) {
        auto& s = *static_cast<Impl*>(data); s.error = message ? message : "KWin refused the stream"; s.settled = true;
    }
    static void StreamSerial(void* data, zkde_screencast_stream_unstable_v1*, uint32_t high, uint32_t low) {
        static_cast<Impl*>(data)->serial = std::to_string((static_cast<uint64_t>(high) << 32) | low);
    }
    bool Await() {
        static const zkde_screencast_stream_unstable_v1_listener listener = {StreamClosed, StreamCreated, StreamFailed, StreamSerial};
        zkde_screencast_stream_unstable_v1_add_listener(stream, &listener, this);
        // KWin answers once PipeWire has the node, which can take a while, so a
        // roundtrip is not enough: wait on the socket, up to three seconds.
        for (int waited = 0; !settled && waited < 3000; waited += 50) {
            while (wl_display_prepare_read(display) != 0) wl_display_dispatch_pending(display);
            wl_display_flush(display);
            pollfd fd{wl_display_get_fd(display), POLLIN, 0};
            if (poll(&fd, 1, 50) > 0) wl_display_read_events(display); else wl_display_cancel_read(display);
            if (wl_display_dispatch_pending(display) < 0) { error = "Lost the KWin connection"; return false; }
        }
        if (!error.empty() || closed || serial.empty() || serial.rfind("node:", 0) == 0) {
            if (error.empty()) error = "KWin did not create a stream";
            return false;
        }
        return true;
    }
    ~Impl() {
        if (stream) zkde_screencast_stream_unstable_v1_close(stream);
        for (auto& window : windowList) if (window->handle) org_kde_plasma_window_destroy(window->handle);
        for (auto& output : outputs) if (output->handle) wl_output_release(output->handle);
        if (screencast) zkde_screencast_unstable_v1_destroy(screencast);
        if (windows) org_kde_plasma_window_management_destroy(windows);
        if (registry) wl_registry_destroy(registry);
        if (display) wl_display_disconnect(display);
    }
};

KWinScreencast::KWinScreencast() : impl_(std::make_unique<Impl>()) {}
KWinScreencast::~KWinScreencast() = default;

bool KWinScreencast::Connect() {
    const char* desktop = std::getenv("XDG_CURRENT_DESKTOP");
    if (!desktop || !std::strstr(desktop, "KDE") || !std::getenv("WAYLAND_DISPLAY")) return false;
    impl_->display = wl_display_connect(nullptr);
    if (!impl_->display) return false;
    impl_->registry = wl_display_get_registry(impl_->display);
    static const wl_registry_listener listener = {Impl::Global, NopAs<decltype(listener.global_remove)>()};
    wl_registry_add_listener(impl_->registry, &listener, impl_.get());
    // Globals, then the windows and outputs they announce, then their properties.
    for (int i = 0; i < 3; ++i) if (wl_display_roundtrip(impl_->display) < 0) return false;
    return impl_->windows && impl_->screencast && !impl_->outputs.empty();
}

std::vector<DisplayInfo> KWinScreencast::Outputs() const {
    std::vector<DisplayInfo> result;
    for (uint32_t i = 0; i < impl_->outputs.size(); ++i) {
        const auto& output = *impl_->outputs[i];
        std::string name = output.description.empty() ? output.name : output.description;
        result.push_back({i, name, static_cast<uint32_t>(output.width), static_cast<uint32_t>(output.height), i == 0,
            static_cast<uint32_t>((output.refresh + 500) / 1000)});
    }
    return result;
}

std::string KWinScreencast::WindowForPid(uint32_t pid) {
    if (!pid || wl_display_roundtrip(impl_->display) < 0) return {};
    // shortcut: picks the largest mapped window of the process tree; a game
    // with a separate launcher window could pick the launcher until it closes.
    const Impl::Window* best = nullptr; bool bestExact = false;
    for (const auto& window : impl_->windowList) {
        if (!window->mapped || !window->pid) continue;
        const bool exact = window->pid == pid;
        if (!exact && !DescendsFrom(window->pid, pid)) continue;
        const auto area = static_cast<int64_t>(window->width) * window->height;
        if (!best || (exact && !bestExact) || (exact == bestExact && area > static_cast<int64_t>(best->width) * best->height)) {
            best = window.get(); bestExact = exact;
        }
    }
    return best ? best->uuid : std::string{};
}

bool KWinScreencast::StreamWindow(const std::string& uuid) {
    impl_->stream = zkde_screencast_unstable_v1_stream_window(impl_->screencast, uuid.c_str(),
        ZKDE_SCREENCAST_UNSTABLE_V1_POINTER_EMBEDDED);
    return impl_->Await();
}

bool KWinScreencast::StreamOutput(uint32_t index) {
    if (index >= impl_->outputs.size()) index = 0;
    impl_->stream = zkde_screencast_unstable_v1_stream_output(impl_->screencast, impl_->outputs[index]->handle,
        ZKDE_SCREENCAST_UNSTABLE_V1_POINTER_EMBEDDED);
    return impl_->Await();
}

const std::string& KWinScreencast::Serial() const { return impl_->serial; }
const std::string& KWinScreencast::Error() const { return impl_->error; }

bool KWinScreencast::Pump() {
    // Non-blocking: read whatever KWin sent, so a closed window ends the session.
    auto* display = impl_->display;
    while (wl_display_prepare_read(display) != 0) wl_display_dispatch_pending(display);
    wl_display_flush(display);
    pollfd fd{wl_display_get_fd(display), POLLIN, 0};
    if (poll(&fd, 1, 0) > 0) wl_display_read_events(display); else wl_display_cancel_read(display);
    if (wl_display_dispatch_pending(display) < 0) return false;
    return !impl_->closed;
}

std::vector<DisplayInfo> ListKWinOutputs() {
    KWinScreencast kwin;
    return kwin.Connect() ? kwin.Outputs() : std::vector<DisplayInfo>{};
}
} // namespace flash
