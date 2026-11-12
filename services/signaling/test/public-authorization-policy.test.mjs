import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicAuthorizationPolicy } from '../src/public-authorization-policy.mjs'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const GUEST = '33333333-3333-4333-8333-333333333333'
const OTHER_GUEST = '44444444-4444-4444-8444-444444444444'
const INVITE = Buffer.alloc(32, 3).toString('base64url') // known dummy, never a production secret
const HOST_CAP = Buffer.alloc(32, 4).toString('base64url')
const GUEST_CAP = Buffer.alloc(32, 5).toString('base64url')
const AT = 1_800_000_000_000

function fixture() {
  let time = AT
  let active = true
  let redeemed = false
  const c = { iss: 'https://identity.example.test', aud: 'capturelink-online',
    sub: 'account-1', exp: AT / 1000 + 600, scope: ['sessions:create'] }
  const identity = new Map([['valid', c]])
  const session = { id: SESSION, ownerSubject: 'account-1', expiresAt: AT + 3600_000,
    inviteExpiresAt: AT + 15 * 60_000, revoked: false, guest: null,
    sentInvite: false, sentResponse: false }
  const capabilities = new Map([
    [HOST_CAP, { role: 'host', sessionId: SESSION, ownerSubject: 'account-1', expiresAt: AT + 3600_000 }],
    [GUEST_CAP, { role: 'guest', sessionId: SESSION, guestId: GUEST, expiresAt: AT + 3600_000 }],
  ])
  const sessions = new Map([[SESSION, session]])
  let redemptions = 0
  const policy = createPublicAuthorizationPolicy({
    now: () => time,
    expectedIssuer: 'https://identity.example.test', expectedAudience: 'capturelink-online',
    verifyHostAccessToken: async token => identity.get(token) ?? null,
    verifySessionCapability: async ({ token }) => capabilities.get(token) ?? null,
    isHostActive: async subject => active && subject === 'account-1',
    loadSession: async id => sessions.get(id) ?? null,
    redeemInvitation: async (code, name) => {
      redemptions++
      if (redeemed || code !== INVITE || session.guest || time >= session.inviteExpiresAt) return null
      redeemed = true // atomic transaction is the responsibility of production adapter
      session.guest = { id: GUEST, status: 'pending', displayName: name }
      return { sessionId: SESSION, guestId: GUEST, expiresAt: session.expiresAt }
    },
  })
  return { policy, session, identity, c, sessions, capabilities, get redemptions() { return redemptions },
    setActive(v) { active = v }, setTime(v) { time = v } }
}

const check = (decision, allowed, code) => {
  assert.equal(decision.allowed, allowed)
  if (code) assert.equal(decision.code, code)
  assert.equal(typeof decision.status, 'number')
}

test('policy cannot be constructed without trusted dependencies, issuer and audience', () => {
  assert.throws(() => createPublicAuthorizationPolicy(), /invalid_public_policy_configuration/)
})

test('anonymous cannot create; supplied user fields and forged principal never become authority', async () => {
  const f = fixture()
  check(await f.policy.authorize({ principal: f.policy.anonymous, operation: 'create',
    subject: 'account-1', installationId: 'admin', role: 'host' }), false)
  check(await f.policy.authorize({ principal: {kind:'verified-host', subject:'account-1', canCreate:true},
    operation: 'create' }), false, 'unauthorized')
})

test('only trusted issuer/audience/subject/expiry/scope can create', async () => {
  const f = fixture()
  assert.equal(f.policy.authenticateHost('missing') instanceof Promise, true)
  assert.equal(await f.policy.authenticateHost('missing'), null)
  const valid = await f.policy.authenticateHost('valid')
  assert.equal(valid.kind, 'verified-host')
  assert.deepEqual(Object.keys(valid), ['kind'])
  check(await f.policy.authorize({principal:valid, operation:'create'}), true)
  const changes = [
    {iss:'https://evil.example.test'}, {aud:'other-api'}, {exp:AT/1000},
    {sub:''}, {scope:['profile:read']}, {nbf:AT/1000+120}, {exp:'tomorrow'},
  ]
  for (const [i, patch] of changes.entries()) {
    f.identity.set(`bad${i}`, {...f.c, ...patch})
    const got = await f.policy.authenticateHost(`bad${i}`)
    if (patch.scope) check(await f.policy.authorize({principal:got, operation:'create'}), false, 'insufficient_scope')
    else assert.equal(got, null)
  }
})

test('trusted identity expiry is rechecked, and account deactivation revokes creation', async () => {
  const f = fixture()
  const principal = await f.policy.authenticateHost('valid')
  f.setActive(false)
  check(await f.policy.authorize({principal,operation:'create'}), false, 'account_inactive')
  f.setActive(true)
  f.setTime(AT + 600_000)
  check(await f.policy.authorize({principal,operation:'create'}), false, 'unauthorized')
})

test('forged session roles and cross-policy principal are rejected', async () => {
  const f = fixture()
  assert.equal(await f.policy.authenticateSession(SESSION, 'wrong'), null)
  assert.equal(await f.policy.authenticateSession(OTHER, HOST_CAP), null)
  const host = await f.policy.authenticateSession(SESSION, HOST_CAP)
  assert.equal(host.kind, 'session-host')
  const otherPolicy = fixture().policy
  check(await otherPolicy.authorize({principal:host,operation:'revoke',sessionId:SESSION}),false,'unauthorized')
  check(await f.policy.authorize({principal:{...host,role:'guest'},operation:'revoke',sessionId:SESSION}),false,'unauthorized')
  check(await f.policy.authorize({principal:host,operation:'revoke',sessionId:OTHER}),false,'unauthorized')
  check(await f.policy.authorize({principal:host,operation:'leave',sessionId:SESSION,role:'guest'}),false,'guest_only')
})

test('unverified guest name and arbitrary role cannot authorize a join', async () => {
  const f = fixture()
  const fake = {kind:'anonymous'}
  check(await f.policy.requestPendingJoin({principal:fake,inviteCode:INVITE,displayName:'Friend'}),false)
  assert.equal(f.redemptions,0)
  const host = await f.policy.authenticateHost('valid')
  check(await f.policy.requestPendingJoin({principal:host,inviteCode:INVITE,displayName:'Friend'}),false)
  check(await f.policy.requestPendingJoin({principal:f.policy.anonymous,inviteCode:'guess',displayName:'Friend'}),false,'invitation_unavailable')
  check(await f.policy.requestPendingJoin({principal:f.policy.anonymous,inviteCode:INVITE,displayName:'<script>'}),false,'invalid_display_name')
  assert.equal(f.redemptions,0)
})

test('anonymous valid invite produces pending guest only, replay fails', async () => {
  const f = fixture()
  const joined = await f.policy.requestPendingJoin({principal:f.policy.anonymous,inviteCode:INVITE,displayName:'Guest'})
  check(joined,true,'pending')
  assert.equal(joined.status,202)
  assert.equal(joined.principal.kind,'session-guest')
  assert.equal(f.session.guest.status,'pending')
  check(await f.policy.authorize({principal:joined.principal,operation:'snapshot',sessionId:SESSION}),true)
  for (const operation of ['create','approve','reject','read-messages','write-message','revoke']) {
    check(await f.policy.authorize({principal:joined.principal,operation,sessionId:SESSION,guestId:GUEST,kind:'invite'}),false)
  }
  check(await f.policy.requestPendingJoin({principal:f.policy.anonymous,inviteCode:INVITE,displayName:'Another'}),false,'invitation_unavailable')
  assert.equal(f.redemptions,2)
})

test('wrong session capability, guest ID and host owner cannot access a session', async () => {
  const f = fixture()
  f.session.guest = {id:GUEST,status:'approved'}
  f.capabilities.set(Buffer.alloc(32, 7).toString('base64url'), {
    role:'guest', sessionId:SESSION, guestId:OTHER_GUEST, expiresAt:AT+50000,
  })
  const wrongGuest = await f.policy.authenticateSession(SESSION,Buffer.alloc(32,7).toString('base64url'))
  check(await f.policy.authorize({principal:wrongGuest,operation:'snapshot',sessionId:SESSION}),false,'unauthorized')
  f.capabilities.set(Buffer.alloc(32, 8).toString('base64url'), {
    role:'host',sessionId:SESSION,ownerSubject:'account-2',expiresAt:AT+50000,
  })
  const wrongHost = await f.policy.authenticateSession(SESSION,Buffer.alloc(32,8).toString('base64url'))
  check(await f.policy.authorize({principal:wrongHost,operation:'revoke',sessionId:SESSION}),false,'unauthorized')
})

test('host approves only matching pending guest before invite expiry, not twice', async () => {
  const f = fixture()
  const host = await f.policy.authenticateSession(SESSION,HOST_CAP)
  const guest = await f.policy.authenticateSession(SESSION,GUEST_CAP)
  f.session.guest = {id:GUEST,status:'pending'}
  check(await f.policy.authorize({principal:guest,operation:'approve',sessionId:SESSION,guestId:GUEST}),false,'host_only')
  check(await f.policy.authorize({principal:host,operation:'approve',sessionId:SESSION,guestId:OTHER_GUEST}),false,'no_matching_pending_guest')
  check(await f.policy.authorize({principal:host,operation:'approve',sessionId:SESSION,guestId:GUEST}),true)
  f.session.guest.status = 'approved' // broker performs the actual mutation, not the policy
  check(await f.policy.authorize({principal:host,operation:'approve',sessionId:SESSION,guestId:GUEST}),false,'no_matching_pending_guest')
  check(await f.policy.authorize({principal:host,operation:'reject',sessionId:SESSION,guestId:GUEST}),false,'no_matching_pending_guest')
})

test('expired invite cannot be approved, stale and revoked guest cannot signal', async () => {
  const f = fixture()
  const host = await f.policy.authenticateSession(SESSION,HOST_CAP)
  const guest = await f.policy.authenticateSession(SESSION,GUEST_CAP)
  f.session.guest = {id:GUEST,status:'pending'}
  f.session.inviteExpiresAt = AT-1
  check(await f.policy.authorize({principal:host,operation:'approve',sessionId:SESSION,guestId:GUEST}),false,'no_matching_pending_guest')
  f.session.guest.status='approved'
  f.session.revoked=true
  check(await f.policy.authorize({principal:guest,operation:'read-messages',sessionId:SESSION}),false,'unauthorized')
  f.session.revoked=false
  f.setActive(false)
  check(await f.policy.authorize({principal:guest,operation:'read-messages',sessionId:SESSION}),false,'account_inactive')
})

test('approved participants have role-bound envelope directions and one-write rules', async () => {
  const f = fixture()
  const host = await f.policy.authenticateSession(SESSION,HOST_CAP)
  const guest = await f.policy.authenticateSession(SESSION,GUEST_CAP)
  f.session.guest = {id:GUEST,status:'approved'}
  check(await f.policy.authorize({principal:guest,operation:'write-message',sessionId:SESSION,kind:'response'}),false,'awaiting_host_invite')
  check(await f.policy.authorize({principal:host,operation:'write-message',sessionId:SESSION,kind:'response'}),false,'wrong_direction')
  check(await f.policy.authorize({principal:guest,operation:'write-message',sessionId:SESSION,kind:'invite',role:'host'}),false,'wrong_direction')
  check(await f.policy.authorize({principal:host,operation:'write-message',sessionId:SESSION,kind:'invite'}),true)
  f.session.sentInvite = true
  check(await f.policy.authorize({principal:host,operation:'write-message',sessionId:SESSION,kind:'invite'}),false,'message_already_sent')
  check(await f.policy.authorize({principal:guest,operation:'write-message',sessionId:SESSION,kind:'response'}),true)
  f.session.sentResponse=true
  check(await f.policy.authorize({principal:guest,operation:'write-message',sessionId:SESSION,kind:'response'}),false,'message_already_sent')
  check(await f.policy.authorize({principal:guest,operation:'read-messages',sessionId:SESSION}),true)
})

test('no operations accepted for unknown or expired sessions, lost guest or credentials', async () => {
  const f = fixture()
  const guest = await f.policy.authenticateSession(SESSION,GUEST_CAP)
  const host = await f.policy.authenticateSession(SESSION,HOST_CAP)
  f.session.guest = {id:GUEST,status:'approved'}
  f.session.guest = null
  check(await f.policy.authorize({principal:guest,operation:'snapshot',sessionId:SESSION}),false,'unauthorized')
  f.session.guest = {id:GUEST,status:'approved'}
  f.session.expiresAt=AT-1
  check(await f.policy.authorize({principal:host,operation:'revoke',sessionId:SESSION}),false,'unauthorized')
  f.session.expiresAt=AT+3600000
  f.setTime(AT+3600000)
  check(await f.policy.authorize({principal:host,operation:'revoke',sessionId:SESSION}),false,'unauthorized')
})

test('trusted verifier exceptions fail closed, no token reflected in outcomes', async () => {
  const f=fixture()
  const secret='token-from-a-client'
  f.identity.set(secret,{...f.c, iss:'bad'})
  assert.equal(await f.policy.authenticateHost(secret),null)
  const result=await f.policy.authorize({principal:f.policy.anonymous,operation:'snapshot',sessionId:SESSION, token:secret})
  check(result,false)
  assert.doesNotMatch(JSON.stringify(result),/token-from-a-client/)
  const p=createPublicAuthorizationPolicy({
    expectedIssuer:'trusted',expectedAudience:'aud',now:()=>AT,
    verifyHostAccessToken:()=>{throw Error(secret)},
    verifySessionCapability:()=>{throw Error(secret)},
    redeemInvitation:()=>{throw Error(secret)},
    loadSession:()=>{throw Error(secret)},
    isHostActive:()=>{throw Error(secret)},
  })
  assert.equal(await p.authenticateHost(secret),null)
  check(await p.requestPendingJoin({principal:p.anonymous,inviteCode:INVITE,displayName:'Guest'}),false,'invitation_unavailable')
})

test('no global principal authority: new policy cannot authorize prior instance principals', async () => {
  const first=fixture(),second=fixture()
  const principal=await first.policy.authenticateHost('valid')
  check(await first.policy.authorize({principal,operation:'create'}),true)
  check(await second.policy.authorize({principal,operation:'create'}),false,'unauthorized')
})

test('reject and leave are role-bound and stale capabilities cannot mutate state', async () => {
  const f = fixture()
  f.session.guest = { id: GUEST, status: 'pending' }
  const host = await f.policy.authenticateSession(SESSION, HOST_CAP)
  const guest = await f.policy.authenticateSession(SESSION, GUEST_CAP)
  check(await f.policy.authorize({principal:host,operation:'reject',sessionId:SESSION,guestId:GUEST}),true)
  check(await f.policy.authorize({principal:host,operation:'leave',sessionId:SESSION}),false,'guest_only')
  check(await f.policy.authorize({principal:guest,operation:'revoke',sessionId:SESSION}),false,'host_only')
  check(await f.policy.authorize({principal:guest,operation:'leave',sessionId:SESSION}),true)
  f.session.guest.status = 'rejected'
  check(await f.policy.authorize({principal:guest,operation:'snapshot',sessionId:SESSION}),true)
  check(await f.policy.authorize({principal:guest,operation:'write-message',sessionId:SESSION,kind:'response'}),false,'not_approved')
  f.sessions.delete(SESSION)
  check(await f.policy.authorize({principal:guest,operation:'leave',sessionId:SESSION}),false,'unauthorized')
})
