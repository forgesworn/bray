# Relay-scoped NIP-29 groups

NIP-29 groups are scoped to one host relay. The same group ID may represent a
different fork on another relay, so every Bray group read and write requires an
explicit relay URL. Group events are queried with `queryDirect` and mutations
are published with `publishDirect`; the active identity's generic relay list is
never substituted.

Relay-generated state (`39000` metadata, `39001` admins, `39002` members and
`39003` roles) is accepted only when its signature matches the relay's NIP-11
`self` pubkey. Member lists may be absent, access-controlled or partial, and
Bray reports that caveat rather than treating them as authoritative history.

## Current moderation mappings

```text
9000  put-user
9001  remove-user
9002  edit-metadata
9005  delete-event
9007  create-group
9008  delete-group
9009  create-invite
9021  join request
9022  leave request
```

Older Bray releases incorrectly used kind `9004` for group creation and kind
`9007` for a client-defined role mutation. The latter was particularly unsafe:
kind `9007` means `create-group`. `group-set-roles` has therefore been removed.
Roles are relay policy; use `group-roles`, `group-admins` or `group-inspect` to
read the relay-generated state.

## CLI examples

```bash
nostr-bray group-inspect wss://groups.example my-group
nostr-bray group-create wss://groups.example my-group --name "My group" --closed
nostr-bray group-invite-create wss://groups.example my-group
nostr-bray group-join wss://groups.example my-group --code INVITE
nostr-bray group-add-user wss://groups.example my-group <pubkey> --role moderator
```

Deleting an event requires `--confirm`. Deleting a group requires repeating the
exact group ID, which makes accidental or prompt-injected deletion harder:

```bash
nostr-bray group-delete-event wss://groups.example my-group <event-id> --confirm
nostr-bray group-delete wss://groups.example my-group --confirm my-group
```

## Forums

Forum topics are kind `11` events with the group's `h` tag. Comments use NIP-22
kind `1111`, including uppercase root references (`E`, `K`, `P`) and lowercase
parent references (`e`, `k`, `p`) plus the group `h` tag.

```bash
nostr-bray group-forum-topics wss://groups.example my-group
nostr-bray group-forum-topic-create wss://groups.example my-group "Title" "Opening post"
nostr-bray group-forum-comment wss://groups.example my-group <topic-id> "Reply"
nostr-bray group-forum-comment wss://groups.example my-group <topic-id> "Nested reply" --parent <comment-id>
```

The same operations are catalogued MCP tools and SDK methods. LiveKit support is
deliberately outside this slice; Bray now covers text chat, forum threads,
invitations, membership, inspection and administrative deletion without taking
on an audio/video application dependency.
