# MSCxxxx: Recording MatrixRTC calls

_Draft. This is the proposal Element Call and matrixrtc-sip-bridge implement;
it is written up here so that the behaviour is specified somewhere until a
real MSC exists._

## Problem

People record calls: for minutes, for those who couldn't attend, for
compliance. Today the only way to record a MatrixRTC call is to run a bot
that joins the call and is driven by chat commands such as `!record`. Every
bot invents its own commands, clients can't offer a record button, and
nobody else in the call finds out that they are being recorded unless they
happen to read the chat.

## Proposal

Recording is done by a _recorder_: a Matrix user, usually a bot, that is a
member of the room and joins the call as a participant. Clients ask it to
start and stop through a room state event, `org.matrix.rtc.recording`, whose
state key is the MatrixRTC slot being recorded (the `m.rtc.slot` event's
state key), so that a room with several slots records each independently.
Because it is state, every client in the room can tell at a glance whether
the call is being recorded, and by whom.

```json
{
  "type": "org.matrix.rtc.recording",
  "state_key": "m.call#ROOM",
  "content": {
    "recorder": "@recordbot:example.org",
    "media": "video",
    "streams": "composite",
    "requires_consent": false
  }
}
```

- `recorder` (required while recording): the user ID of the recorder being
  asked. Other recorders in the room ignore the event. This lets a room hold
  more than one bot, and lets clients tell which bot to invite.
- `media`: `audio` or `video`. Whether to record video as well as audio.
  Defaults to `video`.
- `streams`: `composite`, `separate` or `both`. Whether to record what a
  participant would see and hear (one mixed file), each participant's
  streams separately, or both. Defaults to `composite`.
- `requires_consent`: whether everyone in the call must consent before
  anything is recorded, as the law requires in some places. Defaults to
  `false`. See [Consent](#consent).

An event with empty content (or no `recorder`) means the call is not being
recorded; sending one stops a recording. The event's sender is who started
or stopped it.

Who may start and stop a recording is who may send the event, so a room
controls it through the event's entry in `m.room.power_levels`. Where that
is unset it falls back to `state_default`, which in most rooms means
moderators. Clients should let moderators set this level, and offer
recording only to users at or above it. Recorders should ignore events from
senders below it, which the auth rules already prevent for state events.

### Recorder behaviour

On seeing the event name it as `recorder`, the recorder joins the slot's
call (as a member, so that it receives media keys like anyone else) and
starts recording. Joining takes a while, and can fail, so it tells the room
when it is actually recording with an `org.matrix.rtc.recording.status`
event that references the request:

```json
{
  "type": "org.matrix.rtc.recording.status",
  "content": {
    "m.relates_to": { "rel_type": "m.reference", "event_id": "$request" },
    "status": "started"
  }
}
```

- `status`: `started` once media is being recorded, or `failed` if it can't
  record, for example because the requested `media` or `streams` are not
  supported. A `failed` status should carry a human-readable `reason`, and
  the recorder should clear the state event, since nothing is being
  recorded. It may also send an `m.notice` so that the reason is seen in
  the timeline.

When the event is cleared, or the call ends, it stops recording and posts
the result into the room: the file as an `m.video` or `m.audio` message, or
a link to it as `m.text`, so that the recording is where the call was. That
message references the request the same way, so that clients can tell
which recording it is. Where the recorder stopped on its own (the call
ended, or it failed), it should clear the event itself so that clients
don't go on warning about a recording that is over; it therefore needs the
power to send it.

A recording too big for the homeserver's media repository may instead be
kept by the recorder (or wherever it stores files): the message is then
the same `m.video` or `m.audio`, with its thumbnail and `info`, but its
`url` is a link to the recorder's own download endpoint rather than an
`mxc://` URI, and the content carries `org.matrix.rtc.recording.url` with
that same link to mark it. A client downloads it with the user's OpenID
token (`Authorization: Bearer` and a `server_name` query parameter), which
the recorder verifies with the homeserver before checking that the user is
in the room and answering with a short-lived URL for the file. Clients only
honour the field on messages from the recorder named in the request, and
only for `https` links, since the token goes to whatever it points at.

A recorder should not record anything it can't tell the room about: if it
can't send the events, it shouldn't record.

### Consent

Recording someone without their consent is illegal in some countries, so
a request can ask that nobody be recorded until everyone in the call has
agreed. When `requires_consent` is `true`, each participant answers in
their call membership, under `org.matrix.rtc.recording_consent`: a map
from the request's event ID to `true` to agree to being recorded, or
`false` to decline. In an `m.rtc.member` event it sits in the
`application` object; in a legacy `m.call.member` event, at the top
level:

```json
{
  "type": "m.call.member",
  "state_key": "_@alice:example.org_DEVICEID_m.call",
  "content": {
    "application": "m.call",
    "call_id": "",
    "device_id": "DEVICEID",
    "org.matrix.rtc.recording_consent": { "$request": true },
    "...": "..."
  }
}
```

Consent is per request, since a participant may be willing to be recorded
by one person and not another; an answer to any other request means
nothing to this one. It lives in the membership because that is what
being in the call means: whoever is in the call can set it by definition,
the recorder and every client already track the current memberships
reliably (state that can't fall into a gap in the timeline), and it goes
away with the membership, so someone who leaves and comes back is asked
again. A user with several devices in the call has consented if any of
them has, and declined if any of them has.

The recorder joins the call as usual on seeing such a request, but
doesn't record until every user with a membership in the slot, other than
the request's sender (who consented by asking) and the recorder itself,
has answered `true`. Users who leave the call before answering no longer
need to; users who join after the request are told by their client that
the call is (or is about to be) recorded and that joining means
consenting, and their client joins with the consent already in its
membership. A `false` from anyone in the call means it can't be recorded:
the recorder answers with a `failed` status naming who declined and
clears the request. The client that asked should do the same as soon as
it sees the decline, without waiting for the recorder.

### Client behaviour

A client whose user is in the call reads the `org.matrix.rtc.recording`
state for its slot to know whether the call is being recorded. A
`recorder` means it is, started by the event's sender, until the event is
cleared. Clients must make this obvious for as long as it lasts: a
persistent indicator, a notice naming who is recording that stays until the
user has acknowledged it, and an audible alert when the recording starts and
stops, so that nobody is recorded without knowing. The indicator should
show whether the recorder has confirmed with a `started` status yet, since
until then nothing is being recorded, and a `failed` status should be shown
to the user who asked.

A client offering a record button invites the recorder into the room if it
isn't a member already, then sets the event; pressing it again clears it.
Which recorder to invite is a deployment matter (Element Call reads it from
its config). If the recorder answers `failed`, or doesn't answer within a
reasonable time (Element Call waits 30 seconds), the client that asked
should clear the event itself, since nothing is being recorded and the
recorder may not be there to clear it. Where the request requires consent,
that time only starts once everyone has consented, since the recorder
can't start before then.

For a request that requires consent, a client whose user is in the call
and hasn't answered asks them, in a way that can't be dismissed without
answering one way or the other, and shows the person who asked how many
people have yet to consent. Its join screen warns that the call is being
recorded and that joining means consenting to it, and sends the consent
once the user joins; a client that drops the user straight into the call
asks them there instead.

Element Call's standalone app encrypts calls with a key in the URL rather
than in the room; recording those needs the key handed to the recorder,
which Element Call does with a to-device message of its own, described in
[call_recording_shared_key.md](./call_recording_shared_key.md).

## Potential issues

Making the request a state event means the power to send state is the
floor for who can record, unless the room lowers the event's level
explicitly; a room that wants everyone to be able to record has to set it.
It also means a recorder that stops on its own needs that power to say so.

The status and result events reference a state event, which relations
aren't usually used with; clients that render references (reply previews,
say) may show nothing useful for the target. A reference rather than a
reply was chosen for that reason: replies carry fallbacks meant for
messages.

An earlier draft used a timeline event with an `m.text` fallback of
`!record start`, so that chat-driven bots kept working; that was dropped in
favour of state that every client can read reliably.

Consent is only as good as the clients: a client that answers `true`
without asking, or a recorder that ignores `requires_consent`, records
people who never agreed. The answers are in the room's history, though,
so at least it can be shown who was asked.

Nothing stops a participant recording the call with software outside
Matrix. This proposal only makes sanctioned recording visible; it doesn't
prevent the unsanctioned kind.

## Security considerations

Recording is gated on the power level to send the event, which the auth
rules enforce, and the recorder must be invited into the room, so a
recording needs both a room member who may send the event and a moderator's
earlier invitation (or the bot to be a member already). Recordings are uploaded as ordinary room media,
with whatever encryption the room has.
