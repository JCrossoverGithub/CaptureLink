# Third-Party Work

CaptureLink uses third-party open-source software and platform services.

This directory exists to make material third-party source artifacts and provenance explicit rather than hiding them inside generated build output.

## Current vendored component

CaptureLink currently checks in a browser bundle from:

```text
xbox-xcloud-player
Jim Kroon / UnknownSKL
https://github.com/unknownskl/xbox-xcloud-player
```

See:

```text
third_party/xbox-xcloud-player/
```

The bundle is used for the browser-side Xbox xCloud/xHome WebRTC player and control layer.

CaptureLink's vendoring script verifies the bundle SHA-256 before copying it into the renderer's generated public assets.

## Other important dependencies

Other material dependencies, including `xal-node`, Electron, and FFmpeg/`ffmpeg-static`, are installed through npm rather than copied into this directory.

See:

```text
THIRD_PARTY_NOTICES.md
```
