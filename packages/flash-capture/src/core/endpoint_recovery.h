#pragma once
#include <string_view>

namespace flash {
inline bool EndpointNeedsRebuild(bool available, bool invalidated,
    std::string_view currentId, std::string_view wantedId) {
    return invalidated || (!wantedId.empty() && (!available || currentId != wantedId));
}
} // namespace flash
