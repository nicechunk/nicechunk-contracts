use solana_program::{entrypoint::ProgramResult, pubkey::Pubkey};

use crate::cluster_config::GUARDIAN_TREASURY_WALLET;
use crate::errors::NicechunkGuardianError;

pub const GUARDIAN_REGISTRY_MAGIC: [u8; 8] = *b"NCKGDR01";
pub const GUARDIAN_REGION_MAGIC: [u8; 8] = *b"NCKGRG01";
pub const GUARDIAN_REGISTRY_VERSION: u16 = 1;
pub const GUARDIAN_REGION_VERSION: u16 = 2;
pub const EMPTY_BLUEPRINT_HASH: [u8; 16] = [
    37, 35, 34, 132, 228, 156, 242, 203, 66, 1, 187, 7, 46, 39, 98, 108,
];
pub const GUARDIAN_REGISTRY_SEED: &[u8] = b"guardian-registry";
pub const GUARDIAN_REGION_SEED: &[u8] = b"guardian-region";
pub const GUARDIAN_TREASURY_AUTHORITY_SEED: &[u8] = b"guardian-treasury";
pub const REGION_SIZE_CHUNKS: i32 = 100;
pub const REGION_SIZE_CHUNKS_U16: u16 = 100;
pub const GUARDIAN_STAKE_AMOUNT: u64 = 100_000_000_000;
// This policy value remains encoded for layout stability; no V2 instruction can slash stake.
pub const GUARDIAN_SLASH_AMOUNT: u64 = GUARDIAN_STAKE_AMOUNT / 10;
pub const MAX_HOST_LEN: usize = 64;
pub const REGION_STATUS_EMPTY: u8 = 0;
pub const REGION_STATUS_ACTIVE: u8 = 1;
pub const REGION_STATUS_REMOVED: u8 = 2;

pub struct GuardianRegistry;

impl GuardianRegistry {
    pub const LEN: usize = 160;
    pub const GLOBAL_CONFIG_OFFSET: usize = 12;
    pub const TREASURY_TOKEN_OFFSET: usize = 76;
    pub const ACTIVE_COUNT_OFFSET: usize = 116;
    pub const GENESIS_REGISTERED_OFFSET: usize = 124;

    #[allow(clippy::too_many_arguments)]
    pub fn pack(
        dst: &mut [u8],
        bump: u8,
        treasury_bump: u8,
        global_config: &Pubkey,
        nck_mint: &Pubkey,
        treasury_token: &Pubkey,
        created_slot: u64,
        created_at: i64,
    ) -> ProgramResult {
        if dst.len() != Self::LEN {
            return Err(NicechunkGuardianError::InvalidRegistryData.into());
        }

        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&GUARDIAN_REGISTRY_MAGIC)?;
        writer.u16(GUARDIAN_REGISTRY_VERSION)?;
        writer.u8(bump)?;
        writer.u8(treasury_bump)?;
        writer.pubkey(global_config)?;
        writer.pubkey(nck_mint)?;
        writer.pubkey(treasury_token)?;
        writer.u64(0)?;
        writer.u64(0)?;
        writer.u8(0)?;
        writer.u8(0)?;
        writer.u16(REGION_SIZE_CHUNKS_U16)?;
        writer.u64(GUARDIAN_STAKE_AMOUNT)?;
        writer.u64(GUARDIAN_SLASH_AMOUNT)?;
        writer.u64(created_slot)?;
        writer.i64(created_at)?;

        if writer.offset != Self::LEN {
            return Err(NicechunkGuardianError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate(data: &[u8], global_config: &Pubkey) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidRegistryData.into());
        }
        if &data[Self::GLOBAL_CONFIG_OFFSET..Self::GLOBAL_CONFIG_OFFSET + 32]
            != global_config.as_ref()
        {
            return Err(NicechunkGuardianError::InvalidRegistryData.into());
        }
        Ok(())
    }

    pub fn treasury_token(data: &[u8]) -> Result<Pubkey, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidRegistryData);
        }
        Ok(Pubkey::new_from_array(
            data[Self::TREASURY_TOKEN_OFFSET..Self::TREASURY_TOKEN_OFFSET + 32]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidRegistryData)?,
        ))
    }

    pub fn genesis_registered(data: &[u8]) -> Result<bool, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidRegistryData);
        }
        Ok(data[Self::GENESIS_REGISTERED_OFFSET] == 1)
    }

    pub fn add_active(data: &mut [u8], is_genesis: bool) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidRegistryData.into());
        }
        let active = read_u64(data, Self::ACTIVE_COUNT_OFFSET)
            .checked_add(1)
            .ok_or(NicechunkGuardianError::InvalidRegistryData)?;
        let total = read_u64(data, Self::ACTIVE_COUNT_OFFSET + 8)
            .checked_add(1)
            .ok_or(NicechunkGuardianError::InvalidRegistryData)?;
        data[Self::ACTIVE_COUNT_OFFSET..Self::ACTIVE_COUNT_OFFSET + 8]
            .copy_from_slice(&active.to_le_bytes());
        data[Self::ACTIVE_COUNT_OFFSET + 8..Self::ACTIVE_COUNT_OFFSET + 16]
            .copy_from_slice(&total.to_le_bytes());
        if is_genesis {
            data[Self::GENESIS_REGISTERED_OFFSET] = 1;
        }
        Ok(())
    }

    fn has_valid_layout(data: &[u8]) -> bool {
        data.len() == Self::LEN
            && data[0..8] == GUARDIAN_REGISTRY_MAGIC
            && u16::from_le_bytes([data[8], data[9]]) == GUARDIAN_REGISTRY_VERSION
    }
}

pub struct GuardianRegionInitArgs<'a> {
    pub bump: u8,
    pub status: u8,
    pub region_x: i32,
    pub region_y: i32,
    pub owner: &'a Pubkey,
    pub operator: &'a Pubkey,
    pub global_config: &'a Pubkey,
    pub host: &'a [u8],
    pub port: u16,
    pub use_tls: bool,
    pub created_slot: u64,
    pub created_at: i64,
}

pub struct GuardianRegion;

impl GuardianRegion {
    pub const LEN: usize = 288;
    pub const STATUS_OFFSET: usize = 11;
    pub const REGION_X_OFFSET: usize = 12;
    pub const REGION_Y_OFFSET: usize = 16;
    pub const OWNER_OFFSET: usize = 36;
    pub const OPERATOR_OFFSET: usize = 68;
    pub const GLOBAL_CONFIG_OFFSET: usize = 100;
    pub const HOST_LEN_OFFSET: usize = 132;
    pub const HOST_OFFSET: usize = 133;
    pub const PORT_OFFSET: usize = 197;
    pub const USE_TLS_OFFSET: usize = 199;
    pub const STAKE_AMOUNT_OFFSET: usize = 200;
    pub const TOTAL_SLASHED_OFFSET: usize = 208;
    pub const PENALTY_COUNT_OFFSET: usize = 216;
    pub const REGISTERED_AT_OFFSET: usize = 220;
    pub const LAST_PROOF_AT_OFFSET: usize = 228;
    pub const PENALTY_CURSOR_AT_OFFSET: usize = 236;
    pub const PROOF_COUNT_OFFSET: usize = 244;
    pub const UPDATED_SLOT_OFFSET: usize = 252;
    pub const BLUEPRINT_HASH_OFFSET: usize = 256;
    pub const BLUEPRINT_REVISION_OFFSET: usize = 272;
    pub const BLUEPRINT_RECORD_COUNT_OFFSET: usize = 280;
    pub const BLUEPRINT_RESERVED_OFFSET: usize = 284;

    pub fn pack(dst: &mut [u8], args: &GuardianRegionInitArgs) -> ProgramResult {
        if dst.len() != Self::LEN
            || args.owner != &GUARDIAN_TREASURY_WALLET
            || args.operator == &Pubkey::default()
        {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        validate_host(args.host)?;
        validate_port(args.port)?;

        let mut host_buf = [0_u8; MAX_HOST_LEN];
        host_buf[..args.host.len()].copy_from_slice(args.host);

        let min_chunk_x = args.region_x.saturating_mul(REGION_SIZE_CHUNKS);
        let min_chunk_y = args.region_y.saturating_mul(REGION_SIZE_CHUNKS);
        let max_chunk_x = min_chunk_x.saturating_add(REGION_SIZE_CHUNKS - 1);
        let max_chunk_y = min_chunk_y.saturating_add(REGION_SIZE_CHUNKS - 1);

        let mut writer = ByteWriter { dst, offset: 0 };
        writer.bytes(&GUARDIAN_REGION_MAGIC)?;
        writer.u16(GUARDIAN_REGION_VERSION)?;
        writer.u8(args.bump)?;
        writer.u8(args.status)?;
        writer.i32(args.region_x)?;
        writer.i32(args.region_y)?;
        writer.i32(min_chunk_x)?;
        writer.i32(min_chunk_y)?;
        writer.i32(max_chunk_x)?;
        writer.i32(max_chunk_y)?;
        writer.pubkey(args.owner)?;
        writer.pubkey(args.operator)?;
        writer.pubkey(args.global_config)?;
        writer.u8(args.host.len() as u8)?;
        writer.bytes(&host_buf)?;
        writer.u16(args.port)?;
        writer.u8(u8::from(args.use_tls))?;
        writer.u64(GUARDIAN_STAKE_AMOUNT)?;
        writer.u64(0)?;
        writer.u32(0)?;
        writer.i64(args.created_at)?;
        writer.i64(args.created_at)?;
        writer.i64(args.created_at)?;
        writer.u64(0)?;
        writer.u32(args.created_slot as u32)?;
        writer.bytes(&EMPTY_BLUEPRINT_HASH)?;
        writer.u64(0)?;
        writer.u32(0)?;
        writer.u32(0)?;

        if writer.offset != Self::LEN {
            return Err(NicechunkGuardianError::PackSizeMismatch.into());
        }
        Ok(())
    }

    pub fn validate_active(
        data: &[u8],
        global_config: &Pubkey,
        region_x: i32,
        region_y: i32,
    ) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        if data[Self::STATUS_OFFSET] != REGION_STATUS_ACTIVE {
            return Err(NicechunkGuardianError::GuardianNotActive.into());
        }
        if read_i32(data, Self::REGION_X_OFFSET) != region_x
            || read_i32(data, Self::REGION_Y_OFFSET) != region_y
            || &data[Self::OWNER_OFFSET..Self::OWNER_OFFSET + 32]
                != GUARDIAN_TREASURY_WALLET.as_ref()
            || &data[Self::GLOBAL_CONFIG_OFFSET..Self::GLOBAL_CONFIG_OFFSET + 32]
                != global_config.as_ref()
        {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        Ok(())
    }

    pub fn status(data: &[u8]) -> Result<u8, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Ok(REGION_STATUS_EMPTY);
        }
        Ok(data[Self::STATUS_OFFSET])
    }

    pub fn operator(data: &[u8]) -> Result<Pubkey, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData);
        }
        Ok(Pubkey::new_from_array(
            data[Self::OPERATOR_OFFSET..Self::OPERATOR_OFFSET + 32]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidGuardianRegionData)?,
        ))
    }

    pub fn owner(data: &[u8]) -> Result<Pubkey, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData);
        }
        Ok(Pubkey::new_from_array(
            data[Self::OWNER_OFFSET..Self::OWNER_OFFSET + 32]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidGuardianRegionData)?,
        ))
    }

    pub fn update_endpoint(
        data: &mut [u8],
        authority: &Pubkey,
        host: &[u8],
        port: u16,
        use_tls: bool,
        slot: u64,
    ) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        if data[Self::STATUS_OFFSET] != REGION_STATUS_ACTIVE {
            return Err(NicechunkGuardianError::GuardianNotActive.into());
        }
        if &Self::operator(data)? != authority {
            return Err(NicechunkGuardianError::InvalidOperatorAuthority.into());
        }
        validate_host(host)?;
        validate_port(port)?;

        let mut host_buf = [0_u8; MAX_HOST_LEN];
        host_buf[..host.len()].copy_from_slice(host);
        data[Self::HOST_LEN_OFFSET] = host.len() as u8;
        data[Self::HOST_OFFSET..Self::HOST_OFFSET + MAX_HOST_LEN].copy_from_slice(&host_buf);
        data[Self::PORT_OFFSET..Self::PORT_OFFSET + 2].copy_from_slice(&port.to_le_bytes());
        data[Self::USE_TLS_OFFSET] = u8::from(use_tls);
        data[Self::UPDATED_SLOT_OFFSET..Self::UPDATED_SLOT_OFFSET + 4]
            .copy_from_slice(&(slot as u32).to_le_bytes());
        Ok(())
    }

    pub fn set_operator(data: &mut [u8], operator: &Pubkey, slot: u64) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        if data[Self::STATUS_OFFSET] != REGION_STATUS_ACTIVE || operator == &Pubkey::default() {
            return Err(NicechunkGuardianError::InvalidOperatorAuthority.into());
        }
        data[Self::OPERATOR_OFFSET..Self::OPERATOR_OFFSET + 32].copy_from_slice(operator.as_ref());
        data[Self::UPDATED_SLOT_OFFSET..Self::UPDATED_SLOT_OFFSET + 4]
            .copy_from_slice(&(slot as u32).to_le_bytes());
        Ok(())
    }

    pub fn update_blueprint(
        data: &mut [u8],
        blueprint_hash: &[u8; 16],
        revision: u64,
        record_count: u32,
        slot: u64,
    ) -> ProgramResult {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData.into());
        }
        if data[Self::STATUS_OFFSET] != REGION_STATUS_ACTIVE {
            return Err(NicechunkGuardianError::GuardianNotActive.into());
        }
        let current_revision = u64::from_le_bytes(
            data[Self::BLUEPRINT_REVISION_OFFSET..Self::BLUEPRINT_REVISION_OFFSET + 8]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidGuardianRegionData)?,
        );
        let current_count = u32::from_le_bytes(
            data[Self::BLUEPRINT_RECORD_COUNT_OFFSET..Self::BLUEPRINT_RECORD_COUNT_OFFSET + 4]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidGuardianRegionData)?,
        );
        let same_hash = data[Self::BLUEPRINT_HASH_OFFSET..Self::BLUEPRINT_HASH_OFFSET + 16]
            == blueprint_hash[..];
        if revision < current_revision
            || revision == current_revision && (!same_hash || record_count != current_count)
        {
            return Err(NicechunkGuardianError::InvalidBlueprintRevision.into());
        }
        if revision == current_revision {
            return Ok(());
        }

        data[Self::BLUEPRINT_HASH_OFFSET..Self::BLUEPRINT_HASH_OFFSET + 16]
            .copy_from_slice(blueprint_hash);
        data[Self::BLUEPRINT_REVISION_OFFSET..Self::BLUEPRINT_REVISION_OFFSET + 8]
            .copy_from_slice(&revision.to_le_bytes());
        data[Self::BLUEPRINT_RECORD_COUNT_OFFSET..Self::BLUEPRINT_RECORD_COUNT_OFFSET + 4]
            .copy_from_slice(&record_count.to_le_bytes());
        data[Self::BLUEPRINT_RESERVED_OFFSET..Self::BLUEPRINT_RESERVED_OFFSET + 4].fill(0);
        data[Self::UPDATED_SLOT_OFFSET..Self::UPDATED_SLOT_OFFSET + 4]
            .copy_from_slice(&(slot as u32).to_le_bytes());
        Ok(())
    }

    pub fn blueprint_hash(data: &[u8]) -> Result<Option<[u8; 16]>, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData);
        }
        Ok(Some(
            data[Self::BLUEPRINT_HASH_OFFSET..Self::BLUEPRINT_HASH_OFFSET + 16]
                .try_into()
                .map_err(|_| NicechunkGuardianError::InvalidGuardianRegionData)?,
        ))
    }

    pub fn blueprint_revision(data: &[u8]) -> Result<u64, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData);
        }
        Ok(read_u64(data, Self::BLUEPRINT_REVISION_OFFSET))
    }

    pub fn blueprint_record_count(data: &[u8]) -> Result<u32, NicechunkGuardianError> {
        if !Self::has_valid_layout(data) {
            return Err(NicechunkGuardianError::InvalidGuardianRegionData);
        }
        Ok(read_u32(data, Self::BLUEPRINT_RECORD_COUNT_OFFSET))
    }

    fn has_valid_layout(data: &[u8]) -> bool {
        data.len() == Self::LEN
            && data[0..8] == GUARDIAN_REGION_MAGIC
            && u16::from_le_bytes([data[8], data[9]]) == GUARDIAN_REGION_VERSION
    }
}

pub fn validate_host(host: &[u8]) -> ProgramResult {
    if host.is_empty() || host.len() > MAX_HOST_LEN {
        return Err(NicechunkGuardianError::InvalidHost.into());
    }
    for byte in host {
        let valid = byte.is_ascii_alphanumeric()
            || matches!(*byte, b'.' | b'-' | b'_' | b':' | b'[' | b']');
        if !valid {
            return Err(NicechunkGuardianError::InvalidHost.into());
        }
    }
    Ok(())
}

pub fn validate_port(port: u16) -> ProgramResult {
    if port == 0 {
        return Err(NicechunkGuardianError::InvalidPort.into());
    }
    Ok(())
}

pub fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

pub fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

pub fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ])
}

struct ByteWriter<'a> {
    dst: &'a mut [u8],
    offset: usize,
}

impl ByteWriter<'_> {
    fn bytes(&mut self, value: &[u8]) -> ProgramResult {
        let end = self
            .offset
            .checked_add(value.len())
            .ok_or(NicechunkGuardianError::InvalidGuardianRegionData)?;
        if end > self.dst.len() {
            return Err(NicechunkGuardianError::PackSizeMismatch.into());
        }
        self.dst[self.offset..end].copy_from_slice(value);
        self.offset = end;
        Ok(())
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

    fn i32(&mut self, value: i32) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }

    fn i64(&mut self, value: i64) -> ProgramResult {
        self.bytes(&value.to_le_bytes())
    }

    fn pubkey(&mut self, value: &Pubkey) -> ProgramResult {
        self.bytes(value.as_ref())
    }
}
