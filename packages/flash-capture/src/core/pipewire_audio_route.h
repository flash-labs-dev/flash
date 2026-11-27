#pragma once

#include "audio_lanes.h"
#include <string>
#include <string_view>

namespace flash {

inline std::string AudioAppName(std::string_view value) {
    const auto slash = value.find_last_of("/\\");
    if (slash != std::string_view::npos) value.remove_prefix(slash + 1);
    std::string name = LowerAscii(value);
    if (name.size() > 4 && name.compare(name.size() - 4, 4, ".exe") == 0) name.resize(name.size() - 4);
    return name;
}

inline bool PipeWireGameNameMatches(std::string_view gameName, std::string_view binary,
                                    std::string_view application) {
    const auto game = AudioAppName(gameName);
    if (game.empty() || game == "wine" || game == "wine64" ||
        game == "wine-preloader" || game == "wine64-preloader") return false;
    return AudioAppName(binary) == game || AudioAppName(application) == game;
}

inline std::string MatchingAudioEntry(std::string_view binary, std::string_view application,
                                      const std::vector<std::string>& entries) {
    const auto bin = AudioAppName(binary), app = AudioAppName(application);
    for (const auto& entry : entries)
        if (AudioAppName(entry) == bin || AudioAppName(entry) == app) return entry;
    return {};
}

inline AudioLane PipeWireLane(std::string_view binary, std::string_view application, bool game,
                              bool self, const AudioLaneConfig& config) {
    if (self) return AudioLane::None;
    if (game) return AudioLane::Game;
    const auto bin = AudioAppName(binary), app = AudioAppName(application);
    const auto discord = [](const std::string& s) {
        return s == "discord" || s == "discordcanary" || s == "discordptb" ||
               s == "vesktop" || s == "webcord";
    };
    if (discord(bin) || discord(app) || !MatchingAudioEntry(binary, application, config.discord).empty())
        return AudioLane::Discord;
    if (!MatchingAudioEntry(binary, application, config.music).empty()) return AudioLane::Music;
    return AudioLane::Other;
}

enum class AudioChannelSide { Skip, Left, Right, Both };
inline AudioChannelSide PipeWireChannel(std::string_view channel) {
    if (channel == "FL" || channel == "SL" || channel == "RL") return AudioChannelSide::Left;
    if (channel == "FR" || channel == "SR" || channel == "RR") return AudioChannelSide::Right;
    if (channel == "FC" || channel == "MONO") return AudioChannelSide::Both;
    return AudioChannelSide::Skip;
}

} // namespace flash
