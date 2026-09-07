import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { open, statfs, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getXboxConsoles } from './xbox/consoles'
import {
  type LocalIceCandidate,
  XboxHomeManager
} from './xbox/xhome'

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
}

let activeRecording: ActiveRecording | null = null
let recordingClosePromptOpen = false
let closeAfterRecording = false

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
    console.warn(
      `[CaptureLink] Preserved partial ${recording.kind} recording after ${reason}: ${recording.filePath}`
    )
  } catch (error) {
    console.error('[CaptureLink] Failed to close partial recording:', error)
  }
}

function getXboxAuthExecutable(): string {
  const executable =
    process.platform === 'win32' ? 'xbox-auth.cmd' : 'xbox-auth'

  return join(
    app.getAppPath(),
    'node_modules',
    '.bin',
    executable
  )
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

  const executable = getXboxAuthExecutable()

  if (!existsSync(executable)) {
    throw new Error(`Xbox authentication executable not found: ${executable}`)
  }

  authProcessRunning = true

  const authDirectory = getAuthDirectory()

  const child = spawn(
    executable,
    ['auth', '--auth', 'msal'],
    {
      cwd: authDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let microsoftLinkOpened = false

  const emit = (message: string): void => {
    mainWindow?.webContents.send(
      'capturelink:xbox-auth-output',
      message
    )

    if (
      !microsoftLinkOpened &&
      message.includes('https://www.microsoft.com/link')
    ) {
      microsoftLinkOpened = true
      void shell.openExternal('https://www.microsoft.com/link')
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    emit(chunk.toString())
  })

  child.stderr.on('data', (chunk: Buffer) => {
    emit(chunk.toString())
  })

  child.on('error', (error) => {
    authProcessRunning = false

    mainWindow?.webContents.send(
      'capturelink:xbox-auth-complete',
      {
        success: false,
        message: error.message
      }
    )
  })

  child.on('close', (code) => {
    authProcessRunning = false

    const success =
      code === 0 &&
      existsSync(getTokenPath())

    mainWindow?.webContents.send(
      'capturelink:xbox-auth-complete',
      {
        success,
        message: success
          ? 'Authentication succeeded.'
          : `Authentication failed with exit code ${code ?? 'unknown'}.`
      }
    )
  })

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
      bytesWritten: 0
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


app.whenReady().then(() => {
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
