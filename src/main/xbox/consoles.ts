import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Msal, TokenStore } from 'xal-node'

export interface XboxConsole {
  serverId: string
  deviceName: string
  powerState: string
  consoleType: string
}

interface XboxWebTokenData {
  Token: string
  DisplayClaims: {
    xui: Array<{
      uhs: string
    }>
  }
}

interface XboxDeviceResponse {
  status?: {
    errorCode?: string
    errorMessage?: string | null
  }
  result?: Array<{
    id: string
    name: string
    powerState: string
    consoleType: string
  }>
}

function getTokenPath(): string {
  return join(
    app.getPath('userData'),
    'xbox-auth',
    '.xbox.tokens.json'
  )
}

async function getWebToken(): Promise<XboxWebTokenData> {
  const tokenPath = getTokenPath()

  if (!existsSync(tokenPath)) {
    throw new Error(
      'Xbox authentication was not found. Sign in with Microsoft first.'
    )
  }

  const tokenStore = new TokenStore()
  tokenStore.load(tokenPath)

  const msal = new Msal(tokenStore)
  const webToken = await msal.getWebToken()

  return webToken.data as XboxWebTokenData
}

export async function getXboxConsoles(): Promise<XboxConsole[]> {
  console.log('[CaptureLink] Requesting Xbox web token')

  const tokenData = await getWebToken()
  const userHash = tokenData.DisplayClaims?.xui?.[0]?.uhs

  if (!userHash || !tokenData.Token) {
    throw new Error('Xbox web token is missing required claims.')
  }

  console.log('[CaptureLink] Discovering Xbox consoles')

  const response = await fetch(
    'https://xccs.xboxlive.com/lists/devices?queryCurrentDevice=false&includeStorageDevices=true',
    {
      method: 'GET',
      headers: {
        Authorization: `XBL3.0 x=${userHash};${tokenData.Token}`,
        'Accept-Language': 'en-US',
        'x-xbl-contract-version': '2',
        'x-xbl-client-name': 'XboxApp',
        'x-xbl-client-type': 'UWA',
        'x-xbl-client-version': '39.39.22001.0'
      }
    }
  )

  if (!response.ok) {
    const body = await response.text()

    throw new Error(
      `Xbox console discovery failed (${response.status}): ${body}`
    )
  }

  const body = (await response.json()) as XboxDeviceResponse

  if (
    body.status?.errorCode &&
    body.status.errorCode !== 'OK'
  ) {
    throw new Error(
      body.status.errorMessage ??
        `Xbox returned ${body.status.errorCode}`
    )
  }

  const consoles = body.result ?? []

  console.log(
    `[CaptureLink] Discovered ${consoles.length} Xbox console(s)`
  )

  return consoles.map((console) => ({
    serverId: console.id,
    deviceName: console.name,
    powerState: console.powerState,
    consoleType: console.consoleType
  }))
}
