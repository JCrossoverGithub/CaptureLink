# CaptureLink export pipeline

CaptureLink records WebM directly because Chromium `MediaRecorder` provides a stable, low-risk real-time capture path for the received Xbox stream. Common user-facing formats are derived after recording finishes.

## Formats

| Capture | Native master | Export |
| --- | --- | --- |
| Audio | WebM / Opus | MP3, WAV, original WebM |
| Video | WebM / VP8 or VP9 + Opus | MP4, original WebM |

MP4 export transcodes video to H.264 with `libx264` when available and audio to AAC. If the local FFmpeg executable lacks `libx264`, CaptureLink retries with FFmpeg's built-in MPEG-4 video encoder so the export can still complete.

MP3 export uses `libmp3lame` at 192 kbps. WAV export uses signed 16-bit PCM.

## Development FFmpeg discovery

M5-B does not add or redistribute an FFmpeg binary. CaptureLink resolves the executable in this order:

1. `CAPTURELINK_FFMPEG` environment variable, when set.
2. `ffmpeg` on the current process `PATH`.

For Ubuntu/WSL development, verify with:

```bash
ffmpeg -version
```

If FFmpeg is not installed, install the distribution package and restart CaptureLink.

## Why the binary is not bundled yet

FFmpeg licensing depends on the exact build configuration and enabled external codecs. Bundling a binary is therefore an M6 release/distribution decision, not a capture-pipeline decision. CaptureLink's application code invokes FFmpeg as a separate process and keeps the original WebM master unchanged.
