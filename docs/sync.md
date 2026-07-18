# NIP-77 reconciliation

Bray separates reconciliation from transfer:

1. `sync plan` compares event IDs without changing either side.
2. `sync pull` fetches the reported remote-only IDs using ordinary `REQ`.
3. `sync push` publishes the reported local-only events using ordinary `EVENT`.

That distinction is important: NIP-77 Negentropy reconciles IDs; it does not
move the corresponding events.

## CLI

The local store is newline-delimited JSON, one complete signed event per line.
Use `-` to read it from stdin.

```bash
nostr-bray sync plan wss://relay.example --events archive.jsonl --kinds 1,30023
nostr-bray sync pull wss://relay.example --events archive.jsonl --jsonl
nostr-bray sync push wss://relay.example --events archive.jsonl --jsonl
cat archive.jsonl | nostr-bray sync plan wss://relay.example --events -
```

JSONL pull output begins with a `sync-plan` record followed by `event` records.
Push output contains the plan, one `publish` record per attempted event, and a
final `summary`. This preserves the selected protocol and completeness state in
streaming output.

Useful bounds:

```text
--max-ids N       IDs retained on each side (default 1000, maximum 10000)
--max-remote N    REQ fallback scan bound (default 10000, maximum 50000)
--timeout ms      Network phase deadline (default 10000, maximum 120000)
--protocol MODE   auto, nip77, or req-fallback
```

`auto` tries NIP-77 first. When a relay does not support it, Bray uses a bounded
REQ comparison and returns `protocol: "req-fallback"`. If the REQ scan reaches
its bound, `complete` is false. If ID arrays are shorter than their reported
counts, `truncated` is true. Pull and push never claim a complete transfer in
either case.

Input events must have a valid ID and signature and must pass Bray's semantic
event validator before they participate in a plan or push.

## MCP and SDK

`sync-plan` is a read-only catalogued MCP action. It accepts an in-memory bounded
event array and never transfers events. Mutation is available only through the
explicit CLI commands or SDK methods:

```ts
const plan = await bray.syncPlan(relay, localEvents, { kinds: [1] })
const pulled = await bray.syncPull(relay, localEvents, { signal })
const pushed = await bray.syncPush(relay, localEvents, { signal })
```

All explicit relay operations pass through `RelayPool`, including URL, private
network, plaintext WebSocket, and Tor-only policy checks. SDK callers can cancel
with an `AbortSignal`; the CLI maps Ctrl-C to cancellation.
