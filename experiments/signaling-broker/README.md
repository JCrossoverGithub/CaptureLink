# CaptureLink Friend Signaling

Small ephemeral signaling broker for CaptureLink Friend Mode.

The broker exchanges only connection setup data:

- short session codes
- WebRTC offer
- WebRTC answer
- presence / disconnect state

It does **not** proxy:

- Xbox video
- Xbox audio
- controller traffic
- gameplay traffic

After signaling completes, CaptureLink peers communicate directly over WebRTC.

## Local endpoint

HTTP health check:

    http://127.0.0.1:4010/healthz

WebSocket:

    ws://127.0.0.1:4010

## Production

The intended production endpoint is proxied through the existing
schultzconsult.com TLS/Nginx host:

    wss://schultzconsult.com/capturelink-signal

The process itself binds only to:

    127.0.0.1:4010
