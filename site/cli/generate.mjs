#!/usr/bin/env node
// Generator for site/cli/index.html (the command atlas).
// Run: node site/cli/generate.mjs — keep the data here in step with the
// HELP text in src/cli/index.ts; the audit in the colophon holds it honest.
// Emits pure static HTML so the shipped page needs no framework;
// edit the data here and re-run, or edit the HTML directly afterwards.

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'index.html')

const FIATJAF_HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const FIATJAF_NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'

// Each row: { ask, cli } for a speakable pair, or { tf, cli } where the
// honest advice is to stay in the terminal (tf = the reason, shown in
// place of the ask).
const groups = [
  {
    id: 'identity', no: '01', title: 'IDENTITY',
    intro: 'Who you are: create it, split it into personas, prove the links between them, and back the whole tree up.',
    rows: [
      { ask: 'Who am I on Nostr right now?', cli: 'npx nostr-bray whoami' },
      { tf: 'Keep this one in the terminal. The 24 recovery words print to your screen and never enter an AI conversation.', cli: 'npx nostr-bray create' },
      { ask: 'List all my identities', cli: 'npx nostr-bray list' },
      { ask: 'Derive a child identity for tipping', cli: 'npx nostr-bray derive tipping' },
      { ask: 'Derive a persona called work', cli: 'npx nostr-bray persona work' },
      { ask: 'Switch to my work persona', cli: 'npx nostr-bray switch work' },
      { ask: 'Create a blind proof linking two of my identities', cli: 'npx nostr-bray prove blind' },
      { ask: 'Publish my linkage proof. I understand it cannot be taken back', cli: 'npx nostr-bray proof publish blind' },
      { ask: 'Back up my identity with Shamir secret sharing, 2-of-3', cli: 'npx nostr-bray backup ./shards 2 3' },
      { ask: 'Restore my identity from these two shard files', cli: 'npx nostr-bray restore shard-1.bray shard-2.bray -t 2' },
      { ask: 'Fetch my profile, contacts and relays as a portable bundle', cli: 'npx nostr-bray identity-backup <pubkey-hex>' },
      { ask: 'Re-sign that bundle of events under my new identity', cli: 'npx nostr-bray identity-restore <pubkey-hex>' },
      { ask: 'Preview migrating my old identity to this one', cli: 'npx nostr-bray migrate <old-hex> <old-npub>' },
    ],
  },
  {
    id: 'social', no: '02', title: 'SOCIAL',
    intro: 'The everyday rhythm: posting, replying, messaging, feeds, files and groups.',
    rows: [
      { ask: 'Post: hello from bray', cli: 'npx nostr-bray post "hello from bray"' },
      { ask: 'Reply to that note saying thanks', cli: 'npx nostr-bray reply <event-id> <pubkey-hex> "thanks"' },
      { ask: 'React to that note with a heart', cli: 'npx nostr-bray react <event-id> <pubkey-hex>' },
      { ask: 'Ask relays to delete the note I posted in error', cli: 'npx nostr-bray delete <event-id> "posted in error"' },
      { ask: 'Repost that note to my followers', cli: 'npx nostr-bray repost <event-id> <pubkey-hex>' },
      { ask: 'Show me fiatjaf’s profile', cli: `npx nostr-bray profile ${FIATJAF_HEX}` },
      { ask: 'Set my display name to Ada', cli: 'npx nostr-bray profile set \'{"name":"Ada"}\' --confirm' },
      { ask: 'Who does fiatjaf follow?', cli: `npx nostr-bray contacts ${FIATJAF_HEX}` },
      { ask: 'Follow fiatjaf', cli: `npx nostr-bray follow ${FIATJAF_HEX}` },
      { ask: 'Unfollow fiatjaf', cli: `npx nostr-bray unfollow ${FIATJAF_HEX}` },
      { ask: 'Send fiatjaf an encrypted message saying hello', cli: `npx nostr-bray dm ${FIATJAF_HEX} "hello"` },
      { ask: 'Read my encrypted messages', cli: 'npx nostr-bray dm read' },
      { ask: 'Show me the latest ten notes from people I follow', cli: 'npx nostr-bray feed --limit 10' },
      { ask: 'Any mentions, replies or zaps for me?', cli: 'npx nostr-bray notifications' },
      { ask: 'Publish my community NIP draft', cli: 'npx nostr-bray nip publish my-nip "My NIP title" ./nip.md' },
      { ask: 'Fetch recent community NIPs', cli: 'npx nostr-bray nip read' },
      { ask: 'Upload this photo to my Blossom server', cli: 'npx nostr-bray blossom-upload https://blossom.azzamo.net ./photo.jpg' },
      { ask: 'List my files on the Blossom server', cli: `npx nostr-bray blossom-list https://blossom.azzamo.net ${FIATJAF_HEX}` },
      { ask: 'Delete that file from the Blossom server', cli: 'npx nostr-bray blossom-delete https://blossom.azzamo.net <sha256>' },
      { ask: 'What is this group about?', cli: 'npx nostr-bray group-info <group-id>' },
      { ask: 'Show me the last twenty group messages', cli: 'npx nostr-bray group-chat <group-id> --limit 20' },
      { ask: 'Tell the group I will be late', cli: 'npx nostr-bray group-send <group-id> "running late"' },
      { ask: 'Who is in this group?', cli: 'npx nostr-bray group-members <group-id>' },
      { ask: 'Open a closed group called Ships Log', cli: 'npx nostr-bray group-create --name "Ships Log" --closed' },
      { ask: 'Rename the group and open it up', cli: 'npx nostr-bray group-update <group-id> --name "Open Log" --open' },
      { ask: 'Make them an admin of the group', cli: 'npx nostr-bray group-add-user <group-id> <pubkey-hex> --role admin' },
      { ask: 'Remove them from the group', cli: 'npx nostr-bray group-remove-user <group-id> <pubkey-hex>' },
      { ask: 'Define a moderator role for the group', cli: 'npx nostr-bray group-set-roles <group-id> --role moderator' },
    ],
  },
  {
    id: 'trust', no: '03', title: 'TRUST',
    intro: 'Bray’s centre of gravity: attest to what you have verified, vouch for who you know, and prove things without oversharing.',
    rows: [
      { ask: 'I have verified what this event claims. Attest to it', cli: 'npx nostr-bray attest <event-id>' },
      { ask: 'Vouch for someone I trust', cli: 'npx nostr-bray claim vouch' },
      { ask: 'What attestations exist about this person?', cli: 'npx nostr-bray trust read --subject <npub>' },
      { ask: 'Is this attestation well-formed?', cli: 'npx nostr-bray trust verify <event-json>' },
      { ask: 'Revoke the vouch I gave earlier', cli: 'npx nostr-bray trust revoke vouch <identifier>' },
      { ask: 'Ask fiatjaf to vouch for my work on this', cli: `npx nostr-bray trust-request ${FIATJAF_HEX} <subject> vouch` },
      { ask: 'Any attestation requests waiting in my messages?', cli: 'npx nostr-bray trust-request-list' },
      { ask: 'Score this event by how my web of trust sees its author', cli: 'npx nostr-bray trust-rank event.json' },
      { ask: 'Prove one of us signed this without revealing who', cli: 'npx nostr-bray ring prove membership <pk1,pk2,pk3>' },
      { ask: 'Check this ring signature', cli: 'npx nostr-bray ring verify <event-json>' },
      { ask: 'Give me a short phrase to say aloud when we meet', cli: 'npx nostr-bray spoken-challenge 8f2a1c4be97d3056a8e2f01b6c5d493a7e8b90c1d2f3a4b5c6d7e8f901234567 meetup 1' },
      { ask: 'They said the phrase back. Does it check out?', cli: 'npx nostr-bray spoken-verify <secret-hex> meetup 1 "<their-words>"' },
    ],
  },
  {
    id: 'relay', no: '04', title: 'RELAY',
    intro: 'Where your events live, and how to interrogate the servers that hold them.',
    rows: [
      { ask: 'Which relays am I on?', cli: 'npx nostr-bray relay-list' },
      { ask: 'Replace my relay list with these two', cli: 'npx nostr-bray relay set wss://relay.damus.io wss://nos.lol --confirm' },
      { ask: 'Add this relay for reading only', cli: 'npx nostr-bray relay add wss://relay.damus.io read' },
      { ask: 'What does this relay support?', cli: 'npx nostr-bray relay-info wss://relay.damus.io' },
      { ask: 'Make an authenticated request to my relay’s admin endpoint', cli: 'npx nostr-bray relay curl <url> --path /stats --auth' },
      { ask: 'Where does fiatjaf read and write?', cli: `npx nostr-bray outbox relays ${FIATJAF_NPUB}` },
      { ask: 'Publish this event where its mentions will actually see it', cli: 'npx nostr-bray outbox publish event.json' },
    ],
  },
  {
    id: 'sync', no: '05', title: 'SYNC',
    intro: 'Filter-based copying of events between relays and files.',
    rows: [
      { ask: 'Pull my notes down from that relay', cli: 'npx nostr-bray sync pull wss://relay.damus.io --kinds 1 --authors <hex>' },
      { ask: 'Push this file of events up to the new relay', cli: 'npx nostr-bray sync push wss://relay.example.com --events ./events.jsonl' },
    ],
  },
  {
    id: 'admin', no: '06', title: 'ADMIN',
    intro: 'NIP-86 management for a relay you run.',
    rows: [
      { ask: 'Allow this pubkey on my relay', cli: 'npx nostr-bray admin allowpubkey <relay-url> <pubkey-hex>' },
      { ask: 'Who is allowed on my relay?', cli: 'npx nostr-bray admin listallowedpubkeys <relay-url>' },
      { ask: 'Ban an event kind on my relay', cli: 'npx nostr-bray admin bankind <relay-url> <kind>' },
      { ask: 'Block that address from my relay', cli: 'npx nostr-bray admin blockip <relay-url> <ip>' },
    ],
  },
  {
    id: 'wallet', no: '07', title: 'WALLET',
    intro: 'NIP-47 Nostr Wallet Connect: a Lightning wallet on a leash it cannot slip.',
    rows: [
      { tf: 'Keep it in the terminal. An NWC URI carries its own secret, and secrets do not belong in a conversation.', cli: 'npx nostr-bray wallet connect <nwc-url>' },
      { ask: 'Disconnect my wallet', cli: 'npx nostr-bray wallet disconnect' },
      { ask: 'Which wallet am I connected to?', cli: 'npx nostr-bray wallet status' },
      { ask: 'Pay this Lightning invoice', cli: 'npx nostr-bray wallet pay <bolt11>' },
      { ask: 'What is my wallet balance?', cli: 'npx nostr-bray wallet balance' },
      { ask: 'Show my recent Lightning transactions', cli: 'npx nostr-bray wallet history --limit 10' },
    ],
  },
  {
    id: 'zap', no: '08', title: 'ZAP',
    intro: 'Money as a first-class verb.',
    rows: [
      { ask: 'Zap this invoice', cli: 'npx nostr-bray zap-send <bolt11>' },
      { ask: 'What is my zap balance?', cli: 'npx nostr-bray zap-balance' },
      { ask: 'Make an invoice for 21 sats for coffee', cli: 'npx nostr-bray zap-invoice 21000 "coffee"' },
      { ask: 'Has that invoice been paid?', cli: 'npx nostr-bray zap-lookup <payment-hash>' },
      { ask: 'List my recent transactions', cli: 'npx nostr-bray zap-transactions --limit 10' },
      { ask: 'Fetch my zap receipts', cli: 'npx nostr-bray zap-receipts --limit 10' },
      { ask: 'What does this invoice actually say?', cli: 'npx nostr-bray zap-decode <bolt11>' },
    ],
  },
  {
    id: 'safety', no: '09', title: 'SAFETY',
    intro: 'A parallel identity for the day someone insists on seeing your phone.',
    rows: [
      { ask: 'Set up my duress identity', cli: 'npx nostr-bray safety-configure travel' },
      { ask: 'Activate my duress identity', cli: 'npx nostr-bray safety-activate travel' },
    ],
  },
  {
    id: 'utility', no: '10', title: 'UTILITY',
    intro: 'The toolbox: query, build, encode, verify, encrypt.',
    rows: [
      { ask: 'Find the last five long-form articles', cli: 'npx nostr-bray req --kinds 30023 --limit 5' },
      { ask: 'Build and publish a custom event of kind 30023', cli: 'npx nostr-bray event --kind 30023 --tag d=my-article --content "draft"' },
      { ask: 'Sign this event and broadcast it, with a per-relay report', cli: 'npx nostr-bray publish-raw --file event.json --report' },
      { tf: 'Terminal territory. It streams live events until you press Ctrl-C.', cli: 'npx nostr-bray subscribe --kinds 1' },
      { ask: 'What is inside this npub?', cli: `npx nostr-bray decode ${FIATJAF_NPUB}` },
      { ask: 'Turn this hex pubkey into an npub', cli: `npx nostr-bray encode npub ${FIATJAF_HEX}` },
      { ask: 'Turn this hex event id into a note address', cli: 'npx nostr-bray encode note <event-hex>' },
      { ask: 'Encode this pubkey with its relays as an nprofile', cli: 'npx nostr-bray encode nprofile <hex> wss://relay.damus.io' },
      { ask: 'Encode this event with its relays as an nevent', cli: 'npx nostr-bray encode nevent <event-hex> wss://relay.damus.io' },
      { tf: 'Terminal only. It takes a raw secret key as input.', cli: 'npx nostr-bray encode nsec <hex>' },
      { tf: 'Terminal only. It takes your secret key as input.', cli: 'npx nostr-bray key-public <nsec-or-hex>' },
      { tf: 'Terminal only. Your secret key and password stay off the record.', cli: 'npx nostr-bray key encrypt <nsec-or-hex> <password>' },
      { tf: 'Terminal only. Same reason: the secret never enters a conversation.', cli: 'npx nostr-bray key decrypt <ncryptsec> <password>' },
      { ask: 'Does this event match this filter?', cli: 'npx nostr-bray filter <event-json> <filter-json>' },
      { ask: 'List the official NIPs', cli: 'npx nostr-bray nips' },
      { ask: 'Show me NIP-17', cli: 'npx nostr-bray nip 17' },
      { ask: 'Verify this event’s hash and signature', cli: 'npx nostr-bray verify <event-json>' },
      { ask: 'Encrypt a message that only fiatjaf can read', cli: `npx nostr-bray encrypt ${FIATJAF_HEX} "hello world"` },
      { ask: 'Decrypt the message fiatjaf sent me', cli: `npx nostr-bray decrypt ${FIATJAF_HEX} <ciphertext>` },
      { ask: 'How many notes has fiatjaf published?', cli: `npx nostr-bray count --kinds 1 --authors ${FIATJAF_HEX}` },
      { ask: 'Fetch whatever this Nostr address points at', cli: `npx nostr-bray fetch ${FIATJAF_NPUB}` },
    ],
  },
  {
    id: 'musig2', no: '11', title: 'MUSIG2',
    intro: 'BIP-327 multi-signature ceremonies, step by step. Raw signing secrets ride the arguments at every stage, so this whole group lives in the terminal.',
    rows: [
      { tf: 'Terminal territory. Generates a signing key pair.', cli: 'npx nostr-bray musig2 key' },
      { tf: 'Terminal territory. The secret nonce must never leave your machine.', cli: 'npx nostr-bray musig2 nonce --sk <hex>' },
      { tf: 'Terminal territory. Your secret key and nonce are arguments.', cli: 'npx nostr-bray musig2 partial-sign --sk <hex> --sec-nonce <hex> --pub-nonces <n1,n2> --pub-keys <pk1,pk2> --msg <32-byte-hex>' },
      { tf: 'Terminal territory. Combines everyone’s partial signatures.', cli: 'npx nostr-bray musig2 aggregate --partial-sigs <s1,s2> --pub-nonces <n1,n2> --pub-keys <pk1,pk2> --msg <32-byte-hex>' },
    ],
  },
  {
    id: 'modes', no: '12', title: 'MODES',
    intro: 'The long-running shapes bray can take.',
    rows: [
      { tf: 'This one is the assistant side itself. Point your MCP client at it and every row above becomes something you can say.', cli: 'npx nostr-bray' },
      { tf: 'Terminal territory. Runs an in-memory test relay until you stop it.', cli: 'npx nostr-bray serve --port 7777' },
      { tf: 'Keep it in the terminal. A bunker URI carries its own secret.', cli: 'npx nostr-bray bunker connect "bunker://..."' },
      { tf: 'Terminal territory. Bunker administration lives beside the daemon.', cli: 'npx nostr-bray bunker authorize <hex-pubkey>' },
      { tf: 'Terminal territory. Shows the saved bunker connection state.', cli: 'npx nostr-bray bunker status' },
      { tf: 'Terminal territory. One-shot signing of an event template via the bunker.', cli: 'npx nostr-bray bunker sign event.json' },
      { tf: 'Terminal territory. A NIP-46 remote signer that runs until you stop it.', cli: 'npx nostr-bray bunker daemon' },
      { tf: 'Terminal territory. The whole CLI as a conversation of its own.', cli: 'npx nostr-bray shell' },
    ],
  },
]

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)

const sections = groups.map(g => `
<!-- ======================= ${g.no} · ${g.title} ======================= -->
<section class="section" id="${g.id}">
  <div class="section-head">
    <span class="section-no">${g.no}</span>
    <h2>${g.title}</h2>
  </div>
  <div class="section-body">
    <p>${g.intro}</p>
    <div class="pair-heads" aria-hidden="true">
      <span class="pair-head">Say to your assistant</span>
      <span class="pair-head">Or type in the terminal</span>
    </div>
    <div class="pairs">
${g.rows.map(r => {
  const human = r.tf
    ? `      <div class="cell cell-human cell-tf"><span class="cell-text">${esc(r.tf)}</span></div>`
    : `      <button type="button" class="cell cell-human" title="click to copy"><span class="cell-text">${esc(r.ask)}</span></button>`
  const cli = `      <button type="button" class="cell cell-cli" title="click to copy"><span class="cell-text">${esc(r.cli)}</span></button>`
  return `      <div class="pair">\n${human}\n${cli}\n      </div>`
}).join('\n')}
    </div>
  </div>
</section>`).join('\n')

const toc = groups.map(g => `    <li><a href="#${g.id}"><span class="toc-no">${g.no}</span>${g.title.charAt(0) + g.title.slice(1).toLowerCase()}</a></li>`).join('\n')

const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bray CLI reference: every command, both languages</title>
<meta name="description" content="Every nostr-bray command beside the plain-English way to ask an AI assistant for the same thing. Hover either side to light up its twin; click to copy.">
<link rel="canonical" href="https://bray.forgesworn.dev/cli/">
<meta property="og:title" content="Bray CLI reference">
<meta property="og:description" content="Every command beside its plain-English equivalent. Hover either side to light up its twin.">
<meta property="og:url" content="https://bray.forgesworn.dev/cli/">
<meta property="og:type" content="article">
<meta name="theme-color" content="#06060b">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%230a0a0f'/><text x='16' y='22' font-size='18' text-anchor='middle' fill='%23e8a838' font-family='serif'>b</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300;1,9..40,400&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../guide.css">
<style>
/* ---------- command pairs ---------- */
.pair-heads {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
.pair-head {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pairs {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.5rem;
}
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
}
.cell {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-elevated);
  padding: 0.6rem 0.8rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.55;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
button.cell { cursor: copy; font-family: inherit; }
.cell-human { font-family: var(--font-body); }
.cell-human:not(.cell-tf) .cell-text::before { content: "\\201C"; color: var(--text-muted); }
.cell-human:not(.cell-tf) .cell-text::after { content: "\\201D"; color: var(--text-muted); }
.cell-cli {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--text-primary);
  background: var(--bg-card);
  overflow-wrap: break-word;
}
.cell-tf { color: var(--text-muted); font-style: italic; font-size: 0.8rem; }
/* hovering one side lights up its twin */
.pair:has(.cell-human:hover) .cell-cli,
.pair .cell-human:hover ~ .cell-cli {
  border-color: var(--accent-gold);
  color: var(--accent-gold);
  background: rgba(232, 168, 56, 0.06);
}
.pair:has(.cell-cli:hover) .cell-human {
  border-color: var(--accent-gold);
  color: var(--text-primary);
  background: rgba(232, 168, 56, 0.06);
}
.cell:hover { border-color: var(--border-medium); }
.cell.copied { border-color: var(--accent-green); }
.cell.copied::after {
  content: "copied";
  position: absolute;
  top: 0.35rem;
  right: 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--accent-green);
}
@media (max-width: 720px) {
  .pair-heads { grid-template-columns: 1fr; }
  .pair-heads .pair-head:last-child { display: none; }
  .pair {
    grid-template-columns: 1fr;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 0.45rem;
  }
}
</style>
</head>
<body>

<header class="masthead">
  <a class="wordmark" href="../">nostr-<span>bray</span></a>
  <nav class="mastnav" aria-label="Sections">
    <a href="../">About</a>
    <a href="../guide/">Getting started</a>
    <a href="../guide/trust/">Trust guide</a>
    <a href="./" aria-current="page">CLI</a>
    <a href="https://github.com/forgesworn/bray">GitHub</a>
    <a href="https://www.npmjs.com/package/nostr-bray">npm</a>
  </nav>
</header>

<main>

<section class="page-hero">
  <p class="kicker">// the command atlas</p>
  <h1>The same tool in <span class="gold">two languages.</span></h1>
  <p class="lede">
    Everything bray does for an assistant it also does from a terminal.
    Below are all ${rowCount} commands the CLI ships, each beside the
    plain-English way to ask an assistant for the same thing. Hover either
    side and its twin lights up; click either side to copy it. Where a row
    says to stay in the terminal, that is deliberate: recovery words, raw
    keys and connection secrets should never enter an AI conversation, so
    those commands print to your screen and nowhere else.
  </p>
  <ul class="toc" aria-label="Command groups">
${toc}
  </ul>
</section>
${sections}

<!-- ======================= 13 · ENVIRONMENT ======================= -->
<section class="section" id="environment">
  <div class="section-head">
    <span class="section-no">13</span>
    <h2>ENVIRONMENT AND FLAGS</h2>
  </div>
  <div class="section-body">
    <p>
      The CLI reads its identity and relays from the environment, so scripts
      and shells stay free of secrets on the command line.
    </p>
    <dl class="spec-rows">
      <div class="spec-row">
        <dt><code>NOSTR_SECRET_KEY_FILE</code></dt>
        <dd>Path to a file holding your nsec, hex key or mnemonic. The
        recommended shape: the key lives in a file only you can read, never
        in shell history.</dd>
      </div>
      <div class="spec-row">
        <dt><code>NOSTR_SECRET_KEY</code></dt>
        <dd>The key itself, for environments that inject secrets directly.
        Prefer the file variant on a desktop machine.</dd>
      </div>
      <div class="spec-row">
        <dt><code>BUNKER_URI</code> / <code>BUNKER_URI_FILE</code></dt>
        <dd>A <code>bunker://</code> URI for remote signing. Use instead of
        a local secret key: the key stays on the signing device.</dd>
      </div>
      <div class="spec-row">
        <dt><code>NOSTR_RELAYS</code></dt>
        <dd>Comma-separated relay URLs to use by default.</dd>
      </div>
      <div class="spec-row">
        <dt><code>NWC_URI</code> / <code>NWC_URI_FILE</code></dt>
        <dd>Nostr Wallet Connect URI for zaps and payments.</dd>
      </div>
      <div class="spec-row">
        <dt><code>NOSTR_BRAY_OUTPUT</code></dt>
        <dd>Default output style: <code>human</code> (default) or
        <code>json</code>. Per-command, <code>--json</code> and
        <code>--human</code> override it either way, which makes every
        command pipe-friendly.</dd>
      </div>
      <div class="spec-row">
        <dt><code>TOR_PROXY</code></dt>
        <dd>SOCKS5h proxy URL, for reaching relays over Tor.</dd>
      </div>
    </dl>
  </div>
</section>

</main>

<footer class="colophon">
  <p class="colophon-links">
    <a href="../">About</a> ·
    <a href="../guide/">Getting started</a> ·
    <a href="../guide/trust/">Trust guide</a> ·
    <a href="https://github.com/forgesworn/bray">Source</a> ·
    <a href="https://www.npmjs.com/package/nostr-bray">npm</a> ·
    <a href="https://forgesworn.dev">forgesworn.dev</a>
  </p>
  <p class="colophon-note">
    The only script on this page copies text to your clipboard when you
    click a command. No cookies, no analytics. The list mirrors
    <code>nostr-bray --help</code>; if they ever disagree, trust the help.
  </p>
</footer>

<script>
document.querySelectorAll('button.cell').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.querySelector('.cell-text').textContent;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1400);
  });
});
</script>

</body>
</html>
`

writeFileSync(OUT, html)
console.log(`wrote ${OUT}: ${rowCount} rows across ${groups.length} groups`)
