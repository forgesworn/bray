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
- NWC secret buffers zeroised after each operation
- NIP-65 relay lists signature-verified
- Relay URLs validated against SSRF (scheme + private IP blocking)
- HTTP transport: constant-time bearer token auth, rate limiting
- Tor proxy support with clearnet blocking enforced at runtime
- Shamir shard files written with 0o600 permissions via atomic rename
