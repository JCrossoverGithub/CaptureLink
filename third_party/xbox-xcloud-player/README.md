# xbox-xcloud-player Vendored Bundle

CaptureLink includes a pinned browser bundle from `xbox-xcloud-player`.

Upstream:

```text
Project: xbox-xcloud-player
Author: Jim Kroon / UnknownSKL
Version: 1.0.0-beta7
Repository: https://github.com/unknownskl/xbox-xcloud-player
License: MIT
```

The bundle is used for the browser-side xCloud/xHome WebRTC player and control layer.

## Canonical checked-in artifact

The repository keeps the selected bundle at:

```text
third_party/xbox-xcloud-player/xCloudPlayer.min.js
```

Its provenance/integrity metadata is stored in:

```text
third_party/xbox-xcloud-player/SOURCE.json
```

## Build preparation

Run:

```bash
npm run vendor:xbox-player
```

The script verifies the checked-in SHA-256 before copying the artifact into:

```text
src/renderer/public/vendor/xCloudPlayer.min.js
```

## Attribution

CaptureLink does not claim authorship of `xbox-xcloud-player`.

See `THIRD_PARTY_NOTICES.md` for repository-level attribution.

## License provenance

The published `xbox-xcloud-player@1.0.0-beta7` package metadata declares the project license as MIT and identifies Jim Kroon / UnknownSKL as the author.

The exact npm package inspected for CaptureLink did not include a standalone LICENSE, LICENCE, COPYING, or NOTICE file.

CaptureLink therefore does not reconstruct or fabricate an upstream license text. Instead, the exact published package metadata is preserved in:

- `UPSTREAM_PACKAGE.json`

The absence of a standalone upstream license text remains a release-review item before broad binary distribution.

CaptureLink does not claim authorship of the upstream player implementation.
