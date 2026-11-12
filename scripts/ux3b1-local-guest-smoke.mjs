import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const launcher = readFileSync(new URL('./launch-ux3b1-local-guest.ps1', import.meta.url), 'utf8')
const beforeReady = main.indexOf('app.whenReady().then(')
const flag = main.indexOf("process.argv.includes('--capturelink-ux3-local-guest')")
const userPath = main.indexOf("app.setPath('userData', guestProfile)")
const sessionPath = main.indexOf("app.setPath('sessionData', guestSessionData)")
assert.ok(beforeReady > flag && flag > 0, 'Guest profile flag must be checked before Electron ready')
assert.ok(beforeReady > userPath && userPath > flag, 'Guest token store must be isolated before ready')
assert.ok(beforeReady > sessionPath && sessionPath > userPath, 'Guest Chromium state must also be isolated before ready')
assert.ok(main.includes("!app.isPackaged && process.argv.includes('--capturelink-ux3-local-guest')"), 'Guest flag must be disabled in packaged releases')
assert.ok(main.includes("join(app.getPath('temp'), `CaptureLink-UX3-Guest-Test-${randomUUID()}`)"), 'Use a unique temp profile for every test launch')
assert.ok(main.includes("mkdirSync(guestSessionData, { recursive: true })"), 'Profile directory must exist before app.setPath')
assert.ok(main.includes("window.setTitle('CaptureLink — ISOLATED LOCAL GUEST TEST')"), 'Guest window must be distinguishable')
assert.ok(launcher.includes('Start-Process') && launcher.includes("'--capturelink-ux3-local-guest'"), 'Launcher must set the opt-in flag')
assert.ok(launcher.includes('node_modules\\electron\\dist\\electron.exe'), 'Launcher must use a second Electron process')
assert.ok(launcher.includes('out\\renderer\\index.html'), 'Launcher must use built renderer (not clash with dev server)')
for (const channel of ['hosted-create','hosted-join','hosted-snapshot','hosted-approve','hosted-send','hosted-messages','hosted-end']) {
  assert.ok(main.includes(`capturelink:${channel}`), `Existing IPC retained: ${channel}`)
}
console.log('PASS: local guest test mode is opt-in, ephemeral and isolated before app ready; IPC and main app unaffected')
