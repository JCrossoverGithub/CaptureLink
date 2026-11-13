/** UX3F-3B3C1: reconciled UX3F-3B3C2 Electron main/preload, while preserving accepted broker, pilot, auth and renderer. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const pinned = Object.freeze({
  'src/main/index.ts': '770f9cb8bc9cc2417f2489b0c1eee2bcbe54007d5b0d00a3ee8b73adb41a4949',
  'src/preload/index.ts': 'c53caff49ec5af81d9e39c2fd7fbe7458dfa8091dd0194681675e92575055246',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/main/capturelink-online-electron.mjs': '065b1f70ed2804411e7bfeb55606df63b9ba5706efbe0a410a29862c45fd05fc',
  'src/main/capturelink-online-https-host-candidate.mjs': 'f67cb169ea465943c727d4249f0344cb92a4b0f09dfc0b45b78844d5fb571bda',
  'src/main/capturelink-online-dev-config.mjs': '239b941100adc6289990bf7c6de2b477e49104a36966abf8439ac3cdf37dcfd9',
  'services/signaling/src/public-v2-server.mjs': '2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f',
})
for (const [path, digest] of Object.entries(pinned)) {
  const normalized = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const actual = createHash('sha256').update(normalized).digest('hex')
  if (actual !== digest) throw new Error(`UX3F-3B3C1 source boundary changed: ${path}`)
}
console.log('PASS: UX3F-3B3C1 accepted broker, Auth0 logic and renderer remain preserved; 3B3C2 offline Electron IPC reconciliation approved')
