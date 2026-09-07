import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getXboxConsoles } from './xbox/consoles'

let mainWindow: BrowserWindow | null = null
let authProcessRunning = false

function getAuthDirectory(): string {
  const directory = join(app.getPath('userData'), 'xbox-auth')
  mkdirSync(directory, { recursive: true })
  return directory
}

function getTokenPath(): string {
  return join(getAuthDirectory(), '.xbox.tokens.json')
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

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
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

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
