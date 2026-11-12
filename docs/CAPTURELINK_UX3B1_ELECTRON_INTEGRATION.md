# CaptureLink V1.6 UX3b1 — Local Electron signaling integration

## Baseline and acceptance scope

**Base:** `a1816b4575374b695c8dc59b01626d08182acfb1`, PR #10 accepted.
**Branch:** `feature/ux3b1-electron-integration`.

UX3b1 integrates the *local-only* UX3a signaling broker and UX3b0 client into Electron main, preload, and the UX2 Friend setup. It is **not** a cross-PC invitation release, not a short-code service, and not approved for public exposure.

A local Node broker must be started separately on the **same Windows computer** as the CaptureLink app at `http://127.0.0.1:8787`. This patch does not autostart, install a system service, alter the firewall, or expose the broker on a LAN/public interface. The invitation code remains a one-use **43-character secret**.

## Boundaries

- Electron **main** holds the host/guest bearer credentials in `LocalSignalingClient` private fields. No bearer tokens are returned to preload or renderer; the one-use invitation code is intentionally displayed to the host for private sharing.
- Preload permits seven small IPC calls; main checks the **exact top-level CaptureLink renderer** and URL before executing any call. The UX2 offer/answer *must* cross main/renderer memory via IPC because UX2 and the WebRTC peer objects live in the renderer. Neither its SDP nor ICE is shown in the hosted UI, logged, or persisted by this feature.
- The signaling broker requires a *human host click* before it approves a guest. The system does **not** authenticate the real-world guest's identity; the host should approve only people with whom they intentionally shared the code.
- Host permissions are frozen when the local invitation is created. Guest microphone consent is a distinct, initially unchecked control. The watch-only path continues to use UX2's silent microphone behavior.
- A successful signaling response is **not proof** of WebRTC media, Xbox voice, or controller health. Those connections must be verified separately.
- Session revocation calls the broker and also resets locally owned UX2 transports. Broker revocation alone cannot stop an already-established P2P media connection on the remote machine.
- The old **manual UX2** invitation/response and V1.5 separate-transport troubleshooting panels remain available behind the fallback controls.

## Testing

1. Linux/WSL Node (no npm dependencies): `node --test services/signaling/test/signaling.test.mjs services/signaling/test/client.test.mjs services/signaling/test/desktop-bridge.test.mjs` — 37 backend/client tests.
2. Source contract: `node scripts/ux3b1-electron-source-smoke.mjs`.
3. **Windows PowerShell:** `npm.cmd ci`, `npm.cmd run typecheck`, `npm.cmd run build`, the existing UX1/UX2 and voice/recording tests, and `npm.cmd run dev`. Windows build is mandatory because the source audit ZIP contains no `node_modules` or Electron binary.
4. In one PowerShell terminal run `node services/signaling/src/server.mjs`, in another verify `curl.exe http://127.0.0.1:8787/healthz`, and in a third run the Electron application.
5. Test both host and guest on the *same local broker* using separate CaptureLink processes (or the headless 37-case tests). Verify host approval, reject, guest voice consent, watch-only, controller sharing, cancellation, restart, and P2P status before merging.

## Not in this release

- Public DNS/TLS service, persistent broker storage, short human-friendly join codes, multi-device identity authentication, TURN transport relay, crash-recovery reconciliation, mobile deep links, and real cross-network joining.
- No changes to Xbox Remote Play internals, recording, V1.5 controller transport, or voice uplink implementation.

**Acceptance gate:** Verify the actual Electron process on Windows, two local clients, and live Xbox controller/voice functionality before committing/merging. This is an experimental local milestone.
