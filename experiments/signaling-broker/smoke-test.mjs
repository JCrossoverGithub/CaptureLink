import WebSocket from 'ws'

const url =
  'ws://127.0.0.1:4010'

function connect() {
  return new Promise(
    (resolve, reject) => {
      const socket =
        new WebSocket(url)

      socket.once(
        'open',
        () => resolve(socket)
      )

      socket.once(
        'error',
        reject
      )
    }
  )
}

function nextMessage(socket) {
  return new Promise(
    (resolve, reject) => {
      socket.once(
        'message',
        (data) => {
          try {
            resolve(
              JSON.parse(
                data.toString()
              )
            )
          } catch (error) {
            reject(error)
          }
        }
      )

      socket.once(
        'error',
        reject
      )
    }
  )
}

const host =
  await connect()

await nextMessage(host)

host.send(
  JSON.stringify({
    type: 'create-session'
  })
)

const created =
  await nextMessage(host)

console.log(
  'HOST:',
  created
)

const guest =
  await connect()

await nextMessage(guest)

guest.send(
  JSON.stringify({
    type: 'join-session',
    code: created.code
  })
)

const joined =
  await nextMessage(guest)

console.log(
  'GUEST:',
  joined
)

const hostJoined =
  await nextMessage(host)

console.log(
  'HOST:',
  hostJoined
)

host.send(
  JSON.stringify({
    type: 'offer',
    offer: 'test-offer',
    metadata: {
      controllerMode:
        'player2'
    }
  })
)

const guestOffer =
  await nextMessage(guest)

console.log(
  'GUEST:',
  guestOffer
)

guest.send(
  JSON.stringify({
    type: 'answer',
    answer: 'test-answer'
  })
)

const hostAnswer =
  await nextMessage(host)

console.log(
  'HOST:',
  hostAnswer
)

host.close()
guest.close()
