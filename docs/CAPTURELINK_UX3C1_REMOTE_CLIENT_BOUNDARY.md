# UX3c-1 — Remote HTTPS client boundary (implementation handoff)

**Status:** code candidate, **NOT** remote deployment approval.
**Baseline:** `1a10f0d538431cd75f4eb6ba2c56e7ca069bf878` (UX3b1 PR #11).
**Branch:** `feature/ux3c-secure-remote-signaling`.
**Charter:** `docs/CAPTURELINK_UX3C_ARCHITECTURE.md` (user-added file; this patch does not overwrite it).

## Implementation

- `LocalSignalingClient` preserves its `http://127.0.0.1:<port>` restriction, request/response API, error codes, and session lifecycle. Its implementation shares a **non-exported** session core with the new remote client so both use the accepted role and bearer state logic. No remote URL is permitted through the local constructor.
- `RemoteSignalingClient` requires `enabled: true`, a canonical HTTPS DNS origin, an independently approved **exact** origin, and a 43-character base64url per-install admission credential. It rejects userinfo, path/query/fragment, noncanonical URLs, IPs, loopback, LAN aliases and insecure TLS override environment. HTTP redirects are disabled; wrong-origin/redirected responses, invalid content type/JSON and oversized responses are rejected. It uses standard Fetch TLS verification. Headers carry a separate `X-CaptureLink-Admission: Bearer …` from the role/session `Authorization: Bearer …`; secrets never enter URLs or return through the bridge.
- `src/main/ux3c-signaling-client.mjs` holds a **trusted main-process** selector. `src/main/index.ts` calls it with no arguments: **local-only**. There is no remote origin, admission credential, feature toggle, or endpoint setter in renderer IPC or the shipping desktop. To run the remote candidate, a future *reviewed main-process policy* must explicitly supply all remote properties. Never populate approved origin and endpoint from the same untrusted user input: the approved origin must be independent, immutable trusted configuration.
- The existing broker remains bound to loopback, unchanged. The remote HTTP v1 contract is only a candidate; **the UX3a server does not enforce installation admission credentials** and must not be deployed publicly.

## Tests

`node --test services/signaling/test/remote-client.test.mjs` verifies the default local selector, rejected origins/configuration, approved host/guest v1 API flow through a simulated HTTPS fixture, required admission header, lack of redirects, unexpected origin/JSON/body limits, abort/timeout behavior, and a **real default Node Fetch certificate rejection** using an ephemeral self-signed TLS server. The positive fixture's HTTPS origin is simulated: it does not test a real remote TLS server or DNS/routing. No private certificates, admission tokens, or personal secrets are persisted in source; test credentials are generated in memory.

`node scripts/ux3c1-remote-source-smoke.mjs` asserts the main/preload/renderer boundary and local default.

The existing 41 signaling integration tests and 14 UX/voice regression tests must still pass. On JPCMAIN, also run `npm.cmd run typecheck`, `npm.cmd run build`, and both recording regression scripts. The Windows CI workflow includes the two new tests; none of these checks proves remote media connectivity.

## Security / acceptance gates still outstanding

- [ ] Windows TypeScript/build and complete existing regression suite.
- [ ] GitHub CI green on a reviewed PR.
- [ ] UX3c-2: real broker admission authorization, proxy identity and rate limits, resource quotas, restart/revocation behavior, controlled TLS edge.
- [ ] UX3c-3: approved hostname, secure per-install credential provisioning, Electron UI/status copy, outage/reconnect handling, privacy/operations review.
- [ ] UX3c-4: independent JPCMAIN–XLAPTOPX remote video/audio/controller/voice tests plus NAT/TURN acceptance.

**Do not bind `services/signaling/src/server.mjs` to `0.0.0.0`, proxy it publicly, or assume that a successful HTTP invitation proves WebRTC media connected.**
