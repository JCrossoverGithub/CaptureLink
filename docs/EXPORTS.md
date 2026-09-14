# CaptureLink Recording Exports

CaptureLink records directly to WebM and creates common user-facing formats only after the recording has finalized.

This keeps the real-time recording path simple and preserves the original capture as a master file.

## Native recording format

| Capture type | Native format |
| --- | --- |
| Audio | WebM / Opus |
| Video + audio | WebM / browser-supported video codec + Opus |

The exact WebM video codec depends on the codec selected by Chromium's `MediaRecorder`.

CaptureLink does not require MP4, MP3, or WAV encoding to succeed while a recording is being made.

## Export formats

| Recording | Available export |
| --- | --- |
| Video WebM | MP4 |
| Audio WebM | MP3 |
| Audio WebM | WAV |
| Any recording | Original WebM copy |

The WebM master is retained unless the user explicitly deletes the recording.

A failed conversion should not modify or destroy the original recording.

## FFmpeg

CaptureLink invokes FFmpeg as a separate process after recording.

Current executable resolution order:

1. `CAPTURELINK_FFMPEG`, when explicitly configured
2. the FFmpeg executable bundled with a packaged CaptureLink build
3. the `ffmpeg-static` development dependency
4. an `ffmpeg` executable available on `PATH`

This means development and packaged builds can use different executable locations while sharing the same export pipeline.

## Packaged Windows builds

The Windows distribution currently includes the FFmpeg executable supplied through `ffmpeg-static`.

electron-builder copies it into the packaged application resources at:

```text
resources/ffmpeg/ffmpeg.exe
```

This replaced the earlier development-only strategy in which CaptureLink depended exclusively on an externally installed FFmpeg executable.

The redistribution/license obligations of the selected FFmpeg build remain part of the release-readiness review.

See:

- `THIRD_PARTY_NOTICES.md`
- `docs/LEGAL_REVIEW.md`

## MP4 export

Video recordings are converted from the WebM master after recording completes.

The preferred MP4 path uses:

- H.264 video through `libx264`
- AAC audio
- variable frame timing derived from the source

CaptureLink deliberately avoids treating Chromium MediaRecorder's nominal WebM time base as the actual gameplay frame rate.

The export path preserves source frame timing so the resulting MP4 does not incorrectly become a high-frame-rate constant-frame-rate file.

If the resolved FFmpeg executable does not expose `libx264`, CaptureLink can retry using FFmpeg's MPEG-4 video encoder.

The fallback improves portability but is not intended to replace H.264 as the preferred export path.

## MP3 export

Audio recordings can be converted to MP3.

Current target:

```text
192 kbps MP3
```

The WebM/Opus master remains unchanged.

## WAV export

Audio recordings can also be exported as uncompressed WAV.

Current target:

```text
signed 16-bit PCM
```

WAV is useful when the recording will be edited further or when a simple uncompressed audio file is preferred.

## Original export

`Export Original` copies the WebM master to a user-selected location without transcoding it.

This is the highest-fidelity representation of what CaptureLink originally recorded.

## Progress and failure behavior

Conversion progress is surfaced to the renderer and recording library.

When conversion fails:

- the incomplete derived file should be removed
- the original WebM remains untouched
- the recording-library entry remains available
- the user can retry or export the original file

## Design principle

Common delivery formats are an export concern, not a live-capture concern.

The pipeline is intentionally:

```text
Xbox Remote Play MediaStream
        |
        v
Chromium MediaRecorder
        |
        v
WebM master
        |
        +--> original WebM copy
        |
        +--> FFmpeg --> MP4
        |
        +--> FFmpeg --> MP3
        |
        +--> FFmpeg --> WAV
```

That separation keeps the time-sensitive capture path independent from CPU-intensive post-processing.
