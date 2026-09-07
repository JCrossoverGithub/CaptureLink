# xbox-xcloud-player development bundle

CaptureLink M1-C uses the browser player bundle from the preserved XboxLink protocol spike rather than the stale published npm package.

Run:

```bash
npm run vendor:xbox-player
```

By default this copies `../XboxLink/.reference/xbox-xcloud-player/dist/assets/xCloudPlayer.min.js` into the renderer's Vite `public/vendor` directory. Set `CAPTURELINK_XBOX_PLAYER_SOURCE` to override that source checkout.

The generated bundle and `SOURCE.json` are intentionally ignored while CaptureLink completes its third-party licensing and attribution review. The upstream package metadata currently identifies `xbox-xcloud-player` as MIT licensed.
