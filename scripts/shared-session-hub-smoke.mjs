// Static, dependency-free source-contract check. Not a replacement for runtime tests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const main = readFileSync(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
const must = (source, snippet, name) => assert.ok(source.includes(snippet), name)
for (const [snippet, label] of [
  ["hub.id = 'capturelink-shared-session-hub'", 'unified session hub'],
  ["hub.querySelector('#session-hub-controller-body')?.append(friendCard)", 'existing controller logic reused'],
  ["hub.querySelector('#session-hub-voice-body')?.append(voiceCard)", 'existing voice logic reused'],
  ["canJoinAsGuest: () => !activePlayer && !webRtcConnected && friendPeerRole !== 'host'", 'guest controller + voice coexistence'],
  ["if (friendPeerRole !== null) {\n    setFriendDiagnosticsVisible", 'host and guest can toggle diagnostics'],
  ["document.querySelector<HTMLElement>('#friend-diagnostics-settings-readout')", 'settings keeps friend diagnostics'],
  ["streamHolder.addEventListener('loadedmetadata', fitFriendStreamStage, true)", 'video metadata-driven stage'],
  ["if (friendPeerRole !== null) {\n      cancelDirectFriendSession()", 'joint disconnect']
]) must(main, snippet, label)
for (const [snippet,label] of [
  ["body.capturelink-friend-session .stream-primary { grid-template-rows: auto auto;", 'no stretched video row'],
  ["body.capturelink-friend-session .stream-card { grid-template-rows: auto auto;", 'no fixed-height card row'],
  ["aspect-ratio: var(--cl-friend-video-ratio, 1.7777778)", 'video aspect ratio'],
  ["body.capturelink-friend-session .stream-holder > video { object-fit: contain; }", 'never crop game HUD'],
  [".friend-diagnostics-settings", 'settings diagnostics style']
]) must(css, snippet, label)
assert.ok(!main.includes('  friendDiagnosticsVisible = true\n\n  updateInteractiveState()'), 'preference not reset')
console.log('PASS: unified session hub, dual session coexistence guard, diagnostic controls, aspect-ratio CSS, joint leave source contracts')
