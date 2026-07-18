# Semantic event validation

Bray validates arbitrary event templates before it signs them. This is separate
from cryptographic verification: `verify-event` proves that a signed event has a
valid ID and signature, while `validate-event` checks whether its shape follows
the protocol registered for its kind.

The validator uses a bundled, generated snapshot of the Nostr Registry of Kinds.
The source commit and SHA-256 digest are included in every result. Normal builds
and runtime validation never fetch mutable schemas from the network.

## CLI

Validate an event without signing or publishing it:

```bash
nostr-bray validate-event '{"kind":30023,"content":"# Hello","tags":[["d","hello"],["title","Hello"]]}'
nostr-bray validate-event --file event.json
cat event.json | nostr-bray validate-event --stdin
```

Arbitrary publishing validates in `strict-known` mode by default:

```bash
nostr-bray event 30023 '# Hello' --tag d:hello --tag title:Hello
nostr-bray publish-raw --file event.json
```

Known kinds with malformed content or tags are rejected before signing. Unknown
or experimental kinds are allowed, with a warning. Use `--validation off` only
when intentionally bypassing protocol semantics; Bray still applies basic event
shape and safety limits, and pre-signed events still require a valid signature.

## MCP and SDK

`validate-event` is a read-only catalogued action. `publish-event` and
`post-schedule` use the same validator. Rejections are returned as structured
JSON with `error: "event_semantic_validation_failed"` and the complete
`validation.issues` array, including paths and suggested fixes.

The SDK exposes `client.validateEvent(input, mode?)`. Publishing methods accept
`validationMode: "strict-known" | "off"`, and thrown
`EventSemanticValidationError` instances retain the structured validation result.

## Updating the pinned snapshot

An update is an explicit source change and should be reviewed like code:

```bash
npm run update:kind-registry
npm run lint
npm test
```

The update script fetches one commit-pinned Registry URL, verifies the generated
digest, and rewrites `src/event-validation/registry.generated.ts`. Change the
pinned commit in the script deliberately; do not fetch the Registry at runtime.
