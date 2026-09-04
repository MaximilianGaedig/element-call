# MSCxxxx: Floor control for MatrixRTC sessions

_Draft. This is the minimal proposal Element Call implements; it is written up
here so that the behaviour is specified somewhere until a real MSC exists._

## Problem

Moderators of large calls need to be able to quiet participants: mute someone
whose microphone is picking up noise, turn off a camera that is showing
something inappropriate, or run a webinar where nobody is audible unless a
moderator allows it. MatrixRTC has no way to express this today, so every
client would have to invent its own.

## Proposal

A new room state event, `org.matrix.rtc.floor_control`, describes what
moderators ask of devices in one of the room's MatrixRTC slots
([MSC4143](https://github.com/matrix-org/matrix-spec-proposals/pull/4143)).
Its state key is the slot ID (the `m.rtc.slot` event's state key, for example
`m.call#ROOM`), so each slot in a room is moderated independently: quieting
someone in a call slot says nothing about a whiteboard or breakout slot in
the same room.

```json
{
  "type": "org.matrix.rtc.floor_control",
  "state_key": "m.call#ROOM",
  "content": {
    "defaults": {
      "audio_muted": true,
      "video_muted": false
    },
    "devices": {
      "@alice:example.org:DEVICEID": {
        "audio_muted": false
      },
      "@bob:example.org:DEVICEID": {
        "video_muted": true,
        "volume": 0.5
      }
    }
  }
}
```

- `devices` is keyed by `<user ID>:<device ID>`, the user and device that
  sent the `m.rtc.member` event. Devices rather than member IDs are the
  target because a member ID is random for every join, whereas a control
  such as a block must survive the device leaving and rejoining.
- Each device entry and `defaults` may contain:
  - `audio_muted` (boolean): the device's microphone must not be heard.
  - `video_muted` (boolean): the device's camera must not be seen.
  - `volume` (number, 0 to 1): a multiplier to apply to the device's audio when
    rendering it, if it is not muted.
- A device's effective controls are its own entry, falling back to `defaults`
  for any field the entry does not set. This applies to everyone in the room,
  moderators included: anyone who can send this event can control anyone,
  regardless of power level, and is controlled by it in turn.
- All fields are optional; a missing event means nothing is controlled.

The event is sent by anyone with sufficient power level to send state events of
this type, which is the room's default state event power level unless a room
sets it otherwise in `m.room.power_levels`. Clients read and write the event
under the slot ID of the session they are in, and ignore events for other
slots.

## Client behaviour

Clients rendering a call must apply the effective controls to every device they
render: mute the audio of an `audio_muted` device, not display the video of a
`video_muted` device, and scale the audio of a device with a `volume` by that
factor. This protects the room even before the controlled device has reacted.

A device whose audio is controlled must stop publishing it, and must not let
its user unmute while the control is in place. It should make clear that a
moderator did this rather than the user. When the control is lifted the device
stays muted until its user chooses to unmute.

A device whose video is controlled keeps its camera as it is: viewers simply do
not display the video. The device should warn its user that nobody can see
them, so that they know their camera is not doing anything.

## Potential issues

Because the whole set of controls lives in one event, two moderators changing
it at the same time can overwrite each other's changes. This is accepted for
simplicity; a per-device state key would need a state key format that the
auth rules permit, which is left for a future revision.

A controlled device that ignores the event is still silenced for everyone
using a compliant client, but a non-compliant client would still hear it.
Enforcement at the SFU is out of scope for this proposal.

## Security considerations

Muting is a moderation action and is gated on the same power level as sending
the state event. It carries no more risk than editing any other room state.
