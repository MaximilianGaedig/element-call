# Mirroring the director's layout in a recording

A recorder following the [call recording MSC](./call_recording_msc.md)
renders the call the way any participant would see it, with the layout
Element Call would choose on its own: a grid, or a spotlight on whoever is
sharing their screen. Whoever asked for the recording has no say in what
it looks like. But that person is watching the call, and often has already
arranged their own view of it: pinned the speaker, dragged the panel into
order, enlarged the slides. This lets them act as the recording's
_director_: the layout decisions they make on their own screen are sent to
the recorder, which applies them to its own view of the call as best it
can.

This is Element Call's own solution, in its `io.element` namespace; it's
not proposed for the spec, since the operations are Element Call's.

## Who directs

The record dialog offers "Mirror my layout / audio levels". When chosen,
the client adds its own device to the `org.matrix.rtc.recording` request.
An audio-only recording has no layout, so for one only the audio levels
are mirrored: the director sends nothing but `volume` operations.

```json
{
  "type": "org.matrix.rtc.recording",
  "state_key": "m.call#ROOM",
  "content": {
    "recorder": "@recordbot:example.org",
    "io.element.call.director_device": "DEVICEID"
  }
}
```

- `io.element.call.director_device`: the ID of the sender's device whose
  layout the recorder should follow. The director is always the event's
  sender: only they know what their screen looks like, and they are who the
  recorder already trusts to start and stop it. Absent, the recorder lays
  the call out on its own.

The field lives in the request so that everyone, the recorder included,
learns who is directing from state they already track, and so that a
director who leaves the call takes their direction with them: the request
is cleared when the recording stops, and a new request names a new
director.

## The `io.element.call.layout` to-device message

While the recording lasts, the director's device sends each layout decision
it makes to the recorder as it happens, in a to-device message to every
device the recorder has in the call (the device IDs of its call
memberships):

```json
{
  "type": "io.element.call.layout",
  "content": {
    "room_id": "!abc:example.org",
    "request": "$request",
    "device_id": "DEVICEID",
    "seq": 12,
    "op": {
      "type": "pin",
      "user_id": "@bob:example.org",
      "device_id": "BOBDEV",
      "media": "camera",
      "pinned": true
    }
  }
}
```

- `room_id`: the room whose call is being recorded. To-device messages
  don't carry one.
- `request`: the event ID of the `org.matrix.rtc.recording` request the
  direction belongs to, so that messages from an earlier recording, or one
  in another slot, are ignored.
- `device_id`: the director's device ID, matching
  `io.element.call.director_device` in the request.
- `seq`: a counter that the director increments for every message in a
  recording, starting at 1. The recorder ignores anything at or below the
  last one it applied, so a message that arrives twice or late does
  nothing.
- `op`: the operation, below. One per message.

In an encrypted room the message is Olm-encrypted, like any other to-device
message the client sends; in a room without encryption it is sent in the
clear, as the request itself was.

### Operations

These describe what the director _did_, not what their screen looks like:
the recorder's viewport is a different size, it shows no tile of its own
where the director sees theirs, and it may hold tiles the director hasn't
seen yet, so copying the director's
layout verbatim would not survive contact. Each operation is something the
recorder can do to its own layout in the same terms Element Call offers its
users, and the result is close enough to let a director frame the recording
without being at the controls.

A tile is named by the participant whose media it shows and which of
their streams it is: `user_id` and `device_id`, the pair that identifies
the participant's `m.rtc.member` / `m.call.member` event; `media`,
`camera` (the default) or `screen_share`; and, where a device publishes
more than one stream of that kind (a phone sending its front and back
cameras at once, say), `track`, the ID of the published track (the
LiveKit track SID, which every subscriber sees alike). Absent, `track`
means the device's only stream of that kind, which is all Element Call
publishes today.

| `type`               | Fields                                                                                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`             | `layout`: `grid` or `spotlight`                                                        | The director switched layout.                                                                                                                                                                                                                                                                                                                                                                |
| `spotlight_expanded` | `expanded` (boolean)                                                                   | The director expanded the spotlight to fill the window, or shrank it back.                                                                                                                                                                                                                                                                                                                   |
| `move_tile`          | tile, `index`, `in`?: `grid` (default) or `spotlight`                                  | The director dragged the tile into position `index` (from 0) among the tiles of the grid, or of the spotlight when it shows several. The index counts every tile the director sees, their own included: the recorder sees the director's camera as one more participant, and shows no tile of its own. The recorder moves the same tile to that index, or to the end if its list is shorter. |
| `pin`                | tile, `pinned` (boolean)                                                               | The director pinned the stream to the spotlight, or unpinned it.                                                                                                                                                                                                                                                                                                                             |
| `enlarge`            | tile, `enlarged` (boolean)                                                             | The director enlarged the tile to twice its size in the grid, or shrank it back.                                                                                                                                                                                                                                                                                                             |
| `tile_options`       | any of `hug_video`, `crop_video`, `relaxed_grid`, `enlarge_active_speakers` (booleans) | The director changed the settings that shape and pack tiles: shrinking tiles to their video, cropping video to fill the tile, packing tiles in rows rather than columns, and enlarging whoever is speaking. Only the settings that changed are present.                                                                                                                                      |
| `rail_width`         | `width` (integer, CSS pixels)                                                          | The director resized the rail of tiles beside the landscape spotlight. The recorder applies it within whatever limits its own window allows.                                                                                                                                                                                                                                                 |
| `volume`             | tile, `volume` (integer, percent)                                                      | The director changed how loudly the participant's stream plays for them: 0 is muted, 100 unchanged, up to 200. Since the recording carries what the recorder hears, this is how a director turns somebody down, in an audio recording as much as a video one. A recorder that mixes the call's audio itself applies it there rather than to any playback.                                    |

### Catching up

The recorder joins after the director has often already arranged their
view, and may be restarted during a recording. So when the recorder
confirms it is recording (an `org.matrix.rtc.recording.status` of
`started`), the director sends its current decisions as a burst of the
operations above: the layout, whether the spotlight is expanded, the tile
options, the rail width, then a `pin`, `enlarge` or `volume` for every tile
where it has chosen one, and a `move_tile` for each tile in the order it
sees them. The recorder applies them like any other.

## Recorder behaviour

A recorder whose request names a `io.element.call.director_device` applies
`io.element.call.layout` messages that were sent by the request's sender,
name that device, and carry the request's event ID, in `seq` order, and
ignores every other one. In an encrypted room it only accepts messages
that were encrypted, so that nobody else in the room can direct it; who
the sender is comes from the encryption, and the device from the content,
which a user's own other devices could forge but nobody else's can.

It applies each operation to its own layout as if its user had done the
same thing: switched the layout, dragged the tile, pinned, enlarged, set a
volume. Where it can't, because the tile isn't in its view or the
operation makes no sense in its current layout, it does nothing, and does
not report back. The director sees the recording only when it is posted;
this is direction, not remote control.

In `matrixrtc-sip-bridge`, the video is Element Call itself rendered in a
headless browser, so the messages reach it through the widget API and the
same layout code that the director used to make the decision applies
them. The audio, for audio and video recordings alike, is the bridge's own
mix of the call's streams, so the bridge applies the `volume` operations
to that mix itself, whether or not a browser is running.

## Potential issues

The recorder's view is not the director's, so the mirror is approximate.
The director's own tile sits at an end of their grid until they drag it,
while the recorder orders it like anyone else's; their window is a
different shape, so the recorder may be in a portrait spotlight where the
director sees a grid; and a participant who joins between a `move_tile`
and its arrival lands wherever Element Call's ordering puts them. Sending
operations rather than positions keeps these from compounding: every
message means the same thing whatever the recorder's state.

A director's other devices could send messages in their name, since the
device is only asserted in the content. They belong to the same user, who
started the recording, so this is accepted.

A director who switches to another device mid-recording stops directing;
the new device isn't named in the request. Stopping and restarting the
recording from the new device names it.
