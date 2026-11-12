import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createSignalingServer } from '../src/server.mjs'
import { LocalSignalingClient } from '../src/client.mjs'
import { HostedSignalingBridge } from '../../../src/main/hosted-signaling-bridge.mjs'

const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const VOICE = { watch: false, voice: true, controller: false, controllerMode: 'shared' }
const COMBINED = { watch: true, voice: true, controller: true, controllerMode: 'player2' }
function offer(p) {
  const t = {}
  if (p.controller) t.controller = 'controller-offer-123456'
  if (p.voice || (p.watch && !p.controller)) t.voice = 'voice-offer-123456'
  const id = randomUUID()
  return { id, wire: 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify({
    kind: 'invite', version: 1, sessionId: id, createdAt: Date.now(), permissions: p, transports: t,
  })).toString('base64url'), transports: t }
}
function response(id, transports) {
  return 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify({
    kind: 'response', version: 1, sessionId: id,
    transports: Object.fromEntries(Object.keys(transports).map(k => [k, `${k}-answer-123456`])),
  })).toString('base64url')
}
async function harness(t) {
  const broker = createSignalingServer()
  const endpoint = await broker.listen()
  t.after(() => broker.close())
  const instance = () => new HostedSignalingBridge({ clientFactory: () => new LocalSignalingClient({ endpoint }) })
  return { host: instance(), guest: instance(), other: instance() }
}
for (const permissions of [WATCH, VOICE, COMBINED]) {
  test(`IPC bridge relays one approved unified exchange: ${JSON.stringify(permissions)}`, async t => {
    const { host, guest } = await harness(t)
    const created = await host.create(permissions)
    assert.deepEqual(Object.keys(created).sort(), ['inviteCode', 'inviteExpiresAt'])
    assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(host.role, 'host')
    assert.equal((await guest.join(created.inviteCode, 'Alex Rivera')).status, 'pending')
    const pending = await host.snapshot()
    assert.deepEqual(Object.keys(pending).sort(), ['guestDisplayName', 'hasPendingGuest', 'role', 'status'])
    assert.equal(pending.guestDisplayName, 'Alex Rivera')
    assert.equal(pending.hasPendingGuest, true)
    await assert.rejects(guest.messages(), e => e.message === 'not_approved')
    assert.equal((await host.approve(true)).status, 'approved')
    assert.equal((await guest.snapshot()).status, 'approved')
    const invite = offer(permissions)
    assert.deepEqual(await host.send('invite', invite.wire), { sent: true })
    assert.deepEqual(await guest.messages(), [{ kind: 'invite', payload: invite.wire }])
    const reply = response(invite.id, invite.transports)
    assert.deepEqual(await guest.send('response', reply), { sent: true })
    assert.deepEqual(await host.messages(), [{ kind: 'response', payload: reply }])
    assert.deepEqual(await host.messages(), [])
    assert.equal(JSON.stringify(await host.snapshot()).includes(created.inviteCode), false)
    assert.deepEqual(await host.end(), { ended: true })
    assert.equal(host.role, null)
    assert.deepEqual(await guest.end(), { ended: true })
  })
}
test('explicit host rejection prevents signaling and erases credentials', async t => {
  const { host, guest } = await harness(t)
  const { inviteCode } = await host.create(WATCH)
  await guest.join(inviteCode, 'Alex Rivera')
  await host.snapshot()
  assert.deepEqual(await host.approve(false), { status: 'rejected' })
  assert.equal((await guest.snapshot()).status, 'rejected')
  await assert.rejects(host.send('invite', offer(WATCH).wire), e => e.message === 'not_approved')
  await host.end()
  await assert.rejects(host.snapshot(), e => e.message === 'not_joined')
})
test('approval only after an observed current pending guest', async t => {
  const { host, guest } = await harness(t)
  const { inviteCode } = await host.create(WATCH)
  await guest.join(inviteCode, 'Alex Rivera')
  await assert.rejects(host.approve(true), e => e.message === 'no_pending_guest')
  await host.snapshot()
  await assert.rejects(guest.approve(true), e => e.message === 'wrong_role')
  await host.end()
  await guest.end()
})
test('unapproved guest never obtains an offer; foreign clients cannot join again', async t => {
  const { host, guest, other } = await harness(t)
  const { inviteCode } = await host.create(COMBINED)
  await guest.join(inviteCode, 'Alex Rivera')
  await assert.rejects(other.join(inviteCode, 'Other Guest'), e => e.message === 'invitation_unavailable')
  assert.equal(other.role, null)
  await assert.rejects(guest.messages(), e => e.message === 'not_approved')
  await assert.rejects(guest.send('invite', offer(COMBINED).wire), e => e.message === 'wrong_direction')
  await host.end()
  await guest.end()
})
test('one active session per Electron bridge and local cancellation', async t => {
  const { host } = await harness(t)
  await host.create(WATCH)
  await assert.rejects(host.create(WATCH), e => e.message === 'session_already_started')
  await host.end()
  assert.equal(host.role, null)
  await host.create(WATCH)
  await host.end()
})
test('rejects invalid code, malformed payload, and nonboolean approval before network', async t => {
  const { host, guest } = await harness(t)
  await assert.rejects(guest.join('not-a-real-code', 'Alex'), e => e.message === 'invalid_invitation')
  await assert.rejects(guest.join('Z'.repeat(43), ''), e => e.message === 'invalid_display_name')
  await assert.rejects(guest.join('Z'.repeat(43)), e => e.message === 'invalid_display_name')
  await host.create(WATCH)
  await assert.rejects(host.approve('yes'), e => e.message === 'invalid_approval')
  await assert.rejects(host.send('invite', 'PRIVATE-SDP'), e => e.message === 'invalid_signaling_envelope')
  await host.end()
})
