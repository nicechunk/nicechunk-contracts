#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    declare_id,
    entrypoint::ProgramResult,
    program::invoke_signed,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_program::entrypoint;

pub mod cluster_config;
pub mod errors;
pub mod state;

use cluster_config::CIVILIZATION_POWER_AUTHORITY;
use errors::{require_key_eq, NicechunkCivilizationError};
use state::{
    CitizenPowerAccount, CitizenPowerInitArgs, ExecutionReceiptAccount, PowerSnapshotAccount,
    PowerSnapshotInitArgs, PublishRuleBookArgs, RuleBookAccount, RuleBookInitArgs,
    RuleSignatureAccount, RuleTallyAccount, CITIZEN_POWER_SEED,
    CIVILIZATION_ADAPTER_AUTHORITY_SEED, EXECUTION_RECEIPT_SEED, POWER_SNAPSHOT_SEED,
    RULE_BOOK_SEED, RULE_SIGNATURE_SEED, RULE_TALLY_SEED, SIDE_ABSTAIN, SIDE_AGREE, SIDE_CHALLENGE,
    SIDE_REJECT, STATUS_EXECUTED, STATUS_FINALIZED, STATUS_PUBLISHED, TARGET_STATUS_GOVERNABLE,
};

declare_id!("3MRG4UjxTK1rMq7TGM4bX1GrD8C36bQtt1RdTmJD7Jah");

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, payload) = instruction_data
        .split_first()
        .ok_or(NicechunkCivilizationError::InvalidInstruction)?;

    match tag {
        0 => publish_rule_book(program_id, accounts, payload),
        1 => sign_rule(program_id, accounts, payload),
        2 => finalize_rule_tally(program_id, accounts),
        3 => execute_rule_receipt(program_id, accounts),
        4 => publish_power_snapshot(program_id, accounts, payload),
        5 => settle_citizen_power(program_id, accounts, payload),
        _ => Err(NicechunkCivilizationError::InvalidInstruction.into()),
    }
}

fn publish_rule_book(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 4 {
        return Err(NicechunkCivilizationError::InvalidAccountCount.into());
    }
    let args = PublishRuleBookArgs::unpack(payload)?;
    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let rule_book = next_account_info(account_info_iter)?;
    let power_snapshot = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    if !payer.is_signer || !payer.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    if !rule_book.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;
    require_key_eq(
        power_snapshot.owner,
        program_id,
        NicechunkCivilizationError::InvalidPowerSnapshotData,
    )?;
    {
        let snapshot_data = power_snapshot.try_borrow_data()?;
        PowerSnapshotAccount::validate(&snapshot_data)?;
        validate_power_snapshot_pda(program_id, power_snapshot.key, &args.snapshot_hash)?;
        if PowerSnapshotAccount::snapshot_hash(&snapshot_data)? != args.snapshot_hash
            || PowerSnapshotAccount::total_active_power(&snapshot_data)? != args.total_active_power
        {
            return Err(NicechunkCivilizationError::InvalidPowerSnapshotData.into());
        }
        let expires_at = i64::from_le_bytes(
            snapshot_data[PowerSnapshotAccount::EXPIRES_AT_OFFSET
                ..PowerSnapshotAccount::EXPIRES_AT_OFFSET + 8]
                .try_into()
                .unwrap_or_default(),
        );
        if expires_at > 0 && Clock::get()?.unix_timestamp > expires_at {
            return Err(NicechunkCivilizationError::PowerSnapshotExpired.into());
        }
    }
    let bump = validate_rule_book_pda(program_id, rule_book.key, &args.rule_id_hash)?;
    create_pda_account(
        payer,
        rule_book,
        system_program_account,
        program_id,
        RuleBookAccount::LEN,
        &[RULE_BOOK_SEED, &args.rule_id_hash, &[bump]],
        NicechunkCivilizationError::RuleBookAlreadyInitialized,
    )?;

    let clock = Clock::get()?;
    let mut data = rule_book.try_borrow_mut_data()?;
    RuleBookAccount::pack(
        &mut data,
        &RuleBookInitArgs {
            bump,
            author: payer.key,
            args: &args,
            created_slot: clock.slot,
            created_at: clock.unix_timestamp,
        },
    )
}

fn sign_rule(program_id: &Pubkey, accounts: &[AccountInfo], payload: &[u8]) -> ProgramResult {
    if accounts.len() != 5 || payload.len() != 41 {
        return Err(NicechunkCivilizationError::InvalidInstruction.into());
    }
    let side = payload[0];
    state::validate_side(side)?;
    let snapshot_power = read_u64(payload, 1);
    if snapshot_power == 0 {
        return Err(NicechunkCivilizationError::InvalidSignatureData.into());
    }
    let mut snapshot_hash = [0_u8; 32];
    snapshot_hash.copy_from_slice(&payload[9..41]);

    let account_info_iter = &mut accounts.iter();
    let signer = next_account_info(account_info_iter)?;
    let rule_book = next_account_info(account_info_iter)?;
    let signature = next_account_info(account_info_iter)?;
    let citizen_power = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    if !signer.is_signer || !signer.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    if !signature.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        rule_book.owner,
        program_id,
        NicechunkCivilizationError::InvalidRuleBookOwner,
    )?;
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;
    require_key_eq(
        citizen_power.owner,
        program_id,
        NicechunkCivilizationError::InvalidCitizenPowerData,
    )?;

    {
        let rule_data = rule_book.try_borrow_data()?;
        RuleBookAccount::validate(&rule_data)?;
        if RuleBookAccount::status(&rule_data)? != STATUS_PUBLISHED {
            return Err(NicechunkCivilizationError::RuleAlreadyFinalized.into());
        }
        if RuleBookAccount::snapshot_hash(&rule_data)? != snapshot_hash {
            return Err(NicechunkCivilizationError::SnapshotMismatch.into());
        }
        if snapshot_power > RuleBookAccount::total_active_power(&rule_data)? {
            return Err(NicechunkCivilizationError::InvalidSignatureData.into());
        }
    }
    {
        let citizen_power_data = citizen_power.try_borrow_data()?;
        CitizenPowerAccount::validate_for_signer(&citizen_power_data, signer.key, &snapshot_hash)?;
        let snapshot = CitizenPowerAccount::snapshot(&citizen_power_data)?;
        validate_citizen_power_pda(program_id, citizen_power.key, &snapshot, signer.key)?;
        if CitizenPowerAccount::power(&citizen_power_data) != snapshot_power {
            return Err(NicechunkCivilizationError::CitizenPowerMismatch.into());
        }
        let expires_at = CitizenPowerAccount::expires_at(&citizen_power_data);
        if expires_at > 0 && Clock::get()?.unix_timestamp > expires_at {
            return Err(NicechunkCivilizationError::PowerSnapshotExpired.into());
        }
    }

    let bump = validate_signature_pda(program_id, signature.key, rule_book.key, signer.key)?;
    create_pda_account(
        signer,
        signature,
        system_program_account,
        program_id,
        RuleSignatureAccount::LEN,
        &[
            RULE_SIGNATURE_SEED,
            rule_book.key.as_ref(),
            signer.key.as_ref(),
            &[bump],
        ],
        NicechunkCivilizationError::SignatureAlreadyInitialized,
    )?;
    let clock = Clock::get()?;
    let mut data = signature.try_borrow_mut_data()?;
    RuleSignatureAccount::pack(
        &mut data,
        bump,
        side,
        rule_book.key,
        signer.key,
        &snapshot_hash,
        snapshot_power,
        clock.slot,
        clock.unix_timestamp,
    )
}

fn publish_power_snapshot(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 3 || payload.len() != 64 {
        return Err(NicechunkCivilizationError::InvalidInstruction.into());
    }
    let mut snapshot_hash = [0_u8; 32];
    snapshot_hash.copy_from_slice(&payload[0..32]);
    let total_active_power = read_u64(payload, 32);
    let window_start_epoch = read_u64(payload, 40);
    let window_end_epoch = read_u64(payload, 48);
    let expires_at = i64::from_le_bytes(payload[56..64].try_into().unwrap_or_default());
    if total_active_power == 0 || window_end_epoch < window_start_epoch {
        return Err(NicechunkCivilizationError::InvalidPowerSnapshotData.into());
    }

    let account_info_iter = &mut accounts.iter();
    let authority = next_account_info(account_info_iter)?;
    let power_snapshot = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    if !authority.is_signer || !authority.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    require_key_eq(
        authority.key,
        &CIVILIZATION_POWER_AUTHORITY,
        NicechunkCivilizationError::InvalidPowerAuthority,
    )?;
    if !power_snapshot.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;
    let bump = validate_power_snapshot_pda(program_id, power_snapshot.key, &snapshot_hash)?;
    create_pda_account(
        authority,
        power_snapshot,
        system_program_account,
        program_id,
        PowerSnapshotAccount::LEN,
        &[POWER_SNAPSHOT_SEED, &snapshot_hash, &[bump]],
        NicechunkCivilizationError::PowerSnapshotAlreadyInitialized,
    )?;
    let clock = Clock::get()?;
    let mut data = power_snapshot.try_borrow_mut_data()?;
    PowerSnapshotAccount::pack(
        &mut data,
        &PowerSnapshotInitArgs {
            bump,
            authority: authority.key,
            snapshot_hash: &snapshot_hash,
            total_active_power,
            window_start_epoch,
            window_end_epoch,
            expires_at,
            created_slot: clock.slot,
            created_at: clock.unix_timestamp,
        },
    )
}

fn settle_citizen_power(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if accounts.len() != 5 || payload.len() != 8 {
        return Err(NicechunkCivilizationError::InvalidInstruction.into());
    }
    let power = read_u64(payload, 0);
    if power == 0 {
        return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
    }

    let account_info_iter = &mut accounts.iter();
    let authority = next_account_info(account_info_iter)?;
    let power_snapshot = next_account_info(account_info_iter)?;
    let citizen_power = next_account_info(account_info_iter)?;
    let citizen = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    if !authority.is_signer || !authority.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    require_key_eq(
        authority.key,
        &CIVILIZATION_POWER_AUTHORITY,
        NicechunkCivilizationError::InvalidPowerAuthority,
    )?;
    if !citizen_power.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        power_snapshot.owner,
        program_id,
        NicechunkCivilizationError::InvalidPowerSnapshotData,
    )?;
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;
    let (snapshot_authority, snapshot_hash, total_active_power, expires_at) = {
        let snapshot_data = power_snapshot.try_borrow_data()?;
        PowerSnapshotAccount::validate(&snapshot_data)?;
        (
            PowerSnapshotAccount::authority(&snapshot_data)?,
            PowerSnapshotAccount::snapshot_hash(&snapshot_data)?,
            PowerSnapshotAccount::total_active_power(&snapshot_data)?,
            i64::from_le_bytes(
                snapshot_data[PowerSnapshotAccount::EXPIRES_AT_OFFSET
                    ..PowerSnapshotAccount::EXPIRES_AT_OFFSET + 8]
                    .try_into()
                    .unwrap_or_default(),
            ),
        )
    };
    require_key_eq(
        &snapshot_authority,
        authority.key,
        NicechunkCivilizationError::InvalidPowerSnapshotData,
    )?;
    if power > total_active_power {
        return Err(NicechunkCivilizationError::InvalidCitizenPowerData.into());
    }
    if expires_at > 0 && Clock::get()?.unix_timestamp > expires_at {
        return Err(NicechunkCivilizationError::PowerSnapshotExpired.into());
    }
    let bump = validate_citizen_power_pda(
        program_id,
        citizen_power.key,
        power_snapshot.key,
        citizen.key,
    )?;
    create_pda_account(
        authority,
        citizen_power,
        system_program_account,
        program_id,
        CitizenPowerAccount::LEN,
        &[
            CITIZEN_POWER_SEED,
            power_snapshot.key.as_ref(),
            citizen.key.as_ref(),
            &[bump],
        ],
        NicechunkCivilizationError::CitizenPowerAlreadyInitialized,
    )?;
    let clock = Clock::get()?;
    let mut data = citizen_power.try_borrow_mut_data()?;
    CitizenPowerAccount::pack(
        &mut data,
        &CitizenPowerInitArgs {
            bump,
            snapshot: power_snapshot.key,
            citizen: citizen.key,
            snapshot_hash: &snapshot_hash,
            power,
            settled_slot: clock.slot,
            settled_at: clock.unix_timestamp,
            expires_at,
        },
    )
}

fn finalize_rule_tally(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(NicechunkCivilizationError::InvalidAccountCount.into());
    }
    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let rule_book = next_account_info(account_info_iter)?;
    let tally = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    if !payer.is_signer || !payer.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    if !rule_book.is_writable || !tally.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        rule_book.owner,
        program_id,
        NicechunkCivilizationError::InvalidRuleBookOwner,
    )?;
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;

    let (required_power, total_active_power) = {
        let rule_data = rule_book.try_borrow_data()?;
        RuleBookAccount::validate(&rule_data)?;
        if RuleBookAccount::status(&rule_data)? != STATUS_PUBLISHED {
            return Err(NicechunkCivilizationError::RuleAlreadyFinalized.into());
        }
        (
            RuleBookAccount::required_power(&rule_data)?,
            RuleBookAccount::total_active_power(&rule_data)?,
        )
    };
    let bump = validate_tally_pda(program_id, tally.key, rule_book.key)?;
    create_pda_account_if_needed(
        payer,
        tally,
        system_program_account,
        program_id,
        RuleTallyAccount::LEN,
        &[RULE_TALLY_SEED, rule_book.key.as_ref(), &[bump]],
    )?;

    let mut yes_power = 0_u64;
    let mut no_power = 0_u64;
    let mut abstain_power = 0_u64;
    let mut challenge_power = 0_u64;
    let mut counted_power = 0_u64;
    let mut seen_signers: Vec<Pubkey> = Vec::new();
    for signature in account_info_iter {
        require_key_eq(
            signature.owner,
            program_id,
            NicechunkCivilizationError::InvalidSignatureData,
        )?;
        let data = signature.try_borrow_data()?;
        RuleSignatureAccount::validate_for_rule(&data, rule_book.key)?;
        let signer = RuleSignatureAccount::signer(&data)?;
        if seen_signers.iter().any(|seen| seen == &signer) {
            return Err(NicechunkCivilizationError::DuplicateSignatureSigner.into());
        }
        seen_signers.push(signer);
        let signature_power = RuleSignatureAccount::power(&data);
        counted_power =
            checked_add_signature_power(counted_power, signature_power, total_active_power)?;
        match RuleSignatureAccount::side(&data) {
            SIDE_AGREE => yes_power = checked_add_power(yes_power, signature_power)?,
            SIDE_REJECT => no_power = checked_add_power(no_power, signature_power)?,
            SIDE_ABSTAIN => abstain_power = checked_add_power(abstain_power, signature_power)?,
            SIDE_CHALLENGE => {
                challenge_power = checked_add_power(challenge_power, signature_power)?
            }
            _ => return Err(NicechunkCivilizationError::InvalidSignatureSide.into()),
        }
    }

    let clock = Clock::get()?;
    {
        let mut tally_data = tally.try_borrow_mut_data()?;
        RuleTallyAccount::pack(
            &mut tally_data,
            bump,
            rule_book.key,
            yes_power,
            no_power,
            abstain_power,
            challenge_power,
            required_power,
            clock.slot,
            clock.unix_timestamp,
        )?;
    }
    let mut rule_data = rule_book.try_borrow_mut_data()?;
    RuleBookAccount::set_tally(
        &mut rule_data,
        yes_power,
        no_power,
        abstain_power,
        challenge_power,
        required_power,
        clock.slot,
    )
}

fn execute_rule_receipt(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 5 && accounts.len() != 6 {
        return Err(NicechunkCivilizationError::InvalidAccountCount.into());
    }
    let account_info_iter = &mut accounts.iter();
    let executor = next_account_info(account_info_iter)?;
    let rule_book = next_account_info(account_info_iter)?;
    let tally = next_account_info(account_info_iter)?;
    let receipt = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;
    let adapter_authority = account_info_iter.next();

    if !executor.is_signer || !executor.is_writable {
        return Err(NicechunkCivilizationError::InvalidPayer.into());
    }
    if !rule_book.is_writable || !receipt.is_writable {
        return Err(NicechunkCivilizationError::InvalidWritableAccount.into());
    }
    require_key_eq(
        rule_book.owner,
        program_id,
        NicechunkCivilizationError::InvalidRuleBookOwner,
    )?;
    require_key_eq(
        tally.owner,
        program_id,
        NicechunkCivilizationError::InvalidTallyData,
    )?;
    require_key_eq(
        system_program_account.key,
        &system_program::ID,
        NicechunkCivilizationError::InvalidSystemProgram,
    )?;
    validate_tally_pda(program_id, tally.key, rule_book.key)?;
    let (target_status, target_program) = {
        let rule_data = rule_book.try_borrow_data()?;
        RuleBookAccount::validate(&rule_data)?;
        let status = RuleBookAccount::status(&rule_data)?;
        if status == STATUS_EXECUTED {
            return Err(NicechunkCivilizationError::RuleAlreadyExecuted.into());
        }
        if status != STATUS_FINALIZED {
            return Err(NicechunkCivilizationError::RuleNotFinalized.into());
        }
        (
            RuleBookAccount::target_status(&rule_data)?,
            RuleBookAccount::target_program(&rule_data)?,
        )
    };
    if target_status == TARGET_STATUS_GOVERNABLE {
        let adapter_authority =
            adapter_authority.ok_or(NicechunkCivilizationError::MissingAdapterAuthority)?;
        validate_adapter_authority_pda(adapter_authority, &target_program, rule_book.key)?;
    }
    {
        let tally_data = tally.try_borrow_data()?;
        RuleTallyAccount::validate_threshold_met(&tally_data, rule_book.key)?;
    }

    let bump = validate_execution_receipt_pda(program_id, receipt.key, rule_book.key)?;
    create_pda_account(
        executor,
        receipt,
        system_program_account,
        program_id,
        ExecutionReceiptAccount::LEN,
        &[EXECUTION_RECEIPT_SEED, rule_book.key.as_ref(), &[bump]],
        NicechunkCivilizationError::RuleAlreadyExecuted,
    )?;

    let clock = Clock::get()?;
    {
        let mut receipt_data = receipt.try_borrow_mut_data()?;
        ExecutionReceiptAccount::pack(
            &mut receipt_data,
            bump,
            rule_book.key,
            executor.key,
            clock.slot,
            clock.unix_timestamp,
        )?;
    }
    let mut rule_data = rule_book.try_borrow_mut_data()?;
    RuleBookAccount::mark_executed(&mut rule_data, clock.slot)
}

fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system_program_account: &AccountInfo<'a>,
    owner: &Pubkey,
    len: usize,
    signer_seeds: &[&[u8]],
    already_initialized_error: NicechunkCivilizationError,
) -> ProgramResult {
    if account.owner == owner {
        return Err(already_initialized_error.into());
    }
    create_pda_account_if_needed(
        payer,
        account,
        system_program_account,
        owner,
        len,
        signer_seeds,
    )
}

fn create_pda_account_if_needed<'a>(
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system_program_account: &AccountInfo<'a>,
    owner: &Pubkey,
    len: usize,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    if account.owner == owner {
        if account.data_len() != len {
            return Err(NicechunkCivilizationError::InvalidSystemAccount.into());
        }
        return Ok(());
    }
    if account.owner != &system_program::ID || account.data_len() != 0 {
        return Err(NicechunkCivilizationError::InvalidSystemAccount.into());
    }
    let lamports = Rent::get()?.minimum_balance(len);
    invoke_signed(
        &system_instruction::create_account(payer.key, account.key, lamports, len as u64, owner),
        &[
            payer.clone(),
            account.clone(),
            system_program_account.clone(),
        ],
        &[signer_seeds],
    )
}

fn validate_rule_book_pda(
    program_id: &Pubkey,
    rule_book: &Pubkey,
    rule_id_hash: &[u8; 32],
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) =
        Pubkey::find_program_address(&[RULE_BOOK_SEED, rule_id_hash], program_id);
    if &expected != rule_book {
        return Err(NicechunkCivilizationError::InvalidRuleBookPda);
    }
    Ok(bump)
}

fn validate_signature_pda(
    program_id: &Pubkey,
    signature: &Pubkey,
    rule_book: &Pubkey,
    signer: &Pubkey,
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) = Pubkey::find_program_address(
        &[RULE_SIGNATURE_SEED, rule_book.as_ref(), signer.as_ref()],
        program_id,
    );
    if &expected != signature {
        return Err(NicechunkCivilizationError::InvalidSignaturePda);
    }
    Ok(bump)
}

fn validate_tally_pda(
    program_id: &Pubkey,
    tally: &Pubkey,
    rule_book: &Pubkey,
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) =
        Pubkey::find_program_address(&[RULE_TALLY_SEED, rule_book.as_ref()], program_id);
    if &expected != tally {
        return Err(NicechunkCivilizationError::InvalidTallyPda);
    }
    Ok(bump)
}

fn validate_execution_receipt_pda(
    program_id: &Pubkey,
    receipt: &Pubkey,
    rule_book: &Pubkey,
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) =
        Pubkey::find_program_address(&[EXECUTION_RECEIPT_SEED, rule_book.as_ref()], program_id);
    if &expected != receipt {
        return Err(NicechunkCivilizationError::InvalidExecutionReceiptPda);
    }
    Ok(bump)
}

fn validate_power_snapshot_pda(
    program_id: &Pubkey,
    power_snapshot: &Pubkey,
    snapshot_hash: &[u8; 32],
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) =
        Pubkey::find_program_address(&[POWER_SNAPSHOT_SEED, snapshot_hash], program_id);
    if &expected != power_snapshot {
        return Err(NicechunkCivilizationError::InvalidPowerSnapshotPda);
    }
    Ok(bump)
}

fn validate_citizen_power_pda(
    program_id: &Pubkey,
    citizen_power: &Pubkey,
    power_snapshot: &Pubkey,
    citizen: &Pubkey,
) -> Result<u8, NicechunkCivilizationError> {
    let (expected, bump) = Pubkey::find_program_address(
        &[
            CITIZEN_POWER_SEED,
            power_snapshot.as_ref(),
            citizen.as_ref(),
        ],
        program_id,
    );
    if &expected != citizen_power {
        return Err(NicechunkCivilizationError::InvalidCitizenPowerPda);
    }
    Ok(bump)
}

fn validate_adapter_authority_pda(
    adapter_authority: &AccountInfo,
    target_program: &Pubkey,
    rule_book: &Pubkey,
) -> ProgramResult {
    if !adapter_authority.is_signer {
        return Err(NicechunkCivilizationError::MissingAdapterAuthority.into());
    }
    let (expected, _) = Pubkey::find_program_address(
        &[CIVILIZATION_ADAPTER_AUTHORITY_SEED, rule_book.as_ref()],
        target_program,
    );
    if &expected != adapter_authority.key {
        return Err(NicechunkCivilizationError::InvalidAdapterAuthorityPda.into());
    }
    Ok(())
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or_default())
}

fn checked_add_power(left: u64, right: u64) -> Result<u64, NicechunkCivilizationError> {
    left.checked_add(right)
        .ok_or(NicechunkCivilizationError::InvalidSignatureData)
}

fn checked_add_signature_power(
    current: u64,
    added: u64,
    total_active_power: u64,
) -> Result<u64, NicechunkCivilizationError> {
    let next = checked_add_power(current, added)?;
    if next > total_active_power {
        return Err(NicechunkCivilizationError::InvalidSignatureData);
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_power_sum_cannot_exceed_total_active_power() {
        assert!(checked_add_signature_power(400, 600, 1_000).is_ok());
        assert!(checked_add_signature_power(400, 601, 1_000).is_err());
        assert!(checked_add_signature_power(u64::MAX, 1, u64::MAX).is_err());
    }
}
