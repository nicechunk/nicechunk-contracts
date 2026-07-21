use solana_program::{entrypoint::ProgramResult, pubkey::Pubkey};

use crate::errors::NicechunkCivilizationError;

pub const RULE_BOOK_MAGIC: [u8; 8] = *b"NCKCVR01";
pub const RULE_SIGNATURE_MAGIC: [u8; 8] = *b"NCKCVS01";
pub const RULE_TALLY_MAGIC: [u8; 8] = *b"NCKCVT01";
pub const EXECUTION_RECEIPT_MAGIC: [u8; 8] = *b"NCKCVE01";
pub const POWER_SNAPSHOT_MAGIC: [u8; 8] = *b"NCKCVP01";
pub const CITIZEN_POWER_MAGIC: [u8; 8] = *b"NCKCVC01";
pub const CIVILIZATION_VERSION: u16 = 1;

pub const RULE_BOOK_SEED: &[u8] = b"rule-book";
pub const RULE_SIGNATURE_SEED: &[u8] = b"rule-signature";
pub const RULE_TALLY_SEED: &[u8] = b"rule-tally";
pub const EXECUTION_RECEIPT_SEED: &[u8] = b"rule-execution";
pub const POWER_SNAPSHOT_SEED: &[u8] = b"power-snapshot";
pub const CITIZEN_POWER_SEED: &[u8] = b"citizen-power";
pub const CIVILIZATION_ADAPTER_AUTHORITY_SEED: &[u8] = b"civilization-adapter";

pub const STATUS_PUBLISHED: u8 = 1;
pub const STATUS_FINALIZED: u8 = 2;
pub const STATUS_EXECUTED: u8 = 3;

pub const TARGET_STATUS_GOVERNABLE: u8 = 1;
pub const TARGET_STATUS_ADAPTER_PENDING: u8 = 2;
pub const TARGET_STATUS_READONLY: u8 = 3;
pub const TARGET_STATUS_PROTECTED: u8 = 4;

pub const SIDE_AGREE: u8 = 1;
pub const SIDE_REJECT: u8 = 2;
pub const SIDE_ABSTAIN: u8 = 3;
pub const SIDE_CHALLENGE: u8 = 4;

pub struct PublishRuleBookArgs {
    pub rule_id_hash: [u8; 32],
    pub text_hash: [u8; 32],
    pub patch_hash: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub target_program: Pubkey,
    pub target_pda: Pubkey,
    pub total_active_power: u64,
    pub threshold_bps: u16,
    pub target_status: u8,
    pub risk_level: u8,
}

impl PublishRuleBookArgs {
    pub const LEN: usize = 204;

    pub fn unpack(payload: &[u8]) -> Result<Self, NicechunkCivilizationError> {
        if payload.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidInstruction);
        }
        let mut offset = 0;
        let rule_id_hash = read_hash(payload, &mut offset)?;
        let text_hash = read_hash(payload, &mut offset)?;
        let patch_hash = read_hash(payload, &mut offset)?;
        let snapshot_hash = read_hash(payload, &mut offset)?;
        let target_program = read_pubkey(payload, &mut offset)?;
        let target_pda = read_pubkey(payload, &mut offset)?;
        let total_active_power = read_u64_at(payload, offset);
        offset += 8;
        let threshold_bps = read_u16_at(payload, offset);
        offset += 2;
        let target_status = payload[offset];
        offset += 1;
        let risk_level = payload[offset];
        if threshold_bps == 0 || threshold_bps > 10_000 || total_active_power == 0 {
            return Err(NicechunkCivilizationError::InvalidThreshold);
        }
        if !matches!(
            target_status,
            TARGET_STATUS_GOVERNABLE
                | TARGET_STATUS_ADAPTER_PENDING
                | TARGET_STATUS_READONLY
                | TARGET_STATUS_PROTECTED
        ) {
            return Err(NicechunkCivilizationError::InvalidTargetStatus);
        }
        Ok(Self {
            rule_id_hash,
            text_hash,
            patch_hash,
            snapshot_hash,
            target_program,
            target_pda,
            total_active_power,
            threshold_bps,
            target_status,
            risk_level,
        })
    }
}

pub struct RuleBookInitArgs<'a> {
    pub bump: u8,
    pub author: &'a Pubkey,
    pub args: &'a PublishRuleBookArgs,
    pub created_slot: u64,
    pub created_at: i64,
}

pub struct PowerSnapshotInitArgs<'a> {
    pub bump: u8,
    pub authority: &'a Pubkey,
    pub snapshot_hash: &'a [u8; 32],
    pub total_active_power: u64,
    pub window_start_epoch: u64,
    pub window_end_epoch: u64,
    pub expires_at: i64,
    pub created_slot: u64,
    pub created_at: i64,
}

pub struct CitizenPowerInitArgs<'a> {
    pub bump: u8,
    pub snapshot: &'a Pubkey,
    pub citizen: &'a Pubkey,
    pub snapshot_hash: &'a [u8; 32],
    pub power: u64,
    pub settled_slot: u64,
    pub settled_at: i64,
    pub expires_at: i64,
}

pub struct PowerSnapshotAccount;

impl PowerSnapshotAccount {
    pub const LEN: usize = 128;
    pub const BUMP_OFFSET: usize = 10;
    pub const AUTHORITY_OFFSET: usize = 11;
    pub const SNAPSHOT_HASH_OFFSET: usize = 43;
    pub const TOTAL_POWER_OFFSET: usize = 75;
    pub const WINDOW_START_OFFSET: usize = 83;
    pub const WINDOW_END_OFFSET: usize = 91;
    pub const CREATED_SLOT_OFFSET: usize = 99;
    pub const EXPIRES_AT_OFFSET: usize = 107;
    pub const CREATED_AT_OFFSET: usize = 115;

    pub fn pack(dst: &mut [u8], init: &PowerSnapshotInitArgs) -> ProgramResult {
        if dst.len() != Self::LEN
            || init.total_active_power == 0
            || init.window_end_epoch < init.window_start_epoch
        {
            return Err(NicechunkCivilizationError::InvalidPowerSnapshotData.into());
        }
        dst.fill(0);
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&POWER_SNAPSHOT_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(init.bump)?;
        writer.pubkey(init.authority)?;
        writer.bytes(init.snapshot_hash)?;
        writer.u64(init.total_active_power)?;
        writer.u64(init.window_start_epoch)?;
        writer.u64(init.window_end_epoch)?;
        writer.u64(init.created_slot)?;
        writer.i64(init.expires_at)?;
        writer.i64(init.created_at)?;
        writer.bytes(&[0_u8; 5])?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate(data: &[u8]) -> ProgramResult {
        if data.len() != Self::LEN || data[0..8] != POWER_SNAPSHOT_MAGIC {
            return Err(NicechunkCivilizationError::InvalidPowerSnapshotData.into());
        }
        if read_u16_at(data, 8) != CIVILIZATION_VERSION {
            return Err(NicechunkCivilizationError::InvalidPowerSnapshotData.into());
        }
        Ok(())
    }

    pub fn authority(data: &[u8]) -> Result<Pubkey, NicechunkCivilizationError> {
        read_pubkey_at(data, Self::AUTHORITY_OFFSET)
            .map_err(|_| NicechunkCivilizationError::InvalidPowerSnapshotData)
    }

    pub fn snapshot_hash(data: &[u8]) -> Result<[u8; 32], NicechunkCivilizationError> {
        read_hash_at(data, Self::SNAPSHOT_HASH_OFFSET)
            .map_err(|_| NicechunkCivilizationError::InvalidPowerSnapshotData)
    }

    pub fn total_active_power(data: &[u8]) -> Result<u64, NicechunkCivilizationError> {
        if data.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidPowerSnapshotData);
        }
        Ok(read_u64_at(data, Self::TOTAL_POWER_OFFSET))
    }
}

pub struct CitizenPowerAccount;

impl CitizenPowerAccount {
    pub const LEN: usize = 144;
    pub const BUMP_OFFSET: usize = 10;
    pub const SNAPSHOT_OFFSET: usize = 11;
    pub const CITIZEN_OFFSET: usize = 43;
    pub const SNAPSHOT_HASH_OFFSET: usize = 75;
    pub const POWER_OFFSET: usize = 107;
    pub const SETTLED_SLOT_OFFSET: usize = 115;
    pub const SETTLED_AT_OFFSET: usize = 123;
    pub const EXPIRES_AT_OFFSET: usize = 131;

    pub fn pack(dst: &mut [u8], init: &CitizenPowerInitArgs) -> ProgramResult {
        if dst.len() != Self::LEN || init.power == 0 {
            return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
        }
        dst.fill(0);
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&CITIZEN_POWER_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(init.bump)?;
        writer.pubkey(init.snapshot)?;
        writer.pubkey(init.citizen)?;
        writer.bytes(init.snapshot_hash)?;
        writer.u64(init.power)?;
        writer.u64(init.settled_slot)?;
        writer.i64(init.settled_at)?;
        writer.i64(init.expires_at)?;
        writer.bytes(&[0_u8; 5])?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate_for_signer(
        data: &[u8],
        citizen: &Pubkey,
        snapshot_hash: &[u8; 32],
    ) -> ProgramResult {
        if data.len() != Self::LEN || data[0..8] != CITIZEN_POWER_MAGIC {
            return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
        }
        if read_u16_at(data, 8) != CIVILIZATION_VERSION {
            return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
        }
        if &data[Self::CITIZEN_OFFSET..Self::CITIZEN_OFFSET + 32] != citizen.as_ref() {
            return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
        }
        if &data[Self::SNAPSHOT_HASH_OFFSET..Self::SNAPSHOT_HASH_OFFSET + 32] != snapshot_hash {
            return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
        }
        Ok(())
    }

    pub fn snapshot(data: &[u8]) -> Result<Pubkey, NicechunkCivilizationError> {
        read_pubkey_at(data, Self::SNAPSHOT_OFFSET)
            .map_err(|_| NicechunkCivilizationError::InvalidCitizenPowerData)
    }

    pub fn power(data: &[u8]) -> u64 {
        read_u64_at(data, Self::POWER_OFFSET)
    }

    pub fn expires_at(data: &[u8]) -> i64 {
        i64::from_le_bytes(
            data[Self::EXPIRES_AT_OFFSET..Self::EXPIRES_AT_OFFSET + 8]
                .try_into()
                .unwrap_or_default(),
        )
    }
}

pub struct RuleBookAccount;

impl RuleBookAccount {
    pub const LEN: usize = 320;
    pub const STATUS_OFFSET: usize = 11;
    pub const AUTHOR_OFFSET: usize = 12;
    pub const RULE_ID_HASH_OFFSET: usize = 44;
    pub const TEXT_HASH_OFFSET: usize = 76;
    pub const PATCH_HASH_OFFSET: usize = 108;
    pub const SNAPSHOT_HASH_OFFSET: usize = 140;
    pub const TARGET_PROGRAM_OFFSET: usize = 172;
    pub const TARGET_PDA_OFFSET: usize = 204;
    pub const TOTAL_POWER_OFFSET: usize = 236;
    pub const REQUIRED_POWER_OFFSET: usize = 244;
    pub const THRESHOLD_BPS_OFFSET: usize = 252;
    pub const TARGET_STATUS_OFFSET: usize = 254;
    pub const RISK_LEVEL_OFFSET: usize = 255;
    pub const YES_POWER_OFFSET: usize = 256;
    pub const NO_POWER_OFFSET: usize = 264;
    pub const ABSTAIN_POWER_OFFSET: usize = 272;
    pub const CHALLENGE_POWER_OFFSET: usize = 280;
    pub const CREATED_SLOT_OFFSET: usize = 288;
    pub const FINALIZED_SLOT_OFFSET: usize = 296;
    pub const EXECUTED_SLOT_OFFSET: usize = 304;
    pub const CREATED_AT_OFFSET: usize = 312;

    pub fn pack(dst: &mut [u8], init: &RuleBookInitArgs) -> ProgramResult {
        if dst.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidRuleBookData.into());
        }
        dst.fill(0);
        let required_power = required_power(init.args.total_active_power, init.args.threshold_bps)?;
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&RULE_BOOK_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(init.bump)?;
        writer.u8(STATUS_PUBLISHED)?;
        writer.pubkey(init.author)?;
        writer.bytes(&init.args.rule_id_hash)?;
        writer.bytes(&init.args.text_hash)?;
        writer.bytes(&init.args.patch_hash)?;
        writer.bytes(&init.args.snapshot_hash)?;
        writer.pubkey(&init.args.target_program)?;
        writer.pubkey(&init.args.target_pda)?;
        writer.u64(init.args.total_active_power)?;
        writer.u64(required_power)?;
        writer.u16(init.args.threshold_bps)?;
        writer.u8(init.args.target_status)?;
        writer.u8(init.args.risk_level)?;
        writer.u64(0)?;
        writer.u64(0)?;
        writer.u64(0)?;
        writer.u64(0)?;
        writer.u64(init.created_slot)?;
        writer.u64(0)?;
        writer.u64(0)?;
        writer.i64(init.created_at)?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate(data: &[u8]) -> ProgramResult {
        if data.len() != Self::LEN || data[0..8] != RULE_BOOK_MAGIC {
            return Err(NicechunkCivilizationError::InvalidRuleBookData.into());
        }
        if read_u16_at(data, 8) != CIVILIZATION_VERSION {
            return Err(NicechunkCivilizationError::InvalidRuleBookData.into());
        }
        Ok(())
    }

    pub fn status(data: &[u8]) -> Result<u8, NicechunkCivilizationError> {
        if data.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidRuleBookData);
        }
        Ok(data[Self::STATUS_OFFSET])
    }

    pub fn snapshot_hash(data: &[u8]) -> Result<[u8; 32], NicechunkCivilizationError> {
        read_hash_at(data, Self::SNAPSHOT_HASH_OFFSET)
    }

    pub fn required_power(data: &[u8]) -> Result<u64, NicechunkCivilizationError> {
        if data.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidRuleBookData);
        }
        Ok(read_u64_at(data, Self::REQUIRED_POWER_OFFSET))
    }

    pub fn total_active_power(data: &[u8]) -> Result<u64, NicechunkCivilizationError> {
        if data.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidRuleBookData);
        }
        Ok(read_u64_at(data, Self::TOTAL_POWER_OFFSET))
    }

    pub fn target_program(data: &[u8]) -> Result<Pubkey, NicechunkCivilizationError> {
        read_pubkey_at(data, Self::TARGET_PROGRAM_OFFSET)
    }

    pub fn target_status(data: &[u8]) -> Result<u8, NicechunkCivilizationError> {
        if data.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidRuleBookData);
        }
        Ok(data[Self::TARGET_STATUS_OFFSET])
    }

    pub fn rule_id_hash(data: &[u8]) -> Result<[u8; 32], NicechunkCivilizationError> {
        read_hash_at(data, Self::RULE_ID_HASH_OFFSET)
    }

    pub fn set_tally(
        data: &mut [u8],
        yes_power: u64,
        no_power: u64,
        abstain_power: u64,
        challenge_power: u64,
        required_power: u64,
        finalized_slot: u64,
    ) -> ProgramResult {
        Self::validate(data)?;
        if data[Self::STATUS_OFFSET] == STATUS_EXECUTED {
            return Err(NicechunkCivilizationError::RuleAlreadyExecuted.into());
        }
        write_u64(data, Self::YES_POWER_OFFSET, yes_power);
        write_u64(data, Self::NO_POWER_OFFSET, no_power);
        write_u64(data, Self::ABSTAIN_POWER_OFFSET, abstain_power);
        write_u64(data, Self::CHALLENGE_POWER_OFFSET, challenge_power);
        if threshold_met(yes_power, no_power, required_power) {
            write_u64(data, Self::FINALIZED_SLOT_OFFSET, finalized_slot);
            data[Self::STATUS_OFFSET] = STATUS_FINALIZED;
        } else {
            write_u64(data, Self::FINALIZED_SLOT_OFFSET, 0);
            data[Self::STATUS_OFFSET] = STATUS_PUBLISHED;
        }
        Ok(())
    }

    pub fn mark_executed(data: &mut [u8], executed_slot: u64) -> ProgramResult {
        Self::validate(data)?;
        if data[Self::STATUS_OFFSET] == STATUS_EXECUTED {
            return Err(NicechunkCivilizationError::RuleAlreadyExecuted.into());
        }
        if data[Self::STATUS_OFFSET] != STATUS_FINALIZED {
            return Err(NicechunkCivilizationError::RuleNotFinalized.into());
        }
        write_u64(data, Self::EXECUTED_SLOT_OFFSET, executed_slot);
        data[Self::STATUS_OFFSET] = STATUS_EXECUTED;
        Ok(())
    }
}

pub struct RuleSignatureAccount;

impl RuleSignatureAccount {
    pub const LEN: usize = 136;
    pub const SIDE_OFFSET: usize = 11;
    pub const RULE_BOOK_OFFSET: usize = 12;
    pub const SIGNER_OFFSET: usize = 44;
    pub const SNAPSHOT_HASH_OFFSET: usize = 76;
    pub const POWER_OFFSET: usize = 108;
    pub const SIGNED_SLOT_OFFSET: usize = 116;
    pub const SIGNED_AT_OFFSET: usize = 124;

    pub fn pack(
        dst: &mut [u8],
        bump: u8,
        side: u8,
        rule_book: &Pubkey,
        signer: &Pubkey,
        snapshot_hash: &[u8; 32],
        power: u64,
        signed_slot: u64,
        signed_at: i64,
    ) -> ProgramResult {
        validate_side(side)?;
        if dst.len() != Self::LEN || power == 0 {
            return Err(NicechunkCivilizationError::InvalidSignatureData.into());
        }
        dst.fill(0);
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&RULE_SIGNATURE_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(bump)?;
        writer.u8(side)?;
        writer.pubkey(rule_book)?;
        writer.pubkey(signer)?;
        writer.bytes(snapshot_hash)?;
        writer.u64(power)?;
        writer.u64(signed_slot)?;
        writer.i64(signed_at)?;
        writer.u32(0)?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate_for_rule(data: &[u8], rule_book: &Pubkey) -> ProgramResult {
        if data.len() != Self::LEN || data[0..8] != RULE_SIGNATURE_MAGIC {
            return Err(NicechunkCivilizationError::InvalidSignatureData.into());
        }
        if read_u16_at(data, 8) != CIVILIZATION_VERSION {
            return Err(NicechunkCivilizationError::InvalidSignatureData.into());
        }
        if &data[Self::RULE_BOOK_OFFSET..Self::RULE_BOOK_OFFSET + 32] != rule_book.as_ref() {
            return Err(NicechunkCivilizationError::InvalidSignatureData.into());
        }
        validate_side(data[Self::SIDE_OFFSET])?;
        Ok(())
    }

    pub fn side(data: &[u8]) -> u8 {
        data[Self::SIDE_OFFSET]
    }

    pub fn power(data: &[u8]) -> u64 {
        read_u64_at(data, Self::POWER_OFFSET)
    }

    pub fn signer(data: &[u8]) -> Result<Pubkey, NicechunkCivilizationError> {
        let signer = read_hash_at(data, Self::SIGNER_OFFSET)
            .map_err(|_| NicechunkCivilizationError::InvalidSignatureData)?;
        Ok(Pubkey::new_from_array(signer))
    }
}

pub struct RuleTallyAccount;

impl RuleTallyAccount {
    pub const LEN: usize = 128;
    pub const THRESHOLD_MET_OFFSET: usize = 11;
    pub const RULE_BOOK_OFFSET: usize = 12;
    pub const YES_POWER_OFFSET: usize = 44;
    pub const NO_POWER_OFFSET: usize = 52;
    pub const ABSTAIN_POWER_OFFSET: usize = 60;
    pub const CHALLENGE_POWER_OFFSET: usize = 68;
    pub const REQUIRED_POWER_OFFSET: usize = 76;
    pub const FINALIZED_SLOT_OFFSET: usize = 84;
    pub const FINALIZED_AT_OFFSET: usize = 92;

    pub fn pack(
        dst: &mut [u8],
        bump: u8,
        rule_book: &Pubkey,
        yes_power: u64,
        no_power: u64,
        abstain_power: u64,
        challenge_power: u64,
        required_power: u64,
        finalized_slot: u64,
        finalized_at: i64,
    ) -> ProgramResult {
        if dst.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidTallyData.into());
        }
        let threshold_met = threshold_met(yes_power, no_power, required_power);
        dst.fill(0);
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&RULE_TALLY_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(bump)?;
        writer.u8(u8::from(threshold_met))?;
        writer.pubkey(rule_book)?;
        writer.u64(yes_power)?;
        writer.u64(no_power)?;
        writer.u64(abstain_power)?;
        writer.u64(challenge_power)?;
        writer.u64(required_power)?;
        writer.u64(finalized_slot)?;
        writer.i64(finalized_at)?;
        writer.bytes(&[0_u8; 28])?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate_threshold_met(data: &[u8], rule_book: &Pubkey) -> ProgramResult {
        if data.len() != Self::LEN || data[0..8] != RULE_TALLY_MAGIC {
            return Err(NicechunkCivilizationError::InvalidTallyData.into());
        }
        if &data[Self::RULE_BOOK_OFFSET..Self::RULE_BOOK_OFFSET + 32] != rule_book.as_ref() {
            return Err(NicechunkCivilizationError::InvalidTallyData.into());
        }
        if data[Self::THRESHOLD_MET_OFFSET] != 1 {
            return Err(NicechunkCivilizationError::ThresholdNotMet.into());
        }
        Ok(())
    }
}

pub struct ExecutionReceiptAccount;

impl ExecutionReceiptAccount {
    pub const LEN: usize = 128;

    pub fn pack(
        dst: &mut [u8],
        bump: u8,
        rule_book: &Pubkey,
        executor: &Pubkey,
        executed_slot: u64,
        executed_at: i64,
    ) -> ProgramResult {
        if dst.len() != Self::LEN {
            return Err(NicechunkCivilizationError::InvalidExecutionReceiptData.into());
        }
        dst.fill(0);
        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&EXECUTION_RECEIPT_MAGIC)?;
        writer.u16(CIVILIZATION_VERSION)?;
        writer.u8(bump)?;
        writer.u8(1)?;
        writer.pubkey(rule_book)?;
        writer.pubkey(executor)?;
        writer.u64(executed_slot)?;
        writer.i64(executed_at)?;
        writer.bytes(&[0_u8; 36])?;
        if writer.offset != Self::LEN {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        Ok(())
    }
}

pub fn required_power(
    total_active_power: u64,
    threshold_bps: u16,
) -> Result<u64, NicechunkCivilizationError> {
    if threshold_bps == 0 || threshold_bps > 10_000 || total_active_power == 0 {
        return Err(NicechunkCivilizationError::InvalidThreshold);
    }
    let numerator = (total_active_power as u128) * (threshold_bps as u128);
    Ok(numerator.div_ceil(10_000) as u64)
}

pub fn threshold_met(yes_power: u64, no_power: u64, required_power: u64) -> bool {
    yes_power >= required_power && yes_power > no_power
}

pub fn validate_side(side: u8) -> ProgramResult {
    match side {
        SIDE_AGREE | SIDE_REJECT | SIDE_ABSTAIN | SIDE_CHALLENGE => Ok(()),
        _ => Err(NicechunkCivilizationError::InvalidSignatureSide.into()),
    }
}

fn read_hash(payload: &[u8], offset: &mut usize) -> Result<[u8; 32], NicechunkCivilizationError> {
    let hash = read_hash_at(payload, *offset)?;
    *offset += 32;
    Ok(hash)
}

fn read_hash_at(payload: &[u8], offset: usize) -> Result<[u8; 32], NicechunkCivilizationError> {
    if offset + 32 > payload.len() {
        return Err(NicechunkCivilizationError::InvalidInstruction);
    }
    let mut hash = [0_u8; 32];
    hash.copy_from_slice(&payload[offset..offset + 32]);
    Ok(hash)
}

fn read_pubkey(payload: &[u8], offset: &mut usize) -> Result<Pubkey, NicechunkCivilizationError> {
    let hash = read_hash(payload, offset)?;
    Ok(Pubkey::new_from_array(hash))
}

fn read_pubkey_at(payload: &[u8], offset: usize) -> Result<Pubkey, NicechunkCivilizationError> {
    let hash = read_hash_at(payload, offset)?;
    Ok(Pubkey::new_from_array(hash))
}

fn read_u16_at(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap_or_default())
}

fn read_u64_at(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or_default())
}

fn write_u64(data: &mut [u8], offset: usize, value: u64) {
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

struct ByteWriter<'a> {
    dst: &'a mut [u8],
    offset: usize,
}

impl ByteWriter<'_> {
    fn bytes(&mut self, bytes: &[u8]) -> ProgramResult {
        let end = self.offset + bytes.len();
        if end > self.dst.len() {
            return Err(NicechunkCivilizationError::PackSizeMismatch.into());
        }
        self.dst[self.offset..end].copy_from_slice(bytes);
        self.offset = end;
        Ok(())
    }

    fn pubkey(&mut self, key: &Pubkey) -> ProgramResult {
        self.bytes(key.as_ref())
    }

    fn u8(&mut self, value: u8) -> ProgramResult {
        self.bytes(&[value])
    }

    fn u16(&mut self, value: u16) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }

    fn u32(&mut self, value: u32) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }

    fn u64(&mut self, value: u64) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }

    fn i64(&mut self, value: i64) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_sizes_stay_fixed() {
        assert_eq!(RuleBookAccount::LEN, 320);
        assert_eq!(RuleSignatureAccount::LEN, 136);
        assert_eq!(RuleTallyAccount::LEN, 128);
        assert_eq!(ExecutionReceiptAccount::LEN, 128);
        assert_eq!(PowerSnapshotAccount::LEN, 128);
        assert_eq!(CitizenPowerAccount::LEN, 144);
    }

    #[test]
    fn threshold_rounds_up() {
        assert_eq!(required_power(2_000_000, 5_000).unwrap(), 1_000_000);
        assert_eq!(required_power(7, 5_000).unwrap(), 4);
        assert!(required_power(0, 5_000).is_err());
        assert!(required_power(100, 10_001).is_err());
    }

    #[test]
    fn tally_does_not_finalize_rule_until_threshold_passes() {
        let author = Pubkey::new_unique();
        let target_program = Pubkey::new_unique();
        let target_pda = Pubkey::new_unique();
        let args = PublishRuleBookArgs {
            rule_id_hash: [1; 32],
            text_hash: [2; 32],
            patch_hash: [3; 32],
            snapshot_hash: [4; 32],
            target_program,
            target_pda,
            total_active_power: 2_000_000,
            threshold_bps: 5_000,
            target_status: 1,
            risk_level: 2,
        };
        let mut data = [0_u8; RuleBookAccount::LEN];
        RuleBookAccount::pack(
            &mut data,
            &RuleBookInitArgs {
                bump: 255,
                author: &author,
                args: &args,
                created_slot: 10,
                created_at: 1_700_000_000,
            },
        )
        .unwrap();

        RuleBookAccount::set_tally(&mut data, 120_000, 0, 0, 0, 1_000_000, 20).unwrap();
        assert_eq!(RuleBookAccount::status(&data).unwrap(), STATUS_PUBLISHED);
        assert_eq!(
            read_u64_at(&data, RuleBookAccount::FINALIZED_SLOT_OFFSET),
            0
        );

        RuleBookAccount::set_tally(&mut data, 1_200_000, 100_000, 0, 0, 1_000_000, 30).unwrap();
        assert_eq!(RuleBookAccount::status(&data).unwrap(), STATUS_FINALIZED);
        assert_eq!(
            read_u64_at(&data, RuleBookAccount::FINALIZED_SLOT_OFFSET),
            30
        );
    }
}
