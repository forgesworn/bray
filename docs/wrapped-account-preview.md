# Wrapped existing accounts (preview)

This branch needs the unpublished `nsec-tree@1.7.0-alpha.1` candidate in the
sibling nsec-tree checkout. Its lock entry uses that locally packed artifact's
integrity at the intended npm URL. Publish the exact artifact before clean
registry installs or merging this consumer branch. Repack and update the
integrity if the library changes. The complete cross-repository handover is
`nsec-tree/WRAPPED-PREVIEW-HANDOVER.md`; the format is `WRAPPED-NSEC.md` there.

Owner CLI operations work offline with a configured **local** master. Remote,
hardware and read-only contexts cannot export or restore this way. Both the
same master/root construction and the encrypted record are needed to recover
the exact original raw key. Master compromise plus access to a record also
exposes that account. Keep its separate backup during preview.

Use Bray's existing secret configuration for A. Place disposable B's nsec or
hex in a 0600 input file in a directory allowed by `BRAY_INPUT_DIRS`:

```text
nostr-bray key-wrap ./existing.key ./account.nstw
nostr-bray key-check ./account.nstw <B-npub>
```

Wrap creates a new 0600 encrypted file, authenticates a disk read-back against
B's npub and refuses to overwrite an existing backup. Neither command changes
the active identity. Paths follow Bray's input policy and files are bounded
to 1 KB. No secret appears in command arguments or output.

In interactive `nostr-bray shell`:

```text
key-load ./account.nstw <B-npub>
list
switch <B-npub>
```

Load is process-local, not persistent installation or permission. Selection
is explicit; forbidden npubs are refused before caching. Imported entries
report `origin: imported` and `recovery: master-and-record`, without a
derivation purpose. Both linkage-proof forms refuse imported identities.
Eviction and destruction wipe their mutable secret buffers.

The SDK provides `IdentityContext.wrapRawIdentity`, `checkWrappedIdentity`,
`importWrappedIdentity` and `wrapImportedIdentity`. File helpers are exported
from `nostr-bray/identity`. These are owner operations. No recovery MCP tool,
agent permission or hardware export fallback was added; 261 tool schemas
remain unchanged.

Validation includes exact-key signing after explicit selection, wrong
root/npub and forbidden-key refusal, read-back/no-overwrite behaviour,
provenance collision and zeroisation. The full local suite passed 1,945 tests
across 138 files, together with lint and build.
