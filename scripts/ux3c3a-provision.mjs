/**
 * Generate a strictly private LOCAL Linux pilot credential bundle outside Git.
 * Never logs, emails or publishes raw credentials. Does not start a server.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, lstat, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
function token() { return randomBytes(32).toString('base64url') }
export async function provisionPrivatePilotBundle(target) {
  if (process.platform !== 'linux' || typeof target !== 'string' || !isAbsolute(target)) {
    throw new Error('private_bundle_path_invalid')
  }
  const absolute = resolve(target)
  const root = await realpath(ROOT)
  const parent = await realpath(dirname(absolute))
  if (absolute === root || absolute.startsWith(root + sep) || parent === root || parent.startsWith(root + sep)) {
    throw new Error('private_bundle_must_be_outside_repo')
  }
  if (parent !== dirname(absolute) || !(await stat(parent)).isDirectory()) throw new Error('private_bundle_path_invalid')
  const host = token(), guest = token()
  await mkdir(absolute, { mode: 0o700 }) // fails if it already exists; never overwrite credentials
  if (((await lstat(absolute)).mode & 0o777) !== 0o700) throw new Error('private_directory_permissions_invalid')
  const config = { version: 1, port: 8788,
    installations: [{ id: 'pilot_host_1', token: host }, { id: 'pilot_guest_1', token: guest }],
    maxSessions: 4,
  }
  const entries = [
    ['pilot.config.json', JSON.stringify(config, null, 2) + '\n'],
    ['host.admission', host + '\n'],
    ['guest.admission', guest + '\n'],
  ]
  for (const [filename, value] of entries) {
    const path = `${absolute}/${filename}`
    await writeFile(path, value, { flag: 'wx', mode: 0o600 })
    if (((await lstat(path)).mode & 0o777) !== 0o600) throw new Error('private_file_permissions_invalid')
  }
  return { folder: absolute, filenames: entries.map(x => x[0]) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('one_absolute_path_required')
    const output = await provisionPrivatePilotBundle(process.argv[2])
    console.log(`Created private pilot bundle in ${output.folder} (credentials NOT printed)`)
  } catch {
    console.error('Private pilot provisioning refused; choose a NEW absolute Linux directory outside Git')
    process.exitCode = 1
  }
}
