# CaptureLink UX3F-3B1 — Auth0 adapter and isolated Windows integration seam

**Status:** candidate implementation, offline security acceptance only; **NOT a working user-facing sign-in button**.\
**Accepted baseline:** `0a2d80f7886027e1d7c54856f08f1acd5c626b15` (UX3F-3A merged).\
**Approved provider:** Auth0, development tenant.\
**Deployment:** NONE. No DigitalOcean, Caddy, public URL, v1 broker, Xbox auth, Electron `index.ts`, preload or renderer modifications.

## Why this is a separate, guarded substage

Auth0 has been chosen and a Native application and custom API created. UX3F-3A's provider-neutral coordinator did not request the custom API audience, lacked a concrete JWKS/token adapter, and had no browser callback listener or v2 client. UX3F-3B1 supplies those independent, testable pieces without switching production traffic or prematurely extending privileged IPC. UX3F-3B2 must still wire the actual Electron main process, user-selected mode and renderer-safe status/commands, and execute a real Auth0 tenant test with the owner's development account.

## New modules and contracts

- `src/main/capturelink-auth0-provider.mjs`: `createCaptureLinkAuth0Provider({domain,clientId,audience,fetchImpl?,now?})`. The Auth0 domain, public client ID and API audience are **trusted non-secret configuration**. The adapter exchanges authorization code + PKCE verifier and rotating refresh credentials using the provider's pinned HTTPS `/oauth/token`; it requests `openid offline_access sessions:create`. JWT signature validation uses a bounded, cached HTTPS `/.well-known/jwks.json` request, 2048-bit-or-larger RSA key, RS256-only, trusted issuer, intended audience, `azp` client, `exp`/`iat`/`nbf`, subject, `scope`, and the Auth0 RBAC `permissions` array. Initial ID token is signature-verified and bound to the PKCE transaction's nonce. No use of a client secret, unsigned JWT, unverified `jwt.decode`, arbitrary token URLs or browser renderer code.
- `src/main/capturelink-online-auth.mjs`: narrow update to include OAuth `audience` in the browser authorization request and accept Auth0's standards-conforming issuer value with trailing slash in the optional authorization response `iss`, without weakening issuer equivalence.
- `src/main/capturelink-online-loopback.mjs`: `createCaptureLinkOnlineLoopback({port,onRedirect,timeoutMs?})` binds only IPv4 `127.0.0.1`, before opening the browser. It enforces exact Host and callback path, rejects request bodies, Origin and bearer headers, consumes a callback once, never logs token/code/state, and returns only generic human-readable text. Call `.listen()` **before** `auth.beginLogin()`; always `.close()` in a `finally` or on sign-out. `port:0` is exclusively for hermetic tests; the real Auth0 Native App **requires one fixed, explicitly registered port**, for example `49152`, with the exact URL `http://127.0.0.1:49152/capturelink-online/callback`. If this port is occupied, fail without opening the browser; never silently switch ports. A malicious same-machine process still creates a localhost hijacking threat. Auth0 may present additional consent/confirmation for loopback callbacks.
- `src/main/capturelink-online-v2-client.mjs`: `createLocalV2SignalingClient({origin,accessToken,fetchImpl?})` is main-process-only and intentionally accepts **loopback HTTP only**. It reads host OAuth access only at host session creation, stores host/guest capability only in closure, exposes only one-use invitation and renderer-safe state, enforces approval and signaling direction with server authorization, bounds response sizes and cancels network requests. It can satisfy the current `HostedSignalingBridge` client interface in a future opt-in mode. It is NOT a public HTTPS client; that requires strict origin pinning/TLS and a second reviewed implementation.
- `services/signaling/test/ux3f3b-auth0-integration.test.mjs`: entirely local tests sign synthetic RS256 Auth0-shaped JWTs using an ephemeral test key, use a fake `/oauth/token` and JWKS fetch (no real provider or internet), run a real loopback callback and v2 server, and verify host/anonymous-guest approval/offer/answer and failure conditions. Test fixtures are not authentication or production credentials.
- `scripts/ux3f3b1-source-boundary.mjs`: canonical-LF SHA-256 guard of accepted Xbox, renderer, preload, vault, pilot, v1 and v2 server source. CI runs the new tests and guard on Windows and Linux.

## Security and operational limits

1. `verifyHostAccessToken` cryptographically validates the signed JWT but **does not independently prove an account is currently active**. The separate broker `isHostActive(subject)` dependency MUST remain a trusted, fail-closed server-side account/revocation authority; **do not** supply a constant `true` in public production. JWTs are bearer credentials until expiry and cannot be instantly invalidated by client logout alone. App sign-out MUST tear down any hosted sessions and media locally, and revoke the refresh token when feasible. Auth0's `/oauth/revoke` is a separately reviewed integration step.
2. Auth0 token/refresh rotation requires Native app **Token Endpoint Authentication Method: None**, Authorization Code and Refresh Token grants, Refresh Token Rotation enabled, API **Allow Offline Access** enabled, appropriate API RBAC / `sessions:create` role and application User-Delegated Access. No client secret is used.
3. No code in this packet touches Xbox authentication, private-pilot enrollment/credentials, DigitalOcean, Caddy, `/v1` APIs or public callback URL. No public auth UI or browser launch is invoked by the installed desktop yet. Existing `CaptureLink Online` credential vault is unchanged; its real Electron `safeStorage` operation still needs a native Windows verification.
4. No manual P2P fallback occurs automatically. No TURN, production proxy IP rules, durable v2 session storage or multi-instance transaction safety is provided. The isolated v2 broker still resets session/invitation capabilities on restart. Relay media and disconnect/teardown remain later acceptance gates.
5. Expected test count in uploaded snapshot: 148 existing signaling cases plus the new offline integration cases. They are **not** evidence of actual Auth0 developer-tenant sign-in, Windows browser callback registration, peer media connectivity, or successful production deployment.
6. Existing dependency advisories (45 in prior Windows npm audit) remain a release-readiness issue, outside this auth seam.

## Import, acceptance and stop gates

Import only the exact documented paths, after baseline SHA-256 verification, and never overwrite unexpected files. Test on JPCMAIN WSL Node >=24.19.0:

```
node --test services/signaling/test/ux3f3-online-auth.test.mjs services/signaling/test/ux3f3b-auth0-integration.test.mjs
node scripts/ux3f2-source-boundary.mjs
node scripts/ux3f3a-source-boundary.mjs
node scripts/ux3f3b1-source-boundary.mjs
node --test services/signaling/test/*.test.mjs
```

On JPCMAIN Windows, re-run the auth tests, full signaling regression (5 Linux-only skips), new and existing guards, `npm ci`, `npm run typecheck`, and `npm run build`. Stage and review exact paths; run Git whitespace check, Gitleaks with synthetic-token positive control, then draft PR / CI review. No commit, merge or deployment on the basis of off-machine tests alone.

**Next work:** UX3F-3B2 (explicit dev-only Electron main/preload/renderer wiring, Auth0 Native app exact loopback callback registration, vault instantiation from `app.getPath('userData')`, real developer account/browser sign-in, broker staging client pinned HTTPS, local media teardown and account revocation handling). Do not silently treat this seam as complete UX3F-3B.

References: [OAuth native apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252), [Auth0 native callback documentation](https://support.auth0.com/center/s/article/Callback-URL-Mismatch-Error-Is-Not-in-the-List-of-Allowed-Callback-URLs), [Auth0 RBAC permission in access JWT](https://support.auth0.com/center/s/article/Adding-RBAC-Permissions-to-Access-Tokens), [Auth0 refresh token rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation).
