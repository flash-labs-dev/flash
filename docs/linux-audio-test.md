# Linux audio test

This build is untested on Linux.

- [ ] 1. **Do:** run `pactl info`. **Expect:** the server name mentions PipeWire.
- [ ] 2. **Do:** open Settings and find "Record audio". **Expect:** one switch each for game, mic, other, Discord and music.
- [ ] 3. **Do:** play a game, join a Discord call, play Spotify, speak into the mic, save a clip, then run `ffprobe -hide_banner CLIP.mp4`. **Expect:** separate audio tracks for game, mic, other, Discord and music, in that order.
- [ ] 4. **Do:** listen to each track with `ffplay -vn -ast a:0 CLIP.mp4` (then `a:1` to `a:4`). **Expect:** each track holds only its own source.
- [ ] 5. **Do:** listen to your speakers or headset while recording. **Expect:** sound plays normally.
- [ ] 6. **Do:** start Discord or Spotify after recording has begun, then save a clip. **Expect:** its sound is on its own track.
- [ ] 7. **Do:** switch one source off and save a clip. **Expect:** that track has no sound from that source. With the mic off, the system shows no microphone in use.
- [ ] 8. **Do:** share a clip and open the link. **Expect:** all sources play together.
- [ ] 9. **If anything fails, send:** distribution, desktop, the app's terminal output and the `ffprobe` output.
