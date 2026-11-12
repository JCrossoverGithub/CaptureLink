# CaptureLink UX3F-1 — Offline Public Authorization Policy Boundary

**Ticket status:** Proposed first implementation task / owner-review required.\
**Baseline:** `a1a83eab69ac893a47c2a6d977e0106a2c2d34c2`.\
**Target:** New isolated branch/worktree; never edit the deployed VPS or accepted source worktree in place.\
**Objective:** Introduce a deliberately small, provider-neutral **authorization-policy seam** for future `/v2` hosted signaling. No live endpoint, no account UI and no production tokens.

## Rationale

Existing `createPilotAdmission()` accepts **pre-issued installation bearer tokens** and validates every non-health `/v1` request. It cannot be safely made public merely by permitting anonymous registration or removing the admission check: anyone could create arbitrary installations and consume operator resources. A new v2 trust boundary is required; a v1 overhaul risks the already-accepted JPCMAIN/XLAPTOPX pilot.

## Deliverables (this ticket only)

1. Add a **new, standalone server-side policy module** such as `services/signaling/src/public-authorization-policy.mjs`. It accepts an injected **trusted user-token verifier** (fake verifier in tests); it must not choose an OAuth provider, read environment secrets, load credential files or initiate outbound network requests.
2. The policy's principal types are explicit: `anonymous`, `verified-host` (issuer/audience/expiry/subject from trusted verifier), `session-host`, and `session-guest`. No request-supplied `installationId`, IP address, `role`, or arbitrary display name is an authentication proof.
3. Supply simple, tested operation decisions for **create**, **join**, **snapshot**, **approve/reject**, **write/read messages**, **revoke/leave**. Host creation requires verified host identity; invite-based join yields **pending** only; host session and guest session capabilities are separately checked; only an approved guest may exchange signaling envelopes. Keep the policy boundary separate from HTTP parsing and session persistence.
4. Add `services/signaling/test/public-authorization-policy.test.mjs` with hermetic Node tests using generated dummy values and an injected fake verifier. Tests must include the negative cases listed below.
5. Add documentation for how the future versioned service calls this module and how user OAuth differs from existing Xbox authentication. Document exact error categories, not raw token content.
6. Add a source smoke or static regression assertion that **existing** `createSignalingServer`, `createPilotSignalingServer`, `createPilotAdmission`, `RemoteSignalingClient`, pilot runtime and manual UX2 paths are not modified by this ticket.

**Out of scope:** `POST /v2` listener, database, sign-in screens, real IdP integration, account creation, device enrollment, Caddy routing, IAM changes, server deployment, TURN, gameplay media path or npm dependency changes.

## Test requirements

- Invalid/missing/expired/wrong-issuer/wrong-audience host identities cannot create sessions.
- A `subject` taken from unauthenticated JSON is ignored; no user can select a different account ID.
- Only a validated host identity may create and only within its explicit scope.
- Anonymous guest may **request pending join** only when presented with a valid invitation capability; never create/approve/revoke or exchange SDP before approval.
- Host cannot masquerade as a guest by supplying `role: guest`; guest cannot masquerade as host.
- Guest name remains unverified and grants no authority.
- Cross-session token substitution, replay of approval and stale/revoked principal are denied.
- The policy has no URL choices, network access, embedded secrets or global state.
- Existing v1 and enrollment tests still pass unchanged.

## Verification commands — run in the real clean branch (after implementation)

```powershell
node --test services/signaling/test/public-authorization-policy.test.mjs
node --test services/signaling/test/ux3c3d-enrollment.test.mjs
node --test services/signaling/test/pilot-server.test.mjs
node --test services/signaling/test/remote-client.test.mjs
npm.cmd run typecheck
npm.cmd run build
git diff --check
git status --short
```

The intake did not contain all test files, so verify their actual names and run the **repository's full signaling and Windows regression suites** before a PR. Any failing test must be investigated; do not weaken tests to obtain green.

## Engineer start gate

1. Confirm baseline and clean worktree: `git rev-parse HEAD`, `git status --short`.
2. Create a new worktree/branch at the known baseline. Never force-switch, reset or clean an occupied working tree.
3. Read complete current test tree, `package-lock.json`, workflows and source references; diff them against UX3F-0 intake.
4. Record a short interface design and denial-by-default test matrix *before code*; avoid a speculative implementation of OAuth JWT validation.
5. Implement and run hermetic tests; inspect diff for tokens/secrets/localhost or remote-mode regressions; run gitleaks where configured.
6. Submit a reviewable PR. **Do not deploy or alter live `/v1` behavior.**

## Definition of done

- New policy module and offline tests are green for both allow and deny paths.
- The policy can be invoked from a future v2 router without assuming the existing pilot's static installation admission.
- A public host identity is verified by an injected verifier—not self-asserted by the client.
- The v1 pilot is behaviorally and source-wise untouched; manual P2P is untouched.
- No credentials in Git, artifacts, tests, error messages or logs.
- Reviewer can see explicit evidence from regression output and changed-file inventory.

**This task does not grant permission for public auth traffic, live DNS/TLS changes, or unlimited server access.**
