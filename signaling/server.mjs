import http from 'node:http'
import { randomInt } from 'node:crypto'
import {
  WebSocket,
  WebSocketServer
} from 'ws'

const HOST =
  process.env.CAPTURELINK_SIGNAL_HOST ??
  '127.0.0.1'

const PORT =
  Number(
    process.env.CAPTURELINK_SIGNAL_PORT ??
    '4010'
  )

const MAX_SIGNAL_BYTES =
  256 * 1024

const HEARTBEAT_INTERVAL_MS =
  30_000

const ROOM_CODE_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * @typedef {{
 *   code: string
 *   host: WebSocket
 *   guest: WebSocket | null
 *   offer: string | null
 *   metadata: Record<string, unknown> | null
 *   createdAt: number
 *   lastActivityAt: number
 * }} FriendSession
 */

/** @type {Map<string, FriendSession>} */
const sessions =
  new Map()

/**
 * Connection ownership is deliberately kept server-side.
 *
 * A client cannot claim to be the host/guest for another room
 * merely by sending a different room code in a later message.
 */
const connectionState =
  new WeakMap()

function normalizeCode(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const compact =
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')

  if (compact.length !== 8) {
    return ''
  }

  return compact
}

function displayCode(compact) {
  return (
    `${compact.slice(0, 4)}-` +
    compact.slice(4)
  )
}

function createCode() {
  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    let code = ''

    for (
      let index = 0;
      index < 8;
      index += 1
    ) {
      code +=
        ROOM_CODE_ALPHABET[
          randomInt(
            0,
            ROOM_CODE_ALPHABET.length
          )
        ]
    }

    if (!sessions.has(code)) {
      return code
    }
  }

  throw new Error(
    'Could not allocate a unique session code.'
  )
}

function isOpen(socket) {
  return (
    socket.readyState ===
    WebSocket.OPEN
  )
}

function send(socket, payload) {
  if (!isOpen(socket)) {
    return false
  }

  socket.send(
    JSON.stringify(payload)
  )

  return true
}

function sendError(
  socket,
  code,
  message
) {
  send(
    socket,
    {
      type: 'error',
      code,
      message
    }
  )
}

function getOwnedSession(
  socket,
  requiredRole
) {
  const ownership =
    connectionState.get(socket)

  if (
    !ownership ||
    ownership.role !== requiredRole
  ) {
    return null
  }

  const session =
    sessions.get(
      ownership.code
    )

  if (!session) {
    return null
  }

  if (
    requiredRole === 'host' &&
    session.host !== socket
  ) {
    return null
  }

  if (
    requiredRole === 'guest' &&
    session.guest !== socket
  ) {
    return null
  }

  return session
}

function removeSession(code) {
  const session =
    sessions.get(code)

  if (!session) {
    return
  }

  sessions.delete(code)

  if (session.host) {
    connectionState.delete(
      session.host
    )
  }

  if (session.guest) {
    connectionState.delete(
      session.guest
    )
  }
}

function handleCreateSession(socket) {
  if (connectionState.has(socket)) {
    sendError(
      socket,
      'already-in-session',
      'This connection is already assigned to a Friend session.'
    )
    return
  }

  const compactCode =
    createCode()

  const now =
    Date.now()

  /** @type {FriendSession} */
  const session = {
    code: compactCode,
    host: socket,
    guest: null,
    offer: null,
    metadata: null,
    createdAt: now,
    lastActivityAt: now
  }

  sessions.set(
    compactCode,
    session
  )

  connectionState.set(
    socket,
    {
      role: 'host',
      code: compactCode
    }
  )

  send(
    socket,
    {
      type: 'session-created',
      code:
        displayCode(
          compactCode
        )
    }
  )

  console.log(
    '[CaptureLink:Signal] Session created:',
    displayCode(compactCode)
  )
}

function handleJoinSession(
  socket,
  message
) {
  if (connectionState.has(socket)) {
    sendError(
      socket,
      'already-in-session',
      'This connection is already assigned to a Friend session.'
    )
    return
  }

  const compactCode =
    normalizeCode(
      message.code
    )

  if (!compactCode) {
    sendError(
      socket,
      'invalid-code',
      'Enter a valid CaptureLink session code.'
    )
    return
  }

  const session =
    sessions.get(
      compactCode
    )

  if (
    !session ||
    !isOpen(session.host)
  ) {
    sendError(
      socket,
      'session-not-found',
      'That CaptureLink Friend session is no longer available.'
    )
    return
  }

  if (
    session.guest &&
    isOpen(session.guest)
  ) {
    sendError(
      socket,
      'session-full',
      'A friend is already connected to this session.'
    )
    return
  }

  session.guest =
    socket

  session.lastActivityAt =
    Date.now()

  connectionState.set(
    socket,
    {
      role: 'guest',
      code: compactCode
    }
  )

  send(
    socket,
    {
      type: 'session-joined',
      code:
        displayCode(
          compactCode
        )
    }
  )

  send(
    session.host,
    {
      type: 'guest-joined'
    }
  )

  /*
   * The host is allowed to generate its SDP immediately after
   * creating the room. Store it until a guest arrives so joining
   * requires only the short room code.
   */
  if (session.offer) {
    send(
      socket,
      {
        type: 'offer',
        offer:
          session.offer,
        metadata:
          session.metadata
      }
    )
  }

  console.log(
    '[CaptureLink:Signal] Guest joined:',
    displayCode(compactCode)
  )
}

function handleOffer(
  socket,
  message
) {
  const session =
    getOwnedSession(
      socket,
      'host'
    )

  if (!session) {
    sendError(
      socket,
      'not-host',
      'Only the active Friend host may publish an offer.'
    )
    return
  }

  if (
    typeof message.offer !==
      'string' ||
    message.offer.length === 0 ||
    Buffer.byteLength(
      message.offer,
      'utf8'
    ) > MAX_SIGNAL_BYTES
  ) {
    sendError(
      socket,
      'invalid-offer',
      'The CaptureLink host offer is invalid.'
    )
    return
  }

  session.offer =
    message.offer

  session.metadata =
    message.metadata &&
    typeof message.metadata ===
      'object' &&
    !Array.isArray(
      message.metadata
    )
      ? message.metadata
      : null

  session.lastActivityAt =
    Date.now()

  if (
    session.guest &&
    isOpen(session.guest)
  ) {
    send(
      session.guest,
      {
        type: 'offer',
        offer:
          session.offer,
        metadata:
          session.metadata
      }
    )
  }

  send(
    socket,
    {
      type: 'offer-published'
    }
  )
}

function handleAnswer(
  socket,
  message
) {
  const session =
    getOwnedSession(
      socket,
      'guest'
    )

  if (!session) {
    sendError(
      socket,
      'not-guest',
      'Only the active Friend guest may publish an answer.'
    )
    return
  }

  if (
    typeof message.answer !==
      'string' ||
    message.answer.length === 0 ||
    Buffer.byteLength(
      message.answer,
      'utf8'
    ) > MAX_SIGNAL_BYTES
  ) {
    sendError(
      socket,
      'invalid-answer',
      'The CaptureLink guest answer is invalid.'
    )
    return
  }

  session.lastActivityAt =
    Date.now()

  send(
    session.host,
    {
      type: 'answer',
      answer:
        message.answer
    }
  )

  send(
    socket,
    {
      type: 'answer-published'
    }
  )
}

function handleSocketClose(socket) {
  const ownership =
    connectionState.get(socket)

  connectionState.delete(
    socket
  )

  if (!ownership) {
    return
  }

  const session =
    sessions.get(
      ownership.code
    )

  if (!session) {
    return
  }

  if (ownership.role === 'host') {
    if (
      session.guest &&
      isOpen(session.guest)
    ) {
      send(
        session.guest,
        {
          type: 'session-closed',
          reason:
            'The Friend host disconnected.'
        }
      )
    }

    console.log(
      '[CaptureLink:Signal] Host closed session:',
      displayCode(
        ownership.code
      )
    )

    removeSession(
      ownership.code
    )

    return
  }

  if (
    ownership.role === 'guest' &&
    session.guest === socket
  ) {
    session.guest =
      null

    session.lastActivityAt =
      Date.now()

    send(
      session.host,
      {
        type: 'guest-left'
      }
    )

    console.log(
      '[CaptureLink:Signal] Guest left session:',
      displayCode(
        ownership.code
      )
    )
  }
}

function handleSocketMessage(
  socket,
  raw
) {
  if (
    typeof raw !== 'string' &&
    !Buffer.isBuffer(raw)
  ) {
    sendError(
      socket,
      'invalid-message',
      'Unsupported signaling message.'
    )
    return
  }

  const text =
    raw.toString()

  if (
    Buffer.byteLength(
      text,
      'utf8'
    ) > MAX_SIGNAL_BYTES
  ) {
    sendError(
      socket,
      'message-too-large',
      'The signaling message is too large.'
    )
    return
  }

  let message

  try {
    message =
      JSON.parse(text)
  } catch {
    sendError(
      socket,
      'invalid-json',
      'The signaling message is not valid JSON.'
    )
    return
  }

  if (
    !message ||
    typeof message !==
      'object' ||
    typeof message.type !==
      'string'
  ) {
    sendError(
      socket,
      'invalid-message',
      'The signaling message is malformed.'
    )
    return
  }

  switch (message.type) {
    case 'create-session':
      handleCreateSession(
        socket
      )
      break

    case 'join-session':
      handleJoinSession(
        socket,
        message
      )
      break

    case 'offer':
      handleOffer(
        socket,
        message
      )
      break

    case 'answer':
      handleAnswer(
        socket,
        message
      )
      break

    default:
      sendError(
        socket,
        'unsupported-message',
        `Unsupported signaling message type: ${message.type}`
      )
  }
}

const server =
  http.createServer(
    (request, response) => {
      if (
        request.method === 'GET' &&
        request.url === '/healthz'
      ) {
        response.writeHead(
          200,
          {
            'content-type':
              'application/json; charset=utf-8',
            'cache-control':
              'no-store'
          }
        )

        response.end(
          JSON.stringify({
            ok: true
          })
        )

        return
      }

      response.writeHead(
        404,
        {
          'content-type':
            'application/json; charset=utf-8'
        }
      )

      response.end(
        JSON.stringify({
          error: 'not-found'
        })
      )
    }
  )

const websocketServer =
  new WebSocketServer({
    server,
    maxPayload:
      MAX_SIGNAL_BYTES
  })

websocketServer.on(
  'connection',
  (socket) => {
    socket.isAlive = true

    socket.on(
      'pong',
      () => {
        socket.isAlive = true

        const ownership =
          connectionState.get(
            socket
          )

        if (!ownership) {
          return
        }

        const session =
          sessions.get(
            ownership.code
          )

        if (session) {
          session.lastActivityAt =
            Date.now()
        }
      }
    )

    socket.on(
      'message',
      (data) => {
        handleSocketMessage(
          socket,
          data
        )
      }
    )

    socket.on(
      'close',
      () => {
        handleSocketClose(
          socket
        )
      }
    )

    socket.on(
      'error',
      (error) => {
        console.warn(
          '[CaptureLink:Signal] WebSocket error:',
          error.message
        )
      }
    )

    send(
      socket,
      {
        type: 'hello',
        protocol:
          'capturelink-signaling-v1'
      }
    )
  }
)

const heartbeat =
  setInterval(
    () => {
      websocketServer.clients
        .forEach(
          (socket) => {
            if (
              socket.isAlive ===
              false
            ) {
              socket.terminate()
              return
            }

            socket.isAlive =
              false

            socket.ping()
          }
        )
    },
    HEARTBEAT_INTERVAL_MS
  )

heartbeat.unref()

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `[CaptureLink:Signal] Listening on http://${HOST}:${PORT}`
    )
  }
)

function shutdown(signal) {
  console.log(
    `[CaptureLink:Signal] ${signal}; shutting down`
  )

  for (
    const session
    of sessions.values()
  ) {
    send(
      session.host,
      {
        type: 'session-closed',
        reason:
          'The signaling service is restarting.'
      }
    )

    if (session.guest) {
      send(
        session.guest,
        {
          type: 'session-closed',
          reason:
            'The signaling service is restarting.'
        }
      )
    }
  }

  websocketServer.close()

  server.close(
    () => {
      process.exit(0)
    }
  )

  setTimeout(
    () => {
      process.exit(1)
    },
    5000
  ).unref()
}

process.once(
  'SIGINT',
  () => shutdown('SIGINT')
)

process.once(
  'SIGTERM',
  () => shutdown('SIGTERM')
)
