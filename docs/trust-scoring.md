# Trust scoring

bray models trust across three independent dimensions. `trust-score` returns all three plus a composite `level`. Each dimension can be queried on its own: `signet-badge` for verification, Veil graph queries for proximity, `vault-members` for access.

## Dimensions

**Verification (Signet tier)** — kind 31000 attestations published by Signet verifiers (kind 10010). Tiers are integers: `null` (no badge), `0` (self-asserted), `1`+ (third-party verified, higher = stronger). Signet policy (`signet-policy-set`) decides the tier threshold bray treats as "verified".

**Proximity (web-of-trust)** — social distance via kind 3 follow graph, walked up to 3 hops from the caller's master identity. `0` = self, `1` = direct follow, `2` = contact-of-contact, `3` = third-degree, `-1` = not found within 3 hops. Each hop samples up to 50 contacts to bound relay load. `mutualFollows` is true iff the target also follows the caller.

**Access (Dominion vault)** — vault tier membership from `vault-members`. A pubkey may appear in zero or more vaults (`tier-0`, `tier-1`, ...); tiers are epoch-rotated and backed by Shamir-shared vault keys.

## Composite level

`computeCompositeLevel(tier, distance, vaultTiers)` collapses the three signals to one label:

| Level | Predicate |
|-------|-----------|
| `trusted` | verified **and** close (≤2 hops) **and** in any vault |
| `known` | close **or** in any vault |
| `verified-stranger` | verified, outside follow graph |
| `stranger` | 0–3 hops away, unverified |
| `unknown` | no signals |

`verified` means `tier >= 2`. `close` means `0 <= distance <= 2`.

## Trust modes

Tools that surface content (`social-feed`, `social-notifications`, `dm-read`) honour a `trustMode`:

- `strict`: content from authors with no trusted endorsement is hidden (see the follow pass below)
- `annotate` (default): content is shown with a `trust` annotation
- `off`: no filtering, no annotations

`social-feed` and `social-notifications` use the configured `trustMode` (`annotate` unless set). A per-call `trust` argument overrides it, e.g. `social-feed({ trust: "strict" })`.

## Endorsement anchoring

The Veil score counts endorsements from NIP-85 assertions (kind 30382) and ring proofs about a subject. Counting every assertion from every key would let anyone mint a score with throwaway keys, so only endorsements anchored to a party you trust are scored. Three sets define who is trusted:

- **follows**: the pubkeys in your own latest kind 3 contact list, plus your own pubkey. Cached for the Veil cache TTL, per identity, so an identity switch reads its own list.
- **trusted publishers**: `veilTrustedPublishers` (hex or npub).
- **trusted circles**: `veilTrustedCircles` (64 lowercase hex circle IDs, the `computeCircleId` hash of an exact member set).

Plain assertions:

- An assertion whose author is its own subject is ignored and flagged `self-endorsement ignored`.
- An assertion from a follow or a trusted publisher is a trusted endorsement, one per author.
- Any other author's assertion is an untrusted endorsement: reported in `untrustedEndorsements`, never scored.
- An assertion carrying `veil-sig` tags is only ever treated as a ring proof. A follow's proof in an untrusted ring, or an invalid proof, does not count as that follow's plain endorsement.
- If no kind 3 follow list is found for the caller, only the caller is trusted and results carry the flag `follow list not found`.

Ring proofs (valid `veil-sig` proofs) are trusted by any one of three routes:

1. The proof's circle ID is in `veilTrustedCircles`. This is the strongest route: the ID is a hash of the exact member set, so someone who adds themselves to a ring produces a different ID.
2. The proof was published by a trusted publisher, which trusts that publisher's curation of circles.
3. Every member of the ring is one of your follows (or you).

A fraction or majority of trusted members is not enough. Rings need no consent from their members, and an attacker who places one of their own keys in a ring of otherwise trusted members can sign, while the proof cannot say which member signed. The publisher of a proof is otherwise irrelevant: anyone may republish aggregated proofs.

Key images are grouped by scope (the `electionId` inside each signature) and a replayed key image counts once. Proofs that are valid but not trusted are counted in `untrustedRingEndorsements`, never scored, and flagged `ring proof untrusted`.

Subject in the ring: the ring signature hides which member signed, so when the subject is a member of a trusted ring, one signature per scope may be the subject's own. Key images stop a member signing twice per scope, so at most one per scope can be theirs. bray therefore deducts one key image from each scope whose trusted proofs include the subject as a member (never below zero) and flags `subject is a ring member`. A threshold-1 proof whose ring contains the subject scores nothing.

The score is `endorsements + 3 * ringEndorsements`, trusted counts only. `untrustedEndorsements` and `untrustedRingEndorsements` appear beside them in `trust-score` proximity output so you can see what was set aside.

### Strict mode follow pass

In `strict` mode an author passes when their score meets the threshold (default 1) or they are in your follows or `veilTrustedPublishers`. People you follow therefore stay in strict feeds and notifications even when nobody has endorsed them, while strangers still need an endorsement from someone you trust.

### Configuration

```json
{
  "veilTrustedCircles": ["<64 lowercase hex circle ID>"],
  "veilTrustedPublishers": ["npub1... or 64 hex"]
}
```

`VEIL_TRUSTED_CIRCLES` and `VEIL_TRUSTED_PUBLISHERS` take comma-separated lists and are merged with the file lists. An entry that is not valid stops startup with a message naming it, rather than being dropped.

## What it does not do

Trust scoring is not proof-of-identity. A high tier + short distance means the signals line up, not that the person is who they claim. For cryptographic proof of control, use `identity-prove`. For attestation chains, use `trust-attest-chain`.

## Related tools

- `trust-score` — full three-dimensional assessment
- `signet-badge` — verification tier only
- `signet-policy-check` — test a target against the active Signet policy
- `vault-members` — list members of a vault tier
- `trust-attest` / `trust-claim` / `trust-verify` — kind 31000 attestation lifecycle
- `trust-ring-prove` / `trust-ring-verify` — anonymous group-membership proofs via SAG/LSAG
