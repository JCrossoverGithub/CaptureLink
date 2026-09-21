export const FRIEND_PROTOCOL_VERSION = 1 as const

export type FriendRole =
  | 'host'
  | 'guest'

export type FriendPermission =
  | 'view'
  | 'control'

export interface FriendGamepadButton {
  pressed: boolean
  touched: boolean
  value: number
}

export interface FriendGamepadState {
  id: string
  index: number
  timestamp: number
  connected: boolean
  mapping: string
  axes: number[]
  buttons: FriendGamepadButton[]
}

export interface FriendHelloMessage {
  type: 'hello'
  protocolVersion: typeof FRIEND_PROTOCOL_VERSION
  sessionId: string
  role: FriendRole
}

export interface FriendPermissionMessage {
  type: 'permission'
  view: boolean
  control: boolean
}

export interface FriendGamepadMessage {
  type: 'gamepad'
  sequence: number
  state: FriendGamepadState
}

export interface FriendPingMessage {
  type: 'ping'
  sentAt: number
}

export interface FriendPongMessage {
  type: 'pong'
  sentAt: number
}

export type FriendWireMessage =
  | FriendHelloMessage
  | FriendPermissionMessage
  | FriendGamepadMessage
  | FriendPingMessage
  | FriendPongMessage

export function serializeFriendMessage(
  message: FriendWireMessage
): string {
  return JSON.stringify(message)
}

export function parseFriendMessage(
  payload: string
): FriendWireMessage {
  const parsed: unknown = JSON.parse(payload)

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    typeof parsed.type !== 'string'
  ) {
    throw new Error('Invalid CaptureLink friend message.')
  }

  return parsed as FriendWireMessage
}
