# CaptureLink UX3a — Local signaling service prototype

This is a **backend-only, localhost-only proof of concept**, not the finished one-click feature. It is designed to relay *existing* `CAPTURELINK-SESSION-V1:` unified invite/response envelopes after **explicit host approval**. It does not start WebRTC, open an Xbox connection, request microphone access, or implement the desktop UI. The successful UX2a manual path remains unchanged.

## Run on Windows PowerShell or WSL Bash

Requires Node.js 24+. No npm install or package updates required.

```sh
node --test services/signaling/test/signaling.test.mjs
node services/signaling/src/server.mjs
```

Health check: `http://127.0.0.1:8787/healthz` (server binds loopback only).

**Do not change the listening address to `0.0.0.0` or expose port 8787 to the Internet.** External access, TLS, abuse defenses, persistence/availability, deployment, and secure desktop integration need separate review. Requests use ephemeral in-memory state; restarting drops all sessions.

## HTTP contract (version 1)

Requests/responses are JSON. Host/guest access tokens are 256-bit bearer capabilities; **never** place them in URLs, telemetry, screenshots or logs. Do not log signaling payloads: they can include SDP/ICE and local IP information.

| Actor | Method | Path | Body / purpose |
| --- | --- | --- | --- |
| Anyone (local) | POST | `/v1/sessions` | `{ "permissions": {"watch":true,"voice":true,"controller":true,"controllerMode":"shared"} }`; returns `sessionId`, `hostToken`, `inviteCode`, expiry timestamps |
| Invite holder | POST | `/v1/join` | `{ "inviteCode": "..." }`; returns `sessionId`, `guestId`, `guestToken`, status `pending` |
| Host | GET | `/v1/sessions/:id` | Bearer `hostToken`; inspect pending request, permissions and lifecycle |
| Guest | GET | `/v1/sessions/:id` | Bearer `guestToken`; inspect approval status |
| Host | POST | `/v1/sessions/:id/approve` | `{ "guestId": "..." }`; only pending matching request accepted |
| Host | POST | `/v1/sessions/:id/reject` | `{ "guestId": "..." }` |
| Host | POST | `/v1/sessions/:id/messages` | `{ "kind":"invite", "payload":"CAPTURELINK-SESSION-V1:..." }` |
| Guest | POST | `/v1/sessions/:id/messages` | `{ "kind":"response", "payload":"CAPTURELINK-SESSION-V1:..." }` |
| Both | GET | `/v1/sessions/:id/messages?after=0` | Returns only messages addressed to authenticated role; increment cursor |
| Host | POST | `/v1/sessions/:id/revoke` | Ends and deletes signaling session |
| Guest | POST | `/v1/sessions/:id/leave` | Leaves and deletes signaling session |

The `Authorization` header is `Bearer <hostToken>` or `Bearer <guestToken>`. Invitation code is a random **43-character secret**, not a guessable six-digit PIN. A future user-friendly short-code flow requires additional rate-limiting and abuse controls.

### Client flow

1. Host creates session with permissions and shares invitation code through a trusted channel.
2. Guest posts invitation code; receives pending guest token; waits. **No signaling before approval.**
3. Host sees guest ID and explicitly approves.
4. Host uses existing UX2 `UnifiedSessionCoordinator.createInvitation(...)` to generate legacy unified offer; posts it as `kind:invite`.
5. Guest polls, receives offer, requests *local* microphone consent before `joinInvitation(...)` and posts `kind:response`.
6. Host polls, receives response, calls existing `acceptResponse(...)`, then verifies WebRTC connectivity separately.
7. Disconnect/revoke should stop the actual peer transports in the desktop integration; the backend **cannot** force already established P2P channels to shut down.

The two secret-bearing client tokens identify *session capabilities*, **not real-world user identities**. No authentication of Microsoft/Xbox identity or mutual cryptographic binding of the remote WebRTC peer is implemented here.

## Safety and limitations

- Loopback binding, no public deployment configuration and no CORS wildcard.
- One-use invitation; 15-minute invite lifetime and 3-hour session cap; one guest at a time.
- Explicit host approval and role-restricted message directions; no implicit microphone consent.
- Server checks UX2 unified envelope version, session ID, declared capabilities, transport set, sizes, timestamps and reply binding. It still does not verify opaque legacy SDP and candidate details; desktop adapters do that.
- Bearer token digests are stored in process memory; no log of tokens, message content or SDP/ICE.
- Per-IP and per-code throttling, limited sessions, size caps; these are prototype defenses, **not production-scale DDoS protection**.
- Signaling messages are intentionally retained **in memory** for polling. They disappear on process shutdown, session termination or expiry.
- Service is not durable, highly available, authenticated to an external identity provider, or ready for Internet exposure. TLS termination, threat modeling, monitoring, replay/reconnect semantics, origin rules, and isolation need implementation before deployment.

## Local integration gate

Run the full 17-case backend suite, then inspect endpoint/permission contract and build a desktop adapter on the **new** UX3 branch. Until that adapter passes both PC/Xbox acceptance tests, the UX2a manual workflow is the expected production fallback.
