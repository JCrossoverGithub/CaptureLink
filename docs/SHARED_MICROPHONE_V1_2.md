# Shared Microphone V1.2 — participant UX and guest media return

**Experimental two-PC build, not approved for public distribution.**

## Capabilities in this source change

- Host and guest display peer connection status, local microphone state, and host-reported Xbox forwarding state. The host has a two-person mic list with signal bars. The guest sees their own mic and incoming game-audio meter. A compact session badge appears on the normal Stream surface.
- The host may create an invitation without Xbox microphone or gameplay connected. Xbox microphone forwarding is independent from the guest peer's connection.
- Guest microphone continues to travel from guest to host for host-side mixing into the Xbox microphone uplink. This requires separate Xbox mic enablement and a real in-game listener acceptance test.
- Host may enable **Share Xbox game audio** and **Share Xbox gameplay video**, separately. Both are off by default, and reset when the session ends. Reuses the Xbox stream's existing tracks and reserves outbound WebRTC senders in the initial invite, so host can enable them after joining without another manual offer/answer in the normal case.
- Guest can enable **Play received Xbox game audio** (off by default); video uses the regular CaptureLink Stream view, not a pop-out. No controller permissions are granted to a voice guest. Host may enable local monitoring of the guest microphone (off by default) and should use headphones.
- Guest can mute their microphone to the host. Host mute and gain to Xbox remain independent.

## Known limitations and important distinctions

- **Connected to host is not proof the Xbox can hear the guest.** "Mix attached" means the track was attached to the Xbox RTCRtpSender, NOT proven in-game reception. Guest status relies on a message from the host.
- **Returned audio is Xbox game audio only, not the host's speaking microphone.** Two-way conversational voice monitoring and host microphone return require a subsequent design step.
- `replaceTrack` can fail if codecs or media capabilities require renegotiation; the UI reports this failure. Xbox streaming is not changed by this patch.
- V1.2 retains manual invitation/response (CAPTURELINK-VOICE-V1), STUN-only and one guest. No reliable session codes, TURN, multi-guest, bandwidth/quality selector, identity management or server-side session persistence yet. Both parties should run V1.2 when testing.
- The additional P2P video encode may increase host CPU/GPU usage and network latency. Test audio-only return first, then enable video.
- Activity meters rely on a Web Audio context and may stay at zero if capture is muted or browser output policies block analysis; they are indicative, not a recording or packet acknowledgement.
- Do not test guest voice-only join while the guest is already connected to a local Xbox or ordinary Friend Controller stream; this V1.2 implementation prevents that overlapping mode.
- No new recording of guest audio is introduced. Review recording behavior and privacy before public rollout.

## Two-computer acceptance checklist

1. Host starts without Xbox connected or microphone active. Generate a voice invite, send it to guest, receive answer, and accept. Both sides should report Connected. Host list should show two participants.
2. Speak on guest's selected microphone: guest and host meters should react (if permitted). Mute on guest: host sees connection persist while audio becomes silent. Host monitor checkbox lets host hear guest locally using headphones.
3. Host connects Xbox and enables Xbox mic. Confirm host status "Mix attached" and guest status "Host says mix attached". **A third person in Xbox game chat must hear both voices** to pass end-to-end mic acceptance.
4. Host turns off Xbox mic: guest remains connected and is not forwarded to Xbox; re-enable it and verify both voices return without new invite.
5. Host checks Share Xbox game audio. Guest checks Play received Xbox game audio. Confirm Xbox game audio is audible on guest with no PC-wide sound leakage. Turn either one off and check silence.
6. Host checks Share Xbox gameplay video. Guest should see gameplay in the normal Stream view; confirm no controller access. Stop video sharing and confirm the preview disappears while voice connection persists.
7. Check speaker selection, headphones, echo, capture device changes, leave, host end, new session, and normal Xbox audio/recording unchanged.
8. Collect both consoles' diagnostic logs, especially any ICE timeout, `replaceTrack` error, video playback failure or `SessionInUnexpectedState` keepalive warning.

The sandbox smoke test covers UI logic and mocked WebRTC state; **the real Windows build and live two-PC test still must pass before committing or merging**.
