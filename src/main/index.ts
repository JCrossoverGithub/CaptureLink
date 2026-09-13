import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { Msal, TokenStore } from 'xal-node'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, open, readFile, rename, stat, statfs, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
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
const xboxHome = new XboxHomeManager()

type RecordingKind = 'audio' | 'video'

interface ActiveRecording {
  id: string
  kind: RecordingKind
  filePath: string
  handle: FileHandle
  bytesWritten: number
  startedAt: number
}

interface RecordingLibraryEntry {
  id: string
  kind: RecordingKind
  filePath: string
  createdAt: string
  durationMs: number
  bytes: number
}

interface RecordingLibraryItem extends RecordingLibraryEntry {
  fileName: string
  exists: boolean
}

let activeRecording: ActiveRecording | null = null
let recordingClosePromptOpen = false
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
        typeof candidate.bytes === 'number'
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

    return {
      ...entry,
      bytes,
      fileName: basename(entry.filePath),
      exists
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
        permission === 'speaker-selection'
      )
    }
  )

  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const isCaptureLinkWindow = webContents.id === window.webContents.id
      callback(isCaptureLinkWindow && (
        permission === 'media' ||
        permission === 'speaker-selection'
      ))
    }
  )

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('close', (event) => {
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
ipcMain.handle('capturelink:xbox-auth-status', () => {
  return {
    authenticated: existsSync(getTokenPath())
  }
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

      await shell.openExternal(
        deviceCodeDetails.verification_uri
      )

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
    if (activeRecording) {
      throw new Error('A CaptureLink recording is already active.')
    }

    if (payload?.kind !== 'audio' && payload?.kind !== 'video') {
      throw new Error('Recording kind must be audio or video.')
    }

    const kind = payload.kind
    const suggestedName = kind === 'video'
      ? sanitizeVideoRecordingName(payload.suggestedName)
      : sanitizeRecordingName(payload.suggestedName)
    const defaultPath = join(getRecordingDirectory(), suggestedName)
    const options = {
      title: kind === 'video'
        ? 'Choose CaptureLink video recording location'
        : 'Choose CaptureLink audio recording location',
      defaultPath,
      filters: [
        {
          name: kind === 'video' ? 'WebM video' : 'WebM audio',
          extensions: ['webm']
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

    const directory = dirname(result.filePath)
    const availableBytes = await getAvailableDiskBytes(directory)
    const minimumBytes = MINIMUM_START_SPACE[kind]

    if (availableBytes < minimumBytes) {
      throw new Error(
        `Not enough free disk space to start ${kind} recording. ` +
        `${formatDiskSpace(availableBytes)} is available; ` +
        `CaptureLink requires at least ${formatDiskSpace(minimumBytes)}.`
      )
    }

    const handle = await open(result.filePath, 'w')
    const recording: ActiveRecording = {
      id: randomUUID(),
      kind,
      filePath: result.filePath,
      handle,
      bytesWritten: 0,
      startedAt: Date.now()
    }

    activeRecording = recording
    closeAfterRecording = false

    console.log(`[CaptureLink] ${kind} recording opened: ${recording.filePath}`)

    return {
      started: true,
      recordingId: recording.id,
      filePath: recording.filePath,
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

    try {
      await closeRecordingFile(recording)

      if (recording.bytesWritten === 0) {
        await unlink(recording.filePath).catch(() => undefined)
        throw new Error('The recorder produced an empty file.')
      }

      console.log(
        `[CaptureLink] ${recording.kind} recording finalized: ${recording.filePath}`
      )

      await upsertRecordingLibraryEntry({
        id: recording.id,
        kind: recording.kind,
        filePath: recording.filePath,
        createdAt: new Date(recording.startedAt).toISOString(),
        durationMs: Math.max(0, Date.now() - recording.startedAt),
        bytes: recording.bytesWritten
      })

      const result = {
        saved: true,
        filePath: recording.filePath,
        bytesWritten: recording.bytesWritten
      }

      if (closeAfterRecording) {
        setTimeout(() => {
          mainWindow?.destroy()
        }, 150)
      }

      return result
    } catch (error) {
      if (closeAfterRecording) {
        closeAfterRecording = false
      }
      throw error
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
          detail: 'This permanently deletes the recording file from disk.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
      : await dialog.showMessageBox({
          type: 'warning',
          title: 'Delete recording',
          message: `Delete ${basename(entry.filePath)}?`,
          detail: 'This permanently deletes the recording file from disk.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })

    if (response.response !== 1) {
      return { deleted: false }
    }

    await unlink(entry.filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })

    entries.splice(index, 1)
    await writeRecordingLibrary(entries)
    return { deleted: true }
  }
)

ipcMain.handle(
  'capturelink:recordings-export-original',
  async (_event, id: string) => {
    const { entry } = await requireLibraryEntry(id)

    if (!existsSync(entry.filePath)) {
      throw new Error('Recording file is missing from disk.')
    }

    const fileName = basename(entry.filePath)
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

    await copyFile(entry.filePath, result.filePath)
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

    if (activeRecordingExport) {
      throw new Error('Another CaptureLink export is already running.')
    }

    const support = await getFfmpegSupport()

    if (!support.available) {
      throw new Error(support.detail)
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

      return {
        exported: true,
        filePath: result.filePath,
        format
      }
    } catch (error) {
      await unlink(result.filePath).catch(() => undefined)
      throw error
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
