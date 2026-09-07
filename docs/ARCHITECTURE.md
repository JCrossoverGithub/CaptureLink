# CaptureLink Architecture

## Product boundary

CaptureLink is a local desktop application. The v1 architecture intentionally has no CaptureLink cloud control plane, transcription backend, GPU service, or account system.

```text
Microsoft / Xbox services
          |
          | authentication + xHome session control
          v
      Xbox console
          |
          | WebRTC
          v
+------------------------------+
| CaptureLink Desktop          |
|                              |
| Electron main process        |
|   - lifecycle                |
|   - filesystem              |
|   - future secure storage    |
|                              |
| Preload boundary             |
|   - minimal typed IPC        |
|                              |
| Renderer / Chromium          |
|   - Xbox/xHome session       |
|   - WebRTC peer connection   |
|   - video render             |
|   - audio playback           |
|   - controller/mic controls  |
|   - media recording          |
+------------------------------+
          |
          v
   Local recording files
```

## Why Electron

The protocol spike demonstrated that Chromium successfully negotiated the xHome WebRTC session while Firefox failed during SDP exchange. Electron bundles Chromium, giving CaptureLink a known browser engine instead of depending on whichever browser the user happens to launch.

## Security defaults

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- renderer does not receive unrestricted filesystem access
- authentication tokens must never be committed
- recording writes should eventually go through narrow preload/main IPC APIs
- external links open outside the app

## Dependency boundary

Xbox-specific behavior should live behind a provider/session layer rather than leak through all UI code. Recording should consume generic `MediaStream` tracks and should not know Xbox protocol details.

Target conceptual split:

```text
Xbox provider -> RemotePlaySession -> MediaStream -> Player / Recorder
```
