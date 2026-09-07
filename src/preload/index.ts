import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('captureLink', {
  platform: process.platform,
  version: '0.1.0',

  getXboxAuthStatus: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-status'),

  getXboxConsoles: () =>
    ipcRenderer.invoke('capturelink:xbox-consoles'),

  startXboxAuth: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-start'),

  onXboxAuthOutput: (
    callback: (message: string) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-auth-output',
      (_event, message: string) => callback(message)
    )
  },

  onXboxAuthComplete: (
    callback: (
      result: {
        success: boolean
        message: string
      }
    ) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-auth-complete',
      (_event, result) => callback(result)
    )
  }
})
