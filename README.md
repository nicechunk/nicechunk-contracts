# NiceChunk Contracts

Focused contract repository for the current NiceChunk Solana surface.

This split contains the Rust native programs, TypeScript SDK helpers, contract operation scripts, focused tests, runtime rule data, public chain configuration, and the browser contract directory that explains the active PDA and instruction surface.

## Official Links

GitHub: [https://github.com/nicechunk/nicechunk-contracts](https://github.com/nicechunk/nicechunk-contracts)

Website: [https://nicechunk.com/contracts/](https://nicechunk.com/contracts/)

## Current Scope

The workspace currently includes these Solana programs:

| Program | Role |
| --- | --- |
| `nicechunk_core` | Global configuration, authority seeds, and shared on-chain constants. |
| `nicechunk_player` | Player profiles, session authority, identity, appearance, and profile state. |
| `nicechunk_skills` | Skill rules, per-player XP and levels, and program-authorized progress updates. |
| `nicechunk_chunk` | Chunk state, generated block verification, broken block records, resource drop tables, and surface decoration tables. |
| `nicechunk_game` | Game routing layer for shared program integration. |
| `nicechunk_guardian` | Guardian registry, NCK-staked region enrollment, proof submission, settlement, and realtime endpoint updates. |
| `nicechunk_backpack` | Backpack and inventory records used by gameplay and item custody flows. |
| `nicechunk_market` | Marketplace listings, MarketUser membership, and treasury-issued blank land-contract balances. |
| `nicechunk_smelting` | Smelting recipe tables, rule synchronization, and recipe retirement tests. |
| `nicechunk_civilization` | Civilization rule books, signatures, tallies, execution receipts, value snapshots, and citizen power. |
| `nicechunk_building` | Immutable chunk-aligned land registration, NCM3 building manifests, and rollback of incomplete indexing. |

## Contract Logic Map

The contract surface is easiest to read as a set of trust boundaries and evidence accounts rather than a linear transaction list:

```mermaid
flowchart LR
  wallet["Player wallet<br/>owner signer"] --> playerGate["Player Program<br/>profile + session guard"]
  session["Session authority<br/>expiry-bearing signer"] --> playerGate
  core["Genesis Core<br/>GlobalConfig anchor"] --> playerGate
  core --> chunkGate["Chunk Program<br/>world mutation gate"]
  core --> buildingGate["Building Program<br/>foundation + NCM3 manifest gate"]
  core --> backpackGate["Backpack Program<br/>inventory custody gate"]

  playerGate --> profile[(PlayerProfile PDA)]
  playerGate --> sessionPda[(PlayerSession PDA)]
  chunkGate --> broken[(ChunkBrokenState PDA)]
  chunkGate --> drops[(ResourceDropTable PDA)]

  marketGate --> marketUser[(MarketUser PDA<br/>available + reserved contracts)]
  marketUser -->|one contract per chunk| buildingGate
  buildingGate --> site[(BuildSite v3 PDA)]
  buildingGate --> manifest[(BuildingManifest PDA)]
  buildingGate --> shards[(BuildingShard PDA)]
  backpackGate --> backpack[(Backpack PDA)]
  backpack --> smeltingGate["Smelting Program<br/>recipe + authority gate"]
  smeltingGate --> recipes[(RecipeTable PDA)]
  smeltingGate --> backpack
  backpack --> marketGate["Marketplace Program<br/>escrow + settlement gate"]
  marketGate --> listing[(MarketplaceListing PDA)]
  listing --> backpack

  civilizationGate["Civilization Program<br/>rule signature + tally gate"] --> rules[(RuleBook / Rule PDA)]
  civilizationGate --> tally[(Tally PDA)]
  civilizationGate --> receipt[(ExecutionReceipt PDA)]
  chunkGate -. adapter proof .-> civilizationGate
  smeltingGate -. adapter proof .-> civilizationGate

  classDef signer fill:#1f2937,stroke:#f5f9ff,color:#f5f9ff
  classDef program fill:#10200c,stroke:#8cff00,color:#f5f9ff
  classDef pda fill:#0b1724,stroke:#98cbff,color:#f5f9ff
  classDef proof fill:#1b1328,stroke:#d0a4ff,color:#f5f9ff
  class wallet,session signer
  class core,playerGate,chunkGate,buildingGate,backpackGate,smeltingGate,marketGate program
  class profile,sessionPda,broken,drops,site,manifest,shards,backpack,recipes,listing,rules,tally,receipt pda
  class civilizationGate proof
```

The hosted contract directory expands this map into the visual `Contract Logic Atlas`, with account layouts, PDA seeds, source panels, and RPC decoders for the source and client-configured devnet surface. Client configuration is not deployment evidence.

## Reviewer Audit Matrix

External review should tie each contract claim to an authority gate, a public evidence account, and a current runtime boundary:

| Surface | Authority gate | Public evidence | Current boundary |
| --- | --- | --- | --- |
| Genesis Core | `GlobalConfig` is initialized from generated genesis constants and then read by clients. | World seed, config hashes, NCK mint, chunk dimensions, Guardian parameters. | Core does not mint items, mutate terrain, update inventory, or execute governance. |
| Player Identity | Owner wallet controls profile state; an expiry-bearing session signer may submit action-mask-approved calls. | `PlayerProfile`, `PlayerSession`, appearance, and equipment PDA records. | Consumers do not enforce the stored action counter or a maximum duration, and no revoke/close path exists. Browser-cached addresses are not proof of control. |
| Chunk / Mining | Chunk logic recomputes the generated block from `GlobalConfig` and rejects invalid or already broken targets. | `ChunkBrokenState`, `ResourceDropTable`, surface decoration table, packed local block records. | The program stores sparse mutations, not full terrain; inventory settlement is separate. |
| Building | A valid `PlayerSession` creates chunk-aligned land only after Building reserves one MarketUser contract per selected chunk. | `MarketUser`, `BuildSite v3`, `FoundationChunk v3`, `BuildingManifest v3`, and `BuildingShard v2`. | Active land is immutable. Incomplete indexing removes chunk records in reverse order before releasing the full reservation. |
| Guardian Registry | Any payer may initialize the deterministic registry against the pinned treasury token account; region owners register NCK-staked services, operators submit proofs, and owners update endpoints. | `GuardianRegistry` and `GuardianRegion` owner, operator, endpoint, stake, proof, penalty, and settlement fields. | Guardian state is realtime-service evidence only. It neither gates land registration nor stores or proves building state. |
| Backpack Inventory | Owner and authorized program signers control slot creation, removal, and delivery; direct tag `2` also accepts a `BREAK_BLOCK` session. | `Backpack` item count, fixed slot payloads, coordinates, material or forged-item identity, durability. | Construction-item issuance tag `9` is retired and always rejected; land contracts never occupy Backpack slots. |
| Smelting Recipes | Any signer may first-initialize an unused table ID and become its authority; smelting authority mutates Backpack slots after selected-table validation. | `RecipeTable`, stored authority, recipe IDs, heat tiers, input/output volumes, disabled recipe flags. | Execution accepts any Smelting-owned table and has no canonical-table allowlist; verify table provenance independently. |
| Marketplace | Seller signatures gate listings; treasury purchases debit exactly `1 NCK` per blank land contract; Building alone may reserve, consume, or release balances. | `MarketplaceListing` plus the owner's 64-byte `MarketUser` account. | Treasury contracts create no Listing PDA and consume no Backpack slot. Each wallet remains capped at 50 active listings. |
| Civilization Rules | Rule targets, citizen signatures, power snapshots, caller-supplied tallies, and receipts are separate records. | `RuleBook`, `RuleSignature`, `RuleTally`, `ExecutionReceipt`, `PowerSnapshot`, `CitizenPower`. | `mainnet.json` omits Civilization, but that is not an on-chain disable switch. No voting window is enforced, threshold may be 1 bps, and the finalizer can omit available signatures. |

## PDA Seed Evidence

The contract directory now includes a `PDA Seed Evidence` graph built from the Rust and SDK seed constants. The most review-sensitive seeds are:

| Evidence family | Seeds | Why it matters |
| --- | --- | --- |
| World anchor | `GlobalConfig`: `["global-config"]` | Every world proof, chunk write, rule table, and client runtime check should point back to the same public configuration anchor. |
| Chunk deltas | `ChunkBrokenState`: `["chunk-broken", globalConfig, chunkX:i32_le, chunkZ:i32_le]`; `FoundationChunk`: `["foundation-chunk-v3", globalConfig, chunkX:i32_le, chunkZ:i32_le]` | Mining records and immutable land occupancy remain sparse, chunk-scoped evidence rather than a private terrain database. |
| Rule tables | `ResourceDropTable`: `["resource-drops-v2", globalConfig]`; `SurfaceDecorationTable`: `["surface-decor-v1", globalConfig]` | The active resource-drop seed is `resource-drops-v2`; it is scoped by `GlobalConfig` and does not include a table ID. |
| Identity and inventory | `PlayerProfile`: `["player-v7", owner]`; `PlayerSession`: `["session", owner, sessionAuthority]`; `Backpack`: `["backpack", creator, backpackId:u64_le]` | Ownership, expiry-bearing action authority, and item custody are separate PDA families; the seed does not enforce duration or action count. |
| Program signer boundaries | `ChunkAuthority`: `["chunk-authority-v2", globalConfig]`; `LandContractAuthority`: `["land-contract-authority-v1", globalConfig]`; `MarketplaceAuthority`: `["market-authority"]` | Building uses separate scoped signers for land-contract balances and Chunk indexing; no Building signer mutates Guardian state. |
| Land and building publication | `MarketUser`: `["market-user-v1", owner]`; `BuildSite`: `["build-site-v3", globalConfig, foundationId:u64_le]`; `BuildingManifest`: `["building-v3", globalConfig, foundationId:u64_le, revision:u32_le]`; `BuildingShard`: `["building-data-v2", globalConfig, foundationId:u64_le, revision:u32_le, shardIndex:u8]` | One available contract is reserved per complete 16x16 chunk; active land is immutable and every visible building remains tied to a hash-checked manifest revision. |
| Governance proof | `RuleBook`, `RuleSignature`, `RuleTally`, `ExecutionReceipt`, `PowerSnapshot`, and `CitizenPower` seeds | Civilization evidence stays independently decodable, but a receipt does not prove every available signature was counted or that a voting window elapsed. |

## Instruction Surface Map

The contract directory now includes an `Instruction Surface Map` generated from the current Rust `process_instruction` dispatchers. It is meant to catch stale SDK assumptions, especially retired or intentionally disabled discriminators.

| Program | Accepted tags | Disabled or unassigned tags | Audit note |
| --- | --- | --- | --- |
| `nicechunk_game` | Wire payload `[namespace, childTag, childPayload...]`; namespaces `1` Backpack, `2` Chunk, `3` Smelting, `4` Market | Empty payload or any namespace outside `1-4` | The router passes its incoming Game program ID into the child processor, so unified-route PDA derivation is governed by the Game ID. Current client configuration aliases Backpack, Market, and Smelting to Game while Chunk remains standalone; routing configuration is not deployment proof. |
| `nicechunk_core` | Exact payload `[0]` for `initialize_global_config` | Any other payload | Core is a one-time genesis anchor, not a general admin router. |
| `nicechunk_player` | `0-15` | Any tag above `15` | Identity, session authority, appearance, invite indexes, equipment, transfer, swap, and durability paths are all explicit branches. |
| `nicechunk_chunk` | `5`, `6`, `7`, `8`, `9`, `10`, `11`, `12`, `13`, `15`, `20`, `21` | Legacy `0-4` are not accepted | Current world writes center on generated mining checks, rule tables, Civilization receipts, and Building chunk registration. |
| `nicechunk_building` | `0-6` | Tag `7` and every higher tag are invalid | Tags `0-1` reserve and consume land contracts, `2-5` stage/finalize/cancel NCM3 uploads, and `6` rolls incomplete land indexing back. |
| `nicechunk_guardian` | `0-5` | Any tag above `5` | Tags `0-2` initialize and register services, `3` submits a proof, `4` settles a proof window, and `5` updates the realtime endpoint. |
| `nicechunk_backpack` | `0-6`, `8`, `10-16` | `7` is disabled and retired construction-item tag `9` is invalid | Inventory, forging, material physics, skill recording, smelting, and placement remain active; land contracts are not Backpack items. |
| `nicechunk_smelting` | `0-4` | Any tag above `4` | Recipe authority, execution, authority transfer, and Civilization recipe receipt application are all present. |
| `nicechunk_market` | `0-7` | Any tag above `7` | Tag `3` joins the market, tag `4` buys treasury contracts for exactly `1 NCK` each, and tags `5-7` are Building-authority-only reserve/consume/release operations. |
| `nicechunk_civilization` | `0-5` | Any tag above `5` | The dispatcher is live source code; omission from `mainnet.json` describes current client routing, not an on-chain disable control. |

## CPI Authority Ledger

The hosted contract directory also includes a `CPI Authority Ledger` for game-facing cross-program writes. It traces the current Rust `invoke` and `invoke_signed` sites by caller branch, callee tag, signer PDA, and durable evidence account.

| Caller branch | Callee tag | Signer boundary | Durable evidence |
| --- | --- | --- | --- |
| `nicechunk_building` tag `1` `register_build_site_chunks` | `nicechunk_chunk` tag `15` `register_build_site_chunk` | `ChunkAuthority`: `["chunk-authority-v2", globalConfig]` derived under the Building program and re-derived by Chunk | `FoundationChunk v3` stores chunk-scoped immutable land occupancy. |
| `nicechunk_building` tags `0`, `1`, `6` | `nicechunk_market` tags `5`, `6`, `7` | `LandContractAuthority`: `["land-contract-authority-v1", globalConfig]` | `MarketUser` moves contracts between available and reserved balances, consumes them on final indexing, or restores them after reverse-order rollback. |
| `nicechunk_chunk` reward-bearing mining tags `8`, `9`, `20`, `21` | `nicechunk_backpack` tags `1` and `6` | `ChunkBrokenState` PDA signs mined-resource delivery for the exact chunk coordinates | Backpack v4 resource slots with block coordinates, volume, and metadata. Chunk tag `5` records a mined block but does not perform the Backpack reward CPI. |
| `nicechunk_player` tag `13` `transfer_equipment_slot` | `nicechunk_backpack` tags `10` and `11` | `EquipmentTransferAuthority`: `["equipment-transfer-v1"]` under the Player program | `PlayerEquipment` and Backpack slots stay synchronized without arbitrary item minting. |
| `nicechunk_smelting` tag `2` `execute_smelting` | `nicechunk_backpack` tags `4` and `5` | Owner signer removes inputs; `SmeltingAuthority`: `["smelting-authority"]` appends validated outputs | Backpack slots and `RecipeTable` records show recipe IO and output identity. |
| `nicechunk_market` tags `0`, `1`, `2` | `nicechunk_backpack` tags `2` and `3`; `nicechunk_player` tag `2` when clearing display equipment | Seller signer removes or clears; `MarketAuthority`: `["market-authority"]` restores or delivers the slot snapshot | `MarketplaceListing` stores seller, buyer, currency, price, lifecycle timestamps/state, and the full 80-byte source slot. The fee is computed during purchase and is not stored as listing fee state. |
| `nicechunk_chunk` tags `10` and `13`; `nicechunk_smelting` tag `4` | `nicechunk_civilization` tag `3` `execute_rule_receipt` | `CivilizationAdapterAuthority`: `["civilization-adapter", ruleBook]` derived under the target program ID | `ExecutionReceipt` PDA proves target-bound rule execution before target rule state mutates. |

## Account Lifecycle Map

The contract directory now includes an `Account Lifecycle Map` for PDA creation, growth, migration, closure, refund, and sold-state retention. Reviewers should treat account lifecycle as a separate audit surface from instruction dispatch.

| Lifecycle surface | Current behavior | Reviewer check |
| --- | --- | --- |
| PDA creation and selected pre-funded adoption | Core GlobalConfig; Guardian registry/region; Player profile, session, appearance, equipment, and index; ChunkBroken, Chunk PlayerProgress, and FoundationChunk helpers; and Smelting PlayerProgress include paths that can top up a system-owned, zero-data PDA and then `allocate` and `assign` it. Other initializers, including current Market listings, Backpack accounts, Building fixed PDAs, Civilization accounts, Chunk rule tables, and Smelting recipe tables, call `create_account` and do not provide that universal adoption path. | Check the exact initializer before pre-funding. Verify system ownership and zero data where adoption is supported; otherwise pass a fresh PDA and confirm the program-specific creation rule. |
| ChunkBroken growth | `ChunkBrokenState` grows by capacity after rent top-up and `realloc`, with max-capacity checks. | Confirm the record count never exceeds capacity and the account remains rent-exempt at the larger length. |
| FoundationChunk v3 indexing | Each complete land chunk receives one fixed-size v3 record. Incomplete cancellation removes the newest matching records in reverse order before contract release. | Confirm every indexed record matches owner, foundation ID, bounds, and BuildSite; reject legacy v1/v2 records as current land evidence. |
| Player layout upgrade | Player profile, equipment, and appearance accounts can be topped up and reallocated to current lengths. | Compare current account length and owner before trusting decoded profile, equipment, or appearance fields. |
| BuildSite v3 reservation and activation | Creation reserves `chunksX * chunksZ` blank land contracts in MarketUser. The final chunk registration consumes the full reservation; active land cannot be resized or canceled. | Confirm chunk alignment, contract count, available/reserved transitions, registered count, and reverse-order rollback before accepting ownership. |
| Building upload cancellation | Canceling an upload closes program-owned shard accounts and the manifest, returning lamports to the session authority. | Treat canceled upload artifacts as closed transient accounts, not durable building state. |
| PlayerAppearance close | `close_player_appearance` is treasury-authority gated, zeroes data, and returns lamports to the treasury authority recipient. | Confirm the recipient is the treasury authority signer before considering the close valid. |
| Marketplace terminal states | Cancel restores the escrowed Backpack slot and marks the Listing canceled; purchase marks it sold. Both terminal records remain program-owned and decodable while MarketUser decrements the active count. | Distinguish durable canceled/sold evidence from active custody; neither terminal state returns Listing rent. |

## Payload Truth Boundary

The contract directory now includes a `Payload Truth Boundary` map for the user-supplied byte payloads that auditors are most likely to misread as durable facts. Treat payloads as selectors or intent until the matching PDA, hash, recipe, slot, signature, tally, or receipt evidence is re-derived by the program.

| Surface | User-supplied payload | Contract-derived truth | Reviewer check |
| --- | --- | --- | --- |
| Marketplace listing | `CreateListingArgs` is exactly 19 bytes: listing ID, currency, source type, source index, and price. | Market validates owner/profile PDAs, reads the Backpack v4 80-byte source slot, and stores the full slot snapshot inside `MarketplaceListing`. | Do not accept item category, volume, durability, grade, level, or item identity from listing payload copy; compare `source_slot` with Backpack slot rules. |
| Building NCM3 upload | `BeginBuildingArgs` declares expected hash, payload length, revision, rotation, and offsets; shard writes are capped at 700 bytes each. | Finalization requires complete shard PDAs, recomputes `hash_payload_slices`, parses NCM3 dimensions, enforces 256-axis and 4,096-command caps, and checks BuildSite fit. | A visible building is only proven by finalized manifest and BuildSite revision state, not by uploaded bytes alone. |
| Smelting execution | Owner supplies recipe ID, input indexes, fuel indexes, and optional multiplier. | A caller-selected, Smelting-owned `RecipeTable` defines enabled recipe IO and yield; Backpack slots are owner-validated before removal; outputs are appended through SmeltingAuthority. | Verify table ID and stored authority separately: the program does not enforce a canonical table or authority. Then verify slots, volume, yield, disabled recipes, and output evidence. |
| Civilization rules | `PublishRuleBookArgs` stores hash commitments, target program/PDA, threshold, target status, and risk; signatures submit side, power, and snapshot hash. | Rule signatures bind citizen power and snapshot hash; tally rejects duplicate signers and impossible power; execution requires a threshold-met caller-supplied subset and adapter authority where needed. | Reconstruct omitted signatures, note the absent voting window and 1 bps floor, and verify that only Chunk or Smelting implements the target adapter before treating a rule as executable. |
| Player identity and equipment | Names, appearance code, title, equipment slot, and equipment model bytes are human-facing input. | Names are canonicalized into `UsernameIndex`; appearance/model code lengths are bounded; equipment model code is tied to verified Backpack records. | Compare signer, PDA seed, stored hash, model-code limits, and embedded Backpack slot identity. |
| Guardian service payloads | Registration supplies region bounds and an endpoint; proof submission supplies the measured service window; settlement advances the recorded service state. | Guardian derives the region PDA, validates owner/operator roles, and keeps every mutation inside the Guardian program. | Verify region bounds, host bounds, nonzero port, signer role, stake token movement, proof cadence, and the decoded `GuardianRegion`; do not infer land or building ownership from it. |

## Value Settlement Map

The contract directory now includes a `Value Settlement Map` for SOL, NCK, rent funding, refunds, stake deposits, and non-payment state changes. This keeps money movement separate from inventory custody and governance evidence.

| Surface | Value movement | Contract gate | Reviewer check |
| --- | --- | --- | --- |
| Marketplace SOL purchases | Buyer signs SOL transfers to the seller and `MARKET_TREASURY`; the fee is `MARKET_FEE_BPS = 100` over `10,000` bps. | `purchase_listing` validates listing state, seller PDA, treasury address, source slot snapshot, and system program. | Recompute `split_market_payment`, confirm seller proceeds, treasury fee, buyer Backpack delivery, and `ListingAccount::mark_sold`. |
| Marketplace NCK purchases | Buyer NCK token transfers are split between seller and treasury through SPL Token `transfer_checked`. | Token accounts must be SPL Token owned, pinned to `NCK_MINT`, and owned by buyer, seller, or `MARKET_TREASURY` as appropriate. | Confirm mint, decimals, token owners, checked transfer amounts, and sold listing evidence. |
| Guardian registration stake | Registration transfers `GUARDIAN_STAKE_AMOUNT = 100,000,000,000` NCK base units from the owner token account to the treasury-PDA token account. | Registry initialization pins the `guardian-treasury` PDA, treasury token, NCK mint, and SPL Token program. | Verify the owner signer, treasury token owner, adjacency rule, Region PDA, and stake transfer. V1 has no withdrawal or refund instruction; permissionless settlement records a 10% stake penalty for each complete missed proof hour and removes a Region at zero. |
| Rent funding and refunds | Payers fund PDA rent via `create_account`, top-up transfers, or realloc funding; only explicit close paths refund lamports. | Rent is computed from `Rent::minimum_balance(len)` and scoped to the target PDA size. | Distinguish rent from revenue; verify cancel/refund recipients for listing cancel, building upload cancel, and PlayerAppearance close. |
| Non-payment state writes | Mining, smelting, equipment transfer, building proof, and Civilization rule evidence mutate PDA state without moving SOL or NCK. | Program signer PDAs authorize cross-program writes and custody changes. | Classify a path as value movement only when it invokes system transfer, account close/refund, rent funding, or SPL Token `transfer_checked`. |

## Authority & Control Boundary

This map separates checks enforced by the Rust in this checkout from client configuration and external deployment controls. “Source-enforced” below describes the current source only; it is not evidence that a deployed Program account runs the same ELF or that its ProgramData upgrade authority has been closed.

```mermaid
flowchart TB
  subgraph ROOTS["Compile-time and derived roots"]
    source["Checked-in Rust<br/>constants + dispatchers"]
    core["Core tag 0<br/>one-time GlobalConfig write"]
    walletA["Fixed wallet A<br/>development + player/market treasury"]
    walletB["Fixed wallet B<br/>Civilization power authority"]
    source --> core
    source --> walletA
    source --> walletB
  end

  subgraph SESSION["Effective PlayerSession path"]
    owner["Owner wallet"] -->|creates or refreshes| session[(PlayerSession PDA)]
    temporary["Session signer"] -->|co-signs create or refresh| session
    temporary --> guard{"Callee session guard"}
    session --> guard
    guard --> checked["Checked:<br/>signer/profile/config binding<br/>action bit + expiry"]
    session -. stored but not enforced .-> counters["max_actions<br/>action_count"]
    checked --> chunk["Chunk mutations"]
    checked --> backpack["Backpack removals"]
    checked --> building["Building mutations<br/>currently request BREAK_BLOCK"]
  end

  subgraph MUTABLE["Mutable human and PDA roles"]
    anySigner["Any signer"] -->|first initializes unused table ID| table[(RecipeTable PDA)]
    table --> tableAuthority["Stored table authority"]
    tableAuthority -->|upsert or transfer authority| table
    table -->|any valid Smelting-owned table| smelt["execute_smelting<br/>no canonical allowlist"]
    owner -->|update endpoint| region[(GuardianRegion PDA)]
    operator["Guardian region operator"] -->|submit proof| region
    owner -->|Market tag 4<br/>1 NCK each| marketUser[(MarketUser PDA)]
    landPda["Building land-contract PDA"] -->|reserve / consume / release| marketUser
  end

  subgraph GOVERNANCE["Civilization evidence path"]
    walletB --> power["PowerSnapshot + CitizenPower"]
    author["Rule author"] --> rule["RuleBook<br/>threshold 1..10,000 bps<br/>no voting window"]
    voters["Rule signers<br/>agree / reject / abstain / challenge"] --> signatures[(RuleSignature PDAs)]
    finalizer["Any finalizer"] -->|supplies a chosen subset| subset["Counted signatures"]
    signatures --> subset
    rule --> tally[(RuleTally PDA)]
    subset --> tally
    tally --> receipt[(ExecutionReceipt PDA)]
    receipt --> chunkAdapter["Chunk adapter"]
    receipt --> smeltingAdapter["Smelting adapter"]
  end

  subgraph EVIDENCE["Discovery and external evidence"]
    runtimeConfig["public/mainnet.json<br/>client routing/config"] -. client routing .-> logical["Logical module labels<br/>mapped to executable IDs"]
    checkout["Source review"] -. does not establish .-> unknown["Must be verified separately:<br/>deployed ELF + ProgramData authority<br/>client exposure + GitHub rulesets"]
  end

  classDef root fill:#1f2937,stroke:#f5f9ff,color:#f5f9ff
  classDef enforced fill:#10200c,stroke:#8cff00,color:#f5f9ff
  classDef account fill:#0b1724,stroke:#98cbff,color:#f5f9ff
  classDef warning fill:#32180f,stroke:#ffad66,color:#f5f9ff
  classDef evidence fill:#1b1328,stroke:#d0a4ff,color:#f5f9ff
  class source,walletA,walletB,owner,temporary,anySigner,operator,author,voters,finalizer root
  class core,guard,checked,chunk,backpack,building,tableAuthority,smelt,landPda,power,chunkAdapter,smeltingAdapter enforced
  class session,table,region,marketUser,signatures,tally,receipt account
  class counters,rule,subset,unknown warning
  class runtimeConfig,logical,checkout evidence
```

| Boundary | Current source-enforced control | Reviewer consequence |
| --- | --- | --- |
| Core and deployment | Core accepts only initialization tag `0`, writes compiled constants, and exposes no internal admin, pause, or config-update route. Any payer may perform the one-time initialization if the PDA is unused. | Do not call the deployed program immutable from source review alone. Verify the Program account, ELF hash, ProgramData account, and upgrade authority on the target cluster. |
| Player sessions | Owner and session authority sign creation/refresh. Downstream views validate the relevant session-authority/profile identity bindings, the requested action bit, and expiry; Chunk and Building also bind the GlobalConfig. `max_actions` and `action_count` are stored but never enforced or incremented; there is no revoke, close, or maximum-duration path. Building currently asks for `BREAK_BLOCK`, not `PLACE_BLOCK`, on its player-session branches, and Backpack tag `2` accepts a `BREAK_BLOCK` session when removing any selected slot type. | Treat expiry and action mask as the effective limits. Do not describe an action budget, revocation control, placement-specific permission, or resource-only session removal until program logic implements it. |
| Smelting recipes | Any signer can initialize an unused table-ID PDA and becomes its authority; that authority can write recipes or transfer control. Execution accepts any Smelting-owned table containing a matching valid recipe and has no canonical-table allowlist. | A table listed by the client is not uniquely authoritative. Derive its PDA, inspect its stored authority and records, and decide separately which table IDs the protocol intends to trust. |
| Guardian and land roles | Guardian owners/operators manage realtime service state. Land ownership independently uses treasury-funded MarketUser balances, Building's land authority, immutable BuildSite records, and FoundationChunk indexes. Backpack construction-item tag `9` is retired. | Never use Guardian availability as a land/building gate. Discover buildings directly through `FoundationChunk v3 -> BuildSite v3 -> BuildingManifest v3 -> BuildingShard v2`, and verify the complete SHA-256 hash. |
| Civilization | A fixed authority publishes power evidence. A rule author chooses `threshold_bps` from `1` through `10,000`; no voting window is enforced. Any finalizer supplies the signature accounts to count, so reject or challenge signatures can be omitted. Only Chunk and Smelting currently implement target adapters. | Reconstruct the complete signature set independently before accepting a tally, compare omitted sides, and verify the target adapter rather than treating a threshold-met receipt as universal governance execution. |
| Client and repository controls | `public/mainnet.json` supplies client routing/configuration. In the current file, the logical `backpack`, `market`, and `smelting` labels map to one unified executable ID; those labels are not evidence of three independent deployments. This repository currently publishes no GitHub Actions workflow. | Source and config do not prove deployed ELF identity, ProgramData authority, client feature exposure, branch protection, rulesets, required review, or CI enforcement. Collect those facts from chain state, the built client, and GitHub settings for the exact revision. |

The Cargo workspace contains ten program crates: the `nicechunk_game` router plus nine active domain crates. The repository also retains the Civilization source as an independently reviewable reference outside the current Cargo workspace. None defines a custom `msg!`, `sol_log`, `emit!`, or event structure. Durable accounts, transaction history, CPI traces, and SOL/SPL transfers are therefore the audit evidence; do not describe an application event stream that the current programs do not emit.

## Building Program

`nicechunk_building` is present in source and referenced by the current client devnet configuration; that configuration is not deployment proof. Its current source validates player sessions, reserves one treasury-issued contract for each selected chunk, creates immutable BuildSite v3 land, registers chunk indexes, consumes the reservation only after final indexing, rolls incomplete indexing back in reverse order, stages NCM3 payload shards, and finalizes building manifests after hash and fit checks. Guardian connectivity is not part of this path.

Important account groups:

| Account | Seeds | Size |
| --- | --- | --- |
| `MarketUser` | `["market-user-v1", owner]` | 64 bytes; active listings plus available and reserved contract balances |
| `BuildSite` | `["build-site-v3", globalConfig, foundationId:u64_le]` | 160 bytes; one immutable chunk-aligned land record |
| `BuildingManifest` | `["building-v3", globalConfig, foundationId:u64_le, revision:u32_le]` | 160 bytes |
| `BuildingShard` | `["building-data-v2", globalConfig, foundationId:u64_le, revision:u32_le, shardIndex:u8]` | 64-byte header plus payload, up to 8,256 bytes |

The browser decoder in `contracts/contracts.js` can inspect `BuildSite`, `BuildingManifest`, and `BuildingShard` accounts from RPC alongside the other known PDA groups.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | Rust workspace for the included Solana programs. |
| `programs/` | On-chain Rust program source. |
| `sdk/` | TypeScript helpers for deriving accounts and building instructions. |
| `scripts/` | Contract operation scripts for config, player init, mining, Guardian registry, smelting rules, and civilization settlement. |
| `tests/` | Focused contract and rule tests. |
| `contracts/` | Browser contract directory, account decoders, source panels, and localized copy. |
| `public/mainnet.json` | Runtime chain configuration consumed by the contract directory and client surfaces. |
| `public/contracts/locales/` | Built locale payloads for the hosted contract directory. |
| `public/rules/smelting-rules.json` | Current smelting rule payload mirrored into the contract split. |
| `civilization/` and `chunk.js/` | Runtime rule helpers needed by contract tests and synchronization scripts. |

## Public Chain Configuration

`public/mainnet.json` is a client routing and runtime-configuration snapshot used by NiceChunk web surfaces. The contract directory reads it to show the configured cluster, logical program routes, and smelting-table references. It is not an on-chain authorization source, deployment receipt, or proof that an omitted path is disabled. The file currently includes the Building program ID:

```text
39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx
```

The current `chain.programs` map uses one executable ID for the logical `backpack`, `market`, and `smelting` module labels. Review those labels as instruction-routing namespaces for the unified executable, not as proof of three independently deployed programs; standalone crate IDs and conditional program constants in source must be reconciled with the exact built ELF and target-cluster Program accounts.

Keep this file synchronized whenever intended program routes, recipe-table routing, or public runtime defaults change, then verify those claims against chain state and the built client.

## Contract Directory

The `contracts/` page imports real Rust and SDK source files with Vite raw imports. It is intended to be a practical source browser for frontend developers, auditors, and contributors:

- Program panels show role, status, program ID, instruction list, PDA seeds, account layouts, and notes.
- Source tabs link each program to `Cargo.toml`, `lib.rs`, `state.rs`, errors, cluster config, and SDK files where available.
- The RPC browser decodes known PDA layouts, including player sessions, chunk state, resource tables, 256-byte GuardianRegion V1 accounts, backpacks, smelting recipes, market listings, civilization records, and current Building records. BuildSite discovery accepts only the 160-byte v3 Building layout.

## Validation

Install the exact dependency graph:

```bash
npm ci
```

Run the local release-equivalent gate:

```bash
npm run validate:release
```

`validate:release` runs dependency audit, license audit, TypeScript typechecking, focused contract tests, and the production Vite build for the contract directory.

When a Rust toolchain is available, also check the workspace:

```bash
cargo check --workspace --locked
cargo test --workspace --locked
```

Some operation scripts require real Solana RPC, wallet, mint, or treasury configuration. Do not commit private keys, wallet files, `.env` files, deployment-only machine config, or generated build artifacts.

## Maintenance Notes

This repository is generated as a focused split from the main NiceChunk working tree. Changes should stay aligned with the real program source, SDK helpers, public configuration, rule data, and contract directory copy. When a program ID, account layout, PDA seed, instruction discriminator, or SDK helper changes, update the matching Rust source, SDK file, browser decoder, locale text, and focused tests together.
