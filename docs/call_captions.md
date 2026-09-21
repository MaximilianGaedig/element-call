# Live captions (transcription)

Captions are made by a bot that joins the call and listens, so turning them
on gives the bot the call's media keys: they are for whoever the room
trusts with that. Beyond that, captions are each user's own business.
Turning them on shows them to nobody else, and what is said reaches only
the devices that asked and is never written to the room, unless someone
asks for a transcript as well.

## Who may ask

`transcription_bot` in `config.json` names the bot (a matrixrtc-sip-bridge
with a Voxtral endpoint). The closed-caption button is shown to users with
the power to send `org.matrix.rtc.transcription` state, and the bot checks
the same power before it serves anyone. With no entry for the event type in
the room's power levels that is `state_default`: moderators.

Moderators choose between everyone, moderators and admins in the moderator
settings, which sets the event type's level in `m.room.power_levels`.
`transcription_for_everyone` in `config.json` makes "everyone" the default:
since the bot only knows the room's power levels, the first user to join a
call who can change them writes that default there (only if there is no
entry yet, so a moderator's choice stands).

## Subscribing

A device that wants captions invites the bot if need be, hands it the
call's key if the call is encrypted with a shared one (exactly as for
recording; see `call_recording_shared_key.md`), and sends it an
Olm-encrypted to-device message:

```
type: org.matrix.rtc.transcription.subscribe
content: { "room_id": "!room:example.org", "subscribe": true }
```

`"subscribe": false` unsubscribes. The bot takes the device from the Olm
session, checks that its user may ask and that the device is in the call,
joins the call if it isn't already there, and answers, Olm-encrypted:

```
type: org.matrix.rtc.transcription.status
content: { "room_id": "!room:example.org", "subscribed": true }
```

`"subscribed": false` comes with an `error` when the bot refused or
couldn't start, and turns the captions back off. The bot drops subscribers
whose call membership ends, and leaves the call when nobody is subscribed
and no transcript is being kept.

## Captions without a transcript

Each spoken segment is a stream with no event behind it: the simplified
MSC4471 updates of `event_streams.md`, named by a `stream_id` the bot makes
up instead of an `event_id`, and Olm-encrypted to each subscribed device.

```
type: org.matrix.msc4471.stream.update
content: {
  "room_id": "!room:example.org",
  "stream_id": "abc123",
  "seq": 1,
  "op": "replace",
  "content": {
    "body": "Alice: so what I",
    "org.matrix.rtc.transcription.speaker": "@alice:example.org"
  },
  "done": false
}
```

The first update of a segment is a `replace` with the content its event
would have had, the words that follow are `append`s of `{ "body" }`, and
the last is a `replace` with the finished text and `"done": true`. Nothing
is sent to the room, not even a notice that captions are on; the bot's
call membership is the only trace.

## Keeping a transcript

As captions are turned on, Element Call asks whether to keep a transcript
in the room too (and, as they are turned off with one running, whether to
stop it). That is asked for with state, since it concerns everyone:

```
type: org.matrix.rtc.transcription
state_key: <RTC slot>
content: { "transcriber": "@bot:example.org" }
```

Empty content (or no `transcriber`) stops the transcript. The bot posts an
`m.notice` naming the request event in an
`org.matrix.rtc.transcription.request` content field (a relation would stop
a thread being rooted on it), roots a thread on that notice, and rewrites
the slot's transcription state with the notice's event id:

```
content: { "transcriber": "@bot:example.org", "root": "$notice" }
```

State reaches everyone in the call, where the notice is history that
anyone joining later may not have synced, or in an encrypted room be able
to decrypt. Each spoken segment is then a thread reply, as `Speaker: words`,
naming the speaker's user id in an `org.matrix.rtc.transcription.speaker`
content field, streamed word by word to the subscribed devices and edited
with the finished text once the speaker pauses (see `event_streams.md`).
Subscribed devices follow the thread the state names, replaying the
timeline they already have for replies posted before they joined. Devices
that haven't turned captions on show nothing, though their users can read
the thread in the room.

If the bot can't keep a transcript or stops on its own (everyone else
left), it clears the state.

## Showing them

Either way Element Call renders the segments as a list of message tiles
above the call controls with `@element-hq/web-shared-components`, each shown
as the speaker's words (under their current name in the room) rather than
the bot's.

In widget mode Element Call asks for the capabilities this needs: sending
the subscription and receiving the status and stream updates to-device, and
receiving `m.room.message` for the transcript's thread.

Recordings never show captions: the recorder doesn't subscribe.
