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
    "auditorium_visibility": 50,
    "sip_dial_in": "video",
    "bridges": {
      "@sipbridge:example.org": {
        "sip": ["sip:room-1a2b3c@sip.example.org:5062"]
      }
    },
    "devices": {
      "@alice:example.org:DEVICEID": {
        "audio_muted": false
      },
      "@bob:example.org:DEVICEID": {
        "video_muted": true,
        "volume": 32768,
        "screen_share": {
          "volume": 16384
        },
        "streams": {
          "camera:2": {
            "video_muted": false
          }
        }
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
  - `volume` (integer): a multiplier to apply to the device's audio when
    rendering it, if it is not muted, in units of 1/65536: 0 is silent and
    65536 leaves the volume unchanged. Values above 65536 amplify; clients
    need not honour more than 131072 (twice). An integer because Matrix
    events cannot carry floats.
  - `screen_share` (object): `audio_muted`, `video_muted` and `volume` as
    above, for the device's `m.screenshare` streams: what it shares, and the
    audio shared with it. The fields at the top level of an entry are for its
    `m.usermedia` streams, its cameras and microphones, and say nothing about
    what it shares: muting a presenter's microphone leaves the sound of the
    video they're presenting alone, and the two are levelled apart.
  - `streams` (object, device entries only): refinements for single streams,
    keyed by stream ID (see "Media streams" in our
    [working copy of MSC4196](./msc4196_matrixrtc_m_call.md#media-streams)),
    each with `audio_muted`, `video_muted` and `volume` as above. This is how
    one of two cameras, or one of two shared windows, is controlled by
    itself. An entry for a stream the device isn't publishing does nothing.
  - `pinned` (boolean): the device is pinned to the spotlight for everyone, as
    if each viewer had pinned it themselves.
  - `hidden` (boolean): the device's tile is not shown to anyone. The device
    itself still sees and hears the call, and its media is still heard unless
    also muted.
  - `blocked` (boolean, device entries only): the device is shut out of the
    call. Everyone treats it as though it had no RTC membership: they show no
    tile for it, display none of its media, do not connect to its SFU, and
    do not send it media where they can avoid doing so. The device must leave
    the session and may not rejoin while blocked.
- A device ID of `*` (for example `@alice:example.org:*`) makes an entry apply
  to all of that user's devices. Where a device also has its own entry, its
  fields take precedence over the wildcard's, field by field.
- A stream's effective controls are, field by field: its entry under the
  device's `streams`, if it has a stream ID; then the controls for streams of
  its purpose (the top level for `m.usermedia`, `screen_share` for
  `m.screenshare`) in the device's entry, in its user's `*` entry, and in
  `defaults`. Stream IDs are chosen by the publisher, who could dodge a control
  on one by publishing under another, so controls that must hold (a mute,
  above all) belong at the level of the purpose, which covers whatever the
  device publishes; `streams` is for refining them.
- A device's effective controls are its own entry, falling back to `defaults`
  for any field the entry does not set. This applies to everyone in the room,
  moderators included: anyone who can send this event can control anyone,
  regardless of power level, and is controlled by it in turn.
- `auditorium_visibility` (number, top level): auditorium mode. Only users
  whose power level is at least this are shown as tiles in the call; everyone
  else is still in the call but not displayed. Unset means everyone is shown.
- `sip_dial_in` (`"audio"` or `"video"`, top level): whether people may dial
  into the call over SIP, and whether they may bring video when they do.
  Unset means dial-in is not allowed. This is advisory: it tells clients
  whether to offer dial-in details, and tells a SIP bridge whether it is
  welcome, so that inviting a bridge into a room is a moderator's decision
  rather than something any member can do on a whim. A bridge should refuse
  to connect callers into a call whose floor control does not allow it.
- `bridges` (object, top level): the addresses at which the call can be
  reached through bridges, keyed by the bridge bot's user ID. Each entry may
  contain `sip`, a list of SIP URIs that dial into this call. Moderators
  fill this in when they enable dial-in, by asking the bridge (below), so
  that every client can show the addresses without asking the bridge
  itself. A future proposal for bridges to advertise the rooms and
  addresses they bridge in general should replace this section; it lives
  here for now because the call already has a moderator-owned event to put
  it in.
- All fields are optional; a missing event means nothing is controlled.

### Discovering bridged addresses

A client that has enabled dial-in asks the bridge bot for the call's
addresses with a to-device message of type
`org.matrix.rtc.bridge_info.request`, sent to all of the bot's devices:

```json
{
  "room_id": "!call:example.org"
}
```

The bridge replies to all of the sender's devices with
`org.matrix.rtc.bridge_info`:

```json
{
  "room_id": "!call:example.org",
  "sip": ["sip:room_12345678@sip.example.org:5062"],
  "tel": ["tel:+442081234567"],
  "code": "12345678"
}
```

`sip` lists URIs that dial straight into the call. `tel` (optional) lists
phone numbers that reach the bridge's dial-in menu, where `code` is what to
key in to be joined to this call.

The client then records the reply under `bridges` in floor control. The
bridge must be a member of the room (or invited to it) before it will answer,
which is how the moderator's invitation doubles as consent.

The event is sent by anyone with sufficient power level to send state events of
this type, which is the room's default state event power level unless a room
sets it otherwise in `m.room.power_levels`. Clients read and write the event
under the slot ID of the session they are in, and ignore events for other
slots.

## Client behaviour

Clients rendering a call must not display tiles for users below
`auditorium_visibility` (other than the local user's own tile), and must apply
the effective controls to every device they
render: mute the audio of an `audio_muted` device, not display the video of a
`video_muted` device, and scale the audio of a device with a `volume` by that
factor. This protects the room even before the controlled device has reacted.
The same goes for each of a device's streams under its own effective
controls: a shared screen's audio and video under `screen_share`, and a
stream with an entry in `streams` under that. Anything else that renders the
call, such as a recorder or a bridge mixing its audio for a phone line,
applies them to what it renders too.

A device whose audio is controlled must stop publishing it, and must not let
its user unmute while the control is in place. It should make clear that a
moderator did this rather than the user. When the control is lifted the device
stays muted until its user chooses to unmute. The audio shared with a screen
can't always be stopped apart from the screen, so a device whose
`screen_share` audio is controlled may carry on publishing it; viewers
silence it.

A device whose video is controlled keeps its camera as it is: viewers simply do
not display the video. The device should warn its user that nobody can see
them, so that they know their camera is not doing anything.

A `hidden` device likewise carries on as normal; viewers do not show its tile.
The device should warn its user that they are hidden. Because a hidden tile
can't be reached to unhide it, clients should offer moderators a list of
hidden devices to restore.

Clients apply a `blocked` device by filtering it out of the session's
memberships before doing anything else with them, so that lifting the block
is handled exactly like the device joining. A blocked device leaves the
session and its client refuses to rejoin until the block is lifted. Note that
where a blocked device shares an SFU with others, the SFU will still forward
their media to it unless it enforces the block itself, and MatrixRTC's
encryption key distribution is not aware of the block; this proposal only
covers what clients can do on their own.

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
