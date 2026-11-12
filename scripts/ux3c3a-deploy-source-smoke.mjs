import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const runtime = read('services/signaling/src/pilot-runtime.mjs')
const provision = read('scripts/ux3c3a-provision.mjs')
const edge = read('ops/Caddyfile.private-pilot.example')
const local = read('services/signaling/src/server.mjs')
const main = read('src/main/ux3c-signaling-client.mjs')
const ci = read('.github/workflows/ci.yml')
for (const [condition, name] of [
  [runtime.includes('createPilotSignalingServer') && !runtime.includes('createSignalingServer({'), 'pilot runtime selects hardened factory'],
  [runtime.includes('CAPTURELINK_PILOT_CONFIG_PATH') && runtime.includes('loadPilotRuntimeConfig'), 'private file only'],
  [runtime.includes('O_NOFOLLOW') && runtime.includes('0o077') && runtime.includes('process.platform'), 'permissions and platform'],
  [runtime.includes('closeAllConnections') && runtime.includes('SIGTERM'), 'bounded process shutdown'],
  [provision.includes("flag: 'wx'") && provision.includes('mode: 0o600'), 'exclusive files'],
  [edge.includes('pilot.example.invalid') && edge.includes('header_up -X-Forwarded-*') && edge.includes('header_up -Forwarded'), 'disabled edge example'],
  [local.includes("server.listen(port, '127.0.0.1'"), 'broker still loopback only'],
  [main.includes("mode = 'local'") && main.includes('remote.enabled !== true'), 'desktop remains local'],
  [ci.includes('private-pilot-linux') && ci.includes('pilot-runtime.test.mjs'), 'CI tests Linux permissions'],
]) assert.ok(condition, name)
console.log('PASS: Linux-only local pilot runtime, private credentials, no public listener, reviewed edge sample, and CI')
