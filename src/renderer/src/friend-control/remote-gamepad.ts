import type {
  FriendGamepadButton,
  FriendGamepadState
} from './protocol'

const FRAME_INTERVAL_MS = 16
const GAMEPAD_DEADZONE = 0.2
const STANDARD_BUTTON_COUNT = 17
const STANDARD_AXIS_COUNT = 4

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeAxis(value: number): number {
  const clamped = clamp(value, -1, 1)

  if (Math.abs(clamped) < GAMEPAD_DEADZONE) {
    return 0
  }

  return (
    clamped -
    Math.sign(clamped) * GAMEPAD_DEADZONE
  ) / (1 - GAMEPAD_DEADZONE)
}

function getButtonValue(
  state: FriendGamepadState,
  index: number
): number {
  const button = state.buttons[index]

  if (!button) {
    return 0
  }

  return clamp(
    Number.isFinite(button.value)
      ? button.value
      : button.pressed
        ? 1
        : 0,
    0,
    1
  )
}

function getAxisValue(
  state: FriendGamepadState,
  index: number
): number {
  const value = state.axes[index]

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return normalizeAxis(value)
}

function makeButton(value = 0): FriendGamepadButton {
  return {
    pressed: value > 0.5,
    touched: value > 0,
    value
  }
}

export function createNeutralFriendGamepadState(): FriendGamepadState {
  return {
    id: 'CaptureLink Remote Controller',
    index: 0,
    timestamp: performance.now(),
    connected: true,
    mapping: 'standard',
    axes: Array.from(
      { length: STANDARD_AXIS_COUNT },
      () => 0
    ),
    buttons: Array.from(
      { length: STANDARD_BUTTON_COUNT },
      () => makeButton()
    )
  }
}

export function createSyntheticButtonGamepadState(
  buttonIndex: number,
  value = 1
): FriendGamepadState {
  const state = createNeutralFriendGamepadState()

  if (
    buttonIndex >= 0 &&
    buttonIndex < state.buttons.length
  ) {
    state.buttons[buttonIndex] = makeButton(
      clamp(value, 0, 1)
    )
  }

  return state
}

function gamepadHasUsableShape(
  gamepad: Gamepad
): boolean {
  return (
    gamepad.connected &&
    gamepad.axes.length >= 4 &&
    gamepad.buttons.length >= 12
  )
}

function gamepadHasMeaningfulActivity(
  gamepad: Gamepad
): boolean {
  const activeAxis =
    Array.from(gamepad.axes).some(
      (value) =>
        Number.isFinite(value) &&
        Math.abs(value) > 0.18
    )

  const activeButton =
    Array.from(gamepad.buttons).some(
      (button) =>
        button.pressed ||
        button.value > 0.15
    )

  return (
    activeAxis ||
    activeButton
  )
}

function gamepadCompatibilityScore(
  gamepad: Gamepad
): number {
  let score = 0

  /*
   * Chromium's standard mapping is the strongest signal that
   * CaptureLink's Xbox-style button indices are safe to use.
   */
  if (gamepad.mapping === 'standard') {
    score += 1000
  }

  /*
   * Prefer common physical controllers over generic/virtual
   * devices when Windows exposes multiple Gamepad API entries.
   */
  if (
    /xbox|xinput|dualsense|dualshock|wireless controller|8bitdo|gamepad|controller/i
      .test(gamepad.id)
  ) {
    score += 250
  }

  /*
   * A controller the user is actively touching should beat an
   * idle virtual controller or stale device.
   */
  if (
    gamepadHasMeaningfulActivity(
      gamepad
    )
  ) {
    score += 5000
  }

  score +=
    Math.min(
      gamepad.buttons.length,
      32
    )

  score +=
    Math.min(
      gamepad.axes.length,
      16
    )

  return score
}

export function findPhysicalGamepad(
  preferredId: string | null = null,
  preferredIndex: number | null = null
): Gamepad | null {
  const connected =
    Array.from(
      navigator.getGamepads()
    ).filter(
      (gamepad): gamepad is Gamepad =>
        gamepad !== null &&
        gamepadHasUsableShape(
          gamepad
        )
    )

  if (connected.length === 0) {
    return null
  }

  /*
   * Stick to the device already selected for this session.
   * Bluetooth reconnects may receive a new browser index, so
   * fall back to matching the controller ID as well.
   */
  if (preferredId !== null) {
    const exact =
      connected.find(
        (gamepad) =>
          gamepad.id ===
            preferredId &&
          (
            preferredIndex === null ||
            gamepad.index ===
              preferredIndex
          )
      )

    if (exact) {
      return exact
    }

    const sameDevice =
      connected.find(
        (gamepad) =>
          gamepad.id ===
          preferredId
      )

    if (sameDevice) {
      return sameDevice
    }
  }

  return (
    connected
      .slice()
      .sort(
        (first, second) => {
          const scoreDifference =
            gamepadCompatibilityScore(
              second
            ) -
            gamepadCompatibilityScore(
              first
            )

          if (
            scoreDifference !== 0
          ) {
            return scoreDifference
          }

          return (
            first.index -
            second.index
          )
        }
      )[0] ??
    null
  )
}

export function capturePhysicalGamepad(
  gamepad: Gamepad
): FriendGamepadState {
  const axes =
    Array.from(
      {
        length:
          STANDARD_AXIS_COUNT
      },
      (_, index) => {
        const value =
          gamepad.axes[index]

        return (
          typeof value === 'number' &&
          Number.isFinite(value)
        )
          ? clamp(
              value,
              -1,
              1
            )
          : 0
      }
    )

  const buttons =
    Array.from(
      {
        length:
          STANDARD_BUTTON_COUNT
      },
      (_, index) => {
        const button =
          gamepad.buttons[index]

        if (!button) {
          return makeButton()
        }

        const value =
          Number.isFinite(
            button.value
          )
            ? clamp(
                button.value,
                0,
                1
              )
            : (
                button.pressed
                  ? 1
                  : 0
              )

        return {
          pressed:
            button.pressed ||
            value > 0.5,

          touched:
            button.touched ||
            value > 0,

          value
        }
      }
    )

  return {
    id: gamepad.id,
    index: gamepad.index,
    timestamp:
      gamepad.timestamp ||
      performance.now(),
    connected:
      gamepad.connected,
    mapping:
      gamepad.mapping,
    axes,
    buttons
  }
}

export function friendGamepadStateHasInput(
  state: FriendGamepadState
): boolean {
  const axisActive =
    state.axes.some(
      (value) =>
        Number.isFinite(value) &&
        Math.abs(value) > 0.08
    )

  const buttonActive =
    state.buttons.some(
      (button) =>
        button.pressed ||
        button.value > 0.08
    )

  return axisActive || buttonActive
}

export function friendStateToXboxFrame(
  state: FriendGamepadState,
  gamepadIndex = 0
): CaptureLinkXboxGamepadFrame {
  return {
    GamepadIndex: gamepadIndex,

    Nexus: getButtonValue(state, 16),
    Menu: getButtonValue(state, 9),
    View: getButtonValue(state, 8),

    A: getButtonValue(state, 0),
    B: getButtonValue(state, 1),
    X: getButtonValue(state, 2),
    Y: getButtonValue(state, 3),

    DPadUp: getButtonValue(state, 12),
    DPadDown: getButtonValue(state, 13),
    DPadLeft: getButtonValue(state, 14),
    DPadRight: getButtonValue(state, 15),

    LeftShoulder: getButtonValue(state, 4),
    RightShoulder: getButtonValue(state, 5),

    LeftThumb: getButtonValue(state, 10),
    RightThumb: getButtonValue(state, 11),

    LeftThumbXAxis: getAxisValue(state, 0),
    LeftThumbYAxis: getAxisValue(state, 1),
    RightThumbXAxis: getAxisValue(state, 2),
    RightThumbYAxis: getAxisValue(state, 3),

    LeftTrigger: getButtonValue(state, 6),
    RightTrigger: getButtonValue(state, 7)
  }
}

export class RemoteGamepadAdapter {
  private player: CaptureLinkPlayer | null = null
  private timer: number | null = null
  private state: FriendGamepadState =
    createNeutralFriendGamepadState()

  constructor(
    private readonly gamepadIndex = 0
  ) {}

  attach(player: CaptureLinkPlayer): void {
    if (this.player === player && this.timer !== null) {
      return
    }

    this.detach()

    this.player = player
    this.state = createNeutralFriendGamepadState()

    player._channels.control.sendGamepadState(
      this.gamepadIndex,
      true
    )

    this.flush()

    this.timer = window.setInterval(
      () => this.flush(),
      FRAME_INTERVAL_MS
    )
  }

  updateState(state: FriendGamepadState): void {
    this.state = {
      ...state,
      axes: [...state.axes],
      buttons: state.buttons.map((button) => ({
        ...button
      }))
    }

    this.flush()
  }

  detach(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }

    const player = this.player

    if (!player) {
      return
    }

    this.state = createNeutralFriendGamepadState()

    try {
      player._channels.input.queueGamepadFrames([
        friendStateToXboxFrame(
          this.state,
          this.gamepadIndex
        )
      ])
    } catch (error) {
      console.warn(
        '[CaptureLink] Remote controller neutral frame failed:',
        error
      )
    }

    try {
      player._channels.control.sendGamepadState(
        this.gamepadIndex,
        false
      )
    } catch (error) {
      console.warn(
        '[CaptureLink] Remote controller detach failed:',
        error
      )
    }

    this.player = null
  }

  private flush(): void {
    if (!this.player) {
      return
    }

    this.player._channels.input.queueGamepadFrames([
      friendStateToXboxFrame(
        this.state,
        this.gamepadIndex
      )
    ])
  }
}
