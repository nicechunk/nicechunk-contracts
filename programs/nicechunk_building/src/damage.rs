//! Revision-scoped air overrides with atomic material recovery.
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction}, program::{invoke, invoke_signed}, pubkey::Pubkey,
};
use crate::{building::{BuildSiteState, BuildingManifestState, BUILD_SITE_STATUS_ACTIVE},
    cluster_config::{NICECHUNK_PLAYER_PROGRAM_ID,NICECHUNK_MARKET_PROGRAM_ID}, errors::{require_key_eq, NicechunkBuildingError as E}};

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
    if accounts.len() < 16 { return Err(E::InvalidAccountCount.into()); }
    let args = DamageArgs::unpack(payload)?;
    let [authority, profile, session, site_account, manifest_account, mask, global, system, owner, equipment, player_program] = &accounts[..11] else {
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
    let reward_authority=&accounts[11];let backpack=&accounts[12];let physics=&accounts[13];let game=&accounts[14];
    require_key_eq(game.key, &NICECHUNK_MARKET_PROGRAM_ID, E::InvalidDemolitionReward)?;
    if !game.executable || !backpack.is_writable { return Err(E::InvalidDemolitionReward.into()); }
    let (expected_reward, reward_bump)=Pubkey::find_program_address(&[b"building-reward-v1",global.key.as_ref()],program_id);
    require_key_eq(reward_authority.key,&expected_reward,E::InvalidDemolitionReward)?;
    let material=verified_material(program_id,&accounts[15..],global.key,args,manifest)?;
    if material==0 { return Err(E::InvalidDemolitionReward.into()); }
    let (width,depth)=if manifest.quarter_turns%2==0 {(manifest.size_x,manifest.size_z)}else{(manifest.size_z,manifest.size_x)};
    let (rx,rz)=match manifest.quarter_turns {
        1=>(i64::from(manifest.size_z)-1-i64::from(args.z),i64::from(args.x)),
        2=>(i64::from(manifest.size_x)-1-i64::from(args.x),i64::from(manifest.size_z)-1-i64::from(args.z)),
        3=>(i64::from(args.z),i64::from(manifest.size_x)-1-i64::from(args.x)),
        _=>(i64::from(args.x),i64::from(args.z)),
    };
    let wx=i32::try_from(i64::from(site.min_x)+(i64::from(site.width)-i64::from(width)).div_euclid(2)+i64::from(manifest.offset_x)+rx).map_err(|_|E::InvalidDemolitionReward)?;
    let wz=i32::try_from(i64::from(site.min_z)+(i64::from(site.depth)-i64::from(depth)).div_euclid(2)+i64::from(manifest.offset_z)+rz).map_err(|_|E::InvalidDemolitionReward)?;
    let y=i32::from(site.surface_y)+i32::from(args.y)-i32::from(context.config.min_build_y);
    if !(0..512).contains(&y) {return Err(E::InvalidDemolitionReward.into());}
    let resource=resource_block(material).ok_or(E::InvalidDemolitionReward)?;
    let packed_y=((resource<<9)|(y as u16)) as i16;
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
    // The air override, resource credit and tool wear commit together. A full
    // backpack or failed credit rolls back every change, including a new mask.
    let mut reward=vec![1,23];reward.extend_from_slice(&wx.to_le_bytes());reward.extend_from_slice(&packed_y.to_le_bytes());reward.extend_from_slice(&wz.to_le_bytes());
    let bump=[reward_bump];let reward_seeds=[b"building-reward-v1".as_ref(),global.key.as_ref(),bump.as_ref()];
    invoke_signed(&Instruction {program_id:*game.key,data:reward,accounts:vec![
        AccountMeta::new_readonly(*reward_authority.key,true),AccountMeta::new_readonly(*global.key,false),
        AccountMeta::new_readonly(*profile.key,false),AccountMeta::new(*backpack.key,false),AccountMeta::new_readonly(*physics.key,false),
    ]},&[reward_authority.clone(),global.clone(),profile.clone(),backpack.clone(),physics.clone(),game.clone()],&[&reward_seeds])?;
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

fn verified_material(program_id:&Pubkey,accounts:&[AccountInfo],global:&Pubkey,args:DamageArgs,manifest:crate::building::BuildingManifestView)->Result<u16,solana_program::program_error::ProgramError>{
    use crate::building::{BuildingShardState,BUILDING_SHARD_HEADER_LEN,building_shard_payload_len,hash_payload_slices,ncm3_material_at};
    if accounts.len()!=usize::from(manifest.shard_count){return Err(E::InvalidAccountCount.into());}
    for (i,a) in accounts.iter().enumerate(){
        require_key_eq(a.owner,program_id,E::InvalidBuildingShardData)?;
        crate::validate_building_shard_pda(program_id,a.key,global,args.foundation,args.revision,i as u8)?;
    }
    let data=accounts.iter().map(AccountInfo::try_borrow_data).collect::<Result<Vec<_>,_>>()?;
    let mut slices=Vec::with_capacity(data.len());
    for (i,d) in data.iter().enumerate(){
        let shard=BuildingShardState::validate(d)?;
        if shard.global_config!=*global||shard.foundation_id!=args.foundation||shard.revision!=args.revision
            ||usize::from(shard.shard_index)!=i||shard.uploaded_len!=shard.payload_len
            ||usize::from(shard.payload_len)!=building_shard_payload_len(manifest.payload_len,i as u8)?{return Err(E::InvalidBuildingShardData.into());}
        slices.push(&d[BUILDING_SHARD_HEADER_LEN..]);
    }
    if hash_payload_slices(&slices)!=manifest.expected_hash{return Err(E::BuildingHashMismatch.into());}
    Ok(ncm3_material_at(&slices,[args.x,args.y,args.z])?)
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

/// Canonical resource ids, matching chunk.js construction/building-resource.js.
/// NCM processed finishes are appearances, not distinct inventory resources.
pub fn resource_block(material:u16)->Option<u16>{
    Some(match material {
        16=>3,1..=47=>material,48..=52=>material+1,55..=57=>22,58..=61=>5,
        62|63|71|74|75|96=>7,64|69|70=>3,65=>4,66=>14,67|97=>5,68=>6,72=>2,
        73|98=>46,76|100=>15,77=>10,99=>47,101=>40,_=>return None,
    })
}

#[cfg(test)]
mod material_query_regression {
    use super::*;
    #[test]
    fn query_matches_all_voxels_from_the_client_codec() {
        let data=include_bytes!("../fixtures/ncm-point-query.bin");let mut o=0;
        let u16_at=|o:usize|u16::from_le_bytes(data[o..o+2].try_into().unwrap()) as usize;
        let models=u16_at(o);o+=2;
        for _ in 0..models {
            let len=u16_at(o);o+=2;let payload=&data[o..o+len];o+=len;
            crate::building::validate_ncm3_payload(&[payload]).unwrap();
            let points=u32::from_le_bytes(data[o..o+4].try_into().unwrap());o+=4;
            for _ in 0..points {
                let p=[data[o],data[o+1],data[o+2]];let expected=u16_at(o+3) as u16;o+=5;
                assert_eq!(crate::building::ncm3_material_at(&[payload],p).unwrap(),expected,"point {:?}",p);
            }
        }
        assert_eq!(o,data.len());
    }
    #[test]
    fn inventory_mapping_matches_client_and_never_confuses_planks_with_pebbles() {
        let bytes=include_bytes!("../fixtures/ncm-resource-map.bin");
        for pair in bytes.chunks_exact(4) {
            let m=u16::from_le_bytes(pair[..2].try_into().unwrap());let r=u16::from_le_bytes(pair[2..].try_into().unwrap());
            assert_eq!(resource_block(m),Some(r));assert!((1..=55).contains(&r));
        }
        assert_eq!(resource_block(55),Some(22));assert_eq!(resource_block(64),Some(3));
        assert_eq!(resource_block(58),Some(5));assert_eq!(resource_block(0),None);
    }
}
