# nicechunk-contracts Changelog

All notable public changes for this split repository should be recorded here.

This repository is generated from the main NiceChunk working tree. Make source changes in the main tree, regenerate the split repositories, then commit and push this split separately.

## Release Note Rules

- Use English for public GitHub changelog entries and release notes.
- Reference the main-tree commit and this split repository commit.
- List validation commands that were run for this split or its source surface.
- Do not include private server addresses, credentials, deployment-only scripts, raw production logs, wallet secrets, or unreleased private infrastructure details.
- Mark manual release gates as deferred unless evidence exists for the exact commit under review.

## Unreleased

### Split Scope

NiceChunk contract directory and source browser.

### Added

- Added the unified `nicechunk_game` router to the documented and tested instruction surface. Its wire format is `[namespace, childTag, childPayload...]` with namespaces 1 Backpack, 2 Chunk, 3 Smelting, and 4 Market; the incoming Game program ID governs PDA derivation in routed child processors.
- Added source-backed authority, PDA-seed, CPI, account-lifecycle, payload-truth, value-settlement, and logging-evidence maps for the ten workspace program crates: one router plus nine domain crates.
- Added router, cluster-feature, Guardian layout, dependency-policy, smelting-retirement, and contract behavior regression coverage.

### Changed

- Runtime program selection now prefers aliases in `public/mainnet.json` and describes those values as client routing configuration rather than proof of deployed binaries or upgrade authority.
- Contract navigation, responsive diagrams, program-detail wrapping, keyboard listbox behavior, mobile menu focus restoration, locale fallback, and stale-request protection were tightened across the directory UI.
- The Game crate forwards exactly one selected cluster feature to each routed child crate and rejects missing or conflicting cluster features at compile time.
- The npm manifest is split-specific: runtime dependencies are limited to Solana Web3, SPL Token, Buffer, and TweetNaCl, with only the development tools used by typecheck, tests, audits, and Vite builds. AVR, Three.js, direct bs58, and Playwright entries are not carried into this split.
- Dependency advisory exceptions are checked against an exact recursive advisory graph and fail closed when the observed graph or declared policy differs.

### Fixed

- Corrected GuardianRegistry counter offsets so active-count updates no longer overwrite total registrations or genesis fields, with a packed-layout regression test.
- Corrected contract documentation that previously treated Chunk tag 5 as a Backpack reward CPI, described a stored Marketplace fee field, generalized pre-funded PDA adoption, or treated every CPI as using the same PDA signer model.
- Routed 160-byte BuildSite scans to the Building program and deployed 136-byte legacy BuildSite scans to the Chunk program, with one BuildSite control on each owning program panel.
- Kept the closed mobile navigation inert and hidden from assistive technology when a desktop viewport narrows across the mobile breakpoint.
- Resolved Buffer imports through the declared browser polyfill so Solana Web3 and account decoders do not hit Vite's externalized Node builtin in development.


### Current Status

- Generated from the main NiceChunk working tree.
- Apache-2.0 license metadata is included in `LICENSE`, `NOTICE`, and `docs/license-status.md`.
- CI workflow publication is documented in `docs/ci-workflow-spec.md` and remains pending credentials with `workflow` scope.

### Source Anchors

- Main-tree working-tree base: `012c91571057fa8b244114a9fd6aba708f15fe9b`
- Split repository baseline: `e3ad376d163b9257d14111fd31f0bc20a05db3ae`
- Split publication commit: record the resulting `main` commit after validation; do not substitute the baseline SHA.

### Release Evidence Checklist

Before publishing a release note for this split, cite the commands that apply to this repository:

~~~bash
npm ci
npm run validate:release
# Rust workspace checks when cargo is installed:
cargo check --workspace --locked
cargo test --workspace --locked
cargo check -p nicechunk_game --locked --no-default-features --features devnet
cargo check -p nicechunk_game --locked --no-default-features --features testnet
cargo check -p nicechunk_game --locked --no-default-features --features mainnet
~~~

If a listed command is deferred because a local toolchain is unavailable, record that explicitly with the exact missing command or binary.

### Evidence Recorded for This Preparation

- `node --check scripts/split-github-repos.mjs`, `node --check scripts/update-split-readmes.mjs`, and `node --check scripts/audit-licenses.mjs`: passed on 2026-07-21.
- `git diff --check`: passed on 2026-07-21 after the final split regeneration.
- The generated npm dependency closure was checked to contain the four declared runtime dependencies, exclude the unused direct AVR, Three.js, bs58, and Playwright entries, and contain no unreviewed license outside the tracked Solana/tooling exceptions.
- `npm ci`: passed on 2026-07-21 and installed the 212-package lockfile closure. npm reported five moderate and three high advisories; all eight matched the exact reviewed Solana dependency graph and no unexpected advisory path was accepted.
- `npm run validate:release`: passed on 2026-07-21, including the dependency policy, license audit, TypeScript typecheck, 73 focused tests, and the production Vite build.
- All listed Cargo checks: deferred because the `cargo` binary is unavailable in the current review environment. This is a deferral, not a passing result.
