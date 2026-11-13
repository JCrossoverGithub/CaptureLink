import { contextBridge, ipcRenderer } from 'electron'

interface IceCandidatePayload {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

contextBridge.exposeInMainWorld('captureLink', {
  platform: process.platform,
  version: '0.2.0',

  // UX3F-3B2: only status booleans and commands, never Auth0 credentials.
  onlineAuthStatus: () => ipcRenderer.invoke('capturelink:online-auth-status'),
  onlineAuthBegin: () => ipcRenderer.invoke('capturelink:online-auth-begin'),
  onlineAuthSignOut: () => ipcRenderer.invoke('capturelink:online-auth-sign-out'),

  // Only an unprivileged mode status crosses IPC, never admission credentials.
  hostedMode: () => ipcRenderer.invoke('capturelink:hosted-mode'),
  // Main-process-only tokens: only code, sanitized status, and UX2 wire cross IPC.
  hostedCreate: (permissions: { watch: boolean; voice: boolean; controller: boolean; controllerMode: 'shared' | 'player2' }) =>
    ipcRenderer.invoke('capturelink:hosted-create', permissions),
  hostedJoin: (code: string, displayName: string) => ipcRenderer.invoke('capturelink:hosted-join', code, displayName),
  hostedSnapshot: () => ipcRenderer.invoke('capturelink:hosted-snapshot'),
  hostedApprove: (allowed: boolean) => ipcRenderer.invoke('capturelink:hosted-approve', allowed),
  hostedSend: (kind: 'invite' | 'response', wire: string) => ipcRenderer.invoke('capturelink:hosted-send', kind, wire),
  hostedMessages: () => ipcRenderer.invoke('capturelink:hosted-messages'),
  hostedEnd: () => ipcRenderer.invoke('capturelink:hosted-end'),

  writeFriendClipboard: (value: string) =>
    ipcRenderer.invoke(
      'capturelink:friend-clipboard-write',
      value
    ),

  readFriendClipboard: () =>
    ipcRenderer.invoke(
      'capturelink:friend-clipboard-read'
    ),

  getXboxAuthStatus: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-status'),

  signOutXbox: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-sign-out'),

  getXboxConsoles: () =>
    ipcRenderer.invoke('capturelink:xbox-consoles'),

  startXboxAuth: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-start'),

  openXboxAuthVerification: () =>
    ipcRenderer.invoke('capturelink:xbox-auth-open-verification'),

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

  setWindowFullscreen: (fullscreen: boolean) =>
    ipcRenderer.invoke(
      'capturelink:window-set-fullscreen',
      fullscreen
    ),


  beginRecording: (
    kind: 'audio' | 'video',
    suggestedName: string,
    mp4Quality: 'balanced' | 'smaller' = 'balanced'
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-begin',
      { kind, suggestedName, mp4Quality }
    ),

  appendRecordingChunk: (
    recordingId: string,
    data: ArrayBuffer
  ) =>
    ipcRenderer.invoke(
      'capturelink:recording-append',
      { recordingId, data }
    ),

  finalizeRecording: (recordingId: string) =>
    ipcRenderer.invoke(
      'capturelink:recording-finalize',
      recordingId
    ),

  cancelRecording: (recordingId: string) =>
    ipcRenderer.invoke(
      'capturelink:recording-cancel',
      recordingId
    ),

  getRecordings: () =>
    ipcRenderer.invoke('capturelink:recordings-list'),

  openRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-open', id),

  showRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-show', id),

  renameRecording: (id: string, name: string) =>
    ipcRenderer.invoke(
      'capturelink:recordings-rename',
      { id, name }
    ),

  deleteRecording: (id: string) =>
    ipcRenderer.invoke('capturelink:recordings-delete', id),

  exportOriginalRecording: (id: string) =>
    ipcRenderer.invoke(
      'capturelink:recordings-export-original',
      id
    ),

  getRecordingExportSupport: () =>
    ipcRenderer.invoke('capturelink:recordings-export-support'),

  exportRecording: (
    id: string,
    format: 'mp4' | 'mp3' | 'wav'
  ) =>
    ipcRenderer.invoke(
      'capturelink:recordings-export-converted',
      { id, format }
    ),


  onRecordingMp4Progress: (callback: (percent: number) => void) => {
    ipcRenderer.on('capturelink:recording-mp4-progress', (_event, percent: number) => callback(percent))
  },

  onXboxAuthDeviceCode: (
    callback: (info: { userCode: string; verificationUri: string; expiresIn: number }) => void
  ) => {
    ipcRenderer.on('capturelink:xbox-auth-device-code', (_event, info) => callback(info))
  },

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

  onRecordingStopRequested: (
    callback: () => void
  ) => {
    ipcRenderer.on(
      'capturelink:recording-stop-request',
      () => callback()
    )
  },

  onRecordingExportProgress: (
    callback: (progress: {
      id: string
      format: 'mp4' | 'mp3' | 'wav'
      percent: number
    }) => void
  ) => {
    ipcRenderer.on(
      'capturelink:recordings-export-progress',
      (_event, progress) => callback(progress)
    )
  },

  onWindowFullscreenChanged: (
    callback: (fullscreen: boolean) => void
  ) => {
    ipcRenderer.on(
      'capturelink:window-fullscreen-changed',
      (_event, fullscreen: boolean) => callback(fullscreen)
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
