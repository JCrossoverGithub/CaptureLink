import test from 'node:test'
import assert from 'node:assert/strict'
import { createSignalingServer } from '../src/server.mjs'
import { LocalSignalingClient } from '../src/client.mjs'
import { HostedSignalingBridge } from '../../../src/main/hosted-signaling-bridge.mjs'
import { canonicalGuestName } from '../src/protocol.mjs'

const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }

async function harness(t) {
  const service = createSignalingServer()
  const endpoint = await service.listen()
  t.after(() => service.close())
  const factory = () => new LocalSignalingClient({ endpoint })
  return { endpoint, factory, bridge: () => new HostedSignalingBridge({ clientFactory: factory }) }
}

test('guest name flows through broker to host-only snapshot and approval', async t => {
  const { bridge, endpoint } = await harness(t)
  const host = bridge(), guest = bridge()
  const { inviteCode } = await host.create(WATCH)
  assert.equal((await guest.join(inviteCode, '  Ana   María  ')).status, 'pending')
  const pending = await host.snapshot()
  assert.equal(pending.guestDisplayName, 'Ana María')
  assert.equal(pending.hasPendingGuest, true)
  assert.equal((await guest.snapshot()).guestDisplayName, null)
  assert.equal((await host.approve(true)).status, 'approved')
  assert.equal((await host.snapshot()).guestDisplayName, 'Ana María')
  await host.end()
  await assert.rejects(guest.snapshot(), error => error.message === 'not_found')
  await guest.end()
})

test('name is not exposed to unauthenticated client and absent for legacy guests', async t => {
  const { endpoint, factory } = await harness(t)
  const host = factory(), guest = factory()
  const { inviteCode } = await host.create(WATCH)
  await guest.join(inviteCode) // headless UX3b0 compatibility
  assert.equal((await host.snapshot()).guestDisplayName, null)
  const r = await fetch(`${endpoint}/v1/sessions/${host.sessionId}`)
  assert.equal(r.status, 401)
  assert.equal(JSON.stringify(await r.json()).includes('guestDisplayName'), false)
  await host.end()
})

test('broker rejects invalid guest names without consuming the invitation', async t => {
  const { endpoint, factory } = await harness(t)
  const host = factory()
  const { inviteCode } = await host.create(WATCH)
  const invalid = ['<script>', '<img src=x onerror=1>', '\u202EGuest', 'A\nB', '', 'A'.repeat(33), '😀', 123]
  for (const displayName of invalid) {
    const res = await fetch(endpoint + '/v1/join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteCode, displayName })
    })
    assert.equal(res.status, 400, String(displayName))
    assert.equal((await res.json()).error, 'invalid_display_name')
  }
  const guest = factory()
  await guest.join(inviteCode, { displayName: 'Valid Person' })
  assert.equal((await host.snapshot()).guestDisplayName, 'Valid Person')
  await host.end()
})

test('name normalization and strict character policy is deterministic', () => {
  assert.equal(canonicalGuestName('  José   Smith  '), 'José Smith')
  assert.equal(canonicalGuestName('  Ａｌｅｘ  '), 'Alex')
  assert.equal(canonicalGuestName('A<svg>'), null)
  assert.equal(canonicalGuestName('\u200BAlex'), null)
  assert.equal(canonicalGuestName(''), null)
})
