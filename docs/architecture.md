# Bray — Architecture

## System Context

How Bray fits into the Nostr ecosystem — AI agents and humans get sovereign identities with three-dimensional trust.

```mermaid
graph TB
    subgraph clients["Clients"]
        direction LR
        CC["Claude Code<br/><i>MCP stdio</i>"]
        CURSOR["Cursor / Windsurf<br/><i>MCP stdio</i>"]
        APP["Web App<br/><i>MCP HTTP + SSE</i>"]
    end

    subgraph bray["Bray MCP Server — 182 tools"]
        direction TB

        subgraph tools["Tool Groups"]
            direction LR
            ID["Identity<br/><b>15 tools</b><br/><i>derive, switch,<br/>prove, shamir</i>"]
            SOC["Social<br/><b>15 tools</b><br/><i>post, reply, DM,<br/>feed, contacts</i>"]
            TRU["Trust<br/><b>22 tools</b><br/><i>attest, verify,<br/>ring-sig, score</i>"]
            ZAP["Zap<br/><b>4 tools</b><br/><i>send, balance,<br/>receipts</i>"]
        end

        subgraph signing["Signing Layer"]
            direction LR
            LOCAL["Local Mode<br/><b>IdentityContext</b><br/><i>nsec-tree hierarchy<br/>LRU + crypto zeroing</i>"]
            BUNKER["Bunker Mode<br/><b>BunkerContext</b><br/><i>No keys held locally<br/>NIP-46 remote signing</i>"]
        end

        subgraph trust["Trust Context — Three Dimensions"]
            direction LR
            SIG["Signet<br/><b>Assessor</b><br/><i>Are they real?<br/>Tier 1–4, Score 0–200</i>"]
            VEIL["Veil<br/><b>Scoring</b><br/><i>Do I know them?<br/>WoT graph distance</i>"]
            DOM["Dominion<br/><b>Vault Resolver</b><br/><i>What can they see?<br/>Epoch-based access</i>"]
        end

        POOL["Relay Pool<br/><i>NIP-65 relay lists · SOCKS5h / Tor · write queue</i>"]
    end

    subgraph relays["Nostr Relays"]
        direction LR
        R1["relay.damus.io"]
        R2["nos.lol"]
        R3["relay.nostr.band"]
    end

    subgraph bunker_remote["Remote NIP-46 Bunker"]
        SIGNER["Bunker Signer<br/><i>Holds nsec<br/>Signs on request</i>"]
    end

    CC --> bray
    CURSOR --> bray
    APP --> bray

    tools --> signing
    tools --> trust
    signing --> POOL
    trust --> POOL

    POOL --> R1
    POOL --> R2
    POOL --> R3

    BUNKER -.->|"kind 24133<br/>NIP-44 encrypted"| R1
    R1 -.->|"kind 24133<br/>signed response"| BUNKER
    SIGNER -.->|"signs via relay"| R1

    style clients fill:#1b2d3d,stroke:#0f3460,color:#eee,stroke-width:2px
    style bray fill:#1b3d2d,stroke:#16c79a,color:#eee,stroke-width:2px
    style tools fill:#1b3d3d,stroke:#00b4d8,color:#eee,stroke-width:2px
    style signing fill:#2d1b3d,stroke:#e94560,color:#eee,stroke-width:2px
    style trust fill:#2d2d3d,stroke:#9b59b6,color:#eee,stroke-width:2px
    style relays fill:#2d2d1b,stroke:#f5a623,color:#eee,stroke-width:2px
    style bunker_remote fill:#3d2d2d,stroke:#e17055,color:#eee,stroke-width:2px

    style CC fill:#1b2d3d,stroke:#0f3460,color:#eee
    style CURSOR fill:#1b2d3d,stroke:#0f3460,color:#eee
    style APP fill:#1b2d3d,stroke:#0f3460,color:#eee
    style ID fill:#1b3d3d,stroke:#00b4d8,color:#eee
    style SOC fill:#1b3d3d,stroke:#00b4d8,color:#eee
    style TRU fill:#1b3d3d,stroke:#00b4d8,color:#eee
    style ZAP fill:#1b3d3d,stroke:#00b4d8,color:#eee
    style LOCAL fill:#2d1b3d,stroke:#e94560,color:#eee
    style BUNKER fill:#2d1b3d,stroke:#e94560,color:#eee
    style SIG fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style VEIL fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style DOM fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style POOL fill:#1b3d2d,stroke:#16c79a,color:#eee
    style R1 fill:#2d2d1b,stroke:#f5a623,color:#eee
    style R2 fill:#2d2d1b,stroke:#f5a623,color:#eee
    style R3 fill:#2d2d1b,stroke:#f5a623,color:#eee
    style SIGNER fill:#3d2d2d,stroke:#e17055,color:#eee
```

## NIP-46 Bunker Flow

The remote signing protocol — private keys never leave the bunker.

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Bray as Bray<br/>(BunkerContext)
    participant Relay as Nostr Relay
    participant Bunker as Remote Bunker<br/>(holds nsec)

    Agent->>Bray: social-post "Hello Nostr"
    activate Bray
    Note over Bray: Builds unsigned<br/>kind 1 event

    Bray->>Relay: kind 24133 request<br/>(NIP-44 encrypted)<br/>"sign_event"
    activate Relay
    Relay->>Bunker: Delivers encrypted request
    activate Bunker
    Note over Bunker: Decrypts request<br/>Checks authorised keys<br/>Signs event with nsec
    Bunker->>Relay: kind 24133 response<br/>(NIP-44 encrypted)<br/>"signed event"
    deactivate Bunker
    Relay->>Bray: Delivers encrypted response
    deactivate Relay

    Note over Bray: Decrypts response<br/>Extracts signature

    Bray->>Relay: Publishes signed<br/>kind 1 event
    Bray->>Agent: ✓ Published<br/>note1abc...
    deactivate Bray
```

## Dependency Stack

Bray's library dependencies and what they provide.

```mermaid
graph BT
    subgraph primitives["Cryptographic Primitives"]
        direction LR
        RING["@forgesworn/ring-sig<br/><i>SAG ring signatures<br/>on secp256k1</i>"]
        SHAMIR["@forgesworn/shamir-words<br/><i>Shamir Secret Sharing<br/>BIP-39 output</i>"]
    end

    subgraph identity["Identity Stack"]
        direction LR
        NSEC["nsec-tree<br/><i>Hierarchical identity<br/>derivation</i>"]
        SPOKEN["spoken-token<br/><i>HMAC spoken<br/>verification</i>"]
        CANARY["canary-kit<br/><i>Duress detection</i>"]
    end

    subgraph trust_libs["Trust Stack"]
        direction LR
        SIGNET["signet-protocol<br/><i>Verification credentials<br/>Tier 1–4</i>"]
        DOMINION["dominion-protocol<br/><i>Epoch-based encrypted<br/>access control</i>"]
        VEIL_LIB["nostr-veil<br/><i>Web-of-trust<br/>graph scoring</i>"]
        ATTEST["nostr-attestations<br/><i>NIP-VA kind 31000<br/>attestation builders</i>"]
    end

    subgraph nostr["Nostr Foundation"]
        direction LR
        NT["nostr-tools<br/><i>Events, signing, encryption<br/>NIP-17/44/04, relay pool</i>"]
    end

    subgraph mcp["MCP Framework"]
        direction LR
        MCP_SDK["@modelcontextprotocol/sdk<br/><i>Server framework<br/>stdio + HTTP transport</i>"]
    end

    BRAY["<b>BRAY</b><br/><i>182 tools · 17 groups</i>"]

    NT --> NSEC
    NT --> SIGNET
    NT --> DOMINION
    NT --> VEIL_LIB
    NT --> ATTEST

    RING --> NSEC
    SHAMIR --> NSEC
    CANARY --> SPOKEN

    NSEC --> BRAY
    SPOKEN --> BRAY
    CANARY --> BRAY
    SIGNET --> BRAY
    DOMINION --> BRAY
    VEIL_LIB --> BRAY
    ATTEST --> BRAY
    RING --> BRAY
    SHAMIR --> BRAY
    NT --> BRAY
    MCP_SDK --> BRAY

    style primitives fill:#2d2d1b,stroke:#f5a623,color:#eee,stroke-width:2px
    style identity fill:#1b3d2d,stroke:#16c79a,color:#eee,stroke-width:2px
    style trust_libs fill:#2d2d3d,stroke:#9b59b6,color:#eee,stroke-width:2px
    style nostr fill:#1b2d3d,stroke:#0f3460,color:#eee,stroke-width:2px
    style mcp fill:#1b3d3d,stroke:#00b4d8,color:#eee,stroke-width:2px

    style RING fill:#2d2d1b,stroke:#f5a623,color:#eee
    style SHAMIR fill:#2d2d1b,stroke:#f5a623,color:#eee
    style NSEC fill:#1b3d2d,stroke:#16c79a,color:#eee
    style SPOKEN fill:#1b3d2d,stroke:#16c79a,color:#eee
    style CANARY fill:#1b3d2d,stroke:#16c79a,color:#eee
    style SIGNET fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style DOMINION fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style VEIL_LIB fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style ATTEST fill:#2d2d3d,stroke:#9b59b6,color:#eee
    style NT fill:#1b2d3d,stroke:#0f3460,color:#eee
    style MCP_SDK fill:#1b3d3d,stroke:#00b4d8,color:#eee
    style BRAY fill:#3d2d2d,stroke:#e17055,color:#eee,stroke-width:3px
```

## Auth Tier Progression

From most secure to least — how Bray loads key material.

```mermaid
graph LR
    B["bunker://"]
    N["ncryptsec<br/>(NIP-49)"]
    F["Secret key file"]
    E["Env var"]

    B -->|"fallback"| N -->|"fallback"| F -->|"fallback"| E

    B_DESC["Keys never leave<br/>remote signer"]
    N_DESC["Password-encrypted<br/>on disk"]
    F_DESC["Plain key on disk<br/>file perms protect"]
    E_DESC["Key in process<br/>memory (weakest)"]

    B ~~~ B_DESC
    N ~~~ N_DESC
    F ~~~ F_DESC
    E ~~~ E_DESC

    style B fill:#1b3d2d,stroke:#16c79a,color:#eee,stroke-width:3px
    style N fill:#1b3d3d,stroke:#00b4d8,color:#eee,stroke-width:2px
    style F fill:#2d2d1b,stroke:#f5a623,color:#eee,stroke-width:2px
    style E fill:#3d2d2d,stroke:#e17055,color:#eee,stroke-width:2px
    style B_DESC fill:none,stroke:none,color:#aaa
    style N_DESC fill:none,stroke:none,color:#aaa
    style F_DESC fill:none,stroke:none,color:#aaa
    style E_DESC fill:none,stroke:none,color:#aaa
```
