# Shared Controller input

## Status

Shared Controller remains experimental.

CaptureLink's validated Friend controller modes currently include:

- **Player 2** — the Friend is exposed to the Xbox as a separate logical controller.
- **Shared Controller** — Host and Friend input are combined into Xbox Controller 1.

Player 2 has been validated successfully with a remote Bluetooth-connected controller.

## Host controller requirement

Shared Controller can only combine Host input that CaptureLink can see.

The Host controller therefore needs to be connected to the Host Windows PC through USB, Bluetooth, or another Windows-visible gamepad connection.

A controller connected directly to the physical Xbox cannot be sampled through the browser Gamepad API and therefore cannot participate in CaptureLink's Shared Controller mixer.

## Retest procedure

Before treating Shared Controller as a software regression:

1. Quit the game.
2. Disconnect controllers paired directly to the Xbox.
3. Connect the Host controller to the CaptureLink PC.
4. Verify Windows recognizes it with `joy.cpl`.
5. Connect CaptureLink to Xbox Remote Play.
6. Leave the normal CaptureLink Enable Controller control off.
7. Select Shared Controller.
8. Establish the Direct Friend session.
9. Have both Host and Friend send controller input.
10. Launch the game only after the virtual controller is established.

Some games, including tested NBA 2K workflows, may assign controller/player slots when gameplay initializes.

## Open investigation

If Shared Controller still fails when the Host controller is confirmed visible to Windows/CaptureLink, investigate the Host-side shared-controller mixer as a regression.

The Friend Bluetooth transport itself should not be assumed broken when Player 2 mode works, because that validates:

- browser gamepad detection
- Bluetooth controller capture
- Friend P2P controller transport
- remote Xbox controller injection
