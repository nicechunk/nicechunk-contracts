use solana_program::{entrypoint::ProgramResult, pubkey::Pubkey};

use crate::errors::NicechunkBuildingError;

pub const GLOBAL_CONFIG_LEN: usize = 293;
pub const GLOBAL_CONFIG_MAGIC: [u8; 8] = *b"NCKCFG01";
pub const CANONICAL_CHUNK_SIZE: u16 = 16;
pub const CANONICAL_MIN_BUILD_Y: i16 = -32;
pub const CANONICAL_MAX_BUILD_Y: i16 = 320;

const PLAYER_PROFILE_LEN: usize = 773;
const PLAYER_PROFILE_MAGIC: [u8; 8] = *b"NCKPLY01";
const PLAYER_PROFILE_OWNER_OFFSET: usize = 12;
const PLAYER_PROFILE_GLOBAL_CONFIG_OFFSET: usize = 44;
const PLAYER_SESSION_LEN: usize = 184;
const PLAYER_SESSION_MAGIC: [u8; 8] = *b"NCKSES01";
const PLAYER_SESSION_OWNER_OFFSET: usize = 12;
const PLAYER_SESSION_AUTHORITY_OFFSET: usize = 44;
const PLAYER_SESSION_PROFILE_OFFSET: usize = 76;
const PLAYER_SESSION_GLOBAL_CONFIG_OFFSET: usize = 108;
const PLAYER_SESSION_ALLOWED_ACTIONS_OFFSET: usize = 142;
const PLAYER_SESSION_EXPIRES_AT_OFFSET: usize = 144;

#[derive(Clone, Copy, Debug)]
pub struct GlobalConfigView {
    pub chunk_size: u16,
    pub min_build_y: i16,
    pub max_build_y: i16,
}

impl GlobalConfigView {
    pub fn unpack(data: &[u8]) -> Result<Self, NicechunkBuildingError> {
        if data.len() != GLOBAL_CONFIG_LEN || data[0..8] != GLOBAL_CONFIG_MAGIC {
            return Err(NicechunkBuildingError::InvalidGlobalConfigData);
        }
        Ok(Self {
            chunk_size: CANONICAL_CHUNK_SIZE,
            min_build_y: CANONICAL_MIN_BUILD_Y,
            max_build_y: CANONICAL_MAX_BUILD_Y,
        })
    }
}

pub struct PlayerProfileView;

impl PlayerProfileView {
    pub fn validate(data: &[u8], owner: &Pubkey, global_config: &Pubkey) -> ProgramResult {
        if data.len() != PLAYER_PROFILE_LEN || data[0..8] != PLAYER_PROFILE_MAGIC {
            return Err(NicechunkBuildingError::InvalidPlayerProfile.into());
        }
        if &data[PLAYER_PROFILE_OWNER_OFFSET..PLAYER_PROFILE_OWNER_OFFSET + 32] != owner.as_ref() {
            return Err(NicechunkBuildingError::InvalidPlayerAuthority.into());
        }
        if &data[PLAYER_PROFILE_GLOBAL_CONFIG_OFFSET..PLAYER_PROFILE_GLOBAL_CONFIG_OFFSET + 32]
            != global_config.as_ref()
        {
            return Err(NicechunkBuildingError::InvalidGlobalConfigData.into());
        }
        Ok(())
    }
}

pub struct PlayerSessionView {
    pub owner: Pubkey,
}

impl PlayerSessionView {
    pub fn validate(
        data: &[u8],
        session_authority: &Pubkey,
        player_profile: &Pubkey,
        global_config: &Pubkey,
        action: u8,
        now: i64,
    ) -> Result<Self, NicechunkBuildingError> {
        if data.len() != PLAYER_SESSION_LEN || data[0..8] != PLAYER_SESSION_MAGIC {
            return Err(NicechunkBuildingError::InvalidPlayerSession);
        }
        if &data[PLAYER_SESSION_AUTHORITY_OFFSET..PLAYER_SESSION_AUTHORITY_OFFSET + 32]
            != session_authority.as_ref()
        {
            return Err(NicechunkBuildingError::InvalidSessionAuthority);
        }
        if &data[PLAYER_SESSION_PROFILE_OFFSET..PLAYER_SESSION_PROFILE_OFFSET + 32]
            != player_profile.as_ref()
        {
            return Err(NicechunkBuildingError::InvalidPlayerProfile);
        }
        if &data[PLAYER_SESSION_GLOBAL_CONFIG_OFFSET..PLAYER_SESSION_GLOBAL_CONFIG_OFFSET + 32]
            != global_config.as_ref()
        {
            return Err(NicechunkBuildingError::InvalidGlobalConfigData);
        }
        if read_i64(data, PLAYER_SESSION_EXPIRES_AT_OFFSET) <= now {
            return Err(NicechunkBuildingError::PlayerSessionExpired);
        }
        let allowed_actions = read_u16(data, PLAYER_SESSION_ALLOWED_ACTIONS_OFFSET);
        if action >= 16 || allowed_actions & (1_u16 << action) == 0 {
            return Err(NicechunkBuildingError::SessionActionNotAllowed);
        }
        let owner = Pubkey::new_from_array(
            data[PLAYER_SESSION_OWNER_OFFSET..PLAYER_SESSION_OWNER_OFFSET + 32]
                .try_into()
                .map_err(|_| NicechunkBuildingError::InvalidPlayerSession)?,
        );
        Ok(Self { owner })
    }
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_i64(data: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or([0; 8]))
}
