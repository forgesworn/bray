# Dispatch task round-trip

Send a "think" task to another agent, then watch for their reply.

Requires `DISPATCH_IDENTITIES` to be set to a markdown file that includes both the recipient's name and their hex pubkey. See [docs/dispatch.md](../../docs/dispatch.md).

## 1. (Optional) Discover who can do the work

```json
{
  "method": "tools/call",
  "params": {
    "name": "dispatch-capability-discover",
    "arguments": { "capability": "code-review" }
  }
}
```

## 2. Send the task

```json
{
  "method": "tools/call",
  "params": {
    "name": "dispatch-send",
    "arguments": {
      "to": "alice",
      "type": "think",
      "prompt": "Review the failure modes of the retry loop in relay-pool.ts. Is there a case where a rejected event is treated as accepted?",
      "repos": ["bray"],
      "context_id": "review-2026-04"
    }
  }
}
```

Response:

```json
{
  "taskId": "d1e2...",
  "to": "9e1c...",
  "published": { "success": true }
}
```

## 3. Check for replies

```json
{
  "method": "tools/call",
  "params": {
    "name": "dispatch-check",
    "arguments": { "since": "session-start" }
  }
}
```

Response:

```json
{
  "tasks": [{
    "taskId": "d1e2...",
    "from": "9e1c...",
    "type": "reply",
    "status": "completed",
    "body": "Reviewed. The retry loop at line 142 treats a WebSocket close mid-publish as a transient rejection — see suggested fix.",
    "context_id": "review-2026-04"
  }]
}
```

## Notes

- `since: session-start` (default) returns tasks since the server started. Pass `since: 0` to backfill history.
- `context_id` groups a multi-turn exchange. Pass the same value on follow-ups.
- If the recipient declines, you'll see `type: "refuse"` with a reason string.
- For long-running build tasks, the recipient may emit `dispatch-status` updates before the final `dispatch-reply`.
