# MSC4075 addendum: device-targeted invites and ringing feedback

_Draft. Two small extensions to
[MSC4075](https://github.com/matrix-org/matrix-spec-proposals/pull/4075)
(`m.rtc.invite`, unstable `org.matrix.msc4075.rtc.notification`) that the
MatrixRTC SIP bridge and the Element Web SIP calling module rely on. Written
up here until they are proposed upstream._

## Problem

**Targeting.** `m.mentions` addresses users or the whole room, so an invite
rings every device of every mentioned user. Two cases need finer control:

- A user has delegated part of their calling to a bridge device (a SIP
  bridge standing in for their desk phone, a bot that answers when they are
  away). The caller wants to ring _only_ that device, or every device
  _except_ it, depending on whether they chose "call via SIP".
- A bridge account owns several devices bridging different endpoints and
  only one of them should ring.

**Feedback.** MSC4075 lists "lack of feedback" as an open issue: the caller
cannot tell whether the invite reached anything. A bridge knows more than a
client normally does (the far end returned `180 Ringing`, or `183` with early
media, or `486 Busy`) and the caller's UI should show "ringing" rather than
"calling" once the remote phone is actually alerting.

## Proposal

### `m.mentions.devices`

An optional `devices` map inside `m.mentions`, keyed by user ID, listing the
device IDs of that user which the invite is for:

```json5
{
  type: "m.rtc.invite",
  content: {
    slot_id: "m.call#ROOM",
    "m.mentions": {
      user_ids: ["@_sip_447968722968:example.org"],
      devices: {
        "@_sip_447968722968:example.org": ["SIPBRIDGE"],
      },
    },
    sender_ts: 1758500000000,
    lifetime: 90000,
    sticky_key: "m.call#ROOM",
  },
}
```

- `devices` (map of user ID to array of device ID, optional): when a user is
  listed here, only those of their devices ring. Devices of that user not in
  the list treat the invite as not mentioning them (no ring, no toast), but
  still show the call in the timeline and may join it.
- A user listed in `user_ids` (or covered by `room: true`) but absent from
  `devices` rings on every device, as today.
- A user present in `devices` but absent from `user_ids` is implicitly
  mentioned; senders SHOULD still list them in `user_ids` for push rules.
- Push rules cannot see device IDs, so a push may still reach an excluded
  device; the client suppresses the ring locally. This is the same
  best-effort situation as a mention that arrives at a client which has
  already joined the call.

### `m.rtc.invite_progress`

A message-like event, unstable type `org.matrix.msc4075.rtc.invite_progress`,
sent by a mentioned device to say what became of the invite on its side. It
relates to the invite with `m.reference` and, like `m.rtc.decline`, is a
sticky event whose `sticky_key` is the invite's event ID so a later state
replaces an earlier one:

```json5
{
  type: "org.matrix.msc4075.rtc.invite_progress",
  content: {
    "m.relates_to": {
      rel_type: "m.reference",
      event_id: "$invite_event_id",
    },
    sticky_key: "$invite_event_id",
    device_id: "SIPBRIDGE",
    state: "ringing",
    reason: "180 Ringing",
  },
}
```

- `device_id` (string, required): the sender's device that is reporting.
- `state` (string, required), one of:
  - `ringing`: the endpoint is alerting the user (SIP `180`/`183`, a phone is
    ringing, a client is showing the incoming-call toast).
  - `busy`: the endpoint cannot take the call right now (SIP `486`/`600`).
    Unlike `m.rtc.decline` it is not a deliberate rejection by the user.
  - `unreachable`: the endpoint could not be reached (SIP `404`/`408`/`480`/
    `503`, no registered device).
- `reason` (string, optional): free-text detail for diagnostics (the SIP
  status line, say). Clients MAY show it alongside the state so a failed
  call can be diagnosed from the timeline; they SHOULD NOT interpret it.

Pickup and rejection stay as they are in MSC4075: a device that answers
joins the slot; one that declines sends `m.rtc.decline`. A `busy` or
`unreachable` progress event from the only mentioned device SHOULD be shown
to the caller like a decline with a different label, and the caller's
client MAY auto-leave as it does on decline.

Clients that ring locally MAY send `state: "ringing"` themselves so a caller
can distinguish "delivered and ringing" from "not delivered". They SHOULD
send at most one progress event per invite per device.

## Security considerations

Only the invite's sender and the mentioned devices care about progress
events; other room members see nothing sensitive beyond what the invite
already reveals. `devices` exposes the caller's knowledge of the callee's
device list, which is already available to every room member through
`/keys/query`.
