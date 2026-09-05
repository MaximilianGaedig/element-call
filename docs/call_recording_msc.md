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
    "streams": "composite"
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
starts recording. It should acknowledge with an `m.notice` if it can't, for
example because the requested `media` or `streams` are not supported, so
that the user finds out.

When the event is cleared, or the call ends, it stops recording and posts
the result into the room: the file as an `m.video` or `m.audio` message, or
a link to it as `m.text`, so that the recording is where the call was.
Where the recorder stopped on its own (the call ended, or it failed), it
should clear the event itself so that clients don't go on warning about a
recording that is over; it therefore needs the power to send it.

A recorder should not record anything it can't tell the room about: if it
can't send the events, it shouldn't record.

### Client behaviour

A client whose user is in the call reads the `org.matrix.rtc.recording`
state for its slot to know whether the call is being recorded. A
`recorder` means it is, started by the event's sender, until the event is
cleared. Clients must make this obvious for as long as it lasts: a
persistent indicator, a notice naming who is recording that stays until the
user has acknowledged it, and an audible alert when the recording starts and
stops, so that nobody is recorded without knowing.

A client offering a record button invites the recorder into the room if it
isn't a member already, then sets the event; pressing it again clears it.
Which recorder to invite is a deployment matter (Element Call reads it from
its config).

## Potential issues

Making the request a state event means the power to send state is the
floor for who can record, unless the room lowers the event's level
explicitly; a room that wants everyone to be able to record has to set it.
It also means a recorder that stops on its own needs that power to say so.

An earlier draft used a timeline event with an `m.text` fallback of
`!record start`, so that chat-driven bots kept working; that was dropped in
favour of state that every client can read reliably.

Nothing stops a participant recording the call with software outside
Matrix. This proposal only makes sanctioned recording visible; it doesn't
prevent the unsanctioned kind.

## Security considerations

Recording is gated on the power level to send the event, which the auth
rules enforce, and the recorder must be invited into the room, so a
recording needs both a room member who may send the event and a moderator's
earlier invitation (or the bot to be a member already). Recordings are uploaded as ordinary room media,
with whatever encryption the room has.
