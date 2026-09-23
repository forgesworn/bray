# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in nostr-bray, please report it responsibly.

**Do NOT open a public issue.**

Instead, email **security@forgesworn.dev** with:

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

Security issues in the following areas are in scope:

- Private key leakage (nsec, NWC secrets, Shamir shards)
- Cryptographic weaknesses (NIP-44, ring signatures, HMAC)
- Authentication bypass (HTTP bearer token)
- SSRF or network boundary violations
- Input validation failures leading to injection
- Denial of service via resource exhaustion

## Security Model

nostr-bray handles sensitive cryptographic material. Key security properties:

- Private keys never appear in MCP tool responses
- LRU cache with cryptographic zeroing on eviction
- Secrets deleted from `process.env` after parsing
- NWC URIs are read only from private (0600) files, and the byte buffers read from disk are zeroised. The URI itself then lives in memory as a JavaScript string, which cannot be erased, until it is garbage collected
- Spending is capped by bray per payment and per rolling 24 hours (`BRAY_MAX_PAYMENT_MSAT`, `BRAY_MAX_DAILY_MSAT`), and approved by the human via MCP elicitation where the client supports it. The hard limit is a budget set in the wallet on the NWC connection bray holds
- NIP-65 relay lists signature-verified
- Relay URLs validated against SSRF (scheme + private IP blocking)
- HTTP transport: constant-time bearer token auth, rate limiting
- Tor proxy support with clearnet blocking enforced at runtime
- Shamir shard files written with 0o600 permissions via atomic rename
