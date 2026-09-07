# Known-good XboxLink protocol spike

This document records the experimental state that CaptureLink is intended to reproduce.

## Environment

- Development host: Windows 11 + WSL Ubuntu
- Node used during spike: 24.19.0
- npm used during spike: 11.17.0
- Xbox console: Xbox Series X
- Reference implementation: `unknownskl/xbox-xcloud-player`

## Proven sequence

1. Built the upstream TypeScript/Webpack project successfully.
2. Authenticated using the upstream MSAL/device-code flow.
3. Queried `/v6/servers/home` and discovered the physical console.
4. Started an xHome session.
5. Reached the Provisioned state.
6. The reference polling implementation required a local diagnostic patch so pending SDP/ICE responses were not treated as final usable responses.
7. Firefox generated a Mozilla SDP offer and the Xbox failed the SDP exchange.
8. Microsoft Edge/Chromium successfully negotiated the session.
9. Video rendered successfully.
10. Game audio played successfully.
11. Incoming in-game voice chat was audible in the Remote Play audio received by the PC.

## Critical finding

The product-defining discovery was that the Remote Play client received game-chat speech in the audio being played on the PC. CaptureLink therefore has a viable path to record exactly what the user hears without first building a separate game-chat interception subsystem.

## Important scope note

Party Chat has not yet been independently validated. The proven result is incoming **in-game voice chat** in the tested game/configuration.

## Resume principle

Do not continue adding product features to the old reference checkout. Reproduce the known-good xHome path inside CaptureLink, then implement recording against CaptureLink's received `MediaStream`.
