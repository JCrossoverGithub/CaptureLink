/** Product setting: how frequently CaptureLink samples PC-connected controller state.
 * This does not alter Xbox's controller frequency, game simulation, or WebRTC.
 */
export type ControllerResponsivenessMode = 'competitive' | 'standard'

const STORAGE_KEY = 'capturelink.controllerResponsiveness'

function loadMode(): ControllerResponsivenessMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'standard'
      ? 'standard'
      : 'competitive'
  } catch {
    return 'competitive'
  }
}

function persistMode(mode: ControllerResponsivenessMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Preference storage failures cannot interrupt active gameplay.
  }
}

export function installControllerResponsiveness(options: {
  onModeChanged: () => void
}): {
  getIntervalMs: () => 4 | 16
  getMode: () => ControllerResponsivenessMode
} {
  let mode = loadMode()
  const settingsGrid = document.querySelector<HTMLElement>('.settings-grid')
  if (!settingsGrid) {
    throw new Error('Controller responsiveness: Settings grid not found')
  }
  if (document.querySelector('#controller-responsiveness-card')) {
    throw new Error('Controller responsiveness: duplicate settings card')
  }

  const card = document.createElement('article')
  card.id = 'controller-responsiveness-card'
  card.className = 'surface settings-card controller-responsiveness-card'
  card.innerHTML = `
    <div class="settings-card__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M6 11h12a3 3 0 0 1 2.7 4.3l-1.4 3a2 2 0 0 1-3.2.6L14 17h-4l-2.1 1.9a2 2 0 0 1-3.2-.6l-1.4-3A3 3 0 0 1 6 11Z"/><path d="M8 14v2M7 15h2M16 14h.01M18 16h.01"/></svg>
    </div>
    <div class="settings-card__body controller-responsiveness-card__body">
      <div class="eyebrow">CONTROLLER</div>
      <h2>Controller responsiveness</h2>
      <p>Choose how often CaptureLink reads a controller connected to this PC.</p>
      <fieldset class="controller-responsiveness-options">
        <legend class="controller-responsiveness-sr-only">Controller polling mode</legend>
        <label class="controller-responsiveness-option">
          <input type="radio" name="controller-responsiveness" value="competitive" />
          <span><strong>Competitive</strong><small>Faster input sampling (4 ms)</small></span>
        </label>
        <label class="controller-responsiveness-option">
          <input type="radio" name="controller-responsiveness" value="standard" />
          <span><strong>Standard</strong><small>Original input sampling (16 ms)</small></span>
        </label>
      </fieldset>
      <p class="controller-responsiveness-note">Applies to PC-connected controllers during Xbox streaming and Friend hosting. It does not change Xbox network latency.</p>
    </div>
  `
  // Follow account settings; leave the existing diagnostic/setup cards untouched.
  const accountCard = settingsGrid.querySelector('.settings-card--account')
  accountCard?.after(card)
  if (!accountCard) settingsGrid.prepend(card)

  const radios = Array.from(card.querySelectorAll<HTMLInputElement>(
    'input[name="controller-responsiveness"]'
  ))
  function render(): void {
    for (const radio of radios) radio.checked = radio.value === mode
  }
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      const next: ControllerResponsivenessMode =
        radio.value === 'standard' ? 'standard' : 'competitive'
      if (next === mode) return
      mode = next
      persistMode(next)
      options.onModeChanged()
      render()
    })
  }
  render()
  return {
    getIntervalMs: () => mode === 'standard' ? 16 : 4,
    getMode: () => mode
  }
}
