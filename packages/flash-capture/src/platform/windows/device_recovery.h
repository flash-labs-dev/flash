#pragma once

#include <dxgi.h>

namespace flash {
inline bool IsDeviceLost(HRESULT hr) {
    return hr == DXGI_ERROR_DEVICE_REMOVED || hr == DXGI_ERROR_DEVICE_RESET;
}
} // namespace flash
