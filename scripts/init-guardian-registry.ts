import {
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  createInitializeGuardianRegistryInstruction,
  decodeGuardianRegistry,
  deriveGuardianRegistryPda,
  deriveGuardianTreasuryAuthorityPda,
  GUARDIAN_TREASURY_WALLET,
} from "../sdk/nicechunk-guardian.ts";
import { deriveGlobalConfigPda } from "../sdk/nicechunk-core.ts";
import {
  connection,
  coreProgramId,
  guardianProgramId,
  nckMint,
  readPayerKeypair,
} from "./core-script-utils.ts";

const conn = connection();
const treasury = readPayerKeypair();
if (!treasury.publicKey.equals(GUARDIAN_TREASURY_WALLET)) {
  throw new Error(`Guardian registry initialization requires treasury ${GUARDIAN_TREASURY_WALLET.toBase58()}`);
}
const selectedCoreProgramId = coreProgramId();
const selectedGuardianProgramId = guardianProgramId();
const selectedNckMint = nckMint();
const [globalConfig] = deriveGlobalConfigPda(selectedCoreProgramId);
const [registry, registryBump] = deriveGuardianRegistryPda({
  globalConfig,
  programId: selectedGuardianProgramId,
});
const [treasuryAuthority, treasuryBump] = deriveGuardianTreasuryAuthorityPda({
  globalConfig,
  programId: selectedGuardianProgramId,
});
const treasuryNckToken = getAssociatedTokenAddressSync(selectedNckMint, treasuryAuthority, true);

if (process.env.DRY_RUN === "1") {
  console.log(JSON.stringify({
    status: "dry-run",
    treasury: treasury.publicKey.toBase58(),
    coreProgramId: selectedCoreProgramId.toBase58(),
    guardianProgramId: selectedGuardianProgramId.toBase58(),
    globalConfig: globalConfig.toBase58(),
    registry: registry.toBase58(),
    registryBump,
    treasuryAuthority: treasuryAuthority.toBase58(),
    treasuryBump,
    treasuryNckToken: treasuryNckToken.toBase58(),
    nckMint: selectedNckMint.toBase58(),
  }, null, 2));
  process.exit(0);
}

const existing = await conn.getAccountInfo(registry, "confirmed");
if (existing?.owner.equals(selectedGuardianProgramId)) {
  console.log(JSON.stringify({
    status: "exists",
    registry: registry.toBase58(),
    decoded: decodeGuardianRegistry(existing.data),
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  process.exit(0);
}

const tx = new Transaction();
const treasuryTokenInfo = await conn.getAccountInfo(treasuryNckToken, "confirmed");
if (!treasuryTokenInfo) {
  tx.add(createAssociatedTokenAccountInstruction(
    treasury.publicKey,
    treasuryNckToken,
    treasuryAuthority,
    selectedNckMint,
  ));
}
tx.add(createInitializeGuardianRegistryInstruction({
  treasury: treasury.publicKey,
  treasuryNckToken,
  guardianProgramId: selectedGuardianProgramId,
  coreProgramId: selectedCoreProgramId,
  nckMint: selectedNckMint,
}));

const signature = await sendAndConfirmTransaction(conn, tx, [treasury], {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const account = await conn.getAccountInfo(registry, "confirmed");

console.log(JSON.stringify({
  status: "initialized",
  signature,
  registry: registry.toBase58(),
  treasuryAuthority: treasuryAuthority.toBase58(),
  treasuryNckToken: treasuryNckToken.toBase58(),
  decoded: account ? decodeGuardianRegistry(account.data) : null,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
