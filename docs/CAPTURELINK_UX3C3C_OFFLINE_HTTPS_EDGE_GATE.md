# CaptureLink UX3c-3c — Offline HTTPS edge acceptance gate

**Status:** engineering test candidate ONLY. The host and guest desktop remote clients are NOT enabled, and no public hostname, DNS, edge server, firewall, credential delivery, or deploy action has been approved or created.

**Accepted baseline:** `058211226c78a761ab0068e7f4156664494e0566` (PR #15).  **Branch:** `feature/ux3c3c-controlled-https-pilot`.

## Choice

CaptureLink uses **Option C: a lightweight hosted signaling service**, with WebRTC attempting direct P2P transport for game media, microphone, and controller data. A TURN service may be necessary for some NAT combinations. The hosted broker neither receives Xbox authentication nor transcodes gameplay media. The existing manual UX2 invitation and UX3b1 localhost signaling remain available.

Do not infer successful WebRTC media streaming from successful HTTPS signaling. Signal loss and revocation depend on cooperative desktop clients (UX3c-3b), and server-side revoke alone cannot terminate a malicious or disconnected WebRTC peer.

## What this patch proves

- An actual ephemeral TLS listener, confined to `127.0.0.1`, can proxy a real private-pilot broker's HTTP requests.
- Test-only TLS trust is explicit and scoped to the test fixture; a client without test-root trust rejects the certificate. No production TLS validation bypass or global trust modification is installed.
- Separate random host/guest installation admission tokens are needed. A host creates a one-use invitation, a guest requests approval, the host approves, and revoking the host session ends broker authorization.
- The edge strips forwarded-IP headers before forwarding to the localhost broker; the broker independently rejects forwarded-IP headers if any reach it. The test edge hides `/healthz` from the outer listener.
- The Node broker, even in pilot mode, only binds loopback. The shipped Electron main still constructs the original local client. The `.invalid` Caddyfile is review-only.

The test TLS adapter uses Node `https.request` with an *explicit, ephemeral test CA* to connect to its loopback fixture. It is **not** the shipped Electron Fetch implementation, is **not** a live Caddy validation, and does **not** establish internet reachability, WebRTC ICE success, certificate issuance, DNS, or secure client credential storage.

## Validate (Ubuntu / WSL Linux)

Requires Node 24.x and OpenSSL available as `openssl` on `PATH`:

```bash
node --test services/signaling/test/ux3c3c-https-edge.test.mjs
node scripts/ux3c3c-edge-source-smoke.mjs
node --test services/signaling/test/pilot-runtime.test.mjs services/signaling/test/pilot-server.test.mjs
```

Run Windows `npm ci`, `npm run typecheck`, `npm run build`, signaling/UX3/voice regression scripts, and recording tests before opening a PR. Linux CI includes the offline HTTPS integration and no-exposure source gate. Existing CI checks remain unchanged.

## Before deploying a real hosted pilot

1. Select an isolated host, **dedicated DNS hostname**, TLS certificate automation and a firewall that makes the Node port unreachable externally. Independently review and adapt the Caddyfile to the deployed Caddy version; verify incoming forward headers are actually stripped. [Caddy reverse_proxy docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
2. Add an audited, main-process-only secure Windows admission-credential enrollment and rotation procedure (e.g. Electron safeStorage backed by platform protection, with explicit failure handling). **Do not** copy plaintext tokens to a renderer, version control, installer binary, screenshot or support log. The server's pilot-provisioning tool creates **server-side** files only.
3. Establish an explicit host/guest installation allowlist and operator revoke/rotation process. The current runtime loads installation credentials at startup; in-process revocation is not yet a live administrative control plane. Restart clears broker sessions and may interrupt all participants.
4. Review public edge abuse protection, logging/redaction, availability, systemd/container identity and least privilege, backups of configuration **without accidental credential export**, patching and the existing npm dependency advisories.
5. Require physical JPCMAIN ↔ XLAPTOPX acceptance on distinct networks: consent, invitation, approval, video/audio, controller in shared and Player 2 modes, guest microphone, denial, cancellation and broker-unavailable behavior. Test ICE diagnostics and add TURN only if required.
6. Get explicit operator authorization before enabling any publicly reachable listener or real client remote mode. Live remote authentication and media tests must be executed separately from this offline test.

**No new outbound network use, cloud resources, DNS changes, provisioned secrets, or public listener is introduced by this patch.**
