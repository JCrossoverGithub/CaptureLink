import { contextBridge, ipcRenderer } from 'electron'

interface IceCandidatePayload {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

contextBridge.exposeInMainWorld('captureLink', {
  platform: process.platform,
  version: '0.1.0',

  getXboxAuthStatus: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-status'),

  getXboxConsoles: () =>
    ipcRenderer.invoke('capturelink:xbox-consoles'),

  startXboxAuth: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-start'),

  startXboxStream: (serverId: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-start', serverId),

  exchangeXboxSdp: (sdp: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-sdp', sdp),

  exchangeXboxIce: (candidates: IceCandidatePayload[]) =>
    ipcRenderer.invoke('capturelink:xbox-stream-ice', candidates),

  exchangeXboxChatSdp: (sdp: string) =>
    ipcRenderer.invoke('capturelink:xbox-stream-chat-sdp', sdp),

  stopXboxStream: () =>
    ipcRenderer.invoke('capturelink:xbox-stream-stop'),


  saveAudioRecording: (
    data: ArrayBuffer,
    suggestedName: string
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-save-audio',
      { data, suggestedName }
    ),

  saveVideoRecording: (
    data: ArrayBuffer,
    suggestedName: string
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-save-video',
      { data, suggestedName }
    ),

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
  },

  onXboxStreamStatus: (
    callback: (status: string) => void
  ) => {
    ipcRenderer.on(
      'capturelink:xbox-stream-status',
      (_event, status: string) => callback(status)
    )
  }
})
