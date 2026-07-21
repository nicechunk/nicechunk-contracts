import { PublicKey, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  CIVILIZATION_SIDE_AGREE,
  CIVILIZATION_SIDE_REJECT,
  civilizationRequiredPower,
  civilizationThresholdMet,
  CITIZEN_POWER_LEN,
  CITIZEN_POWER_MAGIC,
  createPublishPowerSnapshotInstruction,
  createExecuteCivilizationRuleReceiptInstruction,
  createFinalizeCivilizationRuleInstruction,
  createPublishCivilizationRuleInstruction,
  createSettleCitizenPowerInstruction,
  createSignCivilizationRuleInstruction,
  decodeCitizenPower,
  decodeExecutionReceipt,
  decodePowerSnapshot,
  decodeRuleBook,
  decodeRuleSignature,
  decodeRuleTally,
  deriveCitizenPowerPda,
  deriveCivilizationAdapterAuthorityPda,
  deriveExecutionReceiptPda,
  derivePowerSnapshotPda,
  deriveRuleBookPda,
  deriveRuleSignaturePda,
  deriveRuleTallyPda,
  hash32,
  NICECHUNK_CIVILIZATION_PROGRAM_ID,
  NICECHUNK_CIVILIZATION_POWER_AUTHORITY,
  POWER_SNAPSHOT_LEN,
  POWER_SNAPSHOT_MAGIC,
  EXECUTION_RECEIPT_LEN,
  EXECUTION_RECEIPT_MAGIC,
  RULE_BOOK_LEN,
  RULE_BOOK_MAGIC,
  RULE_SIGNATURE_LEN,
  RULE_SIGNATURE_MAGIC,
  RULE_STATUS_EXECUTED,
  RULE_TALLY_LEN,
  RULE_TALLY_MAGIC,
} from "../sdk/nicechunk-civilization.ts";

describe("nicechunk civilization SDK", () => {
  const payer = new PublicKey("9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud");
  const signer = new PublicKey("Z2WsAfHEgNiycsaKoSo83TzVzGnc6nLB1CkEKN9vymw");
  const targetProgram = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
  const targetPda = new PublicKey("E8CtkK8VQHExofe83isN2KDQdUuSWjw7JhgpT9NVeCQG");
  const ruleIdHash = "sha256:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const textHash = "sha256:111102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const patchHash = "sha256:222102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const snapshotHash = "sha256:333102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

  it("derives deterministic civilization PDAs", () => {
    const [ruleBook] = deriveRuleBookPda({ ruleIdHash });
    const [signature] = deriveRuleSignaturePda({ ruleBook, signer });
    const [tally] = deriveRuleTallyPda({ ruleBook });
    const [receipt] = deriveExecutionReceiptPda({ ruleBook });
    const [adapterAuthority] = deriveCivilizationAdapterAuthorityPda({ ruleBook, targetProgram });
    const [powerSnapshot] = derivePowerSnapshotPda({ snapshotHash });
    const [citizenPower] = deriveCitizenPowerPda({ powerSnapshot, citizen: signer });

    assert.equal(ruleBook.toBase58(), deriveRuleBookPda({ ruleIdHash })[0].toBase58());
    assert.equal(signature.toBase58(), deriveRuleSignaturePda({ ruleBook, signer })[0].toBase58());
    assert.equal(tally.toBase58(), deriveRuleTallyPda({ ruleBook })[0].toBase58());
    assert.equal(receipt.toBase58(), deriveExecutionReceiptPda({ ruleBook })[0].toBase58());
    assert.equal(adapterAuthority.toBase58(), deriveCivilizationAdapterAuthorityPda({ ruleBook, targetProgram })[0].toBase58());
    assert.equal(powerSnapshot.toBase58(), derivePowerSnapshotPda({ snapshotHash })[0].toBase58());
    assert.equal(citizenPower.toBase58(), deriveCitizenPowerPda({ powerSnapshot, citizen: signer })[0].toBase58());
  });

  it("builds publish, sign, finalize, and execute receipt instructions", () => {
    const [ruleBook] = deriveRuleBookPda({ ruleIdHash });
    const [signature] = deriveRuleSignaturePda({ ruleBook, signer });
    const [tally] = deriveRuleTallyPda({ ruleBook });
    const [receipt] = deriveExecutionReceiptPda({ ruleBook });
    const [adapterAuthority] = deriveCivilizationAdapterAuthorityPda({ ruleBook, targetProgram });
    const [powerSnapshot] = derivePowerSnapshotPda({ snapshotHash });
    const [citizenPower] = deriveCitizenPowerPda({ powerSnapshot, citizen: signer });

    const snapshot = createPublishPowerSnapshotInstruction({
      authority: payer,
      snapshotHash,
      totalActivePower: 2_000_000,
      windowStartEpoch: 100,
      windowEndEpoch: 127,
      expiresAt: 1_800_000_000,
    });
    assert.equal(snapshot.data.readUInt8(0), 4);
    assert.equal(snapshot.keys[1].pubkey.toBase58(), powerSnapshot.toBase58());

    const citizen = createSettleCitizenPowerInstruction({
      authority: payer,
      powerSnapshot,
      citizen: signer,
      power: 1_200_000,
    });
    assert.equal(citizen.data.readUInt8(0), 5);
    assert.equal(citizen.data.readBigUInt64LE(1), 1_200_000n);
    assert.equal(citizen.keys[2].pubkey.toBase58(), citizenPower.toBase58());

    const publish = createPublishCivilizationRuleInstruction({
      payer,
      ruleIdHash,
      textHash,
      patchHash,
      snapshotHash,
      targetProgram,
      targetPda,
      totalActivePower: 2_000_000,
      thresholdBps: 5_000,
      targetStatus: 1,
      riskLevel: 2,
    });
    assert.equal(publish.programId.toBase58(), NICECHUNK_CIVILIZATION_PROGRAM_ID.toBase58());
    assert.equal(publish.data.readUInt8(0), 0);
    assert.equal(publish.data.length, 205);
    assert.equal(publish.keys[0].pubkey.toBase58(), payer.toBase58());
    assert.equal(publish.keys[1].pubkey.toBase58(), ruleBook.toBase58());
    assert.equal(publish.keys[2].pubkey.toBase58(), powerSnapshot.toBase58());
    assert.equal(publish.keys[3].pubkey.toBase58(), SystemProgram.programId.toBase58());
    assert.equal(publish.data.subarray(1, 33).toString("hex"), hash32(ruleIdHash).toString("hex"));
    assert.equal(publish.data.readBigUInt64LE(193), 2_000_000n);
    assert.equal(publish.data.readUInt16LE(201), 5_000);

    const sign = createSignCivilizationRuleInstruction({
      signer,
      ruleBook,
      snapshotHash,
      side: CIVILIZATION_SIDE_AGREE,
      snapshotPower: 1_200_000,
    });
    assert.equal(sign.data.readUInt8(0), 1);
    assert.equal(sign.data.readUInt8(1), CIVILIZATION_SIDE_AGREE);
    assert.equal(sign.data.readBigUInt64LE(2), 1_200_000n);
    assert.equal(sign.keys[2].pubkey.toBase58(), signature.toBase58());
    assert.equal(sign.keys[3].pubkey.toBase58(), citizenPower.toBase58());

    const finalize = createFinalizeCivilizationRuleInstruction({ payer, ruleBook, signatures: [signature] });
    assert.equal(finalize.data.readUInt8(0), 2);
    assert.equal(finalize.keys[2].pubkey.toBase58(), tally.toBase58());
    assert.equal(finalize.keys[4].pubkey.toBase58(), signature.toBase58());

    const execute = createExecuteCivilizationRuleReceiptInstruction({ executor: payer, ruleBook });
    assert.equal(execute.data.readUInt8(0), 3);
    assert.equal(execute.keys.length, 5);
    assert.equal(execute.keys[2].pubkey.toBase58(), tally.toBase58());
    assert.equal(execute.keys[3].pubkey.toBase58(), receipt.toBase58());

    const adapterExecute = createExecuteCivilizationRuleReceiptInstruction({
      executor: payer,
      ruleBook,
      adapterAuthority,
    });
    assert.equal(adapterExecute.keys.length, 6);
    assert.equal(adapterExecute.keys[5].pubkey.toBase58(), adapterAuthority.toBase58());
    assert.equal(adapterExecute.keys[5].isSigner, false);
    assert.equal(adapterExecute.keys[5].isWritable, false);
  });

  it("matches civilization threshold semantics", () => {
    assert.equal(civilizationRequiredPower(2_000_000, 5_000), 1_000_000n);
    assert.equal(civilizationRequiredPower(7, 5_000), 4n);
    assert.equal(civilizationThresholdMet({ yesPower: 999_999, noPower: 0, requiredPower: 1_000_000 }), false);
    assert.equal(civilizationThresholdMet({ yesPower: 1_000_000, noPower: 1_000_000, requiredPower: 1_000_000 }), false);
    assert.equal(civilizationThresholdMet({ yesPower: 1_000_000, noPower: 999_999, requiredPower: 1_000_000 }), true);
    assert.throws(() => civilizationRequiredPower(0, 5_000), /Invalid civilization threshold/);
    assert.throws(() => civilizationRequiredPower(100, 10_001), /Invalid civilization threshold/);
  });

  it("keeps non-passing Rust tally recounts signable until threshold passes", () => {
    const source = readFileSync("programs/nicechunk_civilization/src/state.rs", "utf8");
    assert.match(source, /if threshold_met\(yes_power, no_power, required_power\)/);
    assert.match(source, /data\[Self::STATUS_OFFSET\] = STATUS_FINALIZED;/);
    assert.match(source, /data\[Self::STATUS_OFFSET\] = STATUS_PUBLISHED;/);
    assert.match(source, /pub fn threshold_met\(yes_power: u64, no_power: u64, required_power: u64\) -> bool/);
  });

  it("keeps Rust tally recounts one-signature-per-signer on chain", () => {
    const source = readFileSync("programs/nicechunk_civilization/src/lib.rs", "utf8");
    assert.match(source, /let mut seen_signers: Vec<Pubkey> = Vec::new\(\);/);
    assert.match(source, /RuleSignatureAccount::signer\(&data\)\?/);
    assert.match(source, /DuplicateSignatureSigner/);
  });

  it("rejects finalize signature sets whose total power exceeds the rule snapshot", () => {
    const source = readFileSync("programs/nicechunk_civilization/src/lib.rs", "utf8");
    assert.match(source, /let mut counted_power = 0_u64;/);
    assert.match(source, /checked_add_signature_power\(counted_power, signature_power, total_active_power\)/);
    assert.doesNotMatch(source, /saturating_add\(RuleSignatureAccount::power\(&data\)\)/);
  });

  it("keeps execute receipt bound to finalized rule and canonical tally PDA", () => {
    const source = readFileSync("programs/nicechunk_civilization/src/lib.rs", "utf8");
    assert.match(source, /STATUS_FINALIZED/);
    assert.match(source, /validate_tally_pda\(program_id, tally\.key, rule_book\.key\)\?/);
    assert.match(source, /if status != STATUS_FINALIZED/);
    assert.match(source, /RuleNotFinalized/);
    assert.match(source, /TARGET_STATUS_GOVERNABLE/);
    assert.match(source, /MissingAdapterAuthority/);
    assert.match(source, /InvalidAdapterAuthorityPda/);
    assert.match(source, /validate_adapter_authority_pda\(adapter_authority, &target_program, rule_book\.key\)\?/);
  });

  it("rejects impossible signature power before tallying", () => {
    const lib = readFileSync("programs/nicechunk_civilization/src/lib.rs", "utf8");
    const state = readFileSync("programs/nicechunk_civilization/src/state.rs", "utf8");
    assert.match(state, /pub fn total_active_power\(data: &\[u8\]\) -> Result<u64, NicechunkCivilizationError>/);
    assert.match(lib, /snapshot_power > RuleBookAccount::total_active_power\(&rule_data\)\?/);
  });

  it("binds signatures to settled civilization value PDAs", () => {
    const lib = readFileSync("programs/nicechunk_civilization/src/lib.rs", "utf8");
    const state = readFileSync("programs/nicechunk_civilization/src/state.rs", "utf8");
    assert.match(state, /pub const POWER_SNAPSHOT_SEED: &\[u8\] = b"power-snapshot"/);
    assert.match(state, /pub const CITIZEN_POWER_SEED: &\[u8\] = b"citizen-power"/);
    assert.match(state, /pub struct PowerSnapshotAccount/);
    assert.match(state, /pub struct CitizenPowerAccount/);
    assert.match(lib, /4 => publish_power_snapshot/);
    assert.match(lib, /5 => settle_citizen_power/);
    assert.match(lib, /PowerSnapshotAccount::validate/);
    assert.match(lib, /CitizenPowerAccount::validate_for_signer/);
    assert.match(lib, /CitizenPowerAccount::power\(&citizen_power_data\) != snapshot_power/);
    assert.match(lib, /CIVILIZATION_POWER_AUTHORITY/);
    assert.match(lib, /InvalidPowerAuthority/);
    assert.match(lib, /PowerSnapshotExpired/);
    assert.match(lib, /CitizenPowerMismatch/);
  });

  it("keeps the civilization rule UI proof seed-bound and u64-exact", () => {
    const source = readFileSync("civilization/rules.js", "utf8");
    assert.match(source, /signature_pda_seed/);
    assert.match(source, /expected_signature_pda/);
    assert.match(source, /signature_pda_seed_verified/);
    assert.match(source, /signedProof\.side !== proposal\.civilization_power_snapshot/);
    assert.match(source, /signedPower !== proposalPower/);
    assert.match(source, /signedProof\.rule_signature_pda !== expectedPdas\.rule_signature_pda/);
    assert.match(source, /snapshot_power_exceeds_total/);
    assert.match(source, /signature_set_power_exceeds_total/);
    assert.match(source, /tally_pda_seed_verified/);
    assert.match(source, /execution_receipt_pda_seed_verified/);
    assert.match(source, /expected_execution_receipt_pda/);
    assert.match(source, /snapshot_power_u64/);
    assert.match(source, /total_active_power_u64/);
    assert.match(source, /required_power_u64/);
    assert.match(source, /yes_power_u64/);
    assert.match(source, /buildLocalDeployPacketAudit/);
    assert.match(source, /content_hash_claim/);
    assert.match(source, /signature_collection_hash/);
    assert.match(source, /preserved_signature_collection_hash/);
    assert.match(source, /deploySignatureCollectionHash/);
    assert.match(source, /verifyDeploySignatureCollectionHash/);
    assert.match(source, /verifyDeployLineageHashBinding/);
    assert.match(source, /signature_collection_hash_check/);
    assert.match(source, /deploy_lineage_hash_check/);
    assert.match(source, /deploy_signature_collection_hash/);
    assert.match(source, /staged_signature_collection_hash/);
    assert.match(source, /deploySignatureCollectionChanged/);
    assert.match(source, /rule_book_hash_binding/);
    assert.match(source, /verifyDeployRuleBookHashBinding/);
    assert.match(source, /inspectDeployRuleBookHashBinding/);
    assert.match(source, /buildAdapterAuthorityPostSubmitProof/);
    assert.match(source, /buildPostSubmitPlanBindingProof/);
    assert.match(source, /proof\.plan_binding/);
    assert.match(source, /post_submit_plan_binding\.v1/);
    assert.match(source, /readTargetPdaPreSubmitProof/);
    assert.match(source, /execute_target_preimage/);
    assert.match(source, /target_preimage_data_hash/);
    assert.match(source, /old_value_hash_verified/);
    assert.match(source, /refreshComposerOldValueHash/);
    assert.match(source, /oldHashRefreshed/);
    assert.match(source, /readPdaAccountWithFallback\(new PublicKey\(targetPda\)\)/);
    assert.match(source, /oldHashInput\.value = dataHash/);
    assert.match(source, /resetFlowAfterEdit\(\)/);
    assert.match(source, /verifyProposalOldValueHashBeforeSign/);
    assert.match(source, /old_value_preflight/);
    assert.match(source, /oldHashStale/);
    assert.match(source, /deploy_old_value_preflight/);
    assert.match(source, /old_value_preflight_check/);
    assert.match(source, /inspectDeployOldValuePreflight/);
    assert.match(source, /verifyDeployOldValuePreflightForUse/);
    assert.match(source, /old_value_live_check/);
    assert.match(source, /deployPacketRequiresOldValuePreflight/);
    assert.match(source, /buildCivilizationPowerInstructions/);
    assert.match(source, /NICECHUNK_CIVILIZATION_POWER_AUTHORITY/);
    assert.match(source, /readCivilizationPowerReadiness/);
    assert.match(source, /blocked_citizen_power_unsettled/);
    assert.match(source, /blocked_power_snapshot_unsettled/);
    assert.match(source, /civilizationPowerSnapshots/);
    assert.match(source, /civilizationCitizenPowers/);
    assert.match(source, /decodeCivilizationPowerSnapshotAccount/);
    assert.match(source, /decodeCivilizationCitizenPowerAccount/);
    assert.match(source, /createPublishPowerSnapshotInstruction/);
    assert.match(source, /createSettleCitizenPowerInstruction/);
    assert.match(source, /civilizationProgramCapabilities/);
    assert.match(source, /ensureCivilizationProgramSubmitCapability/);
    assert.match(source, /blocked_program_upgrade/);
    assert.match(source, /oldHashDeployStale/);
    assert.match(source, /expectedOldHash !== dataHash/);
    assert.match(source, /targetPreimageChanged/);
    assert.match(source, /readable_summary/);
    assert.match(source, /summarizeSmeltingRecipePatch/);
    assert.match(source, /summarizeResourceDropRulesPatch/);
    assert.match(source, /renderTargetPatchProofFields/);
    assert.match(source, /proof\.adapter_authority/);
    assert.match(source, /chainPhase\.items\.adapterAuthority/);
    assert.match(source, /function deployPacketPdasMatch[\s\S]*\"adapter_authority_pda\"/);
    assert.match(source, /threshold_result_check/);
    assert.match(source, /inspectDeployThresholdResult/);
    assert.match(source, /verifyDeployPacketContentHashClaim/);
    assert.match(source, /verifyDeployThresholdResult/);
    assert.match(source, /deployPacketHistoryCheck/);
    assert.match(source, /history\.auditPending/);
  });

  it("keeps Civilization Value settlement behind the trusted authority tool", () => {
    const source = readFileSync("scripts/civilization-settle-power.ts", "utf8");
    assert.match(source, /NICECHUNK_CIVILIZATION_POWER_AUTHORITY/);
    assert.match(source, /power_settlement_packet\.v1/);
    assert.match(source, /--send/);
    assert.match(source, /send_requested/);
    assert.match(source, /derivePowerSnapshotPda/);
    assert.match(source, /deriveCitizenPowerPda/);
    assert.match(source, /createPublishPowerSnapshotInstruction/);
    assert.match(source, /createSettleCitizenPowerInstruction/);
  });

  it("decodes civilization rule accounts", () => {
    const [ruleBook, ruleBookBump] = deriveRuleBookPda({ ruleIdHash });
    const data = Buffer.alloc(RULE_BOOK_LEN);
    let offset = 0;
    data.write(RULE_BOOK_MAGIC, offset, "utf8"); offset += 8;
    data.writeUInt16LE(1, offset); offset += 2;
    data.writeUInt8(ruleBookBump, offset++);
    data.writeUInt8(RULE_STATUS_EXECUTED, offset++);
    payer.toBuffer().copy(data, offset); offset += 32;
    hash32(ruleIdHash).copy(data, offset); offset += 32;
    hash32(textHash).copy(data, offset); offset += 32;
    hash32(patchHash).copy(data, offset); offset += 32;
    hash32(snapshotHash).copy(data, offset); offset += 32;
    targetProgram.toBuffer().copy(data, offset); offset += 32;
    targetPda.toBuffer().copy(data, offset); offset += 32;
    data.writeBigUInt64LE(2_000_000n, offset); offset += 8;
    data.writeBigUInt64LE(1_000_000n, offset); offset += 8;
    data.writeUInt16LE(5_000, offset); offset += 2;
    data.writeUInt8(1, offset++);
    data.writeUInt8(2, offset++);
    data.writeBigUInt64LE(1_200_000n, offset); offset += 8;
    data.writeBigUInt64LE(100_000n, offset); offset += 8;
    data.writeBigUInt64LE(50_000n, offset); offset += 8;
    data.writeBigUInt64LE(0n, offset); offset += 8;
    data.writeBigUInt64LE(40n, offset); offset += 8;
    data.writeBigUInt64LE(50n, offset); offset += 8;
    data.writeBigUInt64LE(60n, offset); offset += 8;
    data.writeBigInt64LE(1_700_000_000n, offset);

    const decoded = decodeRuleBook(data);
    assert.equal(decoded.magic, RULE_BOOK_MAGIC);
    assert.equal(decoded.status, RULE_STATUS_EXECUTED);
    assert.equal(decoded.ruleIdHash.toString("hex"), hash32(ruleIdHash).toString("hex"));
    assert.equal(decoded.totalActivePower, 2_000_000n);
    assert.equal(decoded.requiredPower, 1_000_000n);
    assert.equal(decoded.yesPower, 1_200_000n);
    assert.equal(decoded.targetPda.toBase58(), targetPda.toBase58());

    const [signature, signatureBump] = deriveRuleSignaturePda({ ruleBook, signer });
    assert.ok(signature);
    const sigData = Buffer.alloc(RULE_SIGNATURE_LEN);
    offset = 0;
    sigData.write(RULE_SIGNATURE_MAGIC, offset, "utf8"); offset += 8;
    sigData.writeUInt16LE(1, offset); offset += 2;
    sigData.writeUInt8(signatureBump, offset++);
    sigData.writeUInt8(CIVILIZATION_SIDE_REJECT, offset++);
    ruleBook.toBuffer().copy(sigData, offset); offset += 32;
    signer.toBuffer().copy(sigData, offset); offset += 32;
    hash32(snapshotHash).copy(sigData, offset); offset += 32;
    sigData.writeBigUInt64LE(123n, offset); offset += 8;
    sigData.writeBigUInt64LE(44n, offset); offset += 8;
    sigData.writeBigInt64LE(1_700_000_001n, offset);
    const decodedSignature = decodeRuleSignature(sigData);
    assert.equal(decodedSignature.side, CIVILIZATION_SIDE_REJECT);
    assert.equal(decodedSignature.snapshotPower, 123n);

    const [powerSnapshot, powerSnapshotBump] = derivePowerSnapshotPda({ snapshotHash });
    const powerSnapshotData = Buffer.alloc(POWER_SNAPSHOT_LEN);
    offset = 0;
    powerSnapshotData.write(POWER_SNAPSHOT_MAGIC, offset, "utf8"); offset += 8;
    powerSnapshotData.writeUInt16LE(1, offset); offset += 2;
    powerSnapshotData.writeUInt8(powerSnapshotBump, offset++);
    NICECHUNK_CIVILIZATION_POWER_AUTHORITY.toBuffer().copy(powerSnapshotData, offset); offset += 32;
    hash32(snapshotHash).copy(powerSnapshotData, offset); offset += 32;
    powerSnapshotData.writeBigUInt64LE(2_000_000n, offset); offset += 8;
    powerSnapshotData.writeBigUInt64LE(100n, offset); offset += 8;
    powerSnapshotData.writeBigUInt64LE(127n, offset); offset += 8;
    powerSnapshotData.writeBigUInt64LE(40n, offset); offset += 8;
    powerSnapshotData.writeBigInt64LE(1_800_000_000n, offset); offset += 8;
    powerSnapshotData.writeBigInt64LE(1_700_000_000n, offset);
    const decodedSnapshot = decodePowerSnapshot(powerSnapshotData);
    assert.equal(decodedSnapshot.magic, POWER_SNAPSHOT_MAGIC);
    assert.equal(decodedSnapshot.authority.toBase58(), NICECHUNK_CIVILIZATION_POWER_AUTHORITY.toBase58());
    assert.equal(decodedSnapshot.snapshotHash.toString("hex"), hash32(snapshotHash).toString("hex"));
    assert.equal(decodedSnapshot.totalActivePower, 2_000_000n);

    const [citizenPower, citizenPowerBump] = deriveCitizenPowerPda({ powerSnapshot, citizen: signer });
    const citizenPowerData = Buffer.alloc(CITIZEN_POWER_LEN);
    offset = 0;
    citizenPowerData.write(CITIZEN_POWER_MAGIC, offset, "utf8"); offset += 8;
    citizenPowerData.writeUInt16LE(1, offset); offset += 2;
    citizenPowerData.writeUInt8(citizenPowerBump, offset++);
    powerSnapshot.toBuffer().copy(citizenPowerData, offset); offset += 32;
    signer.toBuffer().copy(citizenPowerData, offset); offset += 32;
    hash32(snapshotHash).copy(citizenPowerData, offset); offset += 32;
    citizenPowerData.writeBigUInt64LE(1_200_000n, offset); offset += 8;
    citizenPowerData.writeBigUInt64LE(41n, offset); offset += 8;
    citizenPowerData.writeBigInt64LE(1_700_000_100n, offset); offset += 8;
    citizenPowerData.writeBigInt64LE(1_800_000_000n, offset);
    const decodedCitizenPower = decodeCitizenPower(citizenPowerData);
    assert.equal(citizenPower.toBase58(), deriveCitizenPowerPda({ powerSnapshot, citizen: signer })[0].toBase58());
    assert.equal(decodedCitizenPower.magic, CITIZEN_POWER_MAGIC);
    assert.equal(decodedCitizenPower.powerSnapshot.toBase58(), powerSnapshot.toBase58());
    assert.equal(decodedCitizenPower.citizen.toBase58(), signer.toBase58());
    assert.equal(decodedCitizenPower.power, 1_200_000n);
    assert.equal(decodedCitizenPower.expiresAt, 1_800_000_000n);

    const [tally, tallyBump] = deriveRuleTallyPda({ ruleBook });
    assert.ok(tally);
    const tallyData = Buffer.alloc(RULE_TALLY_LEN);
    offset = 0;
    tallyData.write(RULE_TALLY_MAGIC, offset, "utf8"); offset += 8;
    tallyData.writeUInt16LE(1, offset); offset += 2;
    tallyData.writeUInt8(tallyBump, offset++);
    tallyData.writeUInt8(1, offset++);
    ruleBook.toBuffer().copy(tallyData, offset); offset += 32;
    tallyData.writeBigUInt64LE(1_200_000n, offset); offset += 8;
    tallyData.writeBigUInt64LE(100_000n, offset); offset += 8;
    tallyData.writeBigUInt64LE(50_000n, offset); offset += 8;
    tallyData.writeBigUInt64LE(0n, offset); offset += 8;
    tallyData.writeBigUInt64LE(1_000_000n, offset); offset += 8;
    tallyData.writeBigUInt64LE(50n, offset); offset += 8;
    tallyData.writeBigInt64LE(1_700_000_002n, offset);
    const decodedTally = decodeRuleTally(tallyData);
    assert.equal(decodedTally.thresholdMet, true);
    assert.equal(decodedTally.ruleBook.toBase58(), ruleBook.toBase58());
    assert.equal(decodedTally.requiredPower, 1_000_000n);

    const [receipt, receiptBump] = deriveExecutionReceiptPda({ ruleBook });
    assert.ok(receipt);
    const receiptData = Buffer.alloc(EXECUTION_RECEIPT_LEN);
    offset = 0;
    receiptData.write(EXECUTION_RECEIPT_MAGIC, offset, "utf8"); offset += 8;
    receiptData.writeUInt16LE(1, offset); offset += 2;
    receiptData.writeUInt8(receiptBump, offset++);
    receiptData.writeUInt8(1, offset++);
    ruleBook.toBuffer().copy(receiptData, offset); offset += 32;
    payer.toBuffer().copy(receiptData, offset); offset += 32;
    receiptData.writeBigUInt64LE(60n, offset); offset += 8;
    receiptData.writeBigInt64LE(1_700_000_003n, offset);
    const decodedReceipt = decodeExecutionReceipt(receiptData);
    assert.equal(decodedReceipt.executed, true);
    assert.equal(decodedReceipt.ruleBook.toBase58(), ruleBook.toBase58());
    assert.equal(decodedReceipt.executor.toBase58(), payer.toBase58());
    assert.equal(decodedReceipt.executedSlot, 60n);
  });
});
