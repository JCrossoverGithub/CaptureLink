import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Msal, TokenStore } from 'xal-node'

type StatusCallback = (status: string) => void

interface StartSessionResponse {
  sessionId: string
  sessionPath: string
  state: string
}

interface SessionStateResponse {
  state?: string
  errorDetails?: {
    code?: string
    message?: string
  }
}

interface ExchangeResponse {
  exchangeResponse?: unknown
  errorDetails?: {
    code?: string
    message?: string
  }
}

interface ActiveSession {
  sessionId: string
  sessionPath: string
  host: string
  token: string
  keepalive?: ReturnType<typeof setInterval>
}

export interface LocalIceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function getTokenPath(): string {
  return join(
    app.getPath('userData'),
    'xbox-auth',
    '.xbox.tokens.json'
  )
}

function getDeviceInfo(): string {
  return JSON.stringify({
    appInfo: {
      env: {
        clientAppId: 'www.xbox.com',
        clientAppType: 'browser',
        clientAppVersion: '21.1.98',
        clientSdkVersion: '8.5.3',
        httpEnvironment: 'prod',
        sdkInstallId: ''
      }
    },
    dev: {
      hw: {
        make: 'Microsoft',
        model: 'unknown',
        sdktype: 'web'
      },
      os: {
        name: 'windows',
        ver: '22631.2715',
        platform: 'desktop'
      },
      displayInfo: {
        dimensions: {
          widthInPixels: 1920,
          heightInPixels: 1080
        },
        pixelDensity: {
          dpiX: 2,
          dpiY: 2
        }
      },
      browser: {
        browserName: 'chrome',
        browserVersion: '119.0'
      }
    }
  })
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function describeBody(body: unknown): string {
  if (typeof body === 'string') {
    return body
  }

  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

export class XboxHomeManager {
  private activeSession: ActiveSession | null = null
  private msal: Msal | null = null

  private createMsal(): Msal {
    const tokenPath = getTokenPath()

    if (!existsSync(tokenPath)) {
      throw new Error(
        'Xbox authentication was not found. Sign in with Microsoft first.'
      )
    }

    const tokenStore = new TokenStore()
    tokenStore.load(tokenPath)

    const msal = new Msal(tokenStore)
    this.msal = msal

    return msal
  }

  private async getStreamingContext(): Promise<{
    host: string
    token: string
    msal: Msal
  }> {
    const msal = this.createMsal()

    console.log('[CaptureLink] Requesting xHome streaming token')
    const tokens = await msal.getStreamingTokens()
    const xHomeToken = tokens.xHomeToken

    if (!xHomeToken) {
      throw new Error('This account did not return an xHome streaming token.')
    }

    const token = xHomeToken.data.gsToken
    const host = xHomeToken.getDefaultRegion().baseUri

    if (!token || !host) {
      throw new Error('The xHome streaming token is missing its host or token data.')
    }

    return { host, token, msal }
  }

  private requireSession(): ActiveSession {
    if (!this.activeSession) {
      throw new Error('No active Xbox Remote Play session exists.')
    }

    return this.activeSession
  }

  private async request(
    session: Pick<ActiveSession, 'host' | 'token'>,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await fetch(`${session.host}${normalizePath(path)}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Gssv-Client': 'XboxComBrowser',
        'X-MS-Device-Info': getDeviceInfo(),
        Authorization: `Bearer ${session.token}`
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) })
    })

    const text = await response.text()
    let parsed: unknown = { status: response.status }

    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      throw new Error(
        `Xbox xHome ${method} ${path} failed (${response.status}): ${describeBody(parsed)}`
      )
    }

    return parsed
  }

  private startKeepalive(): void {
    const session = this.requireSession()

    if (session.keepalive) {
      clearInterval(session.keepalive)
    }

    session.keepalive = setInterval(() => {
      void this.request(
        session,
        'POST',
        `${normalizePath(session.sessionPath)}/keepalive`,
        ''
      ).then((result) => {
        console.log('[CaptureLink] xHome keepalive:', result)
      }).catch((error) => {
        console.warn('[CaptureLink] xHome keepalive failed:', error)
      })
    }, 30_000)
  }

  async start(
    serverId: string,
    onStatus: StatusCallback = () => {}
  ): Promise<{ sessionId: string; state: string }> {
    if (!/^[A-Za-z0-9._:-]+$/.test(serverId)) {
      throw new Error('Xbox server ID contains unexpected characters.')
    }

    if (this.activeSession) {
      await this.stop().catch(() => undefined)
    }

    onStatus('Requesting xHome streaming token...')
    const { host, token, msal } = await this.getStreamingContext()

    onStatus('Requesting Remote Play session...')
    const startResponse = await this.request(
      { host, token },
      'POST',
      '/v5/sessions/home/play',
      {
        clientSessionId: '',
        titleId: '',
        systemUpdateGroup: '',
        settings: {
          nanoVersion: 'V3;WebrtcTransport.dll',
          enableOptionalDataCollection: false,
          enableTextToSpeech: false,
          highContrast: 0,
          locale: 'en-US',
          useIceConnection: false,
          timezoneOffsetMinutes: 120,
          sdkType: 'web',
          osName: 'windows'
        },
        serverId,
        fallbackRegionNames: []
      }
    ) as StartSessionResponse

    if (!startResponse.sessionId || !startResponse.sessionPath) {
      throw new Error(
        `Xbox returned an invalid Remote Play session: ${describeBody(startResponse)}`
      )
    }

    const session: ActiveSession = {
      sessionId: startResponse.sessionId,
      sessionPath: startResponse.sessionPath,
      host,
      token
    }

    this.activeSession = session
    this.msal = msal

    let connectSent = false
    let previousState = ''

    for (let attempt = 1; attempt <= 120; attempt += 1) {
      const stateResponse = await this.request(
        session,
        'GET',
        `${normalizePath(session.sessionPath)}/state`
      ) as SessionStateResponse

      const state = stateResponse.state ?? 'Unknown'

      if (state !== previousState) {
        console.log(
          `[CaptureLink] xHome session state: ${state}`,
          stateResponse
        )
        onStatus(`Xbox session: ${state}`)
        previousState = state
      }

      if (state === 'ReadyToConnect' && !connectSent) {
        onStatus('Xbox is ready. Sending Microsoft session token...')
        const msalToken = await msal.getMsalToken()
        const lpt = msalToken.data.lpt

        if (!lpt) {
          throw new Error('Microsoft session token did not contain an LPT value.')
        }

        await this.request(
          session,
          'POST',
          `${normalizePath(session.sessionPath)}/connect`,
          { userToken: lpt }
        )

        connectSent = true
      }

      if (state === 'Provisioned') {
        onStatus('Xbox session provisioned. Starting WebRTC...')
        this.startKeepalive()

        return {
          sessionId: session.sessionId,
          state
        }
      }

      if (state === 'Failed' || state === 'Error') {
        console.error(
          '[CaptureLink] xHome session failure:',
          describeBody(stateResponse)
        )

        const code = stateResponse.errorDetails?.code
        const message = stateResponse.errorDetails?.message

        throw new Error(
          [
            `Xbox session entered the ${state} state.`,
            code ? `Code: ${code}.` : '',
            message ? `Message: ${message}` : '',
            !code && !message
              ? `Response: ${describeBody(stateResponse)}`
              : ''
          ]
            .filter(Boolean)
            .join(' ')
        )
      }

      await sleep(500)
    }

    throw new Error('Timed out waiting for the Xbox Remote Play session to provision.')
  }

  async exchangeSdp(
    sdp: string,
    chatRenegotiation = false
  ): Promise<{ sdp: string }> {
    const session = this.requireSession()

    if (!sdp.trim()) {
      throw new Error('Local WebRTC SDP offer is empty.')
    }

    const configuration = chatRenegotiation
      ? { isMediaStreamsChatRenegotiation: true }
      : {
          chatConfiguration: {
            bytesPerSample: 2,
            expectedClipDurationMs: 20,
            format: {
              codec: 'opus',
              container: 'webm'
            },
            numChannels: 1,
            sampleFrequencyHz: 24000
          },
          chat: { minVersion: 1, maxVersion: 1 },
          control: { minVersion: 1, maxVersion: 3 },
          input: { minVersion: 1, maxVersion: 9 },
          message: { minVersion: 1, maxVersion: 1 },
          reliableinput: { minVersion: 9, maxVersion: 9 },
          unreliableinput: { minVersion: 9, maxVersion: 9 }
        }

    await this.request(
      session,
      'POST',
      `${normalizePath(session.sessionPath)}/sdp`,
      {
        messageType: 'offer',
        sdp,
        requestId: chatRenegotiation ? 2 : '1',
        configuration
      }
    )

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const response = await this.request(
        session,
        'GET',
        `${normalizePath(session.sessionPath)}/sdp`
      ) as ExchangeResponse

      if (response.errorDetails?.code) {
        throw new Error(
          response.errorDetails.message ?? response.errorDetails.code
        )
      }

      let exchange: unknown = response.exchangeResponse

      if (typeof exchange === 'string' && exchange.trim().length > 0) {
        try {
          exchange = JSON.parse(exchange)
        } catch {
          exchange = null
        }
      }

      if (
        exchange &&
        typeof exchange === 'object' &&
        'sdp' in exchange &&
        typeof (exchange as { sdp?: unknown }).sdp === 'string' &&
        (exchange as { sdp: string }).sdp.length > 0
      ) {
        console.log('[CaptureLink] Valid Xbox SDP answer received')
        return { sdp: (exchange as { sdp: string }).sdp }
      }

      console.log(`[CaptureLink] SDP pending (${attempt}/60)`)
      await sleep(500)
    }

    throw new Error('Timed out waiting for a valid Xbox SDP answer.')
  }

  async exchangeIce(
    candidates: LocalIceCandidate[]
  ): Promise<unknown[]> {
    const session = this.requireSession()

    if (candidates.length === 0) {
      throw new Error('No local ICE candidates were available to send to Xbox.')
    }

    const serializedCandidates = candidates.map((candidate) =>
      JSON.stringify(candidate)
    )

    await this.request(
      session,
      'POST',
      `${normalizePath(session.sessionPath)}/ice`,
      { candidates: serializedCandidates }
    )

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const response = await this.request(
        session,
        'GET',
        `${normalizePath(session.sessionPath)}/ice`
      ) as ExchangeResponse

      if (response.errorDetails?.code) {
        throw new Error(
          response.errorDetails.message ?? response.errorDetails.code
        )
      }

      let exchange: unknown = response.exchangeResponse

      if (typeof exchange === 'string' && exchange.trim().length > 0) {
        try {
          exchange = JSON.parse(exchange)
        } catch {
          exchange = null
        }
      }

      if (Array.isArray(exchange) && exchange.length > 0) {
        console.log('[CaptureLink] Valid Xbox ICE response received')
        return exchange
      }

      console.log(`[CaptureLink] ICE pending (${attempt}/60)`)
      await sleep(1000)
    }

    throw new Error('Timed out waiting for valid Xbox ICE candidates.')
  }

  async stop(): Promise<void> {
    const session = this.activeSession

    if (!session) {
      return
    }

    if (session.keepalive) {
      clearInterval(session.keepalive)
    }

    this.activeSession = null
    this.msal = null

    try {
      await this.request(
        session,
        'DELETE',
        normalizePath(session.sessionPath)
      )
      console.log('[CaptureLink] Xbox Remote Play session stopped')
    } catch (error) {
      console.warn('[CaptureLink] Failed to stop Xbox session cleanly:', error)
    }
  }
}
