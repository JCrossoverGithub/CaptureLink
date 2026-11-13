# CaptureLink UX3F-3B3A — Offline HTTPS host-creation candidate

**Status:** first implementation candidate, not merged and not approved for any public use.
**Accepted parent commit:** `dde32013d32bc4677a4d322d41fc23bea72ad2dc` (PR #22).
**Target branch:** `feature/ux3f3b3-online-hosting`.
**No production deployment, no Electron UI activation, no real public v2 endpoint.**

## What is implemented

- `src/main/capturelink-online-https-host-candidate.mjs` provides a narrowly scoped HTTPS-only host-creation candidate. An authorized caller supplies a previously validated Auth0 access-token accessor, which stays in trusted main-process memory. The host's broker capability stays inside the closure. Only the one-use invitation and expiry are returned.
- The endpoint is **exactly** `https://signal.capturelink.test` (reserved `.test` hostname), with no path/query/fragment/credentials/port/alternate origin. There is no `signal.capturelink.io` wiring, renderer IPC, DNS override, proxy configuration or outbound network requirement in production code.
- The transport rejects redirects, unexpected response URLs, non-JSON, oversized or malformed results; sends no cookies or pilot admission credentials; uses request timeouts and abort signals; never silently retries with HTTP or a local client.
- Host create validates the broker-issued session ID, invite and host capabilities, and bounded expirations. A single in-flight creation is allowed. `end()` drops local host authority and attempts a best-effort authenticated broker revocation.
- The hermetic test path uses synthetic, in-memory RS256 Auth0 JWT/JWKS, the accepted loopback `/v2` broker, a disposable test-only HTTPS edge with an ephemeral certificate, and a trusted test transport adapter. Both certificate acceptance when explicitly trusted and rejection when untrusted are exercised.
- An additive GitHub workflow runs the target tests on Node 24 Ubuntu, without modifying previous CI, broker, Xbox, pilot, Auth0 app, hosted bridge or renderer files.

## Evidence in source intake workspace

- Archive SHA-256: `9393eda775ef7169cb219ffca2d52aed5074d27c53575078ddc3f34d7821bb4e`.
- Node v22.16.0 (local archive sandbox): 49 selected tests passed (43 accepted policy/broker tests + 6 new host candidate tests), 0 failed, 0 skipped.
- **Not yet verified in the operator's Windows/WSL checkout:** full Linux suite, Windows typecheck/build, legacy source guards, Gitleaks, GitHub CI or real Electron integration. The actual target runtime is Node 24.x.

## Explicit outstanding engineering work

1. This stage does **not** connect Electron's Auth0 controller to a hosted-session bridge: `createCaptureLinkOnlineElectron` does not currently expose any trusted main-only token accessor. Do not make that accessor available through preload, IPC or renderer.
2. The host candidate currently implements **create and end only**. Guest join, polling, host approval, offer/answer exchange and WebRTC are **not** connected to it. These require UX3F-3B3B.
3. Server-side `isHostActive` is a **trusted injected test callback** in this stage; no production account-active source, revocation subscriber or persistence exists. Real account disabling/revocation and session/media termination require a separate explicit design and tests.
4. A real remote origin and TLS edge pin, public request protections, operational quotas, restart semantics and registration/revocation policy need a separately reviewed deployment gate. No public `/v2` or existing `/v1` pilot is changed here.
5. The developer must run the full existing regression suite and all historical UX3F boundaries after applying the patch in the complete repository. The previously accepted hash-pinned sources have intentionally **not** changed.
6. The TLS test uses `openssl` at test time to create a short-lived key/certificate under the OS temp directory; it never adds a certificate, key, or other credentials to Git.

## Local acceptance checklist (WSL, branch root)

- [ ] Verify HEAD is the accepted parent commit and the worktree is initially clean.
- [ ] Apply the exact four new files from the reviewed bundle; no existing files overwritten.
- [ ] `node --test services/signaling/test/public-authorization-policy.test.mjs services/signaling/test/public-v2-server.test.mjs services/signaling/test/ux3f3b3a-https-host-candidate.test.mjs` — target **49/49**.
- [ ] `node --test services/signaling/test/*.test.mjs` — expect **170 cases** on Linux if the accepted suite remains 164 and the 6 new cases run; investigate any mismatch, never assume the count.
- [ ] All five historical UX3F guards still pass; `git diff --check` and the staged Gitleaks scan pass.
- [ ] Windows Node 24 test/build and GitHub CI pass before PR merge.
- [ ] Independent source-diff review confirms no renderer bearer exposure and no production/pilot modifications.

**Merge approval:** NOT GRANTED by creating this bundle or by passing only the selected tests.
