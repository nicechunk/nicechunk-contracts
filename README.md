# NiceChunk Contracts

![NiceChunk Contracts overview](docs/screenshots/overview.png)

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
| `nicechunk_chunk` | Chunk state, generated block verification, broken block records, resource drop tables, and surface decoration tables. |
| `nicechunk_game` | Game routing layer for shared program integration. |
| `nicechunk_guardian` | Guardian registry, endpoint operations, proof state, operator rotation, and blueprint metadata. |
| `nicechunk_backpack` | Backpack and inventory records used by gameplay and item custody flows. |
| `nicechunk_market` | Marketplace listing state and listing lifecycle instructions. |
| `nicechunk_smelting` | Smelting recipe tables, rule synchronization, and recipe retirement tests. |
| `nicechunk_civilization` | Civilization rule books, signatures, tallies, execution receipts, value snapshots, and citizen power. |
| `nicechunk_building` | Player build sites, NCM3 building manifests, upload shards, resize flow, legacy migration, and Guardian blueprint publishing. |

## Contract Logic Map

The contract surface is easiest to read as a set of trust boundaries and evidence accounts rather than a linear transaction list:

```mermaid
flowchart LR
  wallet["Player wallet<br/>owner signer"] --> playerGate["Player Program<br/>profile + session guard"]
  session["Session authority<br/>ephemeral signer"] --> playerGate
  core["Genesis Core<br/>GlobalConfig anchor"] --> playerGate
  core --> chunkGate["Chunk Program<br/>world mutation gate"]
  core --> buildingGate["Building Program<br/>foundation + NCM3 manifest gate"]
  core --> backpackGate["Backpack Program<br/>inventory custody gate"]

  playerGate --> profile[(PlayerProfile PDA)]
  playerGate --> sessionPda[(PlayerSession PDA)]
  chunkGate --> broken[(ChunkBrokenState PDA)]
  chunkGate --> drops[(ResourceDropTable PDA)]

  buildingGate --> site[(BuildSite PDA)]
  buildingGate --> manifest[(BuildingManifest PDA)]
  buildingGate --> shards[(BuildingShard PDA)]
  buildingGate --> blueprint[Guardian blueprint authority]
  blueprint --> guardian[(GuardianRegion PDA)]

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
  class profile,sessionPda,broken,drops,site,manifest,shards,guardian,backpack,recipes,listing,rules,tally,receipt pda
  class civilizationGate,blueprint proof
```

The hosted contract directory expands this map into the visual `Contract Logic Atlas`, with account layouts, PDA seeds, source panels, and RPC decoders for the active devnet surface.

## Reviewer Audit Matrix

External review should tie each contract claim to an authority gate, a public evidence account, and a current runtime boundary:

| Surface | Authority gate | Public evidence | Current boundary |
| --- | --- | --- | --- |
| Genesis Core | `GlobalConfig` is initialized from generated genesis constants and then read by clients. | World seed, config hashes, NCK mint, chunk dimensions, Guardian parameters. | Core does not mint items, mutate terrain, update inventory, or execute governance. |
| Player Identity | Owner wallet and bounded session authority control profile and repeated action submission. | `PlayerProfile`, `PlayerSession`, appearance, and equipment PDA records. | Browser cached wallet addresses are not proof of control; signatures and PDA ownership are. |
| Chunk / Mining | Chunk logic recomputes the generated block from `GlobalConfig` and rejects invalid or already broken targets. | `ChunkBrokenState`, `ResourceDropTable`, surface decoration table, packed local block records. | The program stores sparse mutations, not full terrain; inventory settlement is separate. |
| Building | Valid `PlayerSession` and matching `PlayerProfile` gate BuildSite changes, upload shards, resize, and finalization. | `BuildSite`, `BuildingManifest`, `BuildingShard`, chunk authority PDA, Guardian blueprint authority PDA. | A manifest only becomes active after shard completeness, hash, and fit checks pass. |
| Guardian Registry | Treasury governance, region owner, and operator roles constrain endpoint and proof updates. | `GuardianRegistry` and `GuardianRegion` owner, operator, endpoint, stake, proof, and blueprint fields. | Guardian records do not sign for players or custody player wallets. |
| Backpack Inventory | Owner and authorized program signers control slot creation, removal, and delivery. | `Backpack` item count, fixed slot payloads, coordinates, material or item identity, durability. | Smelting and Marketplace must use explicit authority paths to mutate slots. |
| Smelting Recipes | Recipe authority maintains bounded tables; smelting authority mutates Backpack slots after validation. | `RecipeTable`, recipe IDs, heat tiers, input/output volumes, disabled recipe flags. | Retired recipes remain explicit disabled records so identities do not silently shift. |
| Marketplace | Seller signatures and market authority gate escrow, cancel, settlement, and delivery. | `MarketplaceListing`, seller, buyer, currency, price, escrowed slot bytes, settlement state. | The listing PDA is the custody record; it does not prove a private orderbook. |
| Civilization Rules | Rule targets, citizen signatures, power snapshots, tallies, and receipts are separate records. | `RuleBook`, `RuleSignature`, `RuleTally`, `ExecutionReceipt`, `PowerSnapshot`, `CitizenPower`. | Governance is documented and decodable, but live submission remains gated until runtime config enables it. |

## PDA Seed Evidence

The contract directory now includes a `PDA Seed Evidence` graph built from the Rust and SDK seed constants. The most review-sensitive seeds are:

| Evidence family | Seeds | Why it matters |
| --- | --- | --- |
| World anchor | `GlobalConfig`: `["global-config"]` | Every world proof, chunk write, rule table, and client runtime check should point back to the same public configuration anchor. |
| Chunk deltas | `ChunkBrokenState`: `["chunk-broken", globalConfig, chunkX:i32_le, chunkZ:i32_le]`; `FoundationChunk`: `["foundation-chunk", globalConfig, chunkX:i32_le, chunkZ:i32_le]` | Mining records and foundation occupancy remain sparse, chunk-scoped evidence rather than a private terrain database. |
| Rule tables | `ResourceDropTable`: `["resource-drops-v2", globalConfig]`; `SurfaceDecorationTable`: `["surface-decor-v1", globalConfig]` | The active resource-drop seed is `resource-drops-v2`; it is scoped by `GlobalConfig` and does not include a table ID. |
| Identity and inventory | `PlayerProfile`: `["player-v7", owner]`; `PlayerSession`: `["session", owner, sessionAuthority]`; `Backpack`: `["backpack", creator, backpackId:u64_le]` | Ownership, short-lived action authority, and item custody are separate PDA families. |
| Program signer boundaries | `ChunkAuthority`: `["chunk-authority-v1", globalConfig]`; `GuardianBlueprintAuthority`: `["guardian-blueprint", globalConfig]`; `SmeltingAuthority`: `["smelting-authority"]`; `MarketplaceAuthority`: `["market-authority"]` | Cross-program writes must use explicit PDA signers instead of implicit server trust. |
| Building publication | `BuildSite`: `["build-site-v1", globalConfig, foundationId:u64_le]`; `BuildingManifest`: `["building-v2", globalConfig, foundationId:u64_le, revision:u32_le]`; `BuildingShard`: `["building-data-v1", globalConfig, foundationId:u64_le, revision:u32_le, shardIndex:u8]` | A visible building is tied to a validated footprint, manifest hash, shard bitmap, and revision. |
| Governance proof | `RuleBook`, `RuleSignature`, `RuleTally`, `ExecutionReceipt`, `PowerSnapshot`, and `CitizenPower` seeds | Civilization proposals, signatures, power, tallies, and receipts stay independently decodable before live submission is enabled. |

## Instruction Surface Map

The contract directory now includes an `Instruction Surface Map` generated from the current Rust `process_instruction` dispatchers. It is meant to catch stale SDK assumptions, especially retired or intentionally disabled discriminators.

| Program | Accepted tags | Disabled or unassigned tags | Audit note |
| --- | --- | --- | --- |
| `nicechunk_core` | Exact payload `[0]` for `initialize_global_config` | Any other payload | Core is a one-time genesis anchor, not a general admin router. |
| `nicechunk_player` | `0-15` | Any tag above `15` | Identity, session authority, appearance, invite indexes, equipment, transfer, swap, and durability paths are all explicit branches. |
| `nicechunk_chunk` | `5`, `6`, `7`, `8`, `9`, `10`, `11`, `12`, `13`, `15`, `20`, `21` | Legacy `0-4` are not accepted | Current world writes center on generated mining checks, rule tables, Civilization receipts, and Building chunk registration. |
| `nicechunk_building` | `0-8` | Any tag above `8` | BuildSite lifecycle, NCM3 shard upload/finalization, legacy migration, resize, and Guardian blueprint publishing are covered. |
| `nicechunk_guardian` | `0`, `1`, `2`, `5`, `6`, `8` | Retired `3` and `4` are rejected | `submit_guardian_proof` and `settle_guardian` are not live dispatcher entries in the current program. |
| `nicechunk_backpack` | `0-6`, `8-11` | `7` returns `UnverifiedForgeInstructionDisabled` | Inventory custody is owner or program-signer gated; the unverified legacy forge path stays visibly disabled. |
| `nicechunk_smelting` | `0-4` | Any tag above `4` | Recipe authority, execution, authority transfer, and Civilization recipe receipt application are all present. |
| `nicechunk_market` | `0`, `1`, `2` | `3` is an invalid legacy `initialize_asset` path | Listings escrow the full Backpack slot snapshot; user payload does not mint arbitrary item fields. |
| `nicechunk_civilization` | `0-5` | Any tag above `5` | Rule books, signatures, tallies, receipts, power snapshots, and citizen power remain decodable while runtime submission is gated. |

## CPI Authority Ledger

The hosted contract directory also includes a `CPI Authority Ledger` for game-facing cross-program writes. It traces the current Rust `invoke` and `invoke_signed` sites by caller branch, callee tag, signer PDA, and durable evidence account.

| Caller branch | Callee tag | Signer boundary | Durable evidence |
| --- | --- | --- | --- |
| `nicechunk_building` tag `1` `register_build_site_chunks` | `nicechunk_chunk` tag `15` `register_build_site_chunk` | `ChunkAuthority`: `["chunk-authority-v1", globalConfig]` derived under the Building program and re-derived by Chunk | `FoundationChunk` PDA stores chunk-scoped foundation occupancy. |
| `nicechunk_building` tag `8` `publish_guardian_blueprint` | `nicechunk_guardian` tag `6` `update_guardian_blueprint` | `GuardianBlueprintAuthority`: `["guardian-blueprint", globalConfig]` | `GuardianRegion` blueprint hash, revision, and record count. |
| `nicechunk_chunk` mining tags `5`, `8`, `9`, `20`, `21` | `nicechunk_backpack` tags `1` and `6` | `ChunkBrokenState` PDA signs mined-resource delivery for the exact chunk coordinates | Backpack v3 resource slots with block coordinates, volume, and metadata. |
| `nicechunk_player` tag `13` `transfer_equipment_slot` | `nicechunk_backpack` tags `10` and `11` | `EquipmentTransferAuthority`: `["equipment-transfer-v1"]` under the Player program | `PlayerEquipment` and Backpack slots stay synchronized without arbitrary item minting. |
| `nicechunk_smelting` tag `2` `execute_smelting` | `nicechunk_backpack` tags `4` and `5` | Owner signer removes inputs; `SmeltingAuthority`: `["smelting-authority"]` appends validated outputs | Backpack slots and `RecipeTable` records show recipe IO and output identity. |
| `nicechunk_market` tags `0`, `1`, `2` | `nicechunk_backpack` tags `2` and `3`; `nicechunk_player` tag `2` when clearing display equipment | Seller signer removes or clears; `MarketAuthority`: `["market-authority"]` restores or delivers the slot snapshot | `MarketplaceListing` stores seller, buyer, currency, price, fee state, and the full 80-byte source slot. |
| `nicechunk_chunk` tags `10` and `13`; `nicechunk_smelting` tag `4` | `nicechunk_civilization` tag `3` `execute_rule_receipt` | `CivilizationAdapterAuthority`: `["civilization-adapter", ruleBook]` derived under the target program ID | `ExecutionReceipt` PDA proves target-bound rule execution before target rule state mutates. |

## Account Lifecycle Map

The contract directory now includes an `Account Lifecycle Map` for PDA creation, growth, migration, closure, refund, and sold-state retention. Reviewers should treat account lifecycle as a separate audit surface from instruction dispatch.

| Lifecycle surface | Current behavior | Reviewer check |
| --- | --- | --- |
| Rent-safe PDA creation | Empty PDAs are created with `create_account`; pre-funded PDAs are topped up to rent exemption, then `allocate` and `assign` are signed by the derived PDA seeds. | Verify seed family, bump, owner program, data length, and magic/version bytes after initialization. |
| ChunkBroken growth | `ChunkBrokenState` grows by capacity after rent top-up and `realloc`, with max-capacity checks. | Confirm the record count never exceeds capacity and the account remains rent-exempt at the larger length. |
| FoundationChunk migration | Legacy FoundationChunk records are decoded, converted to v2 records, optionally filtered by a replacement, and re-packed after `realloc`. | Confirm old occupancy evidence survives v1 to v2 migration and replacement only removes superseded records. |
| Player layout upgrade | Player profile, equipment, and appearance accounts can be topped up and reallocated to current lengths. | Compare current account length and owner before trusting decoded profile, equipment, or appearance fields. |
| Building legacy migration and resize | Legacy 136-byte BuildSites are decoded from the Chunk-owned PDA and re-packed into Building-owned BuildSite v2; resize stores staged dimensions and waits for chunk indexing. | Confirm owner, GlobalConfig, foundation ID, footprint, active/pending revision, and registered chunk counters. |
| Building upload cancellation | Canceling an upload closes program-owned shard accounts and the manifest, returning lamports to the session authority. | Treat canceled upload artifacts as closed transient accounts, not durable building state. |
| PlayerAppearance close | `close_player_appearance` is treasury-authority gated, zeroes data, and returns lamports to the treasury authority recipient. | Confirm the recipient is the treasury authority signer before considering the close valid. |
| Marketplace terminal states | Cancel restores the escrowed Backpack slot, zeroes listing data, and refunds listing lamports to the seller; purchase marks the Listing sold and keeps it as settlement evidence. | Distinguish canceled-and-closed listings from sold listings that intentionally remain decodable. |

## Payload Truth Boundary

The contract directory now includes a `Payload Truth Boundary` map for the user-supplied byte payloads that auditors are most likely to misread as durable facts. Treat payloads as selectors or intent until the matching PDA, hash, recipe, slot, signature, tally, or receipt evidence is re-derived by the program.

| Surface | User-supplied payload | Contract-derived truth | Reviewer check |
| --- | --- | --- | --- |
| Marketplace listing | `CreateListingArgs` is exactly 19 bytes: listing ID, currency, source type, source index, and price. | Market validates owner/profile PDAs, reads the Backpack v3 80-byte source slot, and stores the full slot snapshot inside `MarketplaceListing`. | Do not accept item category, volume, durability, grade, level, or item identity from listing payload copy; compare `source_slot` with Backpack slot rules. |
| Building NCM3 upload | `BeginBuildingArgs` declares expected hash, payload length, revision, rotation, and offsets; shard writes are capped at 700 bytes each. | Finalization requires complete shard PDAs, recomputes `hash_payload_slices`, parses NCM3 dimensions, enforces 256-axis and 4,096-command caps, and checks BuildSite fit. | A visible building is only proven by finalized manifest and BuildSite revision state, not by uploaded bytes alone. |
| Smelting execution | Owner supplies recipe ID, input indexes, fuel indexes, and optional multiplier. | `RecipeTable` defines enabled recipe IO and yield; Backpack slots are owner-validated before removal; outputs are normalized through SmeltingAuthority. | Verify selected slot records, recipe input volume, yield math, disabled recipes, and output Backpack evidence. |
| Civilization rules | `PublishRuleBookArgs` stores hash commitments, target program/PDA, threshold, target status, and risk; signatures submit side, power, and snapshot hash. | Rule signatures bind citizen power and snapshot hash; tally rejects duplicate signers and impossible power; execution requires threshold-met tally and adapter authority where needed. | Check RuleBook, RuleSignature, RuleTally, and ExecutionReceipt separately before treating a rule as executable. |
| Player identity and equipment | Names, appearance code, title, equipment slot, and equipment model bytes are human-facing input. | Names are canonicalized into `UsernameIndex`; appearance/model code lengths are bounded; equipment model code is tied to verified Backpack records. | Compare signer, PDA seed, stored hash, model-code limits, and embedded Backpack slot identity. |
| Guardian endpoint and blueprint | Endpoint payload carries host, port, TLS flag; blueprint payload carries region, hash, revision, and record count. | Endpoint updates require the region operator; blueprint updates require the Building-derived `guardian-blueprint` PDA authority. | Verify host bounds, port nonzero, role authority, region PDA, blueprint revision monotonicity, and decoded `GuardianRegion`. |

## Value Settlement Map

The contract directory now includes a `Value Settlement Map` for SOL, NCK, rent funding, refunds, stake deposits, and non-payment state changes. This keeps money movement separate from inventory custody and governance evidence.

| Surface | Value movement | Contract gate | Reviewer check |
| --- | --- | --- | --- |
| Marketplace SOL purchases | Buyer signs SOL transfers to the seller and `MARKET_TREASURY`; the fee is `MARKET_FEE_BPS = 100` over `10,000` bps. | `purchase_listing` validates listing state, seller PDA, treasury address, source slot snapshot, and system program. | Recompute `split_market_payment`, confirm seller proceeds, treasury fee, buyer Backpack delivery, and `ListingAccount::mark_sold`. |
| Marketplace NCK purchases | Buyer NCK token transfers are split between seller and treasury through SPL Token `transfer_checked`. | Token accounts must be SPL Token owned, pinned to `NCK_MINT`, and owned by buyer, seller, or `MARKET_TREASURY` as appropriate. | Confirm mint, decimals, token owners, checked transfer amounts, and sold listing evidence. |
| Guardian registration stake | Registration transfers `GUARDIAN_STAKE_AMOUNT = 100,000,000,000` NCK units from operator token account to the treasury PDA token account. | Registry initialization pins `GUARDIAN_TREASURY_WALLET`, `guardian-treasury` PDA, treasury token, NCK mint, and SPL Token program. | Verify operator signer, treasury token owner, adjacency rule, region PDA, stake transfer, and that V2 has no live slash instruction path. |
| Rent funding and refunds | Payers fund PDA rent via `create_account`, top-up transfers, or realloc funding; only explicit close paths refund lamports. | Rent is computed from `Rent::minimum_balance(len)` and scoped to the target PDA size. | Distinguish rent from revenue; verify cancel/refund recipients for listing cancel, building upload cancel, and PlayerAppearance close. |
| Non-payment state writes | Mining, smelting, equipment transfer, building proof, and Civilization rule evidence mutate PDA state without moving SOL or NCK. | Program signer PDAs authorize cross-program writes and custody changes. | Classify a path as value movement only when it invokes system transfer, account close/refund, rent funding, or SPL Token `transfer_checked`. |

## Building Program

`nicechunk_building` is part of the active devnet contract surface. It validates player sessions, creates and resizes foundation build sites, registers occupied chunks through the chunk authority PDA, stages NCM3 payload shards, finalizes building manifests after hash and fit checks, and publishes Guardian blueprint summaries through a program-derived authority.

Important account groups:

| Account | Seeds | Size |
| --- | --- | --- |
| `BuildSite` | `["build-site-v1", globalConfig, foundationId:u64_le]` | 160 bytes, with 136-byte legacy decode support |
| `BuildingManifest` | `["building-v2", globalConfig, foundationId:u64_le, revision:u32_le]` | 160 bytes |
| `BuildingShard` | `["building-data-v1", globalConfig, foundationId:u64_le, revision:u32_le, shardIndex:u8]` | 64-byte header plus payload, up to 8,256 bytes |
| `GuardianBlueprintAuthority` | `["guardian-blueprint", globalConfig]` | PDA signer only |

The browser decoder in `contracts/contracts.js` can inspect `BuildSite`, `BuildingManifest`, and `BuildingShard` accounts from RPC alongside the other known PDA groups.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | Rust workspace for the included Solana programs. |
| `programs/` | On-chain Rust program source. |
| `sdk/` | TypeScript helpers for deriving accounts and building instructions. |
| `scripts/` | Contract operation scripts for config, player init, mining, Guardian registry, building blueprints, smelting rules, and civilization settlement. |
| `tests/` | Focused contract and rule tests. |
| `contracts/` | Browser contract directory, account decoders, source panels, and localized copy. |
| `public/mainnet.json` | Runtime chain configuration consumed by the contract directory and client surfaces. |
| `public/contracts/locales/` | Built locale payloads for the hosted contract directory. |
| `public/rules/smelting-rules.json` | Current smelting rule payload mirrored into the contract split. |
| `civilization/` and `chunk.js/` | Runtime rule helpers needed by contract tests and synchronization scripts. |

## Public Chain Configuration

`public/mainnet.json` is the current runtime configuration snapshot used by NiceChunk web surfaces. The contract directory reads it to show the configured cluster, RPC settings, token addresses, and program IDs. The file currently includes the Building program ID:

```text
39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx
```

Keep this file synchronized whenever deployed program IDs, token accounts, or public RPC defaults change.

## Contract Directory

The `contracts/` page imports real Rust and SDK source files with Vite raw imports. It is intended to be a practical source browser for frontend developers, auditors, and contributors:

- Program panels show role, status, program ID, instruction list, PDA seeds, account layouts, and notes.
- Source tabs link each program to `Cargo.toml`, `lib.rs`, `state.rs`, errors, cluster config, and SDK files where available.
- The RPC browser decodes known PDA layouts, including player sessions, chunk state, resource tables, Guardian regions, backpacks, smelting recipes, market listings, civilization records, and building records.

## Validation

Install the exact dependency graph:

```bash
npm ci
```

Run the local release-equivalent gate:

```bash
npm run validate:release
```

`validate:release` runs dependency audit, license audit, focused TypeScript contract tests, and the production Vite build for the contract directory.

When a Rust toolchain is available, also check the workspace:

```bash
cargo check --workspace
```

Some operation scripts require real Solana RPC, wallet, mint, or treasury configuration. Do not commit private keys, wallet files, `.env` files, deployment-only machine config, or generated build artifacts.

## Maintenance Notes

This repository is generated as a focused split from the main NiceChunk working tree. Changes should stay aligned with the real program source, SDK helpers, public configuration, rule data, and contract directory copy. When a program ID, account layout, PDA seed, instruction discriminator, or SDK helper changes, update the matching Rust source, SDK file, browser decoder, locale text, and focused tests together.
