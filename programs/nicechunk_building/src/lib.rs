#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    declare_id,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_program::entrypoint;

pub mod building;
pub mod cluster_config;
pub mod errors;
pub mod state;

use building::{
    building_axis_fits, building_shard_payload_len, hash_payload_slices, validate_ncm3_payload,
    BeginBuildingArgs, BuildSiteState, BuildingManifestState, BuildingShardState,
    CreateBuildSiteArgs, FoundationIndexOperation, ResizeBuildSiteArgs, WriteBuildingShardArgs,
    BUILDING_MANIFEST_LEN, BUILDING_MANIFEST_SEED, BUILDING_SHARD_HEADER_LEN, BUILDING_SHARD_SEED,
    BUILDING_STATUS_ACTIVE, BUILDING_STATUS_UPLOADING, BUILD_SITE_LEN, BUILD_SITE_SEED,
    BUILD_SITE_STATUS_ACTIVE, CHUNK_AUTHORITY_SEED,
};
use cluster_config::{
    GUARDIAN_BLUEPRINT_PUBLISHER_WALLET, GUARDIAN_TREASURY_WALLET, NICECHUNK_CHUNK_PROGRAM_ID,
    NICECHUNK_CORE_PROGRAM_ID, NICECHUNK_GUARDIAN_PROGRAM_ID, NICECHUNK_PLAYER_PROGRAM_ID,
};
use errors::{require_key_eq, NicechunkBuildingError};
use state::{GlobalConfigView, PlayerProfileView, PlayerSessionView};

declare_id!("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");

const LEGACY_BUILD_SITE_LEN: usize = 136;
const LEGACY_BUILD_SITE_VERSION: u8 = 1;
const CHUNK_REGISTER_INSTRUCTION: u8 = 15;
const MAX_INDEX_ACCOUNTS_PER_CALL: usize = 4;
const GUARDIAN_BLUEPRINT_AUTHORITY_SEED: &[u8] = b"guardian-blueprint";
const GUARDIAN_UPDATE_BLUEPRINT_INSTRUCTION: u8 = 6;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, payload) = instruction_data
        .split_first()
        .ok_or(NicechunkBuildingError::InvalidInstruction)?;
    match tag {
        0 => create_build_site(program_id, accounts, payload),
        1 => register_build_site_chunks(program_id, accounts, payload),
        2 => begin_building_upload(program_id, accounts, payload),
        3 => write_building_shard(program_id, accounts, payload),
        4 => finalize_building(program_id, accounts, payload),
        5 => cancel_building_upload(program_id, accounts, payload),
        6 => migrate_legacy_build_site(program_id, accounts, payload),
        7 => begin_build_site_resize(program_id, accounts, payload),
        8 => publish_guardian_blueprint(program_id, accounts, payload),
        _ => Err(NicechunkBuildingError::InvalidInstruction.into()),
    }
}

fn publish_guardian_blueprint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 5 || payload.len() != 36 {
        return Err(NicechunkBuildingError::InvalidInstruction.into());
    }
    let publisher = &accounts[0];
    let blueprint_authority = &accounts[1];
    let guardian_region = &accounts[2];
    let global_config = &accounts[3];
    let guardian_program = &accounts[4];

    if !publisher.is_signer {
        return Err(NicechunkBuildingError::InvalidGuardianBlueprintPublisher.into());
    }
    validate_guardian_blueprint_publisher(publisher.key)?;
    if !guardian_region.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    validate_global_config(global_config)?;
    require_key_eq(
        guardian_program.key,
        &NICECHUNK_GUARDIAN_PROGRAM_ID,
        NicechunkBuildingError::InvalidGuardianProgram,
    )?;
    if !guardian_program.executable {
        return Err(NicechunkBuildingError::InvalidGuardianProgram.into());
    }

    let (expected_authority, authority_bump) = Pubkey::find_program_address(
        &[
            GUARDIAN_BLUEPRINT_AUTHORITY_SEED,
            global_config.key.as_ref(),
        ],
        program_id,
    );
    require_key_eq(
        blueprint_authority.key,
        &expected_authority,
        NicechunkBuildingError::InvalidGuardianBlueprintAuthority,
    )?;

    let mut data = Vec::with_capacity(1 + payload.len());
    data.push(GUARDIAN_UPDATE_BLUEPRINT_INSTRUCTION);
    data.extend_from_slice(payload);
    let instruction = Instruction {
        program_id: *guardian_program.key,
        accounts: vec![
            AccountMeta::new_readonly(*blueprint_authority.key, true),
            AccountMeta::new(*guardian_region.key, false),
            AccountMeta::new_readonly(*global_config.key, false),
        ],
        data,
    };
    let bump_seed = [authority_bump];
    let authority_seeds = [
        GUARDIAN_BLUEPRINT_AUTHORITY_SEED,
        global_config.key.as_ref(),
        bump_seed.as_ref(),
    ];
    invoke_signed(
        &instruction,
        &[
            blueprint_authority.clone(),
            guardian_region.clone(),
            global_config.clone(),
            guardian_program.clone(),
        ],
        &[&authority_seeds],
    )
}

fn validate_guardian_blueprint_publisher(publisher: &Pubkey) -> ProgramResult {
    if publisher != &GUARDIAN_TREASURY_WALLET && publisher != &GUARDIAN_BLUEPRINT_PUBLISHER_WALLET {
        return Err(NicechunkBuildingError::InvalidGuardianBlueprintPublisher.into());
    }
    Ok(())
}

struct PlayerActionContext {
    config: GlobalConfigView,
    owner: Pubkey,
    clock: Clock,
}

fn validate_player_action(
    session_authority: &AccountInfo,
    player_profile: &AccountInfo,
    player_session: &AccountInfo,
    global_config: &AccountInfo,
    system_program_account: &AccountInfo,
) -> Result<PlayerActionContext, solana_program::program_error::ProgramError> {
    if !session_authority.is_signer || !session_authority.is_writable {
        return Err(NicechunkBuildingError::InvalidSessionAuthority.into());
    }
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkBuildingError::InvalidSystemProgram,
    )?;
    require_key_eq(
        player_profile.owner,
        &NICECHUNK_PLAYER_PROGRAM_ID,
        NicechunkBuildingError::InvalidPlayerProgram,
    )?;
    require_key_eq(
        player_session.owner,
        &NICECHUNK_PLAYER_PROGRAM_ID,
        NicechunkBuildingError::InvalidPlayerProgram,
    )?;
    let config = validate_global_config(global_config)?;
    let clock = Clock::get()?;
    let owner = {
        let data = player_session.try_borrow_data()?;
        PlayerSessionView::validate(
            &data,
            session_authority.key,
            player_profile.key,
            global_config.key,
            1,
            clock.unix_timestamp,
        )?
        .owner
    };
    {
        let data = player_profile.try_borrow_data()?;
        PlayerProfileView::validate(&data, &owner, global_config.key)?;
    }
    Ok(PlayerActionContext {
        config,
        owner,
        clock,
    })
}

fn validate_global_config(
    global_config: &AccountInfo,
) -> Result<GlobalConfigView, solana_program::program_error::ProgramError> {
    require_key_eq(
        global_config.owner,
        &NICECHUNK_CORE_PROGRAM_ID,
        NicechunkBuildingError::InvalidGlobalConfigOwner,
    )?;
    let data = global_config.try_borrow_data()?;
    GlobalConfigView::unpack(&data).map_err(Into::into)
}

fn create_build_site(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let args = CreateBuildSiteArgs::unpack(payload)?;
    if accounts.len() != 6 {
        return Err(NicechunkBuildingError::InvalidAccountCount.into());
    }
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let global_config = &accounts[4];
    let system_program_account = &accounts[5];
    if !build_site.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    args.validate(&context.config)?;
    let site_bump = validate_build_site_pda(
        program_id,
        build_site.key,
        global_config.key,
        args.foundation_id,
    )?;
    if build_site.owner == program_id {
        let data = build_site.try_borrow_data()?;
        return if BuildSiteState::matches_creation(&data, &context.owner, global_config.key, &args)?
        {
            Ok(())
        } else {
            Err(NicechunkBuildingError::InvalidBuildSiteData.into())
        };
    }
    if build_site.owner != &system_program::ID || build_site.data_len() != 0 {
        return Err(NicechunkBuildingError::InvalidSystemAccount.into());
    }
    let foundation_id_bytes = args.foundation_id.to_le_bytes();
    let bump_seed = [site_bump];
    let seeds = [
        BUILD_SITE_SEED,
        global_config.key.as_ref(),
        foundation_id_bytes.as_ref(),
        bump_seed.as_ref(),
    ];
    create_fixed_pda_account(
        session_authority,
        build_site,
        system_program_account,
        program_id,
        BUILD_SITE_LEN,
        &seeds,
    )?;
    let mut data = build_site.try_borrow_mut_data()?;
    BuildSiteState::pack(
        &mut data,
        site_bump,
        &context.owner,
        global_config.key,
        &args,
        context.clock.slot,
    )
}

fn migrate_legacy_build_site(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 8 || accounts.len() != 7 {
        return Err(NicechunkBuildingError::InvalidInstruction.into());
    }
    let foundation_id = u64::from_le_bytes(
        payload
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let legacy_site = &accounts[4];
    let global_config = &accounts[5];
    let system_program_account = &accounts[6];
    if !build_site.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        legacy_site.owner,
        &NICECHUNK_CHUNK_PROGRAM_ID,
        NicechunkBuildingError::InvalidLegacyBuildSite,
    )?;
    validate_legacy_build_site_pda(legacy_site.key, global_config.key, foundation_id)?;
    let args = {
        let data = legacy_site.try_borrow_data()?;
        decode_legacy_build_site(&data, &context.owner, global_config.key, foundation_id)?
    };
    args.validate(&context.config)?;
    let site_bump =
        validate_build_site_pda(program_id, build_site.key, global_config.key, foundation_id)?;
    if build_site.owner == program_id {
        let data = build_site.try_borrow_data()?;
        return if BuildSiteState::matches_creation(&data, &context.owner, global_config.key, &args)?
        {
            Ok(())
        } else {
            Err(NicechunkBuildingError::InvalidBuildSiteData.into())
        };
    }
    let foundation_id_bytes = foundation_id.to_le_bytes();
    let bump_seed = [site_bump];
    let seeds = [
        BUILD_SITE_SEED,
        global_config.key.as_ref(),
        foundation_id_bytes.as_ref(),
        bump_seed.as_ref(),
    ];
    create_fixed_pda_account(
        session_authority,
        build_site,
        system_program_account,
        program_id,
        BUILD_SITE_LEN,
        &seeds,
    )?;
    let mut data = build_site.try_borrow_mut_data()?;
    BuildSiteState::pack(
        &mut data,
        site_bump,
        &context.owner,
        global_config.key,
        &args,
        context.clock.slot,
    )
}

fn begin_build_site_resize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let args = ResizeBuildSiteArgs::unpack(payload)?;
    if accounts.len() < 6 || accounts.len() > 7 {
        return Err(NicechunkBuildingError::InvalidAccountCount.into());
    }
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let global_config = &accounts[4];
    let system_program_account = &accounts[5];
    if !build_site.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(
        program_id,
        build_site.key,
        global_config.key,
        args.foundation_id,
    )?;
    let site = {
        let data = build_site.try_borrow_data()?;
        BuildSiteState::validate(&data)?
    };
    if site.owner != context.owner
        || site.global_config != *global_config.key
        || site.foundation_id != args.foundation_id
    {
        return Err(NicechunkBuildingError::InvalidBuildSiteData.into());
    }
    if BuildSiteState::matches_resize(&build_site.try_borrow_data()?, args.width, args.depth)? {
        return Ok(());
    }
    if site.active_revision == 0 {
        if accounts.len() != 6 {
            return Err(NicechunkBuildingError::InvalidAccountCount.into());
        }
    } else {
        if accounts.len() != 7 {
            return Err(NicechunkBuildingError::InvalidAccountCount.into());
        }
        let manifest = &accounts[6];
        require_key_eq(
            manifest.owner,
            program_id,
            NicechunkBuildingError::InvalidBuildingManifestData,
        )?;
        validate_building_manifest_pda(
            program_id,
            manifest.key,
            global_config.key,
            args.foundation_id,
            site.active_revision,
        )?;
        let manifest = {
            let data = manifest.try_borrow_data()?;
            BuildingManifestState::validate(&data)?
        };
        if manifest.owner != context.owner
            || manifest.global_config != *global_config.key
            || manifest.foundation_id != args.foundation_id
            || manifest.revision != site.active_revision
            || manifest.status != BUILDING_STATUS_ACTIVE
        {
            return Err(NicechunkBuildingError::InvalidBuildingManifestData.into());
        }
        let (building_width, building_depth) = if manifest.quarter_turns % 2 == 0 {
            (u32::from(manifest.size_x), u32::from(manifest.size_z))
        } else {
            (u32::from(manifest.size_z), u32::from(manifest.size_x))
        };
        if !building_axis_fits(args.width, building_width, manifest.offset_x)
            || !building_axis_fits(args.depth, building_depth, manifest.offset_z)
        {
            return Err(NicechunkBuildingError::BuildingDoesNotFit.into());
        }
    }
    let mut data = build_site.try_borrow_mut_data()?;
    BuildSiteState::begin_resize(
        &mut data,
        &context.owner,
        global_config.key,
        args.width,
        args.depth,
        context.clock.slot,
    )
}

fn register_build_site_chunks(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 8 || accounts.len() < 9 || accounts.len() > 8 + MAX_INDEX_ACCOUNTS_PER_CALL
    {
        return Err(NicechunkBuildingError::InvalidAccountCount.into());
    }
    let foundation_id = u64::from_le_bytes(
        payload
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let chunk_authority = &accounts[4];
    let global_config = &accounts[5];
    let chunk_program = &accounts[6];
    let system_program_account = &accounts[7];
    let foundation_chunks = &accounts[8..];
    if !build_site.is_writable || foundation_chunks.iter().any(|account| !account.is_writable) {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        chunk_program.key,
        &NICECHUNK_CHUNK_PROGRAM_ID,
        NicechunkBuildingError::InvalidChunkProgram,
    )?;
    if !chunk_program.executable {
        return Err(NicechunkBuildingError::InvalidChunkProgram.into());
    }
    let (expected_authority, authority_bump) = Pubkey::find_program_address(
        &[CHUNK_AUTHORITY_SEED, global_config.key.as_ref()],
        program_id,
    );
    require_key_eq(
        chunk_authority.key,
        &expected_authority,
        NicechunkBuildingError::InvalidChunkAuthority,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(program_id, build_site.key, global_config.key, foundation_id)?;
    let site = {
        let data = build_site.try_borrow_data()?;
        BuildSiteState::validate(&data)?
    };
    if site.owner != context.owner
        || site.global_config != *global_config.key
        || site.foundation_id != foundation_id
    {
        return Err(NicechunkBuildingError::InvalidBuildSiteData.into());
    }
    if site.status == BUILD_SITE_STATUS_ACTIVE {
        return Ok(());
    }
    let authority_bump_seed = [authority_bump];
    let authority_seeds = [
        CHUNK_AUTHORITY_SEED,
        global_config.key.as_ref(),
        authority_bump_seed.as_ref(),
    ];
    for (offset, foundation_chunk) in foundation_chunks.iter().enumerate() {
        let index = site
            .registered_chunks
            .checked_add(offset as u64)
            .ok_or(NicechunkBuildingError::InvalidBuildSiteData)?;
        let step = BuildSiteState::index_step(&site, index)?;
        let instruction = register_chunk_instruction(
            chunk_authority.key,
            session_authority.key,
            foundation_chunk.key,
            global_config.key,
            &site.owner,
            &step.foundation,
            step.operation,
            step.chunk_x,
            step.chunk_z,
        );
        invoke_signed(
            &instruction,
            &[
                chunk_authority.clone(),
                session_authority.clone(),
                foundation_chunk.clone(),
                global_config.clone(),
                system_program_account.clone(),
                chunk_program.clone(),
            ],
            &[&authority_seeds],
        )?;
    }
    let mut data = build_site.try_borrow_mut_data()?;
    BuildSiteState::advance_indexing(
        &mut data,
        &context.owner,
        global_config.key,
        foundation_chunks.len() as u64,
        context.clock.slot,
    )
}

fn register_chunk_instruction(
    authority: &Pubkey,
    payer: &Pubkey,
    foundation_chunk: &Pubkey,
    global_config: &Pubkey,
    owner: &Pubkey,
    foundation: &CreateBuildSiteArgs,
    operation: FoundationIndexOperation,
    chunk_x: i32,
    chunk_z: i32,
) -> Instruction {
    let mut data = Vec::with_capacity(68);
    data.push(CHUNK_REGISTER_INSTRUCTION);
    data.extend_from_slice(owner.as_ref());
    data.extend_from_slice(&foundation.foundation_id.to_le_bytes());
    data.extend_from_slice(&foundation.min_x.to_le_bytes());
    data.extend_from_slice(&foundation.min_z.to_le_bytes());
    data.extend_from_slice(&foundation.surface_y.to_le_bytes());
    data.extend_from_slice(&foundation.width.to_le_bytes());
    data.extend_from_slice(&foundation.depth.to_le_bytes());
    data.extend_from_slice(&chunk_x.to_le_bytes());
    data.extend_from_slice(&chunk_z.to_le_bytes());
    data.push(operation as u8);
    Instruction {
        program_id: NICECHUNK_CHUNK_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(*foundation_chunk, false),
            AccountMeta::new_readonly(*global_config, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn validate_legacy_build_site_pda(
    site: &Pubkey,
    global_config: &Pubkey,
    foundation_id: u64,
) -> ProgramResult {
    let id = foundation_id.to_le_bytes();
    let (expected, _) = Pubkey::find_program_address(
        &[BUILD_SITE_SEED, global_config.as_ref(), &id],
        &NICECHUNK_CHUNK_PROGRAM_ID,
    );
    require_key_eq(
        site,
        &expected,
        NicechunkBuildingError::InvalidLegacyBuildSite,
    )
}

fn decode_legacy_build_site(
    data: &[u8],
    owner: &Pubkey,
    global_config: &Pubkey,
    foundation_id: u64,
) -> Result<CreateBuildSiteArgs, NicechunkBuildingError> {
    if data.len() != LEGACY_BUILD_SITE_LEN
        || data[0..8] != building::BUILD_SITE_MAGIC
        || data[8] != LEGACY_BUILD_SITE_VERSION
        || data[10] != BUILD_SITE_STATUS_ACTIVE
        || &data[16..48] != owner.as_ref()
        || &data[48..80] != global_config.as_ref()
        || read_u64(data, 80) != foundation_id
    {
        return Err(NicechunkBuildingError::InvalidLegacyBuildSite);
    }
    if read_u32(data, 116) != 0 || read_u32(data, 120) != 0 {
        return Err(NicechunkBuildingError::LegacyBuildingMigrationRequired);
    }
    Ok(CreateBuildSiteArgs {
        foundation_id,
        min_x: read_i32(data, 88),
        min_z: read_i32(data, 92),
        surface_y: read_i16(data, 96),
        width: read_u32(data, 100),
        depth: read_u32(data, 104),
    })
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap_or([0; 4]))
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or([0; 8]))
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap_or([0; 4]))
}

fn read_i16(data: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes(data[offset..offset + 2].try_into().unwrap_or([0; 2]))
}

#[cfg(test)]
mod legacy_build_site_tests {
    use super::*;

    #[test]
    fn decodes_the_deployed_136_byte_build_site_layout() {
        let owner = Pubkey::new_unique();
        let global_config = Pubkey::new_unique();
        let foundation_id = 12_065_219_072_965_175_186_u64;
        let mut data = vec![0_u8; LEGACY_BUILD_SITE_LEN];
        data[0..8].copy_from_slice(&building::BUILD_SITE_MAGIC);
        data[8] = LEGACY_BUILD_SITE_VERSION;
        data[10] = BUILD_SITE_STATUS_ACTIVE;
        data[16..48].copy_from_slice(owner.as_ref());
        data[48..80].copy_from_slice(global_config.as_ref());
        data[80..88].copy_from_slice(&foundation_id.to_le_bytes());
        data[88..92].copy_from_slice(&748_i32.to_le_bytes());
        data[92..96].copy_from_slice(&781_i32.to_le_bytes());
        data[96..98].copy_from_slice(&136_i16.to_le_bytes());
        data[100..104].copy_from_slice(&12_u32.to_le_bytes());
        data[104..108].copy_from_slice(&8_u32.to_le_bytes());

        let decoded =
            decode_legacy_build_site(&data, &owner, &global_config, foundation_id).unwrap();

        assert_eq!(decoded.min_x, 748);
        assert_eq!(decoded.min_z, 781);
        assert_eq!(decoded.surface_y, 136);
        assert_eq!(decoded.width, 12);
        assert_eq!(decoded.depth, 8);
    }
}

#[cfg(test)]
mod guardian_blueprint_tests {
    use super::*;

    #[test]
    fn only_governance_and_index_publisher_can_request_blueprint_cpi() {
        assert!(validate_guardian_blueprint_publisher(&GUARDIAN_TREASURY_WALLET).is_ok());
        assert!(
            validate_guardian_blueprint_publisher(&GUARDIAN_BLUEPRINT_PUBLISHER_WALLET).is_ok()
        );
        assert!(validate_guardian_blueprint_publisher(&Pubkey::new_unique()).is_err());
    }

    #[test]
    fn blueprint_cpi_authority_is_an_off_curve_building_pda() {
        let global_config = Pubkey::new_unique();
        let (authority, _) = Pubkey::find_program_address(
            &[GUARDIAN_BLUEPRINT_AUTHORITY_SEED, global_config.as_ref()],
            &crate::id(),
        );
        assert!(!authority.is_on_curve());
        assert_ne!(authority, GUARDIAN_TREASURY_WALLET);
        assert_ne!(authority, GUARDIAN_BLUEPRINT_PUBLISHER_WALLET);
    }
}
fn begin_building_upload(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 7 {
        return Err(NicechunkBuildingError::InvalidAccountCount.into());
    }
    let args = BeginBuildingArgs::unpack(payload)?;
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let manifest = &accounts[4];
    let global_config = &accounts[5];
    let system_program_account = &accounts[6];
    if !build_site.is_writable || !manifest.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(
        program_id,
        build_site.key,
        global_config.key,
        args.foundation_id,
    )?;
    {
        let data = build_site.try_borrow_data()?;
        let view = BuildSiteState::validate(&data)?;
        if view.owner != context.owner
            || view.global_config != *global_config.key
            || view.foundation_id != args.foundation_id
            || view.pending_revision != 0
            || args.revision != view.active_revision.saturating_add(1)
        {
            return Err(NicechunkBuildingError::BuildingRevisionConflict.into());
        }
    }
    let manifest_bump = validate_building_manifest_pda(
        program_id,
        manifest.key,
        global_config.key,
        args.foundation_id,
        args.revision,
    )?;
    if manifest.owner == program_id {
        return Err(NicechunkBuildingError::BuildingAlreadyExists.into());
    }
    if manifest.owner != &system_program::ID || manifest.data_len() != 0 {
        return Err(NicechunkBuildingError::InvalidSystemAccount.into());
    }
    let foundation_id_bytes = args.foundation_id.to_le_bytes();
    let revision_bytes = args.revision.to_le_bytes();
    let bump_seed = [manifest_bump];
    let seeds = [
        BUILDING_MANIFEST_SEED,
        global_config.key.as_ref(),
        foundation_id_bytes.as_ref(),
        revision_bytes.as_ref(),
        bump_seed.as_ref(),
    ];
    create_fixed_pda_account(
        session_authority,
        manifest,
        system_program_account,
        program_id,
        BUILDING_MANIFEST_LEN,
        &seeds,
    )?;
    {
        let mut data = manifest.try_borrow_mut_data()?;
        BuildingManifestState::pack_upload(
            &mut data,
            manifest_bump,
            &context.owner,
            global_config.key,
            &args,
            context.clock.slot,
        )?;
    }
    {
        let mut data = build_site.try_borrow_mut_data()?;
        BuildSiteState::begin_building(
            &mut data,
            &context.owner,
            global_config.key,
            args.revision,
            context.clock.slot,
        )?;
    }
    Ok(())
}

fn write_building_shard(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 8 {
        return Err(NicechunkBuildingError::InvalidAccountCount.into());
    }
    let args = WriteBuildingShardArgs::unpack(payload)?;
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let manifest = &accounts[4];
    let shard = &accounts[5];
    let global_config = &accounts[6];
    let system_program_account = &accounts[7];
    if !manifest.is_writable || !shard.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(
        program_id,
        build_site.key,
        global_config.key,
        args.foundation_id,
    )?;
    {
        let data = build_site.try_borrow_data()?;
        let view = BuildSiteState::validate(&data)?;
        if view.owner != context.owner
            || view.global_config != *global_config.key
            || view.foundation_id != args.foundation_id
            || view.pending_revision != args.revision
        {
            return Err(NicechunkBuildingError::BuildingRevisionConflict.into());
        }
    }
    require_key_eq(
        manifest.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildingManifestData,
    )?;
    validate_building_manifest_pda(
        program_id,
        manifest.key,
        global_config.key,
        args.foundation_id,
        args.revision,
    )?;
    let expected_shard_len = {
        let data = manifest.try_borrow_data()?;
        let view = BuildingManifestState::validate(&data)?;
        if view.owner != context.owner
            || view.global_config != *global_config.key
            || view.foundation_id != args.foundation_id
            || view.revision != args.revision
            || view.status != BUILDING_STATUS_UPLOADING
        {
            return Err(NicechunkBuildingError::InvalidBuildingManifestData.into());
        }
        building_shard_payload_len(view.payload_len, args.shard_index)?
    };
    let shard_bump = validate_building_shard_pda(
        program_id,
        shard.key,
        global_config.key,
        args.foundation_id,
        args.revision,
        args.shard_index,
    )?;
    if shard.owner != program_id {
        if args.offset != 0 || shard.owner != &system_program::ID || shard.data_len() != 0 {
            return Err(NicechunkBuildingError::InvalidBuildingShardData.into());
        }
        let foundation_id_bytes = args.foundation_id.to_le_bytes();
        let revision_bytes = args.revision.to_le_bytes();
        let shard_index_seed = [args.shard_index];
        let bump_seed = [shard_bump];
        let seeds = [
            BUILDING_SHARD_SEED,
            global_config.key.as_ref(),
            foundation_id_bytes.as_ref(),
            revision_bytes.as_ref(),
            shard_index_seed.as_ref(),
            bump_seed.as_ref(),
        ];
        create_fixed_pda_account(
            session_authority,
            shard,
            system_program_account,
            program_id,
            BuildingShardState::len_for_payload(expected_shard_len)?,
            &seeds,
        )?;
        let mut data = shard.try_borrow_mut_data()?;
        BuildingShardState::pack_empty(
            &mut data,
            shard_bump,
            global_config.key,
            args.foundation_id,
            args.revision,
            args.shard_index,
            expected_shard_len,
        )?;
    }
    let completed = {
        let mut data = shard.try_borrow_mut_data()?;
        let view = BuildingShardState::validate(&data)?;
        if view.global_config != *global_config.key
            || view.payload_len as usize != expected_shard_len
        {
            return Err(NicechunkBuildingError::InvalidBuildingShardData.into());
        }
        BuildingShardState::append(
            &mut data,
            args.foundation_id,
            args.revision,
            args.shard_index,
            args.offset,
            args.bytes,
        )?
    };
    if completed {
        let mut data = manifest.try_borrow_mut_data()?;
        BuildingManifestState::mark_shard_complete(
            &mut data,
            args.foundation_id,
            args.revision,
            args.shard_index,
            context.clock.slot,
        )?;
    }
    Ok(())
}

fn finalize_building(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 12 || accounts.len() < 8 {
        return Err(NicechunkBuildingError::InvalidInstruction.into());
    }
    let foundation_id = u64::from_le_bytes(
        payload[0..8]
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let revision = u32::from_le_bytes(
        payload[8..12]
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let manifest = &accounts[4];
    let global_config = &accounts[5];
    let system_program_account = &accounts[6];
    let shard_accounts = &accounts[7..];
    if !build_site.is_writable || !manifest.is_writable {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(program_id, build_site.key, global_config.key, foundation_id)?;
    let site = {
        let data = build_site.try_borrow_data()?;
        BuildSiteState::validate(&data)?
    };
    if site.owner != context.owner
        || site.global_config != *global_config.key
        || site.foundation_id != foundation_id
        || site.pending_revision != revision
    {
        return Err(NicechunkBuildingError::BuildingRevisionConflict.into());
    }
    require_key_eq(
        manifest.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildingManifestData,
    )?;
    validate_building_manifest_pda(
        program_id,
        manifest.key,
        global_config.key,
        foundation_id,
        revision,
    )?;
    let manifest_view = {
        let data = manifest.try_borrow_data()?;
        BuildingManifestState::validate(&data)?
    };
    if manifest_view.owner != context.owner
        || manifest_view.global_config != *global_config.key
        || manifest_view.foundation_id != foundation_id
        || manifest_view.revision != revision
        || manifest_view.status != BUILDING_STATUS_UPLOADING
        || shard_accounts.len() != manifest_view.shard_count as usize
    {
        return Err(NicechunkBuildingError::InvalidBuildingManifestData.into());
    }

    for (index, account) in shard_accounts.iter().enumerate() {
        require_key_eq(
            account.owner,
            program_id,
            NicechunkBuildingError::InvalidBuildingShardData,
        )?;
        validate_building_shard_pda(
            program_id,
            account.key,
            global_config.key,
            foundation_id,
            revision,
            index as u8,
        )?;
    }
    let shard_data = shard_accounts
        .iter()
        .map(AccountInfo::try_borrow_data)
        .collect::<Result<Vec<_>, _>>()?;
    let mut payload_slices = Vec::with_capacity(shard_data.len());
    for (index, data) in shard_data.iter().enumerate() {
        let view = BuildingShardState::validate(data)?;
        let expected_len = building_shard_payload_len(manifest_view.payload_len, index as u8)?;
        if view.global_config != *global_config.key
            || view.foundation_id != foundation_id
            || view.revision != revision
            || view.shard_index != index as u8
            || view.uploaded_len != view.payload_len
            || view.payload_len as usize != expected_len
        {
            return Err(NicechunkBuildingError::InvalidBuildingShardData.into());
        }
        payload_slices.push(&data[BUILDING_SHARD_HEADER_LEN..]);
    }
    if hash_payload_slices(&payload_slices) != manifest_view.expected_hash {
        return Err(NicechunkBuildingError::BuildingHashMismatch.into());
    }
    let dimensions = validate_ncm3_payload(&payload_slices)?;
    let (footprint_width, footprint_depth) = if manifest_view.quarter_turns % 2 == 0 {
        (dimensions.x, dimensions.z)
    } else {
        (dimensions.z, dimensions.x)
    };
    let max_build_y = i32::from(site.surface_y)
        .checked_add(
            i32::try_from(dimensions.y).map_err(|_| NicechunkBuildingError::BuildingDoesNotFit)?,
        )
        .and_then(|value| value.checked_sub(1))
        .ok_or(NicechunkBuildingError::BuildingDoesNotFit)?;
    if !building_axis_fits(site.width, footprint_width, manifest_view.offset_x)
        || !building_axis_fits(site.depth, footprint_depth, manifest_view.offset_z)
        || max_build_y > i32::from(context.config.max_build_y)
    {
        return Err(NicechunkBuildingError::BuildingDoesNotFit.into());
    }
    drop(payload_slices);
    drop(shard_data);
    {
        let mut data = manifest.try_borrow_mut_data()?;
        BuildingManifestState::activate(
            &mut data,
            foundation_id,
            revision,
            dimensions,
            context.clock.slot,
        )?;
    }
    {
        let mut data = build_site.try_borrow_mut_data()?;
        BuildSiteState::activate_building(
            &mut data,
            &context.owner,
            global_config.key,
            revision,
            context.clock.slot,
        )?;
    }
    Ok(())
}

fn cancel_building_upload(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() != 12 || accounts.len() < 8 {
        return Err(NicechunkBuildingError::InvalidInstruction.into());
    }
    let foundation_id = u64::from_le_bytes(
        payload[0..8]
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let revision = u32::from_le_bytes(
        payload[8..12]
            .try_into()
            .map_err(|_| NicechunkBuildingError::InvalidInstruction)?,
    );
    let session_authority = &accounts[0];
    let player_profile = &accounts[1];
    let player_session = &accounts[2];
    let build_site = &accounts[3];
    let manifest = &accounts[4];
    let global_config = &accounts[5];
    let system_program_account = &accounts[6];
    let shard_accounts = &accounts[7..];
    if !build_site.is_writable
        || !manifest.is_writable
        || shard_accounts.iter().any(|account| !account.is_writable)
    {
        return Err(NicechunkBuildingError::InvalidWritableAccount.into());
    }
    let context = validate_player_action(
        session_authority,
        player_profile,
        player_session,
        global_config,
        system_program_account,
    )?;
    require_key_eq(
        build_site.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildSiteData,
    )?;
    validate_build_site_pda(program_id, build_site.key, global_config.key, foundation_id)?;
    {
        let data = build_site.try_borrow_data()?;
        let site = BuildSiteState::validate(&data)?;
        if site.owner != context.owner
            || site.global_config != *global_config.key
            || site.foundation_id != foundation_id
            || site.pending_revision != revision
        {
            return Err(NicechunkBuildingError::BuildingRevisionConflict.into());
        }
    }
    require_key_eq(
        manifest.owner,
        program_id,
        NicechunkBuildingError::InvalidBuildingManifestData,
    )?;
    validate_building_manifest_pda(
        program_id,
        manifest.key,
        global_config.key,
        foundation_id,
        revision,
    )?;
    let manifest_view = {
        let data = manifest.try_borrow_data()?;
        BuildingManifestState::validate(&data)?
    };
    if manifest_view.owner != context.owner
        || manifest_view.global_config != *global_config.key
        || manifest_view.foundation_id != foundation_id
        || manifest_view.revision != revision
        || manifest_view.status != BUILDING_STATUS_UPLOADING
        || shard_accounts.len() != manifest_view.shard_count as usize
    {
        return Err(NicechunkBuildingError::InvalidBuildingManifestData.into());
    }

    for (index, account) in shard_accounts.iter().enumerate() {
        validate_building_shard_pda(
            program_id,
            account.key,
            global_config.key,
            foundation_id,
            revision,
            index as u8,
        )?;
        if account.owner == program_id {
            let data = account.try_borrow_data()?;
            let shard = BuildingShardState::validate(&data)?;
            if shard.global_config != *global_config.key
                || shard.foundation_id != foundation_id
                || shard.revision != revision
                || shard.shard_index != index as u8
            {
                return Err(NicechunkBuildingError::InvalidBuildingShardData.into());
            }
        } else if account.owner != &system_program::ID || account.data_len() != 0 {
            return Err(NicechunkBuildingError::InvalidBuildingShardData.into());
        }
    }

    {
        let mut data = build_site.try_borrow_mut_data()?;
        BuildSiteState::cancel_building(
            &mut data,
            &context.owner,
            global_config.key,
            revision,
            context.clock.slot,
        )?;
    }
    for account in shard_accounts {
        if account.owner == program_id {
            close_program_account(account, session_authority)?;
        }
    }
    close_program_account(manifest, session_authority)
}

fn close_program_account(account: &AccountInfo, recipient: &AccountInfo) -> ProgramResult {
    let account_lamports = account.lamports();
    let recipient_lamports = recipient.lamports();
    **recipient.try_borrow_mut_lamports()? = recipient_lamports
        .checked_add(account_lamports)
        .ok_or(NicechunkBuildingError::InvalidSystemAccount)?;
    **account.try_borrow_mut_lamports()? = 0;
    account.try_borrow_mut_data()?.fill(0);
    Ok(())
}

fn validate_build_site_pda(
    program_id: &Pubkey,
    build_site: &Pubkey,
    global_config: &Pubkey,
    foundation_id: u64,
) -> Result<u8, solana_program::program_error::ProgramError> {
    let foundation_id_bytes = foundation_id.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(
        &[
            BUILD_SITE_SEED,
            global_config.as_ref(),
            &foundation_id_bytes,
        ],
        program_id,
    );
    require_key_eq(
        build_site,
        &expected,
        NicechunkBuildingError::InvalidBuildSitePda,
    )?;
    Ok(bump)
}

fn validate_building_manifest_pda(
    program_id: &Pubkey,
    manifest: &Pubkey,
    global_config: &Pubkey,
    foundation_id: u64,
    revision: u32,
) -> Result<u8, solana_program::program_error::ProgramError> {
    let foundation_id_bytes = foundation_id.to_le_bytes();
    let revision_bytes = revision.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(
        &[
            BUILDING_MANIFEST_SEED,
            global_config.as_ref(),
            &foundation_id_bytes,
            &revision_bytes,
        ],
        program_id,
    );
    require_key_eq(
        manifest,
        &expected,
        NicechunkBuildingError::InvalidBuildingManifestPda,
    )?;
    Ok(bump)
}

fn validate_building_shard_pda(
    program_id: &Pubkey,
    shard: &Pubkey,
    global_config: &Pubkey,
    foundation_id: u64,
    revision: u32,
    shard_index: u8,
) -> Result<u8, solana_program::program_error::ProgramError> {
    let foundation_id_bytes = foundation_id.to_le_bytes();
    let revision_bytes = revision.to_le_bytes();
    let shard_index_seed = [shard_index];
    let (expected, bump) = Pubkey::find_program_address(
        &[
            BUILDING_SHARD_SEED,
            global_config.as_ref(),
            &foundation_id_bytes,
            &revision_bytes,
            &shard_index_seed,
        ],
        program_id,
    );
    require_key_eq(
        shard,
        &expected,
        NicechunkBuildingError::InvalidBuildingShardPda,
    )?;
    Ok(bump)
}

fn create_fixed_pda_account<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system_program_account: &AccountInfo<'a>,
    program_id: &Pubkey,
    len: usize,
    seeds: &[&[u8]],
) -> Result<bool, solana_program::program_error::ProgramError> {
    if target.owner == program_id {
        if target.data_len() != len {
            return Err(NicechunkBuildingError::InvalidSystemAccount.into());
        }
        return Ok(false);
    }
    if target.owner != &system_program::ID || target.data_len() != 0 {
        return Err(NicechunkBuildingError::InvalidSystemAccount.into());
    }
    let lamports = Rent::get()?.minimum_balance(len);
    let instruction =
        system_instruction::create_account(payer.key, target.key, lamports, len as u64, program_id);
    invoke_signed(
        &instruction,
        &[
            payer.clone(),
            target.clone(),
            system_program_account.clone(),
        ],
        &[seeds],
    )?;
    Ok(true)
}
