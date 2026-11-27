#include "../src/platform/windows/device_recovery.h"
#include <cassert>
#include <cstdio>

int main() {
    assert(flash::IsDeviceLost(DXGI_ERROR_DEVICE_REMOVED));
    assert(flash::IsDeviceLost(DXGI_ERROR_DEVICE_RESET));
    assert(!flash::IsDeviceLost(DXGI_ERROR_ACCESS_LOST));
    assert(!flash::IsDeviceLost(E_ACCESSDENIED));
    assert(!flash::IsDeviceLost(S_OK));
    std::puts("device_recovery: ok");
}
