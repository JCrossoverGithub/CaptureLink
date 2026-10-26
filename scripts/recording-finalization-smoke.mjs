// RQ2 lifecycle regression test: exercises the real TypeScript main-process IPC
// handlers under a narrow mocked Electron runtime, using genuine FFmpeg output.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const ts = createRequire(import.meta.url)('typescript')

const root = resolve(import.meta.dirname, '..')
const workspace = mkdtempSync(join(tmpdir(), 'capturelink-rq2-'))
const videos = join(workspace, 'videos')
const userData = join(workspace, 'user-data')
const downloads = join(workspace, 'downloads')
for (const folder of [videos, userData, downloads]) mkdirSync(folder, { recursive: true })
const source = join(workspace, 'test-source.webm')
const ffmpeg = process.env.CAPTURELINK_FFMPEG || (
  process.platform === 'win32'
    ? join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    : '/usr/bin/ffmpeg'
)
process.env.CAPTURELINK_FFMPEG = ffmpeg
execFileSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '1.5', '-c:v', 'libvpx', '-b:v', '350k',
  '-c:a', 'libopus', source
], { stdio: 'pipe' })

const handlers = new Map()
const savedPaths = []
const app = {
  isPackaged: false,
  on() {},
  quit() {},
  getPath(name) { return ({ videos, userData, downloads })[name] ?? workspace },
  whenReady() { return new Promise(() => {}) },
}
const electron = {
  app,
  dialog: {
    async showSaveDialog() {
      const filePath = savedPaths.shift()
      assert.ok(filePath, 'Unexpected save dialog')
      return { canceled: false, filePath }
    },
    async showMessageBox() { return { response: 1 } },
  },
  ipcMain: { handle(name, handler) { handlers.set(name, handler) } },
  shell: { openPath: async () => '', showItemInFolder() {} },
  Menu: { setApplicationMenu() {} },
  BrowserWindow: class {},
  clipboard: { writeText() {}, readText() { return '' } },
}
function loadTs(file, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const module = { exports: {} }
  const nativeRequire = createRequire(file)
  const requireShim = (id) => {
    if (id === 'electron') return electron
    if (id in mocks) return mocks[id]
    return nativeRequire(id)
  }
  vm.runInNewContext(compiled.outputText.replaceAll('import.meta.url', JSON.stringify(`file://${file.replaceAll('\\', '/')}`)), {
    require: requireShim, module, exports: module.exports, process,
    console, setTimeout, clearTimeout, Buffer, __dirname: dirname(file),
    URL, TextEncoder,
  }, { filename: file })
  return module.exports
}
const recordingExports = loadTs(join(root, 'src/main/recording/export.ts'))
loadTs(join(root, 'src/main/index.ts'), {
  'xal-node': { Msal: class {}, TokenStore: class {} },
  './xbox/consoles': { getXboxConsoles: async () => [] },
  './xbox/xhome': { XboxHomeManager: class {} },
  './recording/export': recordingExports,
})
const ipc = (name, ...args) => {
  const handler = handlers.get(name)
  assert.ok(handler, `${name} registered`)
  return handler({}, ...args)
}

async function recordToLibrary(outputPath) {
  savedPaths.push(outputPath)
  const begin = await ipc('capturelink:recording-begin', {
    kind: 'video', suggestedName: 'CaptureLink-Video.webm'
  })
  assert.equal(begin.started, true)
  assert.equal(begin.filePath, outputPath)
  const buffer = await readFile(source)
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  await ipc('capturelink:recording-append', { recordingId: begin.recordingId, data: array })
  const result = await ipc('capturelink:recording-finalize', begin.recordingId)
  const library = await ipc('capturelink:recordings-list')
  const item = library.find(x => x.id === begin.recordingId)
  assert.ok(item)
  return { result, item }
}

const target = join(videos, 'CaptureLink', 'my-game.mp4')
let { result, item } = await recordToLibrary(target)
assert.equal(result.format, 'mp4')
assert.equal(result.filePath, target)
assert.equal(result.warning, undefined)
assert.equal(item.fileName, 'my-game.mp4')
assert.equal(item.originalExists, true)
assert.ok((await stat(item.filePath)).size > 1024)
const sources = readdirSync(join(videos, 'CaptureLink', '.capturelink-sources'))
assert.equal(sources.length, 1)
const sourcePath = join(videos, 'CaptureLink', '.capturelink-sources', sources[0])
assert.ok(existsSync(sourcePath))
const mp4Copy = join(downloads, 'copied.mp4')
// Force the no-FFmpeg path to prove MP4 export copies without transcoding.
const oldFfmpeg = process.env.CAPTURELINK_FFMPEG
process.env.CAPTURELINK_FFMPEG = join(workspace, 'missing-ffmpeg')
savedPaths.push(mp4Copy)
const copyResult = await ipc('capturelink:recordings-export-converted', {id: item.id, format: 'mp4'})
assert.equal(copyResult.exported, true)
assert.equal((await stat(mp4Copy)).size, (await stat(target)).size)
process.env.CAPTURELINK_FFMPEG = oldFfmpeg
const originalCopy = join(downloads, 'exported-original.webm')
savedPaths.push(originalCopy)
const exported = await ipc('capturelink:recordings-export-original', item.id)
assert.equal(exported.exported, true)
assert.equal((await stat(originalCopy)).size, (await stat(source)).size)
const renamed = await ipc('capturelink:recordings-rename', { id: item.id, name: 'renamed' })
assert.ok(renamed.filePath.endsWith('renamed.mp4'))
assert.ok(existsSync(sourcePath), 'source remains after rename')
const deleted = await ipc('capturelink:recordings-delete', item.id)
assert.equal(deleted.deleted, true)
assert.equal(existsSync(sourcePath), false, 'source removed with library recording')
assert.equal(existsSync(renamed.filePath), false, 'MP4 removed with library recording')

// Existing output is never overwritten by automatic finalization.
const conflict = join(videos, 'CaptureLink', 'collision.mp4')
await import('node:fs/promises').then(x => x.writeFile(conflict, Buffer.from('keep-existing-file')))
;({ result, item } = await recordToLibrary(conflict))
assert.equal(result.format, 'mp4')
assert.ok(result.filePath.endsWith('collision (1).mp4'))
assert.equal(readFileSync(conflict, 'utf8'), 'keep-existing-file')

// Deliberately deny FFmpeg support for a *different* capture. WebM must remain.
const goodCommand = process.env.CAPTURELINK_FFMPEG
process.env.CAPTURELINK_FFMPEG = join(workspace, 'missing-ffmpeg')
try {
  ;({ result, item } = await recordToLibrary(join(videos, 'CaptureLink', 'fallback.mp4')))
  assert.equal(result.format, 'webm')
  assert.ok(result.warning)
  assert.ok(item.fileName.endsWith('.webm'))
  assert.equal(item.originalExists, true)
  assert.equal(existsSync(result.filePath), true)
} finally {
  process.env.CAPTURELINK_FFMPEG = goodCommand
}
console.log('PASS: Auto MP4 finalization, WebM source, rename/delete, and FFmpeg failure recovery.')
console.log(`Test output preserved for inspection: ${workspace}`)
