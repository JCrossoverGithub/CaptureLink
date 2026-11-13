# CaptureLink UX3F-3A — Provider-neutral Windows Online authentication foundation

**Status:** offline implementation candidate, not a public sign-in feature. Owner review required.\
**Accepted baseline:** `80c7a74ac02fd6c1204cd4fdf4453db639dae99b` (PR #19 merged).\
**Scope:** add main-process-only OAuth/PKCE coordinator, Windows `safeStorage`-backed refresh vault, hermetic test suite, protected-source guard and CI.\
**Deployment:** **NONE**. No new Electron IPC, preload export, renderer control, production provider configuration, v2 client selection, `/v2` deployment, server OAuth endpoint, Xbox authentication change or live DigitalOcean modification.

## Rationale and boundaries

The v2 broker merged by UX3F-2 already requires a trusted, issuer/audience/scoped host token from an external verifier. The public Windows app has no such identity provider or login integration. Existing Xbox tokens and pilot admission credentials MUST NOT be repurposed to satisfy the broker's `sessions:create` permission.

UX3F-3A is deliberately **separate from usable UX3F-3 account sign-in**: it implements the main-process primitives without choosing a provider and without enabling any public endpoint. This preserves the worktree's accepted v1, hosted-pilot, manual P2P, existing Xbox login and v2 broker implementations.

The OAuth module `src/main/capturelink-online-auth.mjs` exports `createCaptureLinkOnlineAuth(config)`. All configuration and sensitive callbacks come from trusted Electron main code—not IPC, UI strings, environment variables or CLI flags. It requires:

- Static HTTPS authorization endpoint and issuer; an explicitly provisioned public client ID, `audience`, and `openid sessions:create` scope; an exact `http://127.0.0.1:<port>/capturelink-online/callback` redirect bound by the future main-process loopback listener
- `openBrowser(url)` provided by the future trusted Electron `shell.openExternal` adapter, never an embedded login WebView
- `exchangeCode({code,codeVerifier,redirectUri,clientId})` and `exchangeRefresh({refreshToken,clientId})` that use the identity provider's audited TLS token endpoint, never a renderer/API callback
- `verifyTokens({tokens,issuer,audience,clientId,nonce})`: a **trusted cryptographic verifier**, required to validate provider signature / JWKS / key rotation, issuer, audience, token type, OIDC nonce for initial login, expiry, intended scopes and active-account policy. Its result is rechecked for expected metadata, expiration and scope. Merely decoding a JWT or trusting unverified OAuth JSON is NOT acceptable
- A trusted `vault` with `load/save/clear` for rotating refresh credentials

The coordinator creates unpredictable 32-byte `state`, `nonce` and code verifier; sends PKCE S256 challenge in the system-browser authorization request; rejects cross-origin callbacks, duplicate query fields, unknown fields, wrong/replayed state, wrong optional authorization-response issuer, expired transactions, stale subject and wrong verifier results. Credentials and browser-login URLs do not cross IPC. Calls return only a minimal safe status, with `accessToken()` explicitly **main-process-only** for a later reviewed v2 adapter. All errors are sanitized. Sign-out invalidates pending logins and in-flight exchanges; vault saves and sign-out clearing are serialized. Provider-side refresh revocation and active WebRTC teardown remain separate requirements.

The isolated vault `src/main/capturelink-online-vault.mjs` persists **only refresh material** using Windows Electron `safeStorage` (DPAPI-backed in its supported Windows runtime), never plaintext; its file is separate from the existing Xbox and private-pilot profiles. It validates non-symlink paths, encrypted size and schema, and uses atomic file rotation. The test harness injects a clearly **noncryptographic** mock `safeStorage`, not evidence of real Windows encryption behavior. No production OAuth provider is registered and the app does not yet construct the vault.

## Commands and acceptance

In the isolated UX3F-3 worktree on JPCMAIN WSL, Node >= 24.19.0:

```bash
node --test services/signaling/test/ux3f3-online-auth.test.mjs
node scripts/ux3f3a-source-boundary.mjs
node --test services/signaling/test/*.test.mjs
```

On JPCMAIN Windows PowerShell, after `npm ci` and OpenSSL available to Node as with UX3F-2:

```powershell
node --test services/signaling/test/ux3f3-online-auth.test.mjs
node scripts/ux3f3a-source-boundary.mjs
npm run typecheck
npm run build
```

CI runs the new 25-test file and source boundary on both Windows and Linux. Stage only the six files in this patch, run Git whitespace and a full staged-patch secret scan with a known positive control before any commit. The parent CI suite must continue to pass. No deploy or merge without review.

**Source snapshot preliminary evidence:** the user's 80-file archive SHA-256 is `00801b56ab9ff950b1ae570e4f45e1838eb2d5b4bc8b77d6714ae31051b7f4ec` and matches the uploaded copy. Under container Node v22.16.0, 25 new tests pass and 148 total signaling tests pass (0 failures/skips). These are not substitutes for JPCMAIN Node 24 and Windows/CI verification.

## Required decisions and later UX3F-3B work

1. **Choose host identity provider** and public native client registration (issuer/discovery URL, public client ID, API audience, scopes, redirect policy, token refresh rotation behavior, account disable/revoke semantics, pricing, privacy). The callback currently requires rotating refresh credentials when renewing; choose a provider that supports rotation or explicitly revisit that policy in a separately reviewed change.
2. **Implement trusted Windows loopback callback listener and provider adapter**: bind an ephemeral loopback port *before* opening browser; enforce exact callback URI and one active transaction; exchange codes over pinned HTTPS; validate provider signature/JWKS, nonce/issuer/audience and disabled account; bound timeouts, network retries and failure logging. Never expose code/state/verifier, access or refresh token to the renderer.
3. **Connect main-process public v2 signaling client** without altering the private pilot: host access token in main, host/guest session bearer capabilities only in main, guest invitation/approval via already reviewed renderer-safe IPC, explicit user selection of Online vs manual P2P, fail-closed networking, distinct sign-out (Xbox vs Online), and local teardown of media/control on authorization loss.
4. **Verify staging and production safety**: authenticated host in first/third-party browser, guest without account, revoked host and offline cases, clean browser callback cancellation, Windows DPAPI protection with actual Electron `safeStorage`, side-by-side installed Windows profiles, broker restart semantics, v2 service isolation behind TLS/edge rate limits, TURN decision, end-to-end disconnect and two-machine test. Audit existing npm security advisories before public distribution.

## Explicit non-goals

No self-hosted credential provider, client secret, universal enrollment token, server-side OAuth implementation, public browser token endpoint, manual-pilot import change, backend database, change to `signal.capturelink.io`, persistent v2 sessions, or automatic fallback to the old localhost client.

**Rollback:** revert this add-only foundation and its isolated CI checks. Existing source files are guarded by SHA-256 in `scripts/ux3f3a-source-boundary.mjs` with CRLF normalized, and remain byte-for-byte unchanged in the source archive.

References: [RFC 8252 native apps](https://www.rfc-editor.org/rfc/rfc8252), [RFC 7636 PKCE](https://www.rfc-editor.org/rfc/rfc7636), [RFC 9700 OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700).
