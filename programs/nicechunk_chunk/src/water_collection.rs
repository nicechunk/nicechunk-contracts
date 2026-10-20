//! Repeatable natural-water collection. No terrain delta and no mining/Skills credit.
use super::*;

pub const WATER_COLLECTION_SEED:&[u8]=b"water-collection-v1";
pub const WATER_COLLECTION_MAGIC:&[u8;8]=b"NCKWTR01";
pub const WATER_COLLECTION_LEN:usize=128;
pub const WATER_UNIT_ML:u32=1000;

/// Round up to the number of contacts required for one standard water item.
pub fn required_hits(capacity_ml:u32)->Result<u32,NicechunkChunkError> {
    if capacity_ml==0 {return Err(NicechunkChunkError::InvalidWaterContainer);}
    Ok(1+999/capacity_ml)
}

pub fn collect(program_id:&Pubkey,accounts:&[AccountInfo],payload:&[u8])->ProgramResult {
    if accounts.len()!=15 || payload.len()!=21 {return Err(NicechunkChunkError::InvalidInstruction.into());}
    let action_id=u64::from_le_bytes(payload[..8].try_into().unwrap());
    let args=MineBlockArgs::unpack(&payload[8..20])?;let tool=payload[20];
    let payer=&accounts[0];let profile=&accounts[1];let session=&accounts[2];let collection=&accounts[3];
    let global=&accounts[4];let broken=&accounts[5];let placed=&accounts[6];let foundation=&accounts[7];
    let equipment=&accounts[8];let item=&accounts[9];let backpack=&accounts[10];let physics=&accounts[11];
    let player_program=&accounts[12];let backpack_program=&accounts[13];let system=&accounts[14];
    if !collection.is_writable || !profile.is_writable || !equipment.is_writable || !backpack.is_writable {
        return Err(NicechunkChunkError::InvalidWritableAccount.into());
    }
    let context=validate_player_action(payer,profile,session,global,system)?;
    validate_backpack(backpack_program,backpack)?;
    require_key_eq(player_program.key,&NICECHUNK_PLAYER_PROGRAM_ID,NicechunkChunkError::InvalidPlayerProgram)?;
    if !player_program.executable || args.expected_block_id!=BLOCK_WATER || action_id==0 {
        return Err(NicechunkChunkError::InvalidWaterTarget.into());
    }
    let generated=args.generated_args(&context.config)?;generated.validate(&context.config)?;
    if generated_block_id_at(&context.config,&generated)!=BLOCK_WATER {
        return Err(NicechunkChunkError::InvalidWaterTarget.into());
    }
    let (cx,cz,lx,lz)=args.chunk_coords(&context.config)?;
    let packed=pack_broken_coord(lx,args.world_y,lz,context.config.min_build_y)?;
    if chunk_broken_contains(program_id,broken,global,cx,cz,context.config.min_build_y,packed)?
        || chunk_placed_at(program_id,placed,global,cx,cz,context.config.min_build_y,packed)?.is_some() {
        return Err(NicechunkChunkError::InvalidWaterTarget.into());
    }
    reject_foundation_protected_block(program_id,foundation,global,cx,cz,&context.owner,&args)?;
    {let data=profile.try_borrow_data()?;
        if &data[393..425]!=backpack.key.as_ref() {return Err(NicechunkChunkError::InvalidWaterCollection.into());}
        let px=i32::from_le_bytes(data[78..82].try_into().unwrap()) as i64;
        let py=i32::from_le_bytes(data[82..86].try_into().unwrap()) as i64;
        let pz=i32::from_le_bytes(data[86..90].try_into().unwrap()) as i64;
        let dx=i64::from(args.world_x)-px;let dy=i64::from(args.world_y)-py;let dz=i64::from(args.world_z)-pz;
        if dx.abs()>12 || dy.abs()>12 || dz.abs()>12 || dx*dx+dy*dy+dz*dz>144 {
            return Err(NicechunkChunkError::InvalidWaterTarget.into());
        }
    }
    let capacity=container_capacity(item,backpack_program.key)?;
    let hits=required_hits(capacity)?;
    validate_equipped_container(equipment,profile,global,&context.owner,tool,item)?;
    let (expected,bump)=Pubkey::find_program_address(&[WATER_COLLECTION_SEED,global.key.as_ref(),context.owner.as_ref()],program_id);
    require_key_eq(collection.key,&expected,NicechunkChunkError::InvalidWaterCollection)?;
    let seeds=[WATER_COLLECTION_SEED,global.key.as_ref(),context.owner.as_ref(),&[bump]];
    let created=create_fixed_pda_account(payer,collection,system,program_id,WATER_COLLECTION_LEN,&seeds)?;
    {let mut data=collection.try_borrow_mut_data()?;
        if created {data.fill(0);data[..8].copy_from_slice(WATER_COLLECTION_MAGIC);data[8..10].copy_from_slice(&1_u16.to_le_bytes());
            data[12..44].copy_from_slice(context.owner.as_ref());data[44..76].copy_from_slice(global.key.as_ref());}
        validate_collection(&data,&context.owner,global.key)?;
        if action_id<=u64::from_le_bytes(data[76..84].try_into().unwrap()) {return Err(NicechunkChunkError::WaterActionReplayed.into());}
    }
    // Only this program can sign the collection PDA. The hit count is derived
    // above from the certified immutable item, never from a submitted counter.
    let mut debit=vec![19,tool];debit.extend_from_slice(&hits.to_le_bytes());debit.extend_from_slice(item.key.as_ref());
    let instruction=Instruction {program_id:*player_program.key,accounts:vec![
        AccountMeta::new_readonly(*collection.key,true),AccountMeta::new(*profile.key,false),
        AccountMeta::new(*equipment.key,false),AccountMeta::new_readonly(*global.key,false)],data:debit};
    invoke_signed(&instruction,&[collection.clone(),profile.clone(),equipment.clone(),global.clone(),player_program.clone()],&[&seeds])?;
    let (issuer,receipt)=get_return_data().ok_or(NicechunkChunkError::InvalidMiningDurabilityReturn)?;
    if issuer!=*player_program.key || receipt.len()!=57 || &receipt[..8]!=b"NCKDUR01"
        || receipt[8]!=tool || receipt[25..57]!=item.key.to_bytes() {
        return Err(NicechunkChunkError::InvalidMiningDurabilityReturn.into());
    }
    let mut reward=vec![21];reward.extend_from_slice(&args.world_x.to_le_bytes());
    reward.extend_from_slice(&pack_backpack_resource_y(args.world_y,BLOCK_WATER,context.config.min_build_y).to_le_bytes());
    reward.extend_from_slice(&args.world_z.to_le_bytes());
    let instruction=Instruction {program_id:*backpack_program.key,accounts:vec![
        AccountMeta::new_readonly(*collection.key,true),AccountMeta::new_readonly(*global.key,false),
        AccountMeta::new_readonly(*profile.key,false),AccountMeta::new(*backpack.key,false),AccountMeta::new_readonly(*physics.key,false)],
        data:backpack_cpi_data(&reward)};
    invoke_signed(&instruction,&[collection.clone(),global.clone(),profile.clone(),backpack.clone(),physics.clone(),backpack_program.clone()],&[&seeds])?;
    {let mut data=collection.try_borrow_mut_data()?;
        data[76..84].copy_from_slice(&action_id.to_le_bytes());data[84..92].copy_from_slice(&context.clock.slot.to_le_bytes());
        data[92..124].copy_from_slice(item.key.as_ref());data[124..128].copy_from_slice(&hits.to_le_bytes());}
    // A failed storage/debit CPI rolls the entire operation back, including
    // account initialization, nonce and durability. Water blocks are untouched.
    // Prefix the authenticated durability receipt with the per-contact result.
    // Keeping the complete receipt lets clients reconcile exact exhaustion.
    let mut water_receipt=[0_u8;85];water_receipt[..8].copy_from_slice(b"NCKWAT01");
    water_receipt[8..16].copy_from_slice(&action_id.to_le_bytes());
    water_receipt[16..20].copy_from_slice(&0_u32.to_le_bytes());
    water_receipt[20..24].copy_from_slice(&capacity.to_le_bytes());
    water_receipt[24..28].copy_from_slice(&1_u32.to_le_bytes());
    water_receipt[28..].copy_from_slice(&receipt);
    set_return_data(&water_receipt);
    Ok(())
}

pub fn validate_collection(data:&[u8],owner:&Pubkey,config:&Pubkey)->ProgramResult {
    if data.len()!=WATER_COLLECTION_LEN || &data[..8]!=WATER_COLLECTION_MAGIC
        || data[8..10]!=1_u16.to_le_bytes() || data[12..44]!=owner.to_bytes() || data[44..76]!=config.to_bytes() {
        return Err(NicechunkChunkError::InvalidWaterCollection.into());
    }
    Ok(())
}

fn container_capacity(item:&AccountInfo,program:&Pubkey)->Result<u32,solana_program::program_error::ProgramError> {
    require_key_eq(item.owner,program,NicechunkChunkError::InvalidWaterContainer)?;
    let data=item.try_borrow_data()?;
    if data.len()!=752 || &data[..8]!=b"NCKFGI01" || data[8..10]!=1_u16.to_le_bytes() || data[11]!=1
        || (u16::from_le_bytes(data[94..96].try_into().unwrap())>>12)!=1 {
        return Err(NicechunkChunkError::InvalidWaterContainer.into());
    }
    let creator=Pubkey::new_from_array(data[20..52].try_into().unwrap());
    let (expected,_)=Pubkey::find_program_address(&[b"forged-item-v1",creator.as_ref(),&data[12..20]],program);
    require_key_eq(item.key,&expected,NicechunkChunkError::InvalidWaterContainer)?;
    Ok(u32::from_le_bytes(data[90..94].try_into().unwrap()))
}

fn validate_equipped_container(equipment:&AccountInfo,profile:&AccountInfo,global:&AccountInfo,owner:&Pubkey,tool:u8,item:&AccountInfo)->ProgramResult {
    require_key_eq(equipment.owner,&NICECHUNK_PLAYER_PROGRAM_ID,NicechunkChunkError::InvalidMiningTool)?;
    let (expected,_)=Pubkey::find_program_address(&[b"player-equipment-v1",owner.as_ref()],&NICECHUNK_PLAYER_PROGRAM_ID);
    require_key_eq(equipment.key,&expected,NicechunkChunkError::InvalidMiningTool)?;
    if tool>=9 {return Err(NicechunkChunkError::InvalidMiningTool.into());}
    let data=equipment.try_borrow_data()?;
    if data.len()!=7040 || &data[..8]!=b"NCKEQP01" || data[8..10]!=1_u16.to_le_bytes() || data[11]!=1
        || data[12..44]!=owner.to_bytes() || data[44..76]!=profile.key.to_bytes() || data[76..108]!=global.key.to_bytes() {
        return Err(NicechunkChunkError::InvalidMiningTool.into());
    }
    let offset=128+usize::from(tool)*768;
    let record=&data[offset+40..offset+120];
    if data[offset]!=1 || data[offset+3]&2==0 || record[0]!=2 || record[1]!=2
        || record[18..20]!=8_u16.to_le_bytes() || record[28..60]!=item.key.to_bytes() {
        return Err(NicechunkChunkError::InvalidWaterContainer.into());
    }
    let item_data=item.try_borrow_data()?;
    let code_len=usize::from(u16::from_le_bytes(item_data[88..90].try_into().unwrap()));
    if !(14..=640).contains(&code_len) || data[offset+4..offset+6]!=item_data[88..90]
        || data[offset+120..offset+120+code_len]!=item_data[96..96+code_len] {
        return Err(NicechunkChunkError::InvalidWaterContainer.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn capacity_hit_boundaries_round_up_without_overflow() {
        for (ml,hits) in [(1,1000),(100,10),(249,5),(250,4),(333,4),(334,3),(499,3),(500,2),(999,2),(1000,1),(u32::MAX,1)] {
            assert_eq!(required_hits(ml).unwrap(),hits);
        }
        assert!(required_hits(0).is_err());
    }
}
