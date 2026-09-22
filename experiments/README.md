# CaptureLink Experiments

This directory contains research code that is useful to preserve but is not
required by the current CaptureLink product path.

## signaling-broker

`signaling-broker/` is an optional WebSocket rendezvous experiment for
exchanging Friend-session WebRTC offers and answers through short session
codes.

The current CaptureLink Direct Invite workflow does not require this service.
Direct Invite exchanges a complete WebRTC offer and answer between the users
and then establishes the media/controller connection directly between peers.

The broker is retained for possible future work such as:

- short join codes
- hosted rendezvous
- simpler invite UX
- reconnect/session recovery
- TURN fallback coordination

It is not a production dependency.
