# MSC4196: Voice and video calling application for MatrixRTC

> **Element Call's working copy.** This is [MSC4196] as of upstream commit
> `2407455cb5` (8 Sep 2026, branch `hughns/matrixrtc-m-call` of
> matrix-org/matrix-spec-proposals) with one change to be proposed upstream:
> the sections on **media streams** ("Media streams", "Stream IDs over
> LiveKit", the three "Alternatives" about naming streams, and the two
> "Security considerations" about stream IDs). Everything else is upstream's
> text, byte for byte: the commit before the one that added this note holds
> the original, so `git diff` between the two is the proposed change.
>
> [MSC4196]: https://github.com/matrix-org/matrix-spec-proposals/pull/4196

[MSC4143] introduces MatrixRTC as an extensible framework for real-time communication in Matrix.
MatrixRTC separates the transport of RTC data between members from the applications that use this
data to build user experiences. This proposal introduces such an application for the concrete use
case of voice and video calling.

The application is able to power a variety of calling use cases including but not limited to
classical 1-on-1 and group calling as well as Discord-style [Voice Channels] (which, previously,
[MSC3417] tried to introdcue based on the pre-MatrixRTC group calling mechanism from [MSC3401]).
The application is compatible with the [LiveKit] transport introduced in [MSC4195].

Note that call ringing and notifications are not in scope for this proposal. These are covered
in [MSC4075] and [MSC4310].

[MSC4143]: https://github.com/matrix-org/matrix-spec-proposals/pull/4143
[Voice Channels]: https://support.discord.com/hc/en-us/articles/19583625604887-Voice-Channels-FAQs
[LiveKit]: https://github.com/livekit/livekit
[MSC3417]: https://github.com/matrix-org/matrix-spec-proposals/pull/3417
[MSC3401]: https://github.com/matrix-org/matrix-spec-proposals/pull/3401
[MSC4195]: https://github.com/matrix-org/matrix-spec-proposals/pull/4195
[MSC4075]: https://github.com/matrix-org/matrix-spec-proposals/pull/4075
[MSC4310]: https://github.com/matrix-org/matrix-spec-proposals/pull/4310

## Proposal

A new MatrixRTC application type `m.call` is introduced. For now, only a single instance of `m.call`
per room is supported. This is sufficient for the majority of use cases and avoids the risk of two
competing slots being opened for the same call when room administrators race.

### Slot event

The `m.call` application instance MUST use an application-specific slot ID literal of `room`. The full
slot ID as per [MSC4143], thus, becomes:

```
slot_id = {application_type}#{application_slot_id} = m.call#room (= state_key)
``` 

No further parameters are required in the slot-level `application` object. Here is an example for
an open `m.rtc.slot` event for the `m.call` application:

```json5
{
  "type": "m.rtc.slot",
  "state_key": "m.call#room", // = slot_id
  "content": {
    "status": "open",
    "application": {
      "type": "m.call",
    },
    "encryption": {
      "type": "m.per_member",
    }
  },
  ...
}
```

When clients create rooms with a `preset` of `private_chat` or `trusted_private_chat` in
[`/createRoom`], they SHOULD by default include an open `m.rtc.slot` event for `m.call` in
`initial_state`. Clients MAY let the user override this default behaviour.

As per [MSC4143], encryption of MatrixRTC sessions is mandatory in encrypted rooms and forbidden
in unencrypted rooms. Therefore, if [`m.room.encryption`] is also present in `initial_state`, the
`encryption` content block on the initial slot event MUST be set to `{ "type": "m.per_member" }`.
Otherwise, the `encryption` property MUST be omitted.

The default [power levels] assigned under the `private_chat` preset prevent room members other
than the room creator from sending state events. Including the slot event at room creation time,
ensures that room members are able to have calls in the room without depending on a room administrator
to send the slot event later.

With the `trusted_private_chat` preset, all room members get the same power level as the room
creator. Thus, they could technically send the `m.rtc.slot` event themselves when needed. However,
including the slot at room creation time, makes it explicit that calls are enabled and prevents
clients from having to create the event later.

Contratry to the above, including `m.rtc.slot` events in `initial_state` is not required when
the `public_chat` preset is used. Enabling calls by default is usually not desired here due to
the open-access nature and the potentially large size of such rooms.

[`/createRoom`]: https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3createroom
[`m.room.encryption`]: https://spec.matrix.org/v1.18/client-server-api/#mroomencryption
[power levels]: https://spec.matrix.org/v1.18/client-server-api/#mroompower_levels

### Membership events

The schema for the `application` content block in `m.rtc.member` events that are joined to `m.call`
slots, looks as follows:

- `type` (string, required): MUST be `m.call`.
- `intent` (string): One of `audio`, `video`. Optionally discloses whether the member intends to
  join the call with audio only or with audio and video. Clients SHOULD set this field when joining
  and update it as they en- or disable their video stream. This gives other members a hint as to whether
  the session presents an audio or video call.

Below is an example of an `m.rtc.member` event for joining an `m.call` slot.

```json5
{
  "type": "m.rtc.member",
  "content": {
    "slot_id": "m.call#room", // = m.rtc.slot state_key
    "member": {
      "id": "xyzABCDEF0123",
      "membership": "join"
    },
    "application": {
      "type": "m.call",
      "intent": "video"
    },
    "transports": {
      ...
    },
    "sticky_key": "xyzABCDEF0123", // = member.id
  },
  ...
}
```

When a client joins an `m.call` slot where all other members have set their `intent` to `audio`,
the joining client SHOULD not publish a video track by default. It MAY allow the user to overrule
this initial setting both before and after joining though. If any other members have an
`intent` of `video`, the joining client SHOULD assume the session to
represent a video call. This does *not* imply that the client should enter the call with video
enabled, however (see [below]).

When leaving a slot, [MSC4143] allows clients to optionally provide context with regards to the
reason for leaving in the `leave_reason` property of their `m.rtc.member` event. For `m.call`
applications, the generic `leave_reason.code` values provided in [MSC4143] are extended with
the following additional codes:

- `transport_error`: The client failed to negotiate a connection over the chosen transport
  (e.g. due to an ICE/DTLS setup failure).
- `media_error`: The client failed to capture or transmit audio and/or video after joining.
- `codec_mismatch`: The client could not decode/encode the call media.

[below]: #faking-intent

### Media streams

What a member contributes to a call is a set of *media streams*. A stream is one source of media as
a user thinks of it: a camera together with the microphone that goes with it, or a shared screen
together with the audio shared with it. Each stream has:

- a *purpose*, either `m.usermedia` (a camera and/or microphone) or `m.screenshare` (a shared
  screen, window or tab, and/or its audio). These are the purposes of [MSC3077], for the same
  reason: a receiver lays out and mixes the two differently.
- at most one video track and at most one audio track.
- optionally, a *stream ID*.

A member MAY publish any number of streams of either purpose at once, for instance the front and
back cameras of a phone, a camera and a document camera, or two shared windows.

Other parts of Matrix need to refer to one particular stream: to mute or hide it for everyone, to
set its volume, to pin it, to say which stream a recording or a caption came from. Transports
identify media in their own terms, which are typically assigned by the transport, differ from one
subscriber or connection to the next, and change whenever the media is republished. The stream ID
is the stable, transport-independent name for a stream instead:

- A stream ID is a string of 1 to 64 characters from `[A-Za-z0-9._:-]`, chosen by the publishing
  client, and unique among the streams that the member's device has published at the same time,
  whatever their purpose.
- A client SHOULD give a source the same stream ID whenever it publishes it again during a session,
  and across sessions where it can (after a reconnection, after stopping and restarting a screen
  share, after leaving and rejoining), so that something said about the stream continues to apply to it.
- The audio and the video of a stream carry the same stream ID. This is what makes the audio shared
  with a screen distinguishable from the microphone of whoever shares it, and one shared screen's
  audio from another's.
- A stream without a stream ID is the device's *default stream* of its purpose. A client that
  publishes a single stream of a purpose MAY leave it without an ID, which is what clients
  predating stream IDs do. A client that publishes more than one stream of a purpose at once
  SHOULD give every one of them an ID, as otherwise the default stream can't be told apart from
  the purpose as a whole.
- Stream IDs are opaque. Clients MUST NOT derive meaning from them, and MUST NOT put anything in
  them that identifies the user or their hardware (such as a device label); see [below](#stream-ids-are-visible-to-the-transport).

A stream is therefore referred to from Matrix by the user ID and device ID of the `m.rtc.member`
event that publishes it (rather than its `member.id`, which is random for every join), the
stream's purpose, and its stream ID if it has one. A reference without a stream ID means the
device's default stream of that purpose. Events that refer to streams SHOULD treat a reference to
a stream ID that the device isn't publishing as referring to nothing, rather than falling back to
another stream.

Stream IDs are deliberately not announced in `m.rtc.member` events; see
[Alternatives](#announcing-streams-in-mrtcmember-events).

[MSC3077]: https://github.com/matrix-org/matrix-spec-proposals/pull/3077

### Usage with the LiveKit transport from [MSC4195]

As of writing, the only known MatrixRTC transport is the `m.livekit` transport from [MSC4195].
Clients can use the mechanisms from [MSC4195] for obtaining WebSocket URLs and access tokens
for the LiveKit SFUs involved in a MatrixRTC session. The URLs and tokens can be used with one
of the [LiveKit SDKs] to [publish] a user's own audio and video (including [screensharing]) and
to [subscribe] to other member's published audio and video. Clients can map LiveKit participants
and their media tracks to `m.rtc.member` events by means of the procedure for deriving LiveKit
participant identities given in [MSC4195].

#### Stream IDs over LiveKit

With the `m.livekit` transport, a stream's purpose is given by the [source] of its tracks: tracks
with the sources `camera` and `microphone` belong to an `m.usermedia` stream, and tracks with
the sources `screen_share` and `screen_share_audio` to an `m.screenshare` stream.

The stream ID is the track's [name]. A publisher sets the same name on a stream's audio and
video track, and SHOULD also pass it as the `stream` publish option, which has LiveKit keep the
two tracks synchronised. Tracks with an empty name belong to the participant's default stream of
their purpose. The track SID MUST NOT be used to refer to a stream from Matrix: the SFU assigns a
new one each time a track is published.

[source]: https://docs.livekit.io/reference/client-sdk-js/enums/Track.Source.html
[name]: https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishOptions.html#name

Note that future transports might lack some or all of the capabilities listed above. Therefore,
the `m.call` application is explicitly only deemed compatible with the `m.livekit` transport for
now. If a future MSC introduces another transport, that MSC will have to evaluate the transport's
fitness for use in `m.call`, including how it carries stream IDs.

[LiveKit SDKs]: https://docs.livekit.io/transport/sdk-platforms/
[publish]: https://docs.livekit.io/transport/media/publish/
[screensharing]: https://docs.livekit.io/transport/media/screenshare/
[subscribe]: https://docs.livekit.io/transport/media/subscribe/

## Potential issues

### Multiple slots per room

More advanced calling experiences might have a need for more than one slot per room, for instance,
for breakout sessions. This was consciously left out of scope in this proposal. A future MSC
may devise a scheme for letting clients negotiate which slot to use when multiple are present in
a room.

## Alternatives

### Injecting `m.rtc.slot` events on the server

Instead of having clients pass in the initial `m.rtc.slot` event via `initial_state` on
[`/createRoom`] requests, this logic could also be implemented by the server. This would
further complicate the already complex steps the server has to run through during room
creation though.

### Announcing streams in `m.rtc.member` events

A member could list its streams, with their IDs and purposes, in its `m.rtc.member` event. Every
camera switched on and every screen share started or stopped would then be an update to the
member event, sent to the whole room rather than the session, and media would routinely arrive
before the event describing it, so that receivers would need a rule for undescribed media
anyway. It would also disclose to the room what a member is sharing, which `intent` already
raises concerns about. Carrying the ID with the media has none of these problems, and the
purpose is something every transport fit for calling can already express.

### A membership per stream

[MSC4143] already lets a device hold several memberships, and each additional stream could be
published under one of its own, which needs no new concept. Each membership needs its own
connection to the transport and its own encryption keys, though, and `member.id` is random for
every join, so that nothing said about a stream would survive its publisher rejoining.

### Referring to streams by the transport's identifiers

Events could name a stream by whatever the transport calls it, such as a LiveKit track SID. These
are assigned by the transport and change when media is republished, so a mute or a volume set
on a stream would lapse when its publisher reconnected or restarted their screen share, and
every event format referring to streams would become specific to a transport.

## Security considerations

### Metadata leakage through intent

The `intent` property on `m.rtc.member` events is visible to all room members, not just
those joined to the MatrixRTC session. Some user's might not be comfortable with disclosing
whether their camera is on or off outside the session though. To mitigate this, users can opt
not to fill `intent` given that it is an optional property.

### Consent to share media

Before joining a call, clients SHOULD demonstrate to the user what media (audio and/or video)
they are about to share so that the user can meaningfully consent to sharing it.

In particular, clients should be careful about the fact that remote users could fake a call's
intent. If an `intent` of `video` would cause a client to automatically start sharing video upon
accepting an incoming call, then it SHOULD clearly differentiate the call from an audio call.
This could be achieved for instance by presenting different text labels ("Incoming video call"
/ 'Join with video') or by showing the user a preview of their video.

Clients MAY allow their users to override any default settings before joining a call, so that a
user can accept an incoming video call without sharing their own video, for example.

### Stream IDs are chosen by the publisher

Nothing stops a client from publishing a stream under a new stream ID. Anything that restricts a
member through a reference to one of their streams, such as a moderator muting it, can therefore
be evaded by the restricted member. Proposals that refer to streams for such purposes MUST make
it possible to refer to all of a device's streams of a purpose (or all of its streams) at once,
which a publisher can't evade, and SHOULD treat references to single streams as refinements of
that.

### Stream IDs are visible to the transport

Stream IDs travel with the media, outside of Matrix's end-to-end encryption, so that the
transport's infrastructure (the SFU, for `m.livekit`) and every participant it serves can read
them. They MUST NOT contain anything that identifies the user or their hardware, such as the
label of a capture device or the title of a shared window. Short generic IDs such as `camera:2`
or `screen:1` are sufficient.

## Unstable prefix

No unstable prefix is needed for `m.call` because it is only used inside the `m.rtc.slot`
and `m.rtc.member` events that are themselves guarded by the unstable prefix from [MSC4143].

Stream IDs need none either: a track without a name is already a default stream, and a name set
by a client that knows nothing of stream IDs is as good an opaque ID as any.

## Dependencies

This proposal depends on [MSC4143] and [MSC4195].
