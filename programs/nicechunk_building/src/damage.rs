//! Revision-scoped demolition masks. Debug NCM geometry has no resource payout.
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction}, program::invoke, pubkey::Pubkey,
};
use crate::{building::{BuildSiteState, BuildingManifestState, BUILD_SITE_STATUS_ACTIVE},
    cluster_config::NICECHUNK_PLAYER_PROGRAM_ID, errors::{require_key_eq, NicechunkBuildingError as E}};

pub const DAMAGE_SEED: &[u8] = b"building-damage-v1";
pub const DAMAGE_MAGIC: [u8; 8] = *b"NCKBDM01";
pub const DAMAGE_HEADER: usize = 80;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DamageArgs {
    pub foundation: u64, pub revision: u32, pub x: u8, pub y: u8, pub z: u8,
    pub tool_slot: u8, pub item: Pubkey,
}
impl DamageArgs {
    pub fn unpack(data: &[u8]) -> Result<Self, E> {
        if data.len() != 48 { return Err(E::InvalidInstruction); }
        let value = Self { foundation: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            revision: u32::from_le_bytes(data[8..12].try_into().unwrap()),
            x: data[12], y: data[13], z: data[14], tool_slot: data[15],
            item: Pubkey::new_from_array(data[16..48].try_into().unwrap()) };
        if value.foundation == 0 || value.revision == 0 || value.tool_slot >= 9 || value.item == Pubkey::default() {
            return Err(E::InvalidDemolitionTool);
        }
        Ok(value)
    }
    pub fn section(self) -> [u8; 2] { [self.x / 16, self.z / 16] }
    pub fn bit(self) -> usize { (usize::from(self.y) * 16 + usize::from(self.z % 16)) * 16 + usize::from(self.x % 16) }
}

pub fn validate_mask(data: &[u8], global: &Pubkey, args: DamageArgs, height: u16) -> ProgramResult {
    if data.len() != DAMAGE_HEADER + usize::from(height) * 32 || data[0..8] != DAMAGE_MAGIC
        || data[8] != 1 || data[10..12] != args.section()
        || data[12..14] != height.to_le_bytes() || data[16..48] != global.to_bytes()
        || data[48..56] != args.foundation.to_le_bytes() || data[56..60] != args.revision.to_le_bytes() {
        return Err(E::InvalidBuildingDamage.into());
    }
    Ok(())
}

pub fn demolish(program_id: &Pubkey, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    if accounts.len() != 11 { return Err(E::InvalidAccountCount.into()); }
    let args = DamageArgs::unpack(payload)?;
    let [authority, profile, session, site_account, manifest_account, mask, global, system, owner, equipment, player_program] = accounts else {
        return Err(E::InvalidAccountCount.into());
    };
    if !site_account.is_writable || !manifest_account.is_writable || !mask.is_writable || !equipment.is_writable {
        return Err(E::InvalidWritableAccount.into());
    }
    let context = crate::validate_player_action(authority, profile, session, global, system)?;
    require_key_eq(owner.key, &context.owner, E::InvalidPlayerAuthority)?;
    require_key_eq(site_account.owner, program_id, E::InvalidBuildSiteData)?;
    require_key_eq(manifest_account.owner, program_id, E::InvalidBuildingManifestData)?;
    crate::validate_build_site_pda(program_id, site_account.key, global.key, args.foundation)?;
    crate::validate_building_manifest_pda(program_id, manifest_account.key, global.key, args.foundation, args.revision)?;
    let site = BuildSiteState::validate(&site_account.try_borrow_data()?)?;
    let manifest = BuildingManifestState::validate(&manifest_account.try_borrow_data()?)?;
    if site.owner != context.owner || site.global_config != *global.key || site.status != BUILD_SITE_STATUS_ACTIVE
        || site.foundation_id != args.foundation || site.active_revision != args.revision
        || manifest.status != 1 || manifest.owner != context.owner || manifest.global_config != *global.key
        || manifest.foundation_id != args.foundation || manifest.revision != args.revision {
        return Err(E::BuildingRevisionConflict.into());
    }
    if u16::from(args.x) >= manifest.size_x || u16::from(args.y) >= manifest.size_y || u16::from(args.z) >= manifest.size_z {
        return Err(E::InvalidBuildingDamage.into());
    }
    require_key_eq(player_program.key, &NICECHUNK_PLAYER_PROGRAM_ID, E::InvalidPlayerProgram)?;
    require_key_eq(equipment.owner, &NICECHUNK_PLAYER_PROGRAM_ID, E::InvalidDemolitionTool)?;
    if !player_program.executable { return Err(E::InvalidPlayerProgram.into()); }
    validate_tool_identity(&equipment.try_borrow_data()?, &context.owner, profile.key, global.key, args)?;
    let id = args.foundation.to_le_bytes(); let revision = args.revision.to_le_bytes(); let section = args.section();
    let seeds = [DAMAGE_SEED, global.key.as_ref(), id.as_ref(), revision.as_ref(), section.as_ref()];
    let (expected, bump) = Pubkey::find_program_address(&seeds, program_id);
    require_key_eq(mask.key, &expected, E::InvalidBuildingDamage)?;
    if mask.owner == &solana_program::system_program::ID && mask.data_is_empty() {
        let bump_seed = [bump];
        let signer_seeds = [DAMAGE_SEED, global.key.as_ref(), id.as_ref(), revision.as_ref(), section.as_ref(), bump_seed.as_ref()];
        crate::create_fixed_pda_account(authority, mask, system, program_id,
            DAMAGE_HEADER + usize::from(manifest.size_y) * 32, &signer_seeds)?;
        let mut data = mask.try_borrow_mut_data()?;
        data.fill(0); data[0..8].copy_from_slice(&DAMAGE_MAGIC); data[8] = 1; data[9] = bump;
        data[10..12].copy_from_slice(&section); data[12..14].copy_from_slice(&manifest.size_y.to_le_bytes());
        data[16..48].copy_from_slice(global.key.as_ref()); data[48..56].copy_from_slice(&id);
        data[56..60].copy_from_slice(&revision);
    }
    require_key_eq(mask.owner, program_id, E::InvalidBuildingDamage)?;
    {
        let mut data = mask.try_borrow_mut_data()?;
        validate_mask(&data, global.key, args, manifest.size_y)?;
        let offset = DAMAGE_HEADER + args.bit() / 8; let bit = 1 << (args.bit() & 7);
        if data[offset] & bit != 0 { return Err(E::BuildingVoxelAlreadyRemoved.into()); }
        data[offset] |= bit;
        data[64..72].copy_from_slice(&context.clock.slot.to_le_bytes());
    }
    // The existing Player instruction verifies custody, session, equipment PDA,
    // durability and authority. Its failure rolls back the mask atomically.
    let mut data = vec![15, args.tool_slot]; data.extend_from_slice(&1_u32.to_le_bytes());
    invoke(&Instruction { program_id: NICECHUNK_PLAYER_PROGRAM_ID, data, accounts: vec![
        AccountMeta::new_readonly(*authority.key, true), AccountMeta::new_readonly(*owner.key, false),
        AccountMeta::new_readonly(*profile.key, false), AccountMeta::new_readonly(*session.key, false),
        AccountMeta::new(*equipment.key, false), AccountMeta::new_readonly(*global.key, false),
    ]}, &[authority.clone(), owner.clone(), profile.clone(), session.clone(), equipment.clone(), global.clone(), player_program.clone()])?;
    // A monotonic counter avoids missing two edits in the same slot. The spare
    // manifest bytes 134..136 identify damage; the original NCM hash is immutable.
    {
        let mut data = manifest_account.try_borrow_mut_data()?;
        data[13] = 1;
        let count = u16::from_le_bytes(data[134..136].try_into().unwrap()).wrapping_add(1);
        data[134..136].copy_from_slice(&count.to_le_bytes());
        data[144..152].copy_from_slice(&context.clock.slot.to_le_bytes());
    }
    site_account.try_borrow_mut_data()?[124..132].copy_from_slice(&context.clock.slot.to_le_bytes());
    Ok(())
}

pub fn validate_tool_identity(data: &[u8], owner: &Pubkey, profile: &Pubkey, global: &Pubkey, args: DamageArgs) -> ProgramResult {
    if data.len() != 128 + 9 * 768 || data[0..8] != *b"NCKEQP01" || data[8..10] != 1_u16.to_le_bytes()
        || data[11] != 1 || data[108] != 9 || data[12..44] != owner.to_bytes()
        || data[44..76] != profile.to_bytes() || data[76..108] != global.to_bytes() {
        return Err(E::InvalidDemolitionTool.into());
    }
    let offset = 128 + usize::from(args.tool_slot) * 768;
    let record = offset + 40;
    if data[offset] != 1 || data[offset + 1] != args.tool_slot || data[offset + 3] & 2 == 0
        || data[record] != 2 || data[record + 1] != 2 || data[record + 18..record + 20] != 8_u16.to_le_bytes()
        || data[record + 28..record + 60] != args.item.to_bytes() {
        return Err(E::InvalidDemolitionTool.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args() -> DamageArgs { DamageArgs { foundation: u64::MAX, revision: 1, x: 255, y: 255, z: 255, tool_slot: 2, item: Pubkey::new_unique() } }
    #[test] fn packed_coordinates_and_replay_are_revision_scoped() {
        let a = args(); assert_eq!(a.section(), [15, 15]); assert_eq!(a.bit(), 65535);
        let global = Pubkey::new_unique(); let mut data = vec![0; DAMAGE_HEADER + 256*32];
        data[0..8].copy_from_slice(&DAMAGE_MAGIC); data[8]=1; data[10..12].copy_from_slice(&a.section());
        data[12..14].copy_from_slice(&256_u16.to_le_bytes()); data[16..48].copy_from_slice(global.as_ref());
        data[48..56].copy_from_slice(&a.foundation.to_le_bytes()); data[56..60].copy_from_slice(&a.revision.to_le_bytes());
        validate_mask(&data, &global, a, 256).unwrap();
        assert!(validate_mask(&data, &global, DamageArgs { revision: 2, ..a }, 256).is_err());
        assert!(validate_mask(&data, &global, DamageArgs { x: 0, ..a }, 256).is_err());
        assert!(validate_mask(&data, &Pubkey::new_unique(), a, 256).is_err());
    }
    #[test] fn request_requires_tool_identity_and_valid_slot() {
        assert!(DamageArgs::unpack(&[0;48]).is_err()); assert!(DamageArgs::unpack(&[0;47]).is_err());
        let a=args(); let mut bytes=vec![]; bytes.extend_from_slice(&a.foundation.to_le_bytes());
        bytes.extend_from_slice(&a.revision.to_le_bytes()); bytes.extend_from_slice(&[a.x,a.y,a.z,a.tool_slot]);
        bytes.extend_from_slice(a.item.as_ref()); assert_eq!(DamageArgs::unpack(&bytes).unwrap(),a);
        bytes[15]=9; assert!(DamageArgs::unpack(&bytes).is_err());
    }
}
