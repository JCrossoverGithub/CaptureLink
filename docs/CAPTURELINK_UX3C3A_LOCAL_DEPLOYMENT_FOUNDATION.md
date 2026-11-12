# CaptureLink UX3c-3a — Local operator deployment foundation

**Status:** gated engineering candidate; **NOT approved for external deployment or production traffic**.
**Baseline:** `38d52df198617e4a65072f00b597922a86b0a382` (UX3c-2 / PR #13).
**Worktree:** `feature/ux3c3-private-pilot-deployment`.

## Scope and hard boundaries

The accepted `node services/signaling/src/server.mjs` CLI remains unchanged as the UX3b1 **localhost prototype**. The new `services/signaling/src/pilot-runtime.mjs` is an **opt-in, Linux-only** runtime for the existing UX3c-2 `createPilotSignalingServer()` factory. It binds exclusively to `127.0.0.1` and requires a privately permissioned JSON configuration file. There is no systemd unit, publicly approved DNS, TLS listener, firewall change, container, deployment action, reverse-proxy installation or desktop feature-flag activation in this patch. There is **no live remote hostname**.

The Caddy example in `ops/Caddyfile.private-pilot.example` uses the reserved `.invalid` TLD. It is review material only. **Do not copy to an active server or replace the hostname until a separate deployment security and operations review approves it.** The edge must limit unauthenticated traffic and remove every forwarded-IP header before proxying. Caddy automatically creates `X-Forwarded-*` headers unless the `header_up` removal rules are included; review the final adapted Caddy configuration and validate it with the installed Caddy version. [Caddy reverse_proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Linux-only local provisioning (not deployment)

This is an optional localhost demonstration, not required to run automated tests. Run under a dedicated **unprivileged Linux service account** on a dedicated Linux machine or WSL's **Linux filesystem**, never as root for deployment, and never inside a Git worktree, Windows Downloads folder, or `/mnt/c`. Secrets must stay out of stdout, shell history, GitHub, Electron renderer bundles, screenshots, telemetry and logs.

```bash
# Choose a NEW path on the Linux filesystem outside every Git worktree.
install -d -m 700 "$HOME/.local/share"
node scripts/ux3c3a-provision.mjs "$HOME/.local/share/capturelink-pilot-ux3c3a-private"

# Check permissions and keep all three files private.
ls -ld "$HOME/.local/share/capturelink-pilot-ux3c3a-private"
ls -l "$HOME/.local/share/capturelink-pilot-ux3c3a-private"

# Only the path is placed in an environment variable, never a credential.
export CAPTURELINK_PILOT_CONFIG_PATH="$HOME/.local/share/capturelink-pilot-ux3c3a-private/pilot.config.json"
node services/signaling/src/pilot-runtime.mjs
```

The provisioning tool refuses an existing directory and creates a `0700` folder containing `pilot.config.json`, `host.admission` and `guest.admission`, each `0600`. Separate 32-byte random base64url tokens are issued for host and guest installations. The pilot configuration contains BOTH secrets; treat that file as highly sensitive. Never send the configuration or token files to ChatGPT. Keep installation tokens separate when transferring to specific, approved pilot machines. The generator does **not** install those tokens into desktop CaptureLink: client credential provisioning and activation remain later gates. Example port `8788` is fixed in generated config to avoid clashing with localhost UX3a port `8787`.

The runtime enforces POSIX owner/mode checks for the configuration file and its immediate parent directory, opens the file with `O_NOFOLLOW`, limits the configuration to 64 KiB, rejects unknown fields and invalid quotas, then uses the existing admission-validating pilot factory. It fails closed on Windows rather than claiming Windows ACLs are equivalent to POSIX permissions. The runtime **does not read keys from CLI arguments or environment variable values** (only the path). The file remains in process memory while running. Provisioning and startup errors avoid printing credentials, configuration contents or rejected paths. It binds loopback only, serves a minimal `/healthz`, and drains/forces HTTP connections at most five seconds after SIGINT/SIGTERM; already-established WebRTC media is **not** ended by broker shutdown.

## Approved configuration schema for local tests

```text
version: 1 (required)
port: integer 1..65535 (required; listener remains 127.0.0.1)
installations: array of distinct {id,token} (required; 2..64)
maxSessions: integer 1..12 (optional; reduction only)
limits: UX3c-2 quota overrides (optional; reduction only)
```

No `host`, `listenAddress`, `publicUrl`, `allowAnonymous`, HTTP bypass, TLS bypass, trust-proxy flag or other top-level keys are accepted. Pilot session and admission tokens remain distinct; revoking an installation is a separate in-process operation, not yet a distributed credential service. Restart erases session state and creates no durable backup of sessions. **Do not back up plaintext credential bundles to a general-purpose cloud or shared drive.** Operator key rotation and revocation procedures must be defined before the controlled hosted pilot.

## Validation

```bash
node --test services/signaling/test/pilot-runtime.test.mjs
node scripts/ux3c3a-deploy-source-smoke.mjs
node --test services/signaling/test/pilot-server.test.mjs
```

New Linux CI job `private-pilot-linux` runs the file permission / startup tests. The original Windows CI job continues to run builds, existing signaling, UX and voice regressions. The new runtime and provisioning script do not add runtime dependencies. Both jobs must pass before PR acceptance. The Caddy example is **not** executable configuration in CI and is not proof of a working TLS ingress.

## Remaining UX3c-3b/3c release blockers

1. End desktop friend media, controller control and guest microphone on server revocation, expired leases and connectivity loss (including network partition); do not disconnect Xbox Remote Play unnecessarily.
2. Review identity and credential lifecycle: securely install/rotate/revoke per-machine admission; no shared shipping credential; protect local secret storage on Windows.
3. Choose a dedicated host, DNS, TLS/reverse proxy, firewall and edge abuse protection; validate actual public exposure and HTTPS with explicit operator approval. Never publish the Node loopback port.
4. Reconcile Caddy's forwarded-header behavior with the accepted pilot's strict rejection; run a real integration test across the actual proxy before deployment.
5. Confirm observability, incident response, availability/rollback, privacy retention and backup/restore strategy. Review dependency advisories separately.
6. Prove JPCMAIN ↔ XLAPTOPX live signal approval, media transport, ICE/TURN when needed, Controller 1/Player 2, guest audio consent, disconnect and revocation on real separate networks.

**UX3c-3a acceptance is permission to prepare a controlled deployment design, not permission to expose a server or distribute host/guest tokens.**
