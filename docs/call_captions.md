# Live captions (transcription)

Closed captions work like recording (see `call_recording_msc.md`): a state
event asks a bot to do the work, and the bot's answers come back as room
events that everyone in the call can see.

## Asking

`transcription_bot` in `config.json` names the bot (a matrixrtc-sip-bridge
with a Voxtral endpoint). Users who may send the state event get a
closed-caption button, which invites the bot and sets

```
type: org.matrix.rtc.transcription
state_key: <RTC slot>
content: { "transcriber": "@bot:example.org" }
```

Empty content (or no `transcriber`) turns captions off. Who may ask is
governed by the power level for the event type, as for recording. A call
encrypted with a shared key needs the key handed to the bot first, exactly
as for recording (see `call_recording_shared_key.md`).

## Answering

The bot posts an `m.notice` naming the request event in an
`org.matrix.rtc.transcription.request` content field (a relation would stop
a thread being rooted on it), and roots a thread on that notice. Each
spoken segment is a thread reply, as `Speaker: words`. Element Call watches
the bot's messages: the notice tells it which thread to follow, and the
replies are the captions, rendered as a fragment of timeline above the call controls with
`@element-hq/web-shared-components`.

While a segment is being spoken the bot streams its words to the devices
in the call over to-device messages and edits the reply with the finished
text once the speaker pauses, so captions appear word by word rather than
sentence by sentence. The mechanism is a simplified MSC4471, described in
`event_streams.md`.

If the bot can't start (no Voxtral, no call) or stops on its own (everyone
else left), it clears the state, so the button turns back off.

In widget mode Element Call requests the state event capabilities only, not
`m.room.message`, so the panel stays empty there; the host client shows the
thread in the room's timeline instead.
