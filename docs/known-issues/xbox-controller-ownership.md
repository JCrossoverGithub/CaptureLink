# Xbox Remote Play Controller Ownership

## Status

Known Xbox Remote Play / game interaction.

Not considered a CaptureLink v0.1 release blocker.

Revisit after v0.1.

## Summary

Some Xbox games can stop accepting gameplay input from a controller
connected directly to the Xbox if an Xbox Remote Play session is already
active when gameplay initializes.

The physical controller remains connected to the console and continues
to control Xbox system UI, including the Xbox Guide. Only gameplay input
is affected.

This behavior has been reproduced with CaptureLink and Microsoft's own
Xbox Remote Play client.

Known affected titles during testing:

- NBA 2K
- Minecraft

## Reproduction

A representative failing sequence is:

1. Connect a controller directly to the Xbox.
2. Start CaptureLink and establish Remote Play.
3. Launch or enter gameplay in an affected title.
4. Reach the point where the player should have movement control.
5. The Xbox-connected controller no longer controls gameplay.
6. Pressing the Xbox/Home button still opens Xbox system UI normally.

If gameplay control is established with the physical Xbox controller
before CaptureLink starts Remote Play, the problem does not normally
occur.

## Observations

### Physical Xbox controller remains connected

While gameplay input is broken, the Xbox/Home button continues to work
and Xbox system UI remains controllable.

This strongly suggests that the console has not lost the physical
controller. The issue appears to be at the game's gameplay-input or
player-slot assignment layer.

### CaptureLink remote controller works

While the Xbox-connected controller cannot control gameplay:

1. Connect another controller to the PC.
2. Enable Controller in CaptureLink.
3. The PC-connected controller successfully controls gameplay.

This suggests that the affected game is listening to the Remote Play
input endpoint.

### Disabling CaptureLink controller does not restore local control

After controlling gameplay through a PC-connected controller:

1. Disable Controller in CaptureLink.
2. Try the controller connected directly to the Xbox.

The Xbox-connected controller still does not regain gameplay control.

Re-enabling the CaptureLink controller allows the PC controller to work
again.

This suggests that the title does not dynamically reassign Player 1 back
to the local Xbox controller when the Remote Play controller disappears.

### Remote Play reconnection can restore control

During the affected state, unplugging and reconnecting the controller at
the Xbox caused the WebRTC / Remote Play connection to drop.

After CaptureLink reconnected, the Xbox-connected controller was able to
control gameplay again.

The important event may therefore be the Remote Play session reset,
rather than the physical controller reconnect itself.

## Working Hypothesis

The current model is:

CaptureLink / Remote Play connects
    |
    v
Remote Play input endpoint exists
    |
    v
Game initializes gameplay controller ownership
    |
    v
Game associates Player 1 with Remote Play input
    |
    +--> Xbox controller still controls system UI,
    |    but gameplay ignores it
    |
    +--> CaptureLink PC controller feeds the Remote Play
         endpoint and gameplay works

This is a hypothesis and should not be treated as confirmed knowledge
of Xbox internals.

## CaptureLink Investigation

### Startup gamepad registration experiment

The vendored xbox-xcloud-player control channel briefly reports gamepad
index 0 as added and then removed during Remote Play authorization.

An experimental CaptureLink build removed that automatic add/remove
sequence.

Result:

- Remote Play continued to work.
- The NBA 2K / Minecraft controller problem still occurred.

Conclusion:

The startup gamepad add/remove sequence is not sufficient to explain the
problem.

The experiment was not retained.

### Input-channel removal

Removing these xHome capabilities was considered:

- input
- reliableinput
- unreliableinput

This was not pursued because the input channel is also used by the
vendored player for functionality beyond explicit controller input,
including video-frame metadata.

Removing it could destabilize the working Remote Play implementation
without strong evidence that it would fix controller ownership.

## Microsoft Remote Play Comparison

The same general behavior was reproduced using Microsoft's Xbox Remote
Play client.

This is strong evidence that the issue is not unique to CaptureLink's
controller implementation.

CaptureLink should avoid invasive protocol modifications solely to work
around this behavior unless future investigation produces stronger
evidence.

## Current Workaround

For users controlling the Xbox with a controller connected directly to
the console:

1. Launch the game.
2. Enter actual gameplay.
3. Confirm the Xbox-connected controller can control the player.
4. Start or connect CaptureLink afterward.

If the problem has already occurred:

1. Disconnect CaptureLink.
2. Regain gameplay control using the controller connected to the Xbox.
3. Reconnect CaptureLink.

Alternatively, a controller connected to the PC can control gameplay
through CaptureLink's Enable Controller feature.

## Future Investigation

Possible future work:

- Test additional games.
- Determine whether the issue is title-specific or common to certain
  game engines or Xbox player-slot behavior.
- Compare CaptureLink and Microsoft Remote Play control-channel traffic.
- Investigate whether Remote Play can exist without becoming an eligible
  gameplay controller endpoint.
- Investigate whether a control-channel message can relinquish or
  reassign the Remote Play gamepad.
- Test alternate controller indexes.
- Investigate Xbox controller/user pairing state.
- Add a CaptureLink Reconnect action that performs a clean xHome/WebRTC
  restart while remembering the selected console.
- Re-test after future Xbox console and Remote Play updates.

## v0.1 Decision

For CaptureLink v0.1:

- Do not modify the stable Remote Play protocol implementation further.
- Treat this as a known Xbox Remote Play / title interaction.
- Document the workaround.
- Keep CaptureLink's optional PC-controller support.
- Revisit after v0.1.
