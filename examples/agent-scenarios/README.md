# Agent scenarios

End-to-end MCP `tools/call` transcripts for common agent workflows. Each file shows the wire-format JSON-RPC calls an MCP client would issue against nostr-bray, with example responses.

| Scenario | What it shows |
|----------|---------------|
| [onboard-and-post.md](onboard-and-post.md) | First-run identity setup + post a note |
| [dm-with-nip05-lookup.md](dm-with-nip05-lookup.md) | DM a recipient identified by NIP-05 |
| [zap-with-confirm.md](zap-with-confirm.md) | Preview a Lightning invoice, then pay |
| [trust-check-then-reply.md](trust-check-then-reply.md) | Check sender trust before replying |
| [dispatch-task-roundtrip.md](dispatch-task-roundtrip.md) | Send a task to another agent, watch reply |

Responses are truncated for readability — real responses include more fields. See `site/tools-manifest.json` for full input/output schemas.
