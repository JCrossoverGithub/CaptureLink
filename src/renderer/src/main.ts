import './styles.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) throw new Error('CaptureLink app root not found')

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">CAPTURELINK</div>
        <h1>Xbox Remote Play, focused on capture.</h1>
        <p class="subtitle">Connect to your console, watch the live stream, hear game and game-chat audio, control the session, and record locally.</p>
      </div>
      <span class="status status--idle">Prototype</span>
    </header>

    <section class="stream-card" aria-label="Remote Play preview">
      <div class="stream-placeholder">
        <div class="stream-mark">CL</div>
        <p>Remote Play stream will appear here.</p>
      </div>
      <div class="controls">
        <button type="button" disabled title="Xbox authentication is the next implementation milestone">Sign in</button>
        <button type="button" disabled>Connect</button>
        <button type="button" disabled>Controller</button>
        <button type="button" disabled>Microphone</button>
        <button type="button" disabled>Diagnostics</button>
        <button type="button" class="record" disabled>Record</button>
      </div>
    </section>

    <section class="grid">
      <article>
        <h2>Known-good foundation</h2>
        <ul>
          <li>Xbox authentication and console discovery proven</li>
          <li>Chromium xHome Remote Play proven</li>
          <li>Xbox video and game audio proven</li>
          <li>Incoming in-game voice chat proven in the same audio stream</li>
        </ul>
      </article>
      <article>
        <h2>Next milestone</h2>
        <p>Reproduce the known-good xHome session inside this Electron runtime before adding recording.</p>
      </article>
    </section>
  </main>
`
