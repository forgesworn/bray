/** Per-command help with examples and detail */
export const COMMAND_HELP: Record<string, { usage: string; description: string; examples: string[]; notes?: string }> = {
  // Identity
  whoami: { usage: 'whoami', description: 'Show the active identity\'s npub.', examples: ['nostr-bray whoami'] },
  create: { usage: 'create', description: 'Generate a fresh Nostr identity with a BIP-39 mnemonic seed. Returns the master npub and mnemonic for backup.', examples: ['nostr-bray create'], notes: 'Store the mnemonic securely — it will not be shown again.' },
  list: { usage: 'list', description: 'List all known identities. Returns npub, purpose, and persona name. Never includes private keys.', examples: ['nostr-bray list'] },
  derive: { usage: 'derive <purpose> [index]', description: 'Derive a child identity by purpose string and optional index. Deterministic — same inputs always produce the same npub.', examples: ['nostr-bray derive messaging', 'nostr-bray derive signing 0', 'nostr-bray derive signing 1  # different index = different key'] },
  persona: { usage: 'persona <name> [index]', description: 'Derive a named persona (e.g. work, personal, anonymous). Shorthand for deriving with a semantic name.', examples: ['nostr-bray persona work', 'nostr-bray persona anonymous'] },
  switch: { usage: 'switch <target> [index]', description: 'Switch the active identity. All subsequent operations sign as the new identity. Use "master" to return to root.', examples: ['nostr-bray switch work', 'nostr-bray switch master', 'nostr-bray switch messaging 0'] },
  prove: { usage: 'prove [blind|full]', description: 'Create a cryptographic linkage proof between the master key and the active identity.\n  blind — proves the link without revealing the derivation path (default)\n  full  — reveals the purpose and index (use with care)', examples: ['nostr-bray prove', 'nostr-bray prove blind', 'nostr-bray prove full'] },
  'proof-publish': { usage: 'proof-publish [blind|full] [--confirm]', description: 'Publish a linkage proof to relays as a kind 30078 event. This is IRREVERSIBLE — once published, the link between identities is public.', examples: ['nostr-bray proof-publish blind', 'nostr-bray proof-publish full --confirm'], notes: 'Without --confirm, shows a preview of what will be revealed.' },
  backup: { usage: 'backup <dir> [threshold] [shares]', description: 'Split the active identity\'s private key into Shamir shards written to files. Default is 3-of-5 (any 3 shards reconstruct the key). Shard files use 0600 permissions.', examples: ['nostr-bray backup ./shards', 'nostr-bray backup ./shards 2 3  # 2-of-3 scheme'] },
  restore: { usage: 'restore <file1> <file2> ... -t <threshold>', description: 'Reconstruct a secret key from Shamir shard files.', examples: ['nostr-bray restore ./shards/shard-1.bray ./shards/shard-2.bray -t 2'] },
  'identity-backup': { usage: 'identity-backup <pubkey-hex>', description: 'Fetch profile (kind 0), contacts (kind 3), relay list (kind 10002), and attestations for a pubkey. Returns a portable JSON bundle — no private keys.', examples: ['nostr-bray identity-backup abc123...'] },
  'identity-restore': { usage: 'identity-restore <pubkey-hex>', description: 'Re-sign migratable events (profile, contacts, relay list) under the active identity. Skips attestations to protect the trust chain.', examples: ['nostr-bray identity-restore abc123...'] },
  migrate: { usage: 'migrate <old-hex> <old-npub> [--confirm]', description: 'Full identity migration. Preview first (shows profile fields, contact count), then execute with --confirm. Publishes a linkage proof and re-signs migratable events.', examples: ['nostr-bray migrate abc123... npub1old...', 'nostr-bray migrate abc123... npub1old... --confirm'] },

  // Social
  post: { usage: 'post "message"', description: 'Publish a text note (kind 1) as the active identity.', examples: ['nostr-bray post "gm nostr"', 'nostr-bray post "Hello from my work persona!"'] },
  reply: { usage: 'reply <event-id> <pubkey> "text"', description: 'Reply to a Nostr event with correct e-tag and p-tag threading.', examples: ['nostr-bray reply abc123... def456... "Great post!"'] },
  react: { usage: 'react <event-id> <pubkey> [emoji]', description: 'React to a Nostr event (kind 7). Defaults to "+" if no emoji specified.', examples: ['nostr-bray react abc123... def456...', 'nostr-bray react abc123... def456... 🤙'] },
  delete: { usage: 'delete <event-id> [reason]', description: 'Request deletion of an event you published (kind 5). Relays may or may not honour the request.', examples: ['nostr-bray delete abc123...', 'nostr-bray delete abc123... "posted by mistake"'] },
  repost: { usage: 'repost <event-id> <pubkey>', description: 'Repost/boost a Nostr event (kind 6).', examples: ['nostr-bray repost abc123... def456...'] },
  profile: { usage: 'profile <pubkey-hex>', description: 'Fetch and display a Nostr profile (kind 0) for any pubkey.', examples: ['nostr-bray profile abc123...'] },
  'profile-set': { usage: 'profile-set \'{"name":"...","about":"..."}\'', description: 'Set the kind 0 profile for the active identity. If a profile already exists, shows a diff and requires --confirm to overwrite.', examples: ['nostr-bray profile-set \'{"name":"Bray User","about":"Powered by nostr-bray"}\'', 'nostr-bray profile-set \'{"name":"Updated"}\' --confirm'] },
  contacts: { usage: 'contacts <pubkey-hex>', description: 'List who a pubkey follows (kind 3 contact list). Shows pubkeys, relay hints, and petnames.', examples: ['nostr-bray contacts abc123...'] },
  follow: { usage: 'follow <pubkey-hex> [relay] [petname]', description: 'Follow a pubkey. Fetches current contact list, adds the pubkey, publishes updated kind 3.', examples: ['nostr-bray follow abc123...', 'nostr-bray follow abc123... wss://relay.example.com alice'] },
  unfollow: { usage: 'unfollow <pubkey-hex>', description: 'Unfollow a pubkey. Removes from contact list and publishes updated kind 3.', examples: ['nostr-bray unfollow abc123...'] },
  dm: { usage: 'dm <pubkey-hex> "message" [--nip04]', description: 'Send an encrypted direct message. Uses NIP-17 gift wrap by default (most private — sender identity hidden behind ephemeral key). Add --nip04 for legacy NIP-04 (requires NIP04_ENABLED=1).', examples: ['nostr-bray dm abc123... "Secret message"', 'nostr-bray dm abc123... "Legacy DM" --nip04'] },
  'dm-read': { usage: 'dm-read', description: 'Read direct messages addressed to the active identity. Decrypts both NIP-17 and NIP-04 messages. Returns error metadata (not crash) on decryption failure.', examples: ['nostr-bray dm-read'] },
  feed: { usage: 'feed [--limit N]', description: 'Fetch the kind 1 text note feed from your relays.', examples: ['nostr-bray feed', 'nostr-bray feed --limit 10'] },
  notifications: { usage: 'notifications [--limit N]', description: 'Fetch mentions, replies, reactions, and zap receipts for the active identity.', examples: ['nostr-bray notifications', 'nostr-bray notifications --limit 5'] },
  'nip-publish': { usage: 'nip-publish <identifier> <title> <content-or-file> [--kinds N,N]', description: 'Publish a community NIP (kind 30817) — a custom protocol specification on Nostr. Content can be inline markdown or a file path.', examples: ['nostr-bray nip-publish my-protocol "My Protocol" ./spec.md', 'nostr-bray nip-publish gaming "Gaming Events" ./gaming.md --kinds 30100,30101'] },
  'nip-read': { usage: 'nip-read [--author X] [--kind N] [--identifier X]', description: 'Fetch community NIPs (kind 30817) from relays.', examples: ['nostr-bray nip-read', 'nostr-bray nip-read --author abc123...', 'nostr-bray nip-read --kind 30100'] },

  // Blossom
  'blossom-upload': { usage: 'blossom-upload <server> <file>', description: 'Upload a file to a blossom media server. Signs a kind 24242 auth event. Returns the blob URL and SHA-256 hash.', examples: ['nostr-bray blossom-upload https://blossom.example.com ./photo.jpg'] },
  'blossom-list': { usage: 'blossom-list <server> <pubkey-hex>', description: 'List blobs uploaded by a pubkey on a blossom server.', examples: ['nostr-bray blossom-list https://blossom.example.com abc123...'] },
  'blossom-delete': { usage: 'blossom-delete <server> <sha256>', description: 'Delete a blob from a blossom media server by its SHA-256 hash.', examples: ['nostr-bray blossom-delete https://blossom.example.com deadbeef...'] },

  // Groups
  'group-info': { usage: 'group-info <group-id>', description: 'Fetch NIP-29 group metadata (name, about, picture, open status).', examples: ['nostr-bray group-info my-group'] },
  'group-chat': { usage: 'group-chat <group-id> [--limit N]', description: 'Fetch recent chat messages (kind 9) from a NIP-29 group.', examples: ['nostr-bray group-chat my-group', 'nostr-bray group-chat my-group --limit 50'] },
  'group-send': { usage: 'group-send <group-id> "message"', description: 'Send a message to a NIP-29 group (kind 9 with h-tag).', examples: ['nostr-bray group-send my-group "Hello group!"'] },
  'group-members': { usage: 'group-members <group-id>', description: 'List members of a NIP-29 group.', examples: ['nostr-bray group-members my-group'] },

  // Trust
  attest: { usage: 'attest <type> <identifier> [subject]', description: 'Create and publish a kind 31000 verifiable attestation (NIP-VA).', examples: ['nostr-bray attest identity-verification abc123... def456...', 'nostr-bray attest endorsement org-member'] },
  'trust-read': { usage: 'trust-read [--subject X] [--type X] [--attestor X]', description: 'Read kind 31000 attestations from relays. All filters are optional.', examples: ['nostr-bray trust-read --subject abc123...', 'nostr-bray trust-read --type identity-verification'] },
  'trust-verify': { usage: 'trust-verify <event-json>', description: 'Validate the structural correctness of a kind 31000 attestation event.', examples: ['nostr-bray trust-verify \'{"kind":31000,...}\''] },
  'trust-revoke': { usage: 'trust-revoke <type> <identifier>', description: 'Revoke a previously issued attestation. Active identity must match the original attestor.', examples: ['nostr-bray trust-revoke identity-verification abc123...'] },
  'trust-request': { usage: 'trust-request <pubkey> <subject> <type>', description: 'Send an attestation request via NIP-17 encrypted DM.', examples: ['nostr-bray trust-request abc123... def456... identity-verification'] },
  'trust-request-list': { usage: 'trust-request-list', description: 'Scan received NIP-17 DMs for attestation request payloads.', examples: ['nostr-bray trust-request-list'] },
  'ring-prove': { usage: 'ring-prove <type> <pk1,pk2,...>', description: 'Create a ring signature proving anonymous group membership. Your active identity must be one of the pubkeys in the comma-separated ring.', examples: ['nostr-bray ring-prove kyc-verified abc123,def456,ghi789'] },
  'ring-verify': { usage: 'ring-verify <event-json>', description: 'Verify a ring signature proof.', examples: ['nostr-bray ring-verify \'{"kind":30078,...}\''] },
  'spoken-challenge': { usage: 'spoken-challenge <secret> <context> <counter>', description: 'Generate a spoken verification token for in-person identity confirmation. Both parties share a secret and verify via spoken words.', examples: ['nostr-bray spoken-challenge aabbccdd... meeting-2026-03-25 1'] },
  'spoken-verify': { usage: 'spoken-verify <secret> <context> <counter> <input>', description: 'Verify a spoken token response.', examples: ['nostr-bray spoken-verify aabbccdd... meeting-2026-03-25 1 castle'] },

  // Relay
  'relay-list': { usage: 'relay-list [--compare npub]', description: 'List the relay set (read/write) for the active identity. Optionally warn about shared relays with another identity.', examples: ['nostr-bray relay-list', 'nostr-bray relay-list --compare npub1other...'] },
  'relay-set': { usage: 'relay-set <url1> <url2> ... [--confirm]', description: 'Publish a kind 10002 relay list. Warns if one already exists — use --confirm to overwrite.', examples: ['nostr-bray relay-set wss://relay.damus.io wss://nos.lol', 'nostr-bray relay-set wss://relay.damus.io --confirm'] },
  'relay-add': { usage: 'relay-add <url> [read|write]', description: 'Add a relay to the active identity\'s relay set (in-memory only — does not publish kind 10002).', examples: ['nostr-bray relay-add wss://new-relay.com', 'nostr-bray relay-add wss://read-only.com read'] },
  'relay-info': { usage: 'relay-info <wss://url>', description: 'Fetch the NIP-11 relay information document (name, description, supported NIPs, limits).', examples: ['nostr-bray relay-info wss://relay.damus.io'] },

  // Zap
  'zap-send': { usage: 'zap-send <bolt11>', description: 'Pay a Lightning invoice via Nostr Wallet Connect (NIP-47). Requires NWC_URI configured.', examples: ['nostr-bray zap-send lnbc10u1...'] },
  'zap-balance': { usage: 'zap-balance', description: 'Request wallet balance via NWC.', examples: ['nostr-bray zap-balance'] },
  'zap-invoice': { usage: 'zap-invoice <msats> [description]', description: 'Generate a Lightning invoice via NWC to receive payments.', examples: ['nostr-bray zap-invoice 100000 "Coffee payment"'] },
  'zap-lookup': { usage: 'zap-lookup <payment-hash>', description: 'Look up a Lightning invoice payment status via NWC.', examples: ['nostr-bray zap-lookup abc123...'] },
  'zap-transactions': { usage: 'zap-transactions [--limit N]', description: 'List recent Lightning transactions via NWC.', examples: ['nostr-bray zap-transactions', 'nostr-bray zap-transactions --limit 5'] },
  'zap-receipts': { usage: 'zap-receipts [--limit N]', description: 'Fetch zap receipts (kind 9735) for the active identity. Returns sender, amount in msats, and message.', examples: ['nostr-bray zap-receipts', 'nostr-bray zap-receipts --limit 10'] },
  'zap-decode': { usage: 'zap-decode <bolt11>', description: 'Decode basic fields from a bolt11 Lightning invoice string.', examples: ['nostr-bray zap-decode lnbc10u1...'] },

  // Safety
  'safety-configure': { usage: 'safety-configure [persona-name]', description: 'Configure an alternative identity persona for emergency use. Defaults to "anonymous".', examples: ['nostr-bray safety-configure', 'nostr-bray safety-configure emergency'] },
  'safety-activate': { usage: 'safety-activate [persona-name]', description: 'Switch to an alternative identity. Response is structurally identical to identity switch — an observer cannot distinguish this from a normal switch.', examples: ['nostr-bray safety-activate', 'nostr-bray safety-activate emergency'] },

  // Utility
  decode: { usage: 'decode <nip19>', description: 'Decode any nip19 entity (npub, nsec, note, nevent, nprofile, naddr) or nostr: URI to its components. For nsec, returns the derived pubkey — never the private key.', examples: ['nostr-bray decode npub1abc...', 'nostr-bray decode nevent1...', 'nostr-bray decode nostr:npub1abc...'] },
  'encode-npub': { usage: 'encode-npub <hex>', description: 'Encode a 64-character hex public key as a bech32 npub.', examples: ['nostr-bray encode-npub abc123...'] },
  'encode-note': { usage: 'encode-note <hex>', description: 'Encode a 64-character hex event ID as a bech32 note.', examples: ['nostr-bray encode-note abc123...'] },
  'encode-nprofile': { usage: 'encode-nprofile <hex> [relay1,relay2,...]', description: 'Encode a hex pubkey with optional relay hints as a bech32 nprofile.', examples: ['nostr-bray encode-nprofile abc123...', 'nostr-bray encode-nprofile abc123... wss://relay.example.com'] },
  'encode-nevent': { usage: 'encode-nevent <hex> [relay1,relay2,...]', description: 'Encode a hex event ID with optional relay hints as a bech32 nevent.', examples: ['nostr-bray encode-nevent abc123... wss://relay.example.com'] },
  'encode-nsec': { usage: 'encode-nsec <hex>', description: 'Encode a 64-character hex private key as a bech32 nsec.', examples: ['nostr-bray encode-nsec abc123...'], notes: 'WARNING: private key is passed as a CLI argument. Use only on trusted systems.' },
  'key-public': { usage: 'key-public <nsec-or-hex>', description: 'Derive a public key (hex + npub) from a secret key.', examples: ['nostr-bray key-public nsec1...', 'nostr-bray key-public abc123...'], notes: 'WARNING: secret key is passed as a CLI argument. Use only on trusted systems.' },
  filter: { usage: 'filter <event-json> <filter-json>', description: 'Test if a Nostr event matches a given filter. Returns true or false.', examples: ['nostr-bray filter \'{"kind":1,...}\' \'{"kinds":[1]}\''] },
  nips: { usage: 'nips', description: 'List all official Nostr NIPs from the protocol repository.', examples: ['nostr-bray nips'] },
  nip: { usage: 'nip <number>', description: 'Fetch and display the full content of an official NIP by number.', examples: ['nostr-bray nip 1', 'nostr-bray nip 17', 'nostr-bray nip 65'] },
  verify: { usage: 'verify <event-json>', description: 'Verify a Nostr event\'s id hash and cryptographic signature.', examples: ['nostr-bray verify \'{"id":"...","pubkey":"...","sig":"...",...}\''] },
  encrypt: { usage: 'encrypt <pubkey-hex> "plaintext"', description: 'Encrypt a string using NIP-44 for a recipient pubkey. Uses the active identity\'s private key.', examples: ['nostr-bray encrypt abc123... "secret message"'] },
  decrypt: { usage: 'decrypt <pubkey-hex> <ciphertext>', description: 'Decrypt a NIP-44 ciphertext using the active identity\'s private key.', examples: ['nostr-bray decrypt abc123... AQBh7...'] },
  count: { usage: 'count [--kinds N,N] [--authors X,X] [--since N]', description: 'Count events matching a filter on relays.', examples: ['nostr-bray count --kinds 1', 'nostr-bray count --kinds 1,7 --authors abc123...'] },
  fetch: { usage: 'fetch <nip19>', description: 'Fetch events by nip19 code (note, nevent, nprofile, npub, naddr). Resolves the entity and queries relays.', examples: ['nostr-bray fetch note1...', 'nostr-bray fetch nevent1...', 'nostr-bray fetch npub1...'] },
  shell: { usage: 'shell', description: 'Start an interactive REPL with a persistent relay connection. Supports tab autocomplete. Type "help" for commands, "exit" to quit.', examples: ['nostr-bray shell'] },
  serve: { usage: 'serve [--port N] [--hostname H] [--events file.jsonl] [--quiet]', description: 'Start an in-memory Nostr relay for testing. Implements NIP-01 (events, subscriptions, EOSE) and NIP-11 (relay info). Events live in memory only — no persistence. Optionally pre-load events from a JSONL file.', examples: ['nostr-bray serve', 'nostr-bray serve --port 7777', 'nostr-bray serve --events test-data.jsonl', 'nostr-bray serve --port 7777 --quiet'] },
}

/** Get formatted help for a single command */
export function getCommandHelp(cmd: string): string | null {
  const h = COMMAND_HELP[cmd]
  if (!h) return null

  let out = `\nUsage: nostr-bray ${h.usage}\n\n${h.description}\n`
  if (h.notes) out += `\n  ${h.notes}\n`
  out += '\nExamples:\n'
  for (const ex of h.examples) {
    out += `  ${ex}\n`
  }
  out += '\nLearn more: https://github.com/forgesworn/bray/blob/main/docs/guide.md'
  return out
}
