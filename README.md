# CaptureLink

CaptureLink is a Windows-first desktop application for Xbox home streaming and local capture.

## Product goal

CaptureLink should let a user:

1. Sign in with the Microsoft/Xbox account that owns or can Remote Play the console.
2. Discover their Xbox console.
3. Start an xHome Remote Play session.
4. Watch the Xbox video stream on the computer.
5. Hear game audio and incoming game-chat audio.
6. Use supported controller, microphone, and diagnostic controls.
7. Record audio-only or video-plus-audio locally.

## Current status

CaptureLink starts from a proven protocol spike developed under the XboxLink research project.

Proven in that spike:

- Xbox authentication works.
- An Xbox Series X can be discovered through xHome.
- Chromium can complete the Remote Play WebRTC session.
- Xbox video plays successfully.
- Xbox game audio plays successfully.
- Incoming in-game voice chat is audible in the same Remote Play audio received by the computer.
- Firefox failed during SDP exchange while Chromium/Edge succeeded.

The current CaptureLink repository intentionally does **not** copy the experimental implementation. The first engineering milestone is to reproduce that known-good session inside Electron/Chromium cleanly.

## Stack

- Electron 44
- Chromium runtime bundled by Electron
- TypeScript
- electron-vite
- electron-builder for eventual Windows installers

## Development

```bash
npm install
npm run dev
```

## Milestones

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Licensing / distribution

This repository should remain private/unlicensed until the Microsoft/Xbox service terms, product naming, upstream code attribution, and third-party dependency licenses have been reviewed for the intended distribution model.
