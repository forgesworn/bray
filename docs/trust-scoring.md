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

- `strict` (default) — `unknown`/`stranger` content is hidden
- `annotate` — content is shown with a `trust` annotation
- `off` — no filtering, no annotations

Per-call overrides are supported where it makes sense (e.g. `social-feed({ trust: "annotate" })`).

## What it does not do

Trust scoring is not proof-of-identity. A high tier + short distance means the signals line up, not that the person is who they claim. For cryptographic proof of control, use `identity-prove`. For attestation chains, use `trust-attest-chain`.

## Related tools

- `trust-score` — full three-dimensional assessment
- `signet-badge` — verification tier only
- `signet-policy-check` — test a target against the active Signet policy
- `vault-members` — list members of a vault tier
- `trust-attest` / `trust-claim` / `trust-verify` — kind 31000 attestation lifecycle
- `trust-ring-prove` / `trust-ring-verify` — anonymous group-membership proofs via SAG/LSAG
