import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, shell } from 'electron'
import { Msal, TokenStore } from 'xal-node'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, open, readFile, rename, stat, statfs, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getXboxConsoles } from './xbox/consoles'
import {
  type LocalIceCandidate,
  XboxHomeManager
} from './xbox/xhome'
import {
  exportRecordingWithFfmpeg,
  getFfmpegSupport,
  type RecordingExportFormat
} from './recording/export'

let mainWindow: BrowserWindow | null = null
let authProcessRunning = false
let activeXboxVerificationUri: string | null = null
const xboxHome = new XboxHomeManager()

type RecordingKind = 'audio' | 'video'

interface ActiveRecording {
  id: string
  kind: RecordingKind
  filePath: string
  handle: FileHandle
  bytesWritten: number
  startedAt: number
  targetFilePath?: string
}

interface RecordingLibraryEntry {
  id: string
  kind: RecordingKind
  filePath: string
  createdAt: string
  durationMs: number
  bytes: number
  sourceFilePath?: string
}

interface RecordingLibraryItem extends RecordingLibraryEntry {
  fileName: string
  exists: boolean
  originalExists: boolean
}

let activeRecording: ActiveRecording | null = null
let recordingClosePromptOpen = false
let recordingFinalizing = false
let closeAfterRecording = false
let activeRecordingExport: {
  recordingId: string
  format: RecordingExportFormat
} | null = null

const MIB = 1024 * 1024
const MINIMUM_START_SPACE: Record<RecordingKind, number> = {
  audio: 32 * MIB,
  video: 256 * MIB
}
const RECORDING_SPACE_RESERVE = 32 * MIB

function getAuthDirectory(): string {
  const directory = join(app.getPath('userData'), 'xbox-auth')
  mkdirSync(directory, { recursive: true })
  return directory
}

function getTokenPath(): string {
  return join(getAuthDirectory(), '.xbox.tokens.json')
}

function getRecordingDirectory(): string {
  const directory = join(app.getPath('videos'), 'CaptureLink')
  mkdirSync(directory, { recursive: true })
  return directory
}

function getRecordingLibraryPath(): string {
  return join(app.getPath('userData'), 'recordings.json')
}

async function readRecordingLibrary(): Promise<RecordingLibraryEntry[]> {
  try {
    const raw = await readFile(getRecordingLibraryPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is RecordingLibraryEntry => {
      if (!entry || typeof entry !== 'object') {
        return false
      }

      const candidate = entry as Partial<RecordingLibraryEntry>
      return typeof candidate.id === 'string' &&
        (candidate.kind === 'audio' || candidate.kind === 'video') &&
        typeof candidate.filePath === 'string' &&
        typeof candidate.createdAt === 'string' &&
        typeof candidate.durationMs === 'number' &&
        typeof candidate.bytes === 'number' &&
        (candidate.sourceFilePath === undefined || typeof candidate.sourceFilePath === 'string')
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[CaptureLink] Could not read recording library:', error)
    }
    return []
  }
}

async function writeRecordingLibrary(entries: RecordingLibraryEntry[]): Promise<void> {
  const target = getRecordingLibraryPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

async function upsertRecordingLibraryEntry(entry: RecordingLibraryEntry): Promise<void> {
  const entries = await readRecordingLibrary()
  const index = entries.findIndex((candidate) => candidate.id === entry.id)

  if (index >= 0) {
    entries[index] = entry
  } else {
    entries.unshift(entry)
  }

  await writeRecordingLibrary(entries)
}

async function listRecordingLibrary(): Promise<RecordingLibraryItem[]> {
  const entries = await readRecordingLibrary()

  return await Promise.all(entries.map(async (entry) => {
    let exists = false
    let bytes = entry.bytes

    try {
      const stats = await stat(entry.filePath)
      exists = stats.isFile()
      if (exists) {
        bytes = stats.size
      }
    } catch {
      exists = false
    }

    const originalPath = entry.sourceFilePath ??
      (extname(entry.filePath).toLowerCase() === '.webm' ? entry.filePath : null)
    const originalExists = originalPath ? existsSync(originalPath) : false

    return {
      ...entry,
      bytes,
      fileName: basename(entry.filePath),
      exists,
      originalExists
    }
  }))
}

async function requireLibraryEntry(id: string): Promise<{
  entry: RecordingLibraryEntry
  entries: RecordingLibraryEntry[]
  index: number
}> {
  const entries = await readRecordingLibrary()
  const index = entries.findIndex((candidate) => candidate.id === id)

  if (index < 0) {
    throw new Error('Recording is no longer in the CaptureLink library.')
  }

  const entry = entries[index]

  if (!entry) {
    throw new Error('Recording is no longer in the CaptureLink library.')
  }

  return { entry, entries, index }
}

function sanitizeLibraryRecordingName(name: string, currentPath: string): string {
  const extension = extname(currentPath) || '.webm'
  const raw = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')

  if (!raw) {
    throw new Error('Recording name cannot be empty.')
  }

  return raw.toLowerCase().endsWith(extension.toLowerCase())
    ? raw
    : `${raw}${extension}`
}

function sanitizeRecordingName(name: string): string {
  const safe = name
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()

  const fallback = `CaptureLink-Audio-${Date.now()}.webm`
  const candidate = safe || fallback

  return candidate.toLowerCase().endsWith('.webm')
    ? candidate
    : `${candidate}.webm`
}

function sanitizeVideoRecordingName(name: string): string {
  const safe = name
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()

  const fallback = `CaptureLink-Video-${Date.now()}.webm`
  const candidate = safe || fallback

  return candidate.toLowerCase().endsWith('.webm')
    ? candidate
    : `${candidate}.webm`
}

async function availableRecordingPath(preferred: string): Promise<string> {
  const extension = extname(preferred)
  const base = preferred.slice(0, -extension.length)
  for (let n = 0; n < 1000; n += 1) {
    const candidate = n === 0 ? preferred : `${base} (${n})${extension}`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error('Too many existing recordings with this file name.')
}

async function getAvailableDiskBytes(directory: string): Promise<number> {
  const stats = await statfs(directory, { bigint: true })
  const bytes = stats.bavail * stats.bsize
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)
  return Number(bytes > maxSafe ? maxSafe : bytes)
}

function formatDiskSpace(bytes: number): string {
  if (bytes >= 1024 * MIB) {
    return `${(bytes / (1024 * MIB)).toFixed(1)} GB`
  }

  return `${Math.max(0, Math.floor(bytes / MIB))} MB`
}

function requireActiveRecording(recordingId: string): ActiveRecording {
  if (!activeRecording || activeRecording.id !== recordingId) {
    throw new Error('CaptureLink recording session is no longer active.')
  }

  return activeRecording
}

async function closeRecordingFile(recording: ActiveRecording): Promise<void> {
  try {
    await recording.handle.sync()
  } finally {
    await recording.handle.close()
  }
}

async function preserveActiveRecording(reason: string): Promise<void> {
  const recording = activeRecording
  if (!recording) {
    return
  }

  activeRecording = null

  try {
    await closeRecordingFile(recording)

    if (recording.bytesWritten > 0) {
      await upsertRecordingLibraryEntry({
        id: recording.id,
        kind: recording.kind,
        filePath: recording.filePath,
        createdAt: new Date(recording.startedAt).toISOString(),
        durationMs: Math.max(0, Date.now() - recording.startedAt),
        bytes: recording.bytesWritten
      })
    }

    console.warn(
      `[CaptureLink] Preserved partial ${recording.kind} recording after ${reason}: ${recording.filePath}`
    )
  } catch (error) {
    console.error('[CaptureLink] Failed to close partial recording:', error)
  }
}

function emitStreamStatus(status: string): void {
  console.log(`[CaptureLink] ${status}`)
  mainWindow?.webContents.send(
    'capturelink:xbox-stream-status',
    status
  )
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    icon: app.isPackaged
      ? join(process.resourcesPath, 'CaptureLink.ico')
      : join(process.cwd(), 'build', 'CaptureLink.ico'),
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'CaptureLink',
    webPreferences: {
      preload: fileURLToPath(
        new URL('../preload/index.cjs', import.meta.url)
      ),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = window
  window.on('enter-full-screen', () => {
    window.webContents.send(
      'capturelink:window-fullscreen-changed',
      true
    )
  })

  window.on('leave-full-screen', () => {
    window.webContents.send(
      'capturelink:window-fullscreen-changed',
      false
    )
  })

  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => {
      const isCaptureLinkWindow = webContents === null || webContents.id === window.webContents.id
      return isCaptureLinkWindow && (
        permission === 'media' ||
        permission === 'display-capture' ||
        permission === 'speaker-selection'
      )
    }
  )

  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const isCaptureLinkWindow = webContents.id === window.webContents.id
      callback(isCaptureLinkWindow && (
        permission === 'media' ||
        permission === 'display-capture' ||
        permission === 'speaker-selection'
      ))
    }
  )

  // RQ3 Windows desktop audio: a recording-only getDisplayMedia request.
  // Only the top-level CaptureLink renderer can obtain system loopback.
  // The screen video track is never attached to the recording; it exists
  // only because Chromium requires video when requesting display audio.
  window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    // Electron supports null to reject the request; 44.2.0's TypeScript
    // declaration incorrectly types this callback as Streams-only.
    const denyCaptureRequest = (): void => {
      (callback as (streams: Parameters<typeof callback>[0] | null) => void)(null)
    }
    if (
      process.platform !== 'win32' ||
      request.frame !== window.webContents.mainFrame ||
      !request.audioRequested ||
      !request.videoRequested ||
      !request.userGesture
    ) {
      denyCaptureRequest()
      return
    }

    void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source = sources[0]
      if (window.isDestroyed() || !source) {
        denyCaptureRequest()
        return
      }
      callback({ video: source, audio: 'loopback' })
    }).catch((error) => {
      console.error('[CaptureLink] Windows desktop audio capture denied:', error)
      denyCaptureRequest()
    })
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('close', (event) => {
    if (recordingFinalizing) {
      // Conversion must not be abandoned when the user closes the app.
      event.preventDefault()
      closeAfterRecording = true
      return
    }

    if (!activeRecording || closeAfterRecording) {
      return
    }

    event.preventDefault()

    if (recordingClosePromptOpen) {
      return
    }

    recordingClosePromptOpen = true
    const label = activeRecording.kind === 'video' ? 'video' : 'audio'

    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Recording in progress',
      message: `CaptureLink is still recording ${label}.`,
      detail: 'Stop the recording cleanly before closing so the current file can be finalized.',
      buttons: ['Keep Recording', 'Stop Recording and Close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then((result) => {
      recordingClosePromptOpen = false

      if (result.response === 1) {
        closeAfterRecording = true
        window.webContents.send('capturelink:recording-stop-request')
      }
    }).catch((error) => {
      recordingClosePromptOpen = false
      console.error('[CaptureLink] Close warning failed:', error)
    })
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    void preserveActiveRecording(`renderer ${details.reason}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
}

ipcMain.handle(
  'capturelink:window-set-fullscreen',
  (event, fullscreen: boolean) => {
    if (typeof fullscreen !== 'boolean') {
      throw new Error('Fullscreen state must be a boolean.')
    }

    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) {
      throw new Error('CaptureLink window is not available.')
    }

    window.setFullScreen(fullscreen)

    return {
      fullscreen
    }
  }
)
ipcMain.handle(
  'capturelink:friend-clipboard-write',
  (_event, value: string) => {
    if (typeof value !== 'string') {
      throw new Error('Clipboard value must be a string.')
    }

    clipboard.writeText(value)

    return { written: true }
  }
)

ipcMain.handle(
  'capturelink:friend-clipboard-read',
  () => {
    return clipboard.readText()
  }
)

ipcMain.handle('capturelink:xbox-auth-status', () => {
  return {
    authenticated: existsSync(getTokenPath())
  }
})

ipcMain.handle('capturelink:xbox-auth-sign-out', async () => {
  if (authProcessRunning) {
    throw new Error(
      'Wait for the Microsoft/Xbox sign-in flow to finish before signing out.'
    )
  }

  emitStreamStatus('Signing out of Xbox...')

  // End any active Remote Play session before removing persisted credentials.
  await xboxHome.stop()

  const tokenPath = getTokenPath()

  if (existsSync(tokenPath)) {
    const { unlink } = await import('node:fs/promises')
    await unlink(tokenPath)
  }

  emitStreamStatus('Signed out of Xbox.')

  return { signedOut: true }
})

ipcMain.handle('capturelink:xbox-auth-open-verification', async () => {
  if (!authProcessRunning || !activeXboxVerificationUri) {
    throw new Error('Start sign-in in CaptureLink to obtain a verification code first.')
  }
  // Never accept an arbitrary URL from renderer IPC.
  const address = new URL(activeXboxVerificationUri)
  if (address.protocol !== 'https:' ||
      !(address.hostname === 'microsoft.com' || address.hostname.endsWith('.microsoft.com'))) {
    throw new Error('Unexpected Microsoft verification address.')
  }
  await shell.openExternal(address.toString())
})

ipcMain.handle('capturelink:xbox-auth-start', async () => {
  if (authProcessRunning) {
    return {
      started: false,
      reason: 'Authentication is already running.'
    }
  }

  authProcessRunning = true

  const emit = (message: string): void => {
    mainWindow?.webContents.send(
      'capturelink:xbox-auth-output',
      message
    )
  }

  void (async () => {
    try {
      const tokenPath = getTokenPath()
      const tokenStore = new TokenStore()

      // Loading also establishes the file path that TokenStore will save to.
      tokenStore.load(tokenPath, true)

      const msal = new Msal(tokenStore)

      emit('Requesting a Microsoft device code...')

      const deviceCodeDetails =
        await msal.doDeviceCodeAuth()

      emit(deviceCodeDetails.message)
      activeXboxVerificationUri = deviceCodeDetails.verification_uri
      mainWindow?.webContents.send('capturelink:xbox-auth-device-code', {
        userCode: deviceCodeDetails.user_code,
        verificationUri: deviceCodeDetails.verification_uri,
        expiresIn: deviceCodeDetails.expires_in
      })

      // Wait while CaptureLink shows the code; browser opens on explicit action.
      await msal.doPollForDeviceCodeAuth(
        deviceCodeDetails.device_code,
        deviceCodeDetails.expires_in * 1000
      )

      // Polling saves automatically; this makes persistence explicit.
      tokenStore.save()

      const success = existsSync(tokenPath)

      mainWindow?.webContents.send(
        'capturelink:xbox-auth-complete',
        {
          success,
          message: success
            ? 'Authentication succeeded.'
            : 'Authentication completed, but the Xbox token file was not created.'
        }
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error)

      emit(`Authentication failed: ${message}`)

      mainWindow?.webContents.send(
        'capturelink:xbox-auth-complete',
        {
          success: false,
          message
        }
      )
    } finally {
      activeXboxVerificationUri = null
      authProcessRunning = false
    }
  })()

  return {
    started: true
  }
})
ipcMain.handle('capturelink:xbox-consoles', async () => {
  return await getXboxConsoles()
})

ipcMain.handle(
  'capturelink:xbox-stream-start',
  async (_event, serverId: string) => {
    return await xboxHome.start(serverId, emitStreamStatus)
  }
)

ipcMain.handle(
  'capturelink:xbox-stream-sdp',
  async (_event, sdp: string) => {
    emitStreamStatus('Exchanging WebRTC session description...')
    return await xboxHome.exchangeSdp(sdp)
  }
)

ipcMain.handle(
  'capturelink:xbox-stream-ice',
  async (_event, candidates: LocalIceCandidate[]) => {
    emitStreamStatus('Exchanging WebRTC network candidates...')
    return await xboxHome.exchangeIce(candidates)
  }
)

ipcMain.handle(
  'capturelink:xbox-stream-chat-sdp',
  async (_event, sdp: string) => {
    emitStreamStatus('Negotiating microphone audio...')
    return await xboxHome.exchangeSdp(sdp, true)
  }
)

ipcMain.handle('capturelink:xbox-stream-stop', async () => {
  emitStreamStatus('Stopping Remote Play...')
  await xboxHome.stop()
  emitStreamStatus('Remote Play stopped.')
})


ipcMain.handle(
  'capturelink:recording-begin',
  async (
    _event,
    payload: {
      kind: RecordingKind
      suggestedName: string
    }
  ) => {
    if (activeRecording || recordingFinalizing) {
      throw new Error('A CaptureLink recording is already active or finalizing.')
    }

    if (payload?.kind !== 'audio' && payload?.kind !== 'video') {
      throw new Error('Recording kind must be audio or video.')
    }

    const kind = payload.kind
    const suggestedName = kind === 'video'
      ? sanitizeVideoRecordingName(payload.suggestedName)
      : sanitizeRecordingName(payload.suggestedName)
    // Video users select the *finished* MP4 path. Capture continues safely
    // as a WebM source in a companion directory until conversion succeeds.
    const defaultPath = join(getRecordingDirectory(), kind === 'video'
      ? suggestedName.replace(/\.webm$/i, '.mp4')
      : suggestedName)
    const options = {
      title: kind === 'video'
        ? 'Save finished CaptureLink MP4 video'
        : 'Choose CaptureLink audio recording location',
      defaultPath,
      filters: [
        {
          name: kind === 'video' ? 'MP4 video' : 'WebM audio',
          extensions: [kind === 'video' ? 'mp4' : 'webm']
        }
      ]
    }

    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return {
        started: false
      }
    }

    const destination = kind === 'video' && extname(result.filePath).toLowerCase() !== '.mp4'
      ? `${result.filePath}.mp4`
      : result.filePath
    const directory = dirname(destination)
    const availableBytes = await getAvailableDiskBytes(directory)
    const minimumBytes = MINIMUM_START_SPACE[kind]

    if (availableBytes < minimumBytes) {
      throw new Error(
        `Not enough free disk space to start ${kind} recording. ` +
        `${formatDiskSpace(availableBytes)} is available; ` +
        `CaptureLink requires at least ${formatDiskSpace(minimumBytes)}.`
      )
    }

    const id = randomUUID()
    const capturePath = kind === 'video'
      ? join(directory, '.capturelink-sources', `${id}.webm`)
      : destination
    if (kind === 'video') {
      mkdirSync(dirname(capturePath), { recursive: true })
    }
    // A unique WebM capture path must not overwrite a previous recording.
    const handle = await open(capturePath, kind === 'video' ? 'wx' : 'w')
    const recording: ActiveRecording = {
      id,
      kind,
      filePath: capturePath,
      handle,
      bytesWritten: 0,
      startedAt: Date.now(),
      ...(kind === 'video' ? { targetFilePath: destination } : {})
    }

    activeRecording = recording
    closeAfterRecording = false

    console.log(`[CaptureLink] ${kind} recording opened: ${recording.filePath}`)

    return {
      started: true,
      recordingId: recording.id,
      filePath: recording.targetFilePath ?? recording.filePath,
      availableBytes
    }
  }
)

ipcMain.handle(
  'capturelink:recording-append',
  async (
    _event,
    payload: {
      recordingId: string
      data: ArrayBuffer
    }
  ) => {
    const recording = requireActiveRecording(payload?.recordingId)

    if (!payload?.data || typeof payload.data.byteLength !== 'number') {
      throw new Error('Recording chunk data is missing.')
    }

    if (payload.data.byteLength === 0) {
      return {
        bytesWritten: recording.bytesWritten,
        availableBytes: await getAvailableDiskBytes(dirname(recording.filePath))
      }
    }

    const availableBytes = await getAvailableDiskBytes(dirname(recording.filePath))
    const requiredBytes = payload.data.byteLength + RECORDING_SPACE_RESERVE

    if (availableBytes < requiredBytes) {
      throw new Error(
        `Recording stopped because disk space is low. ` +
        `${formatDiskSpace(availableBytes)} remains.`
      )
    }

    const buffer = Buffer.from(payload.data)
    let offset = 0

    while (offset < buffer.length) {
      const result = await recording.handle.write(
        buffer,
        offset,
        buffer.length - offset,
        null
      )

      if (result.bytesWritten <= 0) {
        throw new Error('CaptureLink could not write the next recording chunk.')
      }

      offset += result.bytesWritten
    }

    recording.bytesWritten += buffer.length

    return {
      bytesWritten: recording.bytesWritten,
      availableBytes: Math.max(0, availableBytes - buffer.length)
    }
  }
)

ipcMain.handle(
  'capturelink:recording-finalize',
  async (_event, recordingId: string) => {
    const recording = requireActiveRecording(recordingId)
    activeRecording = null
    recordingFinalizing = true

    try {
      await closeRecordingFile(recording)

      if (recording.bytesWritten === 0) {
        await unlink(recording.filePath).catch(() => undefined)
        throw new Error('The recorder produced an empty file.')
      }

      const createdAt = new Date(recording.startedAt).toISOString()
      const durationMs = Math.max(0, Date.now() - recording.startedAt)
      // Register the recoverable WebM *before* attempting the MP4 encode.
      // If CaptureLink or FFmpeg fails, the user's captured video is retained.
      await upsertRecordingLibraryEntry({
        id: recording.id,
        kind: recording.kind,
        filePath: recording.filePath,
        createdAt,
        durationMs,
        bytes: recording.bytesWritten
      })

      let finalPath = recording.filePath
      let finalBytes = recording.bytesWritten
      let format: 'mp4' | 'webm' = 'webm'
      let warning: string | undefined

      if (recording.kind === 'video' && recording.targetFilePath) {
        // Preserve any preexisting destination even if it was created while
        // CaptureLink was recording. Never silently replace someone else's MP4.
        const target = await availableRecordingPath(recording.targetFilePath)
        mainWindow?.webContents.send('capturelink:recording-mp4-progress', 0)
        try {
          const support = await getFfmpegSupport()
          if (!support.available) throw new Error(support.detail)
          const source = {
            id: recording.id, kind: recording.kind,
            filePath: recording.filePath, durationMs
          }
          await exportRecordingWithFfmpeg({
            source, format: 'mp4', outputPath: target,
            onProgress: (percent) => mainWindow?.webContents.send(
              'capturelink:recording-mp4-progress', percent
            )
          })
          const output = await stat(target)
          finalPath = target
          finalBytes = output.size
          format = 'mp4'
          await upsertRecordingLibraryEntry({
            id: recording.id, kind: recording.kind,
            filePath: finalPath, sourceFilePath: recording.filePath,
            createdAt, durationMs, bytes: finalBytes
          })
        } catch (error) {
          console.error('[CaptureLink] MP4 finalization failed; WebM preserved:', error)
          warning = error instanceof Error ? error.message : 'Unknown conversion error'
        }
      }

      console.log(`[CaptureLink] ${recording.kind} saved: ${finalPath}`)
      return {
        saved: true, filePath: finalPath, bytesWritten: finalBytes,
        format, warning
      }
    } finally {
      recordingFinalizing = false
      if (closeAfterRecording) {
        closeAfterRecording = false
        setTimeout(() => mainWindow?.destroy(), 150)
      }
    }
  }
)

ipcMain.handle(
  'capturelink:recording-cancel',
  async (_event, recordingId: string) => {
    const recording = requireActiveRecording(recordingId)
    activeRecording = null

    await closeRecordingFile(recording)

    if (recording.bytesWritten === 0) {
      await unlink(recording.filePath).catch(() => undefined)
    }

    return {
      canceled: true,
      filePath: recording.filePath,
      bytesWritten: recording.bytesWritten
    }
  }
)


ipcMain.handle('capturelink:recordings-list', async () => {
  return await listRecordingLibrary()
})

ipcMain.handle(
  'capturelink:recordings-open',
  async (_event, id: string) => {
    const { entry } = await requireLibraryEntry(id)

    if (!existsSync(entry.filePath)) {
      throw new Error('Recording file is missing from disk.')
    }

    const errorMessage = await shell.openPath(entry.filePath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }

    return { opened: true }
  }
)

ipcMain.handle(
  'capturelink:recordings-show',
  async (_event, id: string) => {
    const { entry } = await requireLibraryEntry(id)

    if (!existsSync(entry.filePath)) {
      throw new Error('Recording file is missing from disk.')
    }

    shell.showItemInFolder(entry.filePath)
    return { shown: true }
  }
)

ipcMain.handle(
  'capturelink:recordings-rename',
  async (_event, payload: { id: string; name: string }) => {
    const { entry, entries, index } = await requireLibraryEntry(payload?.id)

    if (!existsSync(entry.filePath)) {
      throw new Error('Recording file is missing from disk.')
    }

    const fileName = sanitizeLibraryRecordingName(payload?.name ?? '', entry.filePath)
    const targetPath = join(dirname(entry.filePath), fileName)

    if (targetPath !== entry.filePath && existsSync(targetPath)) {
      throw new Error('A file with that name already exists.')
    }

    if (targetPath !== entry.filePath) {
      await rename(entry.filePath, targetPath)
      entries[index] = { ...entry, filePath: targetPath }
      await writeRecordingLibrary(entries)
    }

    return {
      renamed: true,
      filePath: targetPath,
      fileName: basename(targetPath)
    }
  }
)

ipcMain.handle(
  'capturelink:recordings-delete',
  async (_event, id: string) => {
    const { entry, entries, index } = await requireLibraryEntry(id)
    const response = mainWindow
      ? await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Delete recording',
          message: `Delete ${basename(entry.filePath)}?`,
          detail: entry.sourceFilePath
            ? 'This deletes both the finished MP4 and its original WebM capture.'
            : 'This permanently deletes the recording file from disk.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
      : await dialog.showMessageBox({
          type: 'warning',
          title: 'Delete recording',
          message: `Delete ${basename(entry.filePath)}?`,
          detail: entry.sourceFilePath
            ? 'This deletes both the finished MP4 and its original WebM capture.'
            : 'This permanently deletes the recording file from disk.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })

    if (response.response !== 1) {
      return { deleted: false }
    }

    const paths = entry.sourceFilePath && entry.sourceFilePath !== entry.filePath
      ? [entry.sourceFilePath, entry.filePath]
      : [entry.filePath]
    for (const path of paths) {
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }

    entries.splice(index, 1)
    await writeRecordingLibrary(entries)
    return { deleted: true }
  }
)

ipcMain.handle(
  'capturelink:recordings-export-original',
  async (_event, id: string) => {
    const { entry } = await requireLibraryEntry(id)

    const originalPath = entry.sourceFilePath ?? entry.filePath
    if (extname(originalPath).toLowerCase() !== '.webm' || !existsSync(originalPath)) {
      throw new Error('The original WebM capture is unavailable.')
    }

    const fileName = `${parse(entry.filePath).name}.webm`
    const options = {
      title: 'Export original CaptureLink recording',
      defaultPath: join(app.getPath('downloads'), fileName),
      filters: [{ name: 'WebM recording', extensions: ['webm'] }]
    }

    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { exported: false }
    }

    await copyFile(originalPath, result.filePath)
    return { exported: true, filePath: result.filePath }
  }
)

ipcMain.handle('capturelink:recordings-export-support', async () => {
  return await getFfmpegSupport()
})

ipcMain.handle(
  'capturelink:recordings-export-converted',
  async (
    _event,
    payload: {
      id: string
      format: RecordingExportFormat
    }
  ) => {
    const { entry } = await requireLibraryEntry(payload?.id)
    const format = payload?.format

    if (!existsSync(entry.filePath)) {
      throw new Error('Recording file is missing from disk.')
    }

    if (format !== 'mp4' && format !== 'mp3' && format !== 'wav') {
      throw new Error('Unsupported CaptureLink export format.')
    }

    if (entry.kind === 'video' && format !== 'mp4') {
      throw new Error('Video recordings currently export to MP4 or original WebM.')
    }

    if (entry.kind === 'audio' && format === 'mp4') {
      throw new Error('Audio recordings currently export to MP3, WAV, or original WebM.')
    }

    if (activeRecordingExport || recordingFinalizing) {
      throw new Error('Another CaptureLink recording operation is running.')
    }

    // A finished MP4 only needs a byte-for-byte copy, not another lossy
    // H.264 encode (and not another FFmpeg dependency).
    const directMp4Copy = entry.kind === 'video' && format === 'mp4' &&
      extname(entry.filePath).toLowerCase() === '.mp4'
    if (!directMp4Copy) {
      const support = await getFfmpegSupport()
      if (!support.available) throw new Error(support.detail)
    }

    const extension = extname(entry.filePath)
    const stem = basename(entry.filePath, extension)
    const fileName = `${stem}.${format}`
    const filterNames: Record<RecordingExportFormat, string> = {
      mp4: 'MP4 video',
      mp3: 'MP3 audio',
      wav: 'WAV audio'
    }
    const options = {
      title: `Export CaptureLink recording as ${format.toUpperCase()}`,
      defaultPath: join(app.getPath('downloads'), fileName),
      filters: [{ name: filterNames[format], extensions: [format] }]
    }

    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { exported: false }
    }

    activeRecordingExport = {
      recordingId: entry.id,
      format
    }

    try {
      if (directMp4Copy) {
        if (result.filePath === entry.filePath) {
          throw new Error('Choose a different destination from the recording itself.')
        }
        const temporary = join(
          dirname(result.filePath),
          `.${basename(result.filePath)}.${randomUUID()}.partial.mp4`
        )
        try {
          await copyFile(entry.filePath, temporary)
          await rename(temporary, result.filePath)
        } catch (error) {
          await unlink(temporary).catch(() => undefined)
          throw error
        }
      } else {
        await exportRecordingWithFfmpeg({
          source: entry,
          format,
          outputPath: result.filePath,
          onProgress: (percent) => {
            mainWindow?.webContents.send(
              'capturelink:recordings-export-progress',
              { id: entry.id, format, percent }
            )
          }
        })
      }

      return {
        exported: true,
        filePath: result.filePath,
        format
      }
    } finally {
      activeRecordingExport = null
    }
  }
)



app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.capturelink.desktop')
  }

  Menu.setApplicationMenu(null)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  void preserveActiveRecording('application shutdown')
  void xboxHome.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
