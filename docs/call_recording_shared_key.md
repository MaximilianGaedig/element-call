# Recording calls encrypted with a shared key

Element Call's standalone app encrypts its calls with a key that lives in
the call's URL rather than in the room: the room has no `m.room.encryption`
state, and everyone who has the link derives the same LiveKit frame key
from the `password` in its fragment (see [url_params.md](./url_params.md)).
A recorder invited into such a room, following the
[call recording MSC](./call_recording_msc.md), can join the call but can't
decrypt anything, since the per-participant key exchange the MSC relies on
never happens.

This is Element Call's own solution, in its `io.element` namespace; it's
not proposed for the spec.

## The `io.element.call.shared_key` to-device message

Before it sets the `org.matrix.rtc.recording` state, a client asking a
recorder to record a shared-key call sends the key to every device of the
recorder in an Olm-encrypted to-device message:

```json
{
  "type": "io.element.call.shared_key",
  "content": {
    "room_id": "!abc:example.org",
    "key": "the password from the call's URL"
  }
}
```

- `room_id`: the room whose call the key belongs to.
- `key`: the shared key, exactly as it appears in the URL.

The message is sent encrypted, so the homeserver never sees the key, which
is the same guarantee the URL fragment gives. The client awaits sending it
before sending the recording request, so the recorder has the key by the
time it sees the request.

## Recorder behaviour

A recorder receiving the message keeps the key for the room, but only if
the message was encrypted; a plaintext one could be forged by anyone to
break recordings. When a recording request arrives for a room without
`m.room.encryption`, it waits a few seconds for a key from the request's
sender before starting, then records with the shared key if it has one, or
as an unencrypted call if it doesn't. Only the sender of the request may
supply the key, so nobody else can substitute a wrong one.

In `matrixrtc-sip-bridge`, this uses the same shared-key mode as its SPA
`!join` command: the recorder's own LiveKit client derives the frame key
from the password, and the Element Call it renders the call with is given
`password` and `perParticipantE2EE=false` on its URL.
