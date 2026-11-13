/**
 * UX3F-3B2 operator-only development configuration; no OAuth secrets.
 * An explicitly provisioned home-directory JSON file contains ONLY a domain.
 * No CLI/environment or renderer-supplied issuer can change identity.
 * The expected Auth0 tenant slug is known, but its exact Domain must be
 * copied from the Auth0 dashboard by the operator, not guessed here.
 */
import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ONLINE_DEV_CONFIG_FILENAME = 'CaptureLink-Online-Dev.v1.json'
export const ONLINE_DEV_CLIENT_ID = 'QX7btfsc4kCnu4hAUAJCIu7Hpj8Oh1NG'
export const ONLINE_DEV_AUDIENCE = 'https://signal.capturelink.io/v2'
const APPROVED_DOMAIN = /^dev-xh0d5exjel25dl0d\.us\.auth0\.com$/

export async function loadCaptureLinkOnlineDevConfig({ home = homedir() } = {}) {
  const path = join(home, ONLINE_DEV_CONFIG_FILENAME)
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 10 || stat.size > 512) return null
    const raw = await readFile(path, 'utf8')
    const obj = JSON.parse(raw)
    if (!obj || Array.isArray(obj) || typeof obj !== 'object' ||
        Object.keys(obj).length !== 1 || !Object.hasOwn(obj, 'domain') ||
        typeof obj.domain !== 'string' || !APPROVED_DOMAIN.test(obj.domain)) return null
    return Object.freeze({
      domain: obj.domain, clientId: ONLINE_DEV_CLIENT_ID,
      audience: ONLINE_DEV_AUDIENCE, redirectPort: 49152,
    })
  } catch { return null } // Missing, malformed or unreadable file: disabled.
}
