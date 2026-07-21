use solana_program::{program_error::ProgramError, pubkey::Pubkey};

#[derive(Debug)]
#[repr(u32)]
pub enum NicechunkCivilizationError {
    InvalidInstruction = 7000,
    InvalidAccountCount = 7001,
    InvalidPayer = 7002,
    InvalidWritableAccount = 7003,
    InvalidSystemProgram = 7004,
    InvalidSystemAccount = 7005,
    InvalidRuleBookPda = 7006,
    RuleBookAlreadyInitialized = 7007,
    InvalidRuleBookOwner = 7008,
    InvalidRuleBookData = 7009,
    InvalidSignaturePda = 7010,
    SignatureAlreadyInitialized = 7011,
    InvalidSignatureData = 7012,
    InvalidTallyPda = 7013,
    InvalidTallyData = 7014,
    InvalidExecutionReceiptPda = 7015,
    InvalidExecutionReceiptData = 7016,
    InvalidThreshold = 7017,
    RuleAlreadyFinalized = 7018,
    RuleNotFinalized = 7019,
    ThresholdNotMet = 7020,
    RuleAlreadyExecuted = 7021,
    SnapshotMismatch = 7022,
    InvalidSignatureSide = 7023,
    PackSizeMismatch = 7024,
    DuplicateSignatureSigner = 7025,
    InvalidAdapterAuthorityPda = 7026,
    MissingAdapterAuthority = 7027,
    InvalidTargetStatus = 7028,
    InvalidPowerSnapshotPda = 7029,
    PowerSnapshotAlreadyInitialized = 7030,
    InvalidPowerSnapshotData = 7031,
    InvalidCitizenPowerPda = 7032,
    CitizenPowerAlreadyInitialized = 7033,
    InvalidCitizenPowerData = 7034,
    CitizenPowerMismatch = 7035,
    InvalidPowerAuthority = 7036,
    PowerSnapshotExpired = 7037,
}

impl From<NicechunkCivilizationError> for ProgramError {
    fn from(error: NicechunkCivilizationError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

pub fn require_key_eq(
    left: &Pubkey,
    right: &Pubkey,
    error: NicechunkCivilizationError,
) -> Result<(), ProgramError> {
    if left != right {
        return Err(error.into());
    }
    Ok(())
}
