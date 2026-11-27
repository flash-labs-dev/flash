#include "../src/core/endpoint_recovery.h"
#include <cassert>

int main() {
    using flash::EndpointNeedsRebuild;
    assert(EndpointNeedsRebuild(true, false, "speakers-a", "speakers-b"));
    assert(EndpointNeedsRebuild(true, true, "mic-a", "mic-a"));
    assert(EndpointNeedsRebuild(true, true, "mic-a", "")); // unplugged, no fallback
    assert(EndpointNeedsRebuild(false, false, "", "mic-a"));
    assert(!EndpointNeedsRebuild(true, false, "mic-a", "mic-a"));
    assert(!EndpointNeedsRebuild(true, false, "mic-a", ""));
}
