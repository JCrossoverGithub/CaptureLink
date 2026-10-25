/** CaptureLink appearance: fixed Slate surfaces, customizable accent. No Xbox/session dependencies. */
type Accent = 'green' | 'blue' | 'violet' | 'teal' | 'amber' | 'custom'
type Preferences = { accent: Accent; custom: string }
const KEY = 'capturelink.appearance.v2' // Preserve current users' saved accent settings.
const LEGACY_KEY = 'capturelink.appearance.v1'
const SWATCHES: Record<Exclude<Accent, 'custom'>, string> = {
  green: '#43e06f',
  blue: '#629af6',
  violet: '#b296f5',
  teal: '#44cfc5',
  amber: '#edb65b'
}
const LABELS: Record<Accent, string> = {
  green: 'Green', blue: 'Blue', violet: 'Violet', teal: 'Teal', amber: 'Amber', custom: 'Custom'
}
const DEFAULTS: Preferences = { accent: 'green', custom: '#43e06f' }
const VALID_ACCENTS: Accent[] = ['green', 'blue', 'violet', 'teal', 'amber', 'custom']
const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

function validAccent(value: unknown): Accent {
  const normalized = value === 'xbox' ? 'green' : value === 'ocean' ? 'blue' : value === 'iris' ? 'violet' : value
  return VALID_ACCENTS.includes(normalized as Accent) ? normalized as Accent : 'green'
}
function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) {
      const value = JSON.parse(stored) as { accent?: string; custom?: string }
      return { accent: validAccent(value.accent), custom: isHex(value.custom) ? value.custom : DEFAULTS.custom }
    }
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) {
      const value = JSON.parse(old) as { palette?: string; custom?: string }
      return { accent: validAccent(value.palette), custom: isHex(value.custom) ? value.custom : DEFAULTS.custom }
    }
  } catch { /* Corrupt/unavailable storage should never block the application. */ }
  return { ...DEFAULTS }
}
function persist(): void {
  try {
    // Explicitly discard the previous tone preference. Slate is permanent.
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, tone: 'slate' }))
  } catch { /* Best effort. */ }
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05)
}
function mix(a: string, b: string, proportion: number): string {
  return '#' + [1, 3, 5].map(i => {
    const low = Number.parseInt(a.slice(i, i + 2), 16)
    const high = Number.parseInt(b.slice(i, i + 2), 16)
    return Math.round(low * (1 - proportion) + high * proportion).toString(16).padStart(2, '0')
  }).join('')
}
function readableAccent(hex: string): string {
  // Accents used as fine text/icons must remain legible against Slate cards.
  let value = hex
  for (let i = 0; i < 32 && contrast(value, '#202b35') < 4.5; i++) {
    value = mix(value, '#ffffff', 0.1)
  }
  return value
}
const prefs = readPreferences()
function applyTheme(): void {
  const root = document.documentElement
  const hex = prefs.accent === 'custom' ? prefs.custom : SWATCHES[prefs.accent]
  root.dataset.clTone = 'slate'
  root.dataset.clAccent = prefs.accent
  root.style.setProperty('--cl-accent', hex)
  root.style.setProperty('--cl-accent-ink', readableAccent(hex))
  root.style.setProperty('--cl-on-accent', contrast(hex, '#101820') >= 4.5 ? '#101820' : '#ffffff')
  root.style.setProperty('color-scheme', 'dark')
}
applyTheme()

export function installCaptureLinkAppearance(): void {
  const parent = document.querySelector<HTMLElement>('.settings-grid')
  if (!parent) throw new Error('CaptureLink settings grid not found')
  if (document.getElementById('capturelink-appearance')) throw new Error('Appearance preferences installed twice')
  const card = document.createElement('article')
  card.id = 'capturelink-appearance'
  card.className = 'surface settings-card cl-appearance'
  card.innerHTML = `
    <div class="settings-card__icon cl-appearance__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1.6-3.3 1.7 1.7 0 0 1 1.3-2.8h2a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="8" cy="12" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="16" cy="9" r="1"/></svg>
    </div>
    <div class="settings-card__body cl-appearance__body">
      <div class="eyebrow">APPEARANCE</div>
      <h2>Accent color</h2>
      <p>Choose the color for highlights, selections, and primary actions.</p>
      <div class="cl-appearance__swatches" role="group" aria-label="App accent color">
        ${Object.keys(SWATCHES).map(name => `<button type="button" class="cl-swatch" data-accent="${name}" aria-label="${LABELS[name as Accent]}" title="${LABELS[name as Accent]}" aria-pressed="false"><span></span></button>`).join('')}
        <label class="cl-custom" title="Choose a custom accent"><input type="color" id="cl-appearance-custom" aria-label="Custom accent color" value="#43e06f"/><span aria-hidden="true">+</span><span>Custom</span></label>
      </div>
      <div class="cl-appearance__footer"><span id="cl-appearance-status" role="status" aria-live="polite">Green</span><button id="cl-appearance-reset" type="button">Restore green</button></div>
    </div>`
  const controller = parent.querySelector('#controller-responsiveness-card')
  if (controller) controller.after(card)
  else parent.prepend(card)
  const custom = card.querySelector<HTMLInputElement>('#cl-appearance-custom')!
  const status = card.querySelector<HTMLElement>('#cl-appearance-status')!
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('[data-accent]'))
  function sync(): void {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.accent === prefs.accent))
    custom.value = prefs.custom
    card.classList.toggle('cl-appearance--custom', prefs.accent === 'custom')
    status.textContent = prefs.accent === 'custom' ? `Custom · ${prefs.custom.toUpperCase()}` : LABELS[prefs.accent]
  }
  function save(): void { applyTheme(); persist(); sync() }
  for (const button of buttons) button.addEventListener('click', () => {
    prefs.accent = button.dataset.accent as Accent
    save()
  })
  custom.addEventListener('input', () => {
    if (isHex(custom.value)) { prefs.accent = 'custom'; prefs.custom = custom.value; save() }
  })
  card.querySelector<HTMLButtonElement>('#cl-appearance-reset')!.addEventListener('click', () => {
    Object.assign(prefs, DEFAULTS)
    save()
  })
  sync()
}
