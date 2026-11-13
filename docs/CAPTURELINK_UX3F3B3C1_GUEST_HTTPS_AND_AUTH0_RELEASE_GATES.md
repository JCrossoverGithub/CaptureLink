# CaptureLink UX3F-3B3C — Guest HTTPS integration and Auth0 production-release gates

**Status:** first offline-only engineering candidate (`UX3F-3B3C1`); operator acceptance required. No production rollout or new user-facing feature is approved.
**Exact accepted parent:** `6229b04647ddfa0fb59c641a879b8fdaa8e95ecb` (PR #24 squash merge, 2026-11-13).
**Expected branch:** `feature/ux3f3b3c-guest-invitations`.
**Source intake:** `CaptureLink_UX3F3B3C_Source_Intake.zip`, SHA-256 `b01aca2baaae69fe94c293e603cdb3d6ce3cdf9478787be2ea74cd1cd4cf6558`.

## 1. Architectural findings from the accepted source

- `src/main/capturelink-online-electron.mjs` authenticates the host with the development Auth0 tenant and owns the encrypted-refresh and in-memory access-token lifecycles. UX3F-3B3B added **main-only** `createHostSession` / `endHostSession` / `hostingStatus`, without corresponding Electron IPC.
- `src/main/capturelink-online-https-host-candidate.mjs` can create/revoke only a **host** session on exactly `https://signal.capturelink.test`. It does not poll guests or send SDP/ICE. Do **not** silently repurpose it as the full session bridge.
- `src/main/hosted-signaling-bridge.mjs`, `src/preload/index.ts` and `src/renderer/src/hosted-session-ux.ts` already support host approval, anonymous guest name, and manual/P2P or private-pilot SDP/ICE delivery, but **only** via the existing local/private-pilot client factory. The code currently has no approved public-v2 routing.
- `src/main/capturelink-online-v2-client.mjs` has the full v2 API shape but intentionally accepts **loopback HTTP only** for earlier isolated integration tests.
- `services/signaling/src/public-v2-server.mjs` is an **in-memory, 127.0.0.1-only test broker** with injected `verifyHostAccessToken` and `isHostActive`. There is no production account database, persistent/distributed session state, reverse-proxy trust model or operator lifecycle. It must not be exposed by merely opening a firewall.
- A broker revocation response is not proof an already-established peer connection has stopped. Only the **renderer coordinator's synchronous local transport reset** can begin stopping media/control; remote shutdown needs separate two-device testing.

## 2. UX3F-3B3C1 — intentionally narrow candidate (this patch)

**Additive files only:** a main-only HTTPS v2 host/anonymous-guest candidate plus declarations, local regression tests, an immutable source guard, this document and a PR CI workflow. Existing Electron authentication, preload, renderer, local/pilot clients, public broker and main entry point are unchanged.

- Exact `.test` HTTPS origin is enforced even if caller provides another `origin`; redirect and final URL mismatch are refused.
- Only **host create** sends the trusted Auth0 token. **Guest join** sends a one-use invitation and an explicitly unverified display name with **no** authentication header.
- Host approval/rejection, session snapshot, SDP/ICE signaling envelopes and revocation/leave are exercised against the already accepted v2 policy and broker, through a hermetic test-only HTTPS-to-loopback adapter.
- Session bearer tokens stay private in the main-only factory closure; public methods return invite code, unverified display name, permission snapshot, and sanitized SDP envelopes only. There is no IPC call site.
- Validate role, guest approval, direction, permission schema, envelope session identity, response size, media message cursor and cancellation. Reject mismatched host/guest permissions. Clear local authority **before** best-effort remote revocation/leave.
- If a remote join/create succeeds but the HTTP response is lost, or remote cleanup fails, remote authority may survive until server policy/TTL. This patch cannot claim guaranteed remote revocation.
- Test-only synthetic Auth0 keys and broker are created per fixture. No live tenant or public signaling endpoint is contacted.

**Explicit exclusions:** no Auth0 dashboard changes; no new Electron IPC, renderer UI, public/production hostname, `signal.capturelink.io` calls, real Xbox/voice/controller stream, TURN, deployment, or desktop packaging activation. The existing 3B3B main host candidate remains the active (dev-only) hostFactory and is **not** automatically switched to this new client.

## 3. Proposed implementation sequence — each stage needs independent acceptance

- [ ] **3B3C1: main-only HTTPS v2 host/guest protocol candidate.** This patch: offline suite + boundary guard + Windows typecheck/build + Gitleaks + draft PR/CI. No live login, no UI changes.
- [ ] **3B3C2: explicit Electron main integration and safe IPC contract.** Decide whether to adopt a single role-scoped session client behind the existing `HostedSignalingBridge` or a separate `OnlineSignalingBridge`. Do **not** let the 3B3B host session and the new client each create a separate live host invitation. Preserve no-token IPC, role isolation, exact caller/frame checks, and explicit manual/pilot mode. Guest authorization should not require the host's Auth0 token.
- [ ] **3B3C3: renderer invitation/approval/SDP and local teardown.** Explicit “CaptureLink Online” selection; display unverified guest names and permissions, never expose session bearer/JWT/refresh token; fail closed without silent manual fallback. Reuse current UX2 coordinator only after a dedicated teardown/race review, including Xbox, microphone and controller permissions.
- [ ] **Staging/production readiness:** independently provision a nonpublic HTTPS staging broker with real token verifier and persistent account status, trusted proxy, quotas, cancellation, privacy, telemetry and rollback; perform two-device/two-network tests before public service activation.

## 4. Production-grade Auth0 acceptance (separate tracked release gate)

**Current verified code is development-only.** `capturelink-online-dev-config.mjs` pins a development Auth0 domain, public Native Application Client ID, API audience `https://signal.capturelink.io/v2`, and loopback redirect `http://127.0.0.1:49152/capturelink-online/callback`. `src/main/index.ts` enables it only in an unpackaged, normal-profile Windows app with working `safeStorage`. No packaged production Auth0 client exists in this accepted source. Do **not** flip `app.isPackaged` gates or retarget the development tenant as a shortcut.

### Brand and identity experience

- [ ] Create and verify separate development/staging/production identity environments, owner accounts, least-privileged Auth0 administrator roles and configuration change control.
- [ ] Name the production Native application **“CaptureLink Desktop”** and retain **“CaptureLink Desktop Dev”** for development; verify the actual app display name, tenant branding and consent screen rather than assuming changing an app label changes Universal Login branding.
- [ ] Brand **New Universal Login** with official CaptureLink logo, colors, accessible contrast, legal/privacy links, localized/error/help copy, consistent signup and password-recovery experience, and mobile-size layouts. Verify per-app logo display behavior if multiple apps share a tenant.
- [ ] Consider an owned and verified authentication domain such as **`login.capturelink.io`** (proposal only; not configured). Keep **`signal.capturelink.io`** for signaling. Custom-domain rollout changes issuer, authorization/JWKS/token endpoints; validate every issuer/audience/JWKS pin on client and server before switching anything. Verify certificates, CAA/DNS and rollback.
- [ ] Review the Google social connection's own OAuth app name/branding, authorized redirect URLs, consent/verification requirements, account linking, and identity-provider error flows. A development social connection is not evidence that the public Google consent screen is production-branded.

### Routing and native callback policy

- [ ] Document the exact Native App **Allowed Callback URLs** separately from **Allowed Logout URLs** and from the **Application Login URI**. The current loopback callback is HTTP on 127.0.0.1 by design; it is not a public site endpoint. Verify Auth0's exact URI matching for path, scheme and port; use an allowlist rather than redirects inferred from user input.
- [ ] Decide the final native callback strategy (fixed/ephemeral loopback port or registered application URI) against Auth0 provider behavior and the target packaged/code-signed Windows distribution. Test local-port hijack attempts, concurrent sign-ins, malicious `state`/nonce, interrupted login, browser back and retry.
- [ ] If an HTTPS Application Login URI or default login route is enabled, it must launch a **new valid authorization flow** safely; do not misconfigure it as the OAuth callback or make a landing page automatically pass codes/tokens to arbitrary URLs.
- [ ] Preserve `capturelink.io` website's independent marketing and security boundaries. Avoid wildcard callbacks and unapproved open redirects.

### Tokens, sessions, abuse and operations

- [ ] Native/public client + authorization-code PKCE S256; **never** embed a client secret in the distributed Electron app. Confirm offline access, audience, RS256/JWKS, `sessions:create` scope and RBAC permissions; production API access must be verified server-side.
- [ ] Rotating refresh-token vault uses Windows encryption, atomic replacement and serialized renewals; configure and test idle/absolute expiry, rotation reuse detection, recovery from replay or revoked refresh token, and multiple installed instances. Never log token material.
- [ ] Implement provider-side refresh-token revocation, **server-side current-account enforcement**, operator disable/revoke session endpoints and short access-token lifetime. Local sign-out alone **does not** invalidate an already issued JWT or guarantee broker/media shutdown.
- [ ] Establish tenant user/social-login security settings, email verification policy, account recovery, brute-force/bot protection, risk-based MFA as appropriate, sign-in logs/alerts, abuse budgets and incident response, plus transparency about collected signaling metadata and retention.
- [ ] Review 45 reported npm advisories (41 moderate, 4 high) by reachable package and runtime impact; document remediation separately before packaging. Require signed desktop binaries, trusted updates, staging rollback and operator approval.

**Auth0 release decision:** no production sign-in or invitation cutover until the exact production tenant/app/API/domain, redirect/logout allowlists, Google login display, broker account authority, signing/packaging posture and failure semantics are independently verified. A design checklist is **not** proof of dashboard configuration.

## 5. Acceptance and stop conditions for this patch

**Operator local acceptance (2026-11-13; no deployment):**

- [x] Original archive SHA-256 and accepted `main` parent verified; guarded installer added only the six manifest-listed files.
- [x] WSL Linux Node 24 complete signaling suite: **182 passed, 0 failed, 0 skipped** (including six UX3F-3B3C1 tests).
- [x] Windows Node 24 complete signaling suite: **176 passed, 0 failed, 6 expected platform skips**, with temporary Git for Windows OpenSSL PATH; TypeScript check and Electron build passed.
- [x] All five historical UX3F source-boundary guards and the new UX3F-3B3C1 guard passed.
- [x] Exact six-file staged inventory, protected-source hashes, whitespace check, staged Gitleaks 8.30.1 (**no leaks**) and independent diff review passed.
- [ ] New UX3F-3B3C1 GitHub workflow and existing CaptureLink CI pass against the **exact draft PR head**; verify no new routes, IPC or production deployment before merge.

**Review provenance:** the independently reconstructed six-file staged diff matches the operator's reported SHA-256 `8def9452ff77d3dbee7d5f01f5722591af9d54d12068e8fdd0f8556edda593e6` before this documentation-only reconciliation. Earlier off-machine Node 22.16.0 preliminary tests passed 182/182 but do not substitute for the completed Node 24 operator gates. Auth0 production dashboard configuration was not inspected or changed; all production identity, revocation and deployment gates above remain open.

## References for operational follow-up

- [Auth0 Universal Login customization](https://support.auth0.com/center/s/article/universal-login-page-customization)
- [Auth0 native callback exact match](https://support.auth0.com/center/s/article/Callback-URL-Mismatch-Error-Is-Not-in-the-List-of-Allowed-Callback-URLs)
- [Auth0 refresh token rotation/session management](https://support.auth0.com/center/s/article/Refresh-token-and-session-management)
- [Auth0 custom domain provisioning](https://support.auth0.com/center/s/article/troubleshoot-auth0-custom-domains-issues)
- [Auth0 default login route](https://support.auth0.com/center/s/article/Users-occasionally-see-an-error-You-may-have-pressed-the-back-button)
- [OAuth for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252)
