# Event streams (a simplified MSC4471)

[MSC4471](https://github.com/matrix-org/matrix-spec-proposals/pull/4471)
lets a room event have a live, non-durable companion stream: the sender
posts the event, streams changes to its body over to-device messages while
it is being produced, and finally edits the event with the finished content.
Only the first event and the final edit reach the room DAG.

This is the variant Element Call and matrixrtc-sip-bridge implement for live
captions. It keeps MSC4471's descriptor, update and completion shapes and
drops two things:

- **Subscriptions.** There are no per-stream `subscribe` or `cancel`
  messages. The publisher decides who receives updates. For captions that
  is the devices that subscribed to the call's captions as a whole (see
  `call_captions.md`) and still have a live MatrixRTC membership in it.
- **Custom encryption.** MSC4471 defines its own AES-GCM scheme keyed from
  the descriptor. Here, updates are encrypted with the publisher's ordinary
  Megolm session for the room, exactly as if they were room events. That gives
  the sender's device signature on every update, which the shared-key scheme
  cannot, and adds no new cryptography.

## Descriptor

A room event advertises a stream with an `m.stream` object in its content
(unstable name `org.matrix.msc4471.stream`):

```json
{
  "msgtype": "m.text",
  "body": "Alice: so what I",
  "org.matrix.msc4471.stream": {
    "device_id": "BRIDGEDEVICE",
    "expiry_ms": 60000
  }
}
```

- `device_id`: the publisher device. Updates must come from this device of
  the event's sender.
- `expiry_ms`: how long after `origin_server_ts` updates may arrive. After
  that, or after the final edit, the event is rendered as it stands.

The stream is identified by `(room_id, event_id)`.

## Updates

The publisher sends to-device events of type `m.stream.update` (unstable
`org.matrix.msc4471.stream.update`) to each recipient device:

```json
{
  "room_id": "!room:example.org",
  "event_id": "$event:example.org",
  "seq": 3,
  "op": "append",
  "content": { "body": " was saying" }
}
```

`op` is `replace` or `append`, applied to the transient `body`, which starts
as the descriptor event's `body`. `seq` increases by one per update per
recipient; a recipient ignores a `seq` it has already applied. There is no
resync: a recipient that misses an update keeps rendering what it has until
the final edit, which carries the whole text. Publishers should coalesce
text that arrives while a send is in flight into one later `append`.

Recipients ignore updates whose sender is not the descriptor event's sender,
or whose `event_id` they don't know as a stream.

## Completion

When the content is final the publisher edits the descriptor event with an
`m.replace` whose `m.new_content` has the finished `body` and no `m.stream`.
Recipients treat that edit as the end of the stream. Clients that don't know
about streams just see an edited message.

## Encryption

If the room is encrypted, each update is encrypted with the publisher's
Megolm session for that room, as a room event of type
`org.matrix.msc4471.stream.update` with the content above. The resulting
`m.room.encrypted` content is sent as a to-device event of type
`m.stream.encrypted` (unstable `org.matrix.msc4471.stream.encrypted`), with
the room ID added so the recipient knows which session to use:

```json
{
  "algorithm": "m.megolm.v1.aes-sha2",
  "room_id": "!room:example.org",
  "sender_key": "...",
  "session_id": "...",
  "device_id": "BRIDGEDEVICE",
  "ciphertext": "..."
}
```

The recipient decrypts it exactly as it would a room event in that room, and
then checks the plaintext `room_id` and `event_id` as for a plaintext update.
The session is the room's normal one: it is shared with every device in the
room through `m.room_key`, rotates after the usual number of messages or
age, and is backed up like any other. Stream updates therefore count towards
that rotation, so a busy stream shares new keys with the room more often than
messages alone would. That is the cost of not inventing anything.

Recipients that can't decrypt an update (a device that joined the room after
the session was shared, say) get nothing until the next rotation and the
final edit. In practice the publisher shares the current session with new
devices before its next message, so the gap is short.

## Live captions

matrixrtc-sip-bridge uses this for each caption segment. When a speaker's
first words arrive it posts the thread reply `Speaker: words` with the
descriptor, then appends the words that follow about twice a second, and
when the speaker pauses it edits the reply with the complete segment. Element
Call renders the transient body in the captions panel and replaces it with
the edit's content when that arrives. The recipient set is the devices that
subscribed to captions.

When no transcript is being kept there is no descriptor event and no edit:
the stream is all there is. Its updates name a `stream_id` rather than an
`event_id`, the last one carries `"done": true`, and each is Olm-encrypted to
every recipient device rather than Megolm-encrypted, so that nothing of it
depends on the room. See `call_captions.md`.
