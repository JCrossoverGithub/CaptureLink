# FFmpeg Runtime and Distribution

## v0.1 distribution decision

CaptureLink v0.1 does not redistribute an FFmpeg executable inside the Windows installer.

FFmpeg remains an optional external runtime used for post-recording conversion to MP4, MP3, and WAV.

The original WebM recording path does not require FFmpeg.

## Runtime resolution

Development environments may use the `ffmpeg-static` development dependency.

Packaged CaptureLink builds do not include `resources/ffmpeg/ffmpeg.exe`.

For packaged use, FFmpeg can be supplied through:

- the `CAPTURELINK_FFMPEG` environment variable
- an `ffmpeg` executable available on `PATH`

If no usable FFmpeg runtime is available, the original WebM recording remains available, but converted exports cannot be produced.

## Audited binary

During v0.1 release preparation, the exact Windows FFmpeg binary previously bundled by CaptureLink was audited.

The binary was:

- FFmpeg 6.1.1
- Gyan.dev essentials build
- 64-bit Windows static build
- GPL version 3
- built with `--enable-gpl`
- built with `--enable-version3`
- built with `--enable-static`
- built with `--enable-libx264`
- built with `--enable-libx265`
- not built with `--enable-nonfree`

SHA-256:

`04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`

The SHA-256 of the `ffmpeg-static` executable, the previously packaged CaptureLink executable, and the executable from the original Gyan.dev FFmpeg 6.1.1 essentials archive was identical.

The original Gyan.dev archive identifies the FFmpeg source revision as:

`e38092ef93`

The archive also records versions for its external libraries, including x264 and x265.

## Why CaptureLink v0.1 does not bundle it

The audited executable is a statically linked GPLv3 build incorporating numerous external libraries.

The inspected Gyan binary archive contains the GPLv3 license, FFmpeg source revision, build configuration, and external-library versions, but does not itself contain a complete corresponding-source and build-material distribution for every statically incorporated component.

Rather than claim incomplete redistribution compliance, CaptureLink v0.1 does not redistribute this executable.

## Development dependency

CaptureLink currently retains `ffmpeg-static` as a development dependency.

This allows development and testing environments to use a known FFmpeg runtime without making that executable part of the CaptureLink Windows installer.

The `ffmpeg-static` package license text remains preserved in the repository for provenance.

## Future self-contained runtime

A future CaptureLink release may restore a self-contained FFmpeg runtime if the project adopts a distribution strategy with complete corresponding-source compliance.

Possible approaches include:

- maintaining a CaptureLink-controlled FFmpeg build and corresponding source bundle
- using a suitable third-party distribution with complete corresponding-source availability
- otherwise adopting a distribution mechanism that does not make CaptureLink responsible for redistributing the executable

Any future bundled runtime must be reviewed before release.
