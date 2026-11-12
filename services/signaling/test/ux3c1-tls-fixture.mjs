// Ephemeral self-signed X.509 fixture, generated in memory with Node crypto.
// No private keys, passwords or actual credentials are checked into the repo.
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer as createHttpsServer } from 'node:https'

function wrap(tag, value) {
  const b = Buffer.from(value)
  const len = b.length < 128 ? Buffer.from([b.length]) : b.length < 256
    ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 0xff])
  return Buffer.concat([Buffer.from([tag]), len, b])
}
const seq = (...pieces) => wrap(0x30, Buffer.concat(pieces))
const set = (...pieces) => wrap(0x31, Buffer.concat(pieces))
const oid = (...nodes) => wrap(0x06, Buffer.from([nodes[0] * 40 + nodes[1], ...nodes.slice(2).flatMap(n => {
  const parts = [n & 0x7f]
  for (n >>= 7; n; n >>= 7) parts.unshift(0x80 | (n & 0x7f))
  return parts
})]))
const number = n => wrap(0x02, Buffer.from([n]))
const utc = date => wrap(0x17, Buffer.from(date.toISOString().slice(2, 19).replace(/[-:T]/g, '') + 'Z'))
const bit = bytes => wrap(0x03, Buffer.concat([Buffer.from([0]), bytes]))
const pem = bytes => `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`

export async function untrustedTlsFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const alg = seq(oid(1, 2, 840, 113549, 1, 1, 11), wrap(0x05, []))
  const cn = seq(set(seq(oid(2, 5, 4, 3), wrap(0x0c, Buffer.from('signal.capturelink.test')))))
  const now = Date.now()
  const validity = seq(utc(new Date(now - 24 * 3600_000)), utc(new Date(now + 24 * 3600_000)))
  const tbs = seq(wrap(0xa0, number(2)), number(1), alg, cn, validity, cn,
    publicKey.export({ type: 'spki', format: 'der' }))
  const cert = seq(tbs, alg, bit(sign('RSA-SHA256', tbs, privateKey)))
  const server = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem(cert) },
    (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `https://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}
