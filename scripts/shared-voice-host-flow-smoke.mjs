// Offline host state-machine smoke: invitation without Xbox mic; deferred
// attachment on mic enable; retain guest when Xbox mic is disabled; restore
// local mic when host ends. No actual network or Xbox connection is implied.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

class FakeElement extends EventTarget {
  constructor(id) {
    super()
    this.id = id
    this.value = id === 'sv-host-volume' ? '100' : ''
    this.disabled = false
    this.checked = false
    this.textContent = ''
  }
  fire(type = 'click') { this.dispatchEvent(new Event(type)) }
}
class FakeCard {
  constructor() { this.elements = new Map(); this.className = '' }
  set innerHTML(html) {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) this.elements.set(id, new FakeElement(id))
  }
  querySelector(selector) {
    return selector.startsWith('#') ? (this.elements.get(selector.slice(1)) ?? null) : null
  }
  appendChild() {}
  setAttribute() {}
  remove() {}
  el(id) { return this.elements.get(id) }
}
const card = new FakeCard()
const document = { createElement(tag) {
  if (tag === 'audio') return { autoplay: false, muted: true, hidden: true, srcObject: null,
    play() { return Promise.resolve() }, pause() {} }
  return card
} }
const audioPanel = { querySelector(s) { return s === '.audio-device-grid' ? { after() {} } : null } }
const peers = []
const hostTrack = { kind: 'audio', readyState: 'live', id: 'host-mic' }
const guestTrack = { kind: 'audio', readyState: 'live', id: 'guest-mic', addEventListener() {} }
let currentMicEnabled = false
const sender = {
  track: hostTrack,
  async replaceTrack(track) { this.track = track }
}
class FakePeer extends EventTarget {
  constructor() {
    super()
    this.localDescription = null
    this.signalingState = 'stable'
    this.iceGatheringState = 'new'
    this.connectionState = 'new'
    this.currentRemoteDescription = null
    peers.push(this)
  }
  createDataChannel() { return { readyState: 'open', send() {}, close() {} } }
  addTransceiver(kind) {
    const sender = { kind, track: null, async replaceTrack(track) { this.track = track } }
    this.transceivers ??= []
    this.transceivers.push(sender)
    return { sender }
  }
  addTrack(track) { this.guestTrack = track }
  async setRemoteDescription(desc) { this.currentRemoteDescription = desc }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' } }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' } }
  async setLocalDescription() {
    this.localDescription = { sdp: 'v=0\r\na=candidate:1 1 udp 42 192.168.1.5 35001 typ host\r\n' }
    this.iceGatheringState = 'complete'
    this.dispatchEvent(new Event('icegatheringstatechange'))
  }
  close() { this.signalingState = 'closed'; this.connectionState = 'closed' }
}
class FakeMediaStream {
  constructor(tracks = []) { this.tracks = tracks }
  addTrack(track) { this.tracks.push(track) }
  getAudioTracks() { return this.tracks.filter(x => x.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(x => x.kind === 'video') }
  getTracks() { return this.tracks }
}
let outputId = 0
const mixerGainNodes = []
let suspendMixer = false
class FakeAudioContext {
  createMediaStreamDestination() {
    return { stream: new FakeMediaStream([{ kind: 'audio', readyState: 'live', id: `mixed-${++outputId}`, stop() {} }]) }
  }
  createMediaStreamSource() { return { connect() {}, disconnect() {} } }
  createGain() { const node = { gain: { value: 1 }, connect() {} }; mixerGainNodes.push(node); return node }
  createAnalyser() { return { fftSize: 512, getByteTimeDomainData(a) { a.fill(128) } } }
  async resume() {
    if (suspendMixer) return await new Promise(() => {})
  }
  async close() {}
}
const sharedGlobals = {
  document,
  window: { setTimeout, clearTimeout, setInterval() { return 1 }, clearInterval() {} },
  RTCPeerConnection: FakePeer,
  AudioContext: FakeAudioContext,
  MediaStream: FakeMediaStream,
  navigator: { mediaDevices: { getUserMedia: async () => new FakeMediaStream([{ kind: 'audio', id: 'guest-local', readyState: 'live', muted: false, enabled: true, stop() {}, addEventListener() {} }]) } },
  crypto: { randomUUID: () => '55d679ad-3146-446d-893c-7fb61c44f2a3' },
  btoa, atob, setTimeout, clearTimeout,
  console,
}
const cache = new Map()
function load(relativeFile) {
  if (cache.has(relativeFile)) return cache.get(relativeFile)
  const tsSource = readFileSync(new URL(`../src/renderer/src/voice-sharing/${relativeFile}.ts`, import.meta.url), 'utf8')
  const js = transformSync(tsSource, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} }
  cache.set(relativeFile, module.exports)
  const localRequire = name => {
    if (!name.startsWith('./')) throw new Error(`Unexpected module ${name}`)
    return load(name.slice(2))
  }
  runInNewContext(`(function(require,module,exports){${js}\n})`, sharedGlobals)(localRequire, module, module.exports)
  return module.exports
}
const { installSharedVoice } = load('voice-session')
let guestMediaCallbacks = 0
let guestStopped = 0
const ctrl = installSharedVoice({
  audioPanel,
  getXboxUplink: () => currentMicEnabled ? { track: hostTrack, sender } : null,
  getGuestMicrophoneConstraints: () => ({}),
  onGuestMediaStream: () => { guestMediaCallbacks++ },
  onGuestMediaStopped: () => { guestStopped++ },
  getHostMicrophoneTrack: () => currentMicEnabled ? hostTrack : null,
  getHostGameMediaStream: () => {
    const audio = { kind: 'audio', id: 'game-audio', readyState: 'live', muted: false }
    const video = { kind: 'video', id: 'game-video', readyState: 'live', muted: false }
    return new FakeMediaStream([audio, video])
  },
})
const flush = () => new Promise(resolve => setTimeout(resolve, 5))
// Host has NO Xbox session and NO Xbox mic yet.
card.el('sv-host-start').fire()
await flush()
assert.ok(card.el('sv-host-offer').value.startsWith('CAPTURELINK-VOICE-V1:'), 'invite should generate without Xbox mic')
const guestInvite = card.el('sv-host-offer').value
assert.match(card.el('sv-host-status').textContent, /local-network candidates/i)
assert.equal(peers.length, 1)
// A negotiated guest audio track must not stop the voice connection.
peers[0].ontrack({ track: guestTrack, streams: [new FakeMediaStream([guestTrack])] })
await flush()
assert.equal(card.el('sv-host-stop').disabled, false)
assert.equal(sender.track, hostTrack, 'no Xbox sender replacement without Xbox mic')
// Peer status is distinct from the Xbox sender state.
peers[0].connectionState = 'connected'
peers[0].onconnectionstatechange()
await flush()
assert.match(card.el('sv-host-connection').textContent, /Connected/)
assert.match(card.el('sv-host-xbox-state').textContent, /Not broadcasting/)
// Opt-in video/game-audio works without renegotiating the Xbox mic sender.
card.el('sv-host-share-audio').checked = true
card.el('sv-host-share-video').checked = true
card.el('sv-host-share-audio').fire('change')
await flush()
assert.equal(peers[0].transceivers[0].track?.id, 'game-audio')
assert.equal(peers[0].transceivers[1].track?.id, 'game-video')
card.el('sv-host-share-audio').checked = false
card.el('sv-host-share-video').checked = false
card.el('sv-host-share-video').fire('change')
await flush()
assert.equal(peers[0].transceivers[0].track, null)
assert.equal(peers[0].transceivers[1].track, null)
// Explicitly authorize guest microphone forwarding for this session.
card.el('sv-host-allow-guest').checked = true
card.el('sv-host-allow-guest').fire('change')
// Xbox mic enabled later: attach mix even though getXboxUplink lookup subsequently
// returns null because sender.track is now the mixed track.
currentMicEnabled = true
suspendMixer = true
ctrl.onXboxMicrophoneStarted()
await new Promise(resolve => setTimeout(resolve, 2600))
assert.equal(sender.track, hostTrack, 'suspended context must not silently attach a dead mixer')
assert.match(card.el('sv-host-status').textContent, /Audio mixer could not start/)
suspendMixer = false
card.el('sv-host-retry-mix').fire()
await flush()
assert.match(sender.track.id, /^mixed-/)
assert.match(card.el('sv-host-status').textContent, /attached|connected/i)
assert.equal(ctrl.hasActiveGuestMix(), true)
// Revoking guest voice must zero the guest source even while the Xbox sender stays attached.
card.el('sv-host-allow-guest').checked = false
card.el('sv-host-allow-guest').fire('change')
assert.equal(mixerGainNodes.at(-1).gain.value, 0, 'host permission gate must silence guest')
card.el('sv-host-allow-guest').checked = true
card.el('sv-host-allow-guest').fire('change')
assert.equal(mixerGainNodes.at(-1).gain.value, 1, 'host may reauthorize guest voice')
const firstMixTrack = sender.track
card.el('sv-host-retry-mix').fire()
await flush()
assert.notEqual(sender.track, firstMixTrack, 'explicit retry must construct a fresh mixed track')
assert.match(sender.track.id, /^mixed-/)
assert.match(card.el('sv-host-mixer').textContent, /Attached|Starting|Not attached/)
// Disable Xbox mic: stop broadcast but retain friend transport.
ctrl.onXboxMicrophoneStopped()
await flush()
assert.equal(sender.track, null)
assert.equal(card.el('sv-host-stop').disabled, false)
assert.equal(peers[0].signalingState, 'stable')
// Re-enable: app renegotiates new live local mic sender, then reattaches guest.
sender.track = hostTrack
ctrl.onXboxMicrophoneStarted()
await flush()
assert.match(sender.track.id, /^mixed-/)
// End voice sharing: restore original mic source.
card.el('sv-host-stop').fire()
await flush()
assert.equal(sender.track, hostTrack)
// Guest can join without Xbox sign-in; it receives explicit host state and media
// only when a host sends it. This uses a mocked peer, not a real media pipeline.
card.el('sv-guest-offer').value = guestInvite
card.el('sv-guest-join').fire()
await flush()
assert.equal(peers.length, 2)
assert.match(card.el('sv-guest-answer').value, /^CAPTURELINK-VOICE-V1:/)
const guestPeer = peers[1]
guestPeer.connectionState = 'connected'
guestPeer.onconnectionstatechange()
assert.match(card.el('sv-guest-connection').textContent, /Connected/)
assert.match(card.el('sv-guest-mic-state').textContent, /Mic enabled/)
const channel = { label: 'voice-lifecycle', close() {} }
guestPeer.ondatachannel({ channel })
channel.onmessage({ data: JSON.stringify({ type: 'status', xbox: true, audio: true, video: true, muted: false }) })
assert.match(card.el('sv-guest-xbox-state').textContent, /Host says mix attached/)
// Audio/video will be attached by the renderer callback; no controller permission.
const guestGameAudio = { kind: 'audio', id: 'remote-game-audio', muted: false, readyState: 'live', addEventListener() {} }
const guestGameVideo = { kind: 'video', id: 'remote-game-video', muted: false, readyState: 'live', addEventListener() {} }
guestPeer.ontrack({ track: guestGameAudio })
guestPeer.ontrack({ track: guestGameVideo })
assert.ok(guestMediaCallbacks >= 2)
assert.match(card.el('sv-guest-host-note').textContent, /Receiving audio \+ video/)
card.el('sv-guest-mute').checked = true
card.el('sv-guest-mute').fire('change')
assert.equal(guestPeer.guestTrack.enabled, false)
assert.match(card.el('sv-guest-me-note').textContent, /Muted by you/)
card.el('sv-guest-leave').fire()
assert.ok(guestStopped >= 1)
ctrl.dispose()
console.log('PASS: invite without Xbox mic, participant dashboard, game media opt-in/off, deferred mixing, mic-off retains guest, reattach, host restore')
