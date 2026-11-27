#include "../src/core/pipewire_audio_route.h"
#include <cassert>

int main() {
    using namespace flash;
    AudioLaneConfig config{{"discord.exe", "overlap.exe"}, {"spotify.exe", "overlap.exe"}};
    assert(AudioAppName("/Games/Foo.EXE") == "foo");
    for (auto wine : {"wine", "wine64", "wine-preloader", "wine64-preloader"})
        assert(!PipeWireGameNameMatches(wine, wine, "Other Game.exe"));
    assert(PipeWireGameNameMatches("/Games/Foo.EXE", "wine64-preloader", "Foo.exe"));
    assert(!PipeWireGameNameMatches("/Games/Foo.EXE", "wine64-preloader", "Other Game.exe"));
    assert(MatchingAudioEntry("wine64-preloader", "Discord.EXE", config.discord) == "discord.exe");
    assert(PipeWireLane("wine64-preloader", "Foo.exe", true, false, config) == AudioLane::Game);
    assert(PipeWireLane("spotify.exe", "Spotify", false, true, config) == AudioLane::None);
    assert(PipeWireLane("Foo.exe", "Foo", true, true, config) == AudioLane::None);
    assert(PipeWireLane("overlap.exe", "", false, false, config) == AudioLane::Discord);
    assert(PipeWireLane("webcord", "", false, false, config) == AudioLane::Discord);
    assert(PipeWireLane("discordcanary.exe", "", false, false, config) == AudioLane::Discord);
    assert(PipeWireLane("", "Spotify", false, false, config) == AudioLane::Music);
    assert(PipeWireLane("browser", "", false, false, config) == AudioLane::Other);
    for (auto name : {"FL", "SL", "RL"}) assert(PipeWireChannel(name) == AudioChannelSide::Left);
    for (auto name : {"FR", "SR", "RR"}) assert(PipeWireChannel(name) == AudioChannelSide::Right);
    for (auto name : {"FC", "MONO"}) assert(PipeWireChannel(name) == AudioChannelSide::Both);
    assert(PipeWireChannel("LFE") == AudioChannelSide::Skip);
}
