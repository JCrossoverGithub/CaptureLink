/** UX3F-3B2 sealed dev-only main/preload/renderer changes and original broker/Xbox paths.
 * Reconciles prior source guards without dropping historical hash coverage.
 * LF normalization permits Windows CRLF checkout but no source mutation.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const expected = Object.freeze({
  'src/main/xbox/consoles.ts': 'f80077483a2c580281bea86bf914b73a1fc5db59c402c662303abadb0c0ef1e0',
  'src/main/xbox/xhome.ts': '6a2349a38cb07c464f6b987001ed64e5497203e1d59b543f4991fe1867351692',
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/main/capturelink-online-vault.mjs': 'f3aad046e9031a3caf787eba6c5b57b8308debd900cba3e7773f8e64a796ce38',
  'src/main/capturelink-auth0-provider.mjs': ('61d3916430a7b193f01699fcc8868bac' + 'c8ac60c0155cedc855a952d49570aa20'),
  'src/main/capturelink-online-auth.mjs': ('e815235d95d26299d72ef0b0868cad5e' + '902ae09402fa427b750d45973e0a1a45'),
  'src/main/capturelink-online-loopback.mjs': '79fa425e6cc54608d50cc5bae732ef4d62887e0800c80fe9f703bb61a8837187',
  'src/main/capturelink-online-v2-client.mjs': '1bee90a157e7220310c2e7dec1bcfc8cb738fce47787a63305bd320a7ff2ee78',
  'services/signaling/src/server.mjs': '1c85fdc44c1471d52247ea1f1aacf13da91fd9b2caa9155b4727198ad10b36a5',
  'services/signaling/src/client.mjs': '951b159e5671a04341e35872326b74e2e3825435e95e03e3038e3ba2b84364f9',
  'services/signaling/src/public-v2-server.mjs': '2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f',
  'services/signaling/src/public-authorization-policy.mjs': '4d536af5a625f984c59643c81b5e55c6857ce5efa0ce221054114b734791ad44',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/renderer/src/unified-session-ux.ts': '129f765c65a7918a79db8488d46b32513ab69a974a4334508728b5d14bb9edad',
  'src/main/index.ts': '5b184a751c5b83c689aedb5d258b992a535377c6234c36921712f953f168faf5',
  'src/preload/index.ts': 'e7d731a606d764366fbbd170b75bcc57d96f91bd4b90ef7ee0c73ee1b881eddb',
  'src/renderer/src/main.ts': 'd345ce9529fc4050b022d09ec409b29cd09e9de771b5308546a842935e20e3b8',
  'src/renderer/src/env.d.ts': '34489a45ae2dff268b6bc928cb758893f1841f7ca1172f659c2bda605a01ba01',
  'src/main/capturelink-online-dev-config.mjs': '239b941100adc6289990bf7c6de2b477e49104a36966abf8439ac3cdf37dcfd9',
  'src/main/capturelink-online-electron.mjs': 'e4769be795d93e90f0ad2b0c0580ba6dd31a3a3aa96f84f5bf7f8e1593c448cd',
  'src/main/capturelink-online-electron.d.mts': '9f022bed53034906a3c599bf567f0e532b7212dcc9ca4bee4da105f2a94a8527',
  'src/main/capturelink-auth0-provider.d.mts': ('37095a8c42321ee73e0db4ba81fa0031' + 'b772f1a6605c8c2c2fcf4d4619776306'),
  'src/main/capturelink-online-vault.d.mts': 'd6276d844ef993e063c920a2c9b030a448d0f6abfbd66fadac54f5f1394d3022',
  'src/main/capturelink-online-dev-config.d.mts': '457a390d582ecac54b9d6a2c9d4b3092d4434d06416cf8b4c72302f71b6fdf1d',
  'src/renderer/src/capturelink-online-settings.ts': 'e79cc0621eeea1681fc3cdd3d9d48db24143f233afbb3a9218712a4f75681eb3',
  'src/renderer/src/capturelink-online-settings.css': '961ab11de1c75bee05318ede8758927ad347c1f688615e87a2a8d21537a00c95',
})
for (const [path, hash] of Object.entries(expected)) {
  const value = readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
  if (createHash('sha256').update(value).digest('hex') !== hash) {
    console.error(`FAIL: UX3F-3B2 unexpected source mutation: ${path}`)
    process.exit(1)
  }
}
const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const renderer = readFileSync(resolve(root, 'src/renderer/src/capturelink-online-settings.ts'), 'utf8')
const config = readFileSync(resolve(root, 'src/main/capturelink-online-dev-config.mjs'), 'utf8')
if (!main.includes("!app.isPackaged && !localGuestTest") ||
    !main.includes("process.platform === 'win32'") ||
    !main.includes('safeStorage.isEncryptionAvailable()') ||
    !main.includes('authorizedHostedFrame(event)') ||
    !config.includes('ONLINE_DEV_CONFIG_FILENAME') ||
    !renderer.includes('card.hidden = true') ||
    /\b(?:accessToken|refreshToken|clientSecret|codeVerifier|jwks)\b/.test(preload + renderer)) {
  throw new Error('UX3F-3B2 privileged boundary weakened')
}
console.log('PASS: UX3F-3B2 dev-only Auth0 IPC and source boundary verified')
