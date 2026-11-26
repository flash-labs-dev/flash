#pragma once
#include "../../core/platform.h"
#include <memory>
#include <string>
#include <vector>

namespace flash {
// Set through SetCaptureWindowPid in core/platform.h.
uint32_t CaptureWindowPid();

class KWinScreencast {
public:
    KWinScreencast();
    ~KWinScreencast();
    KWinScreencast(const KWinScreencast&) = delete;
    KWinScreencast& operator=(const KWinScreencast&) = delete;
    // False unless this is KDE Plasma on Wayland and KWin grants the protocols.
    bool Connect();
    std::vector<DisplayInfo> Outputs() const;
    // UUID of the window belonging to pid or one of its children, or "".
    std::string WindowForPid(uint32_t pid);
    bool StreamWindow(const std::string& uuid);
    bool StreamOutput(uint32_t index);
    const std::string& Serial() const;  // PipeWire object serial of the stream
    const std::string& Error() const;
    // Reads pending KWin events; false once KWin closed the stream.
    bool Pump();
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
std::vector<DisplayInfo> ListKWinOutputs();
} // namespace flash
