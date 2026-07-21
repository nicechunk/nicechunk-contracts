import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createInitializeSurfaceDecorationTableInstruction,
  createVerifySurfaceDecorationInstruction,
  decodeSurfaceDecorationTable,
  deriveSurfaceDecorationTablePda,
  resolveSurfaceDecorationAt,
  type SurfaceDecorationRuleInput,
} from "../sdk/nicechunk-chunk.ts";
import {
  decodeGlobalConfig,
  deriveGlobalConfigPda,
} from "../sdk/nicechunk-core.ts";
// @ts-ignore Runtime rules are shared directly with the raw WebGL2 generator.
import { DEFAULT_SURFACE_DECORATION_RULES } from "../chunk.js/world/surface-decoration-rules.js";
import {
  chunkProgramId,
  clusterUrl,
  connection,
  coreProgramId,
  readPayerKeypair,
} from "./core-script-utils.ts";

const payer = readPayerKeypair();
const rpc = connection();
const selectedCoreProgramId = coreProgramId();
const selectedChunkProgramId = chunkProgramId();
const [globalConfig] = deriveGlobalConfigPda(selectedCoreProgramId);
const [surfaceDecorationTable] = deriveSurfaceDecorationTablePda({
  globalConfig,
  programId: selectedChunkProgramId,
});
const rules = DEFAULT_SURFACE_DECORATION_RULES as SurfaceDecorationRuleInput[];
const dryRun = process.env.DRY_RUN === "1";

console.log(`Cluster URL: ${clusterUrl()}`);
console.log(`Payer: ${payer.publicKey.toBase58()}`);
console.log(`Chunk program: ${selectedChunkProgramId.toBase58()}`);
console.log(`GlobalConfig PDA: ${globalConfig.toBase58()}`);
console.log(`SurfaceDecorationTable PDA: ${surfaceDecorationTable.toBase58()}`);
console.log(`Rule count: ${rules.length}`);

const globalConfigAccount = await rpc.getAccountInfo(globalConfig, "confirmed");
if (!globalConfigAccount) throw new Error(`GlobalConfig account not found: ${globalConfig.toBase58()}`);

let tableAccount = await rpc.getAccountInfo(surfaceDecorationTable, "confirmed");
if (!tableAccount) {
  const instruction = createInitializeSurfaceDecorationTableInstruction({
    payer: payer.publicKey,
    rules,
    chunkProgramId: selectedChunkProgramId,
    coreProgramId: selectedCoreProgramId,
  });
  if (dryRun) {
    console.log(`Dry run only. Instruction bytes: ${instruction.data.length}; keys: ${instruction.keys.length}`);
    process.exit(0);
  }
  const signature = await sendAndConfirmTransaction(
    rpc,
    new Transaction().add(instruction),
    [payer],
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  console.log(`Initialized SurfaceDecorationTable. Signature: ${signature}`);
  tableAccount = await rpc.getAccountInfo(surfaceDecorationTable, "confirmed");
}

if (!tableAccount) throw new Error("SurfaceDecorationTable was not initialized");
if (!tableAccount.owner.equals(selectedChunkProgramId)) {
  throw new Error(`SurfaceDecorationTable owner mismatch: ${tableAccount.owner.toBase58()}`);
}

const decoded = decodeSurfaceDecorationTable(tableAccount.data);
const sameRules = JSON.stringify(decoded.rules) === JSON.stringify(rules);
console.log(`SurfaceDecorationTable revision: ${decoded.revision}`);
console.log(`SurfaceDecorationTable rules match runtime defaults: ${sameRules}`);
if (!sameRules) {
  throw new Error("The existing table differs from runtime defaults. Update it through a finalized civilization rule instead of overwriting it.");
}

const worldX = readInteger("VERIFY_X", -131);
const worldZ = readInteger("VERIFY_Z", -131);
const config = decodeGlobalConfig(globalConfigAccount.data);
const match = resolveSurfaceDecorationAt(config, decoded.rules, worldX, worldZ);
if (!match) throw new Error(`No surface decoration exists at verification coordinate ${worldX},${worldZ}`);

const verifyInstruction = createVerifySurfaceDecorationInstruction({
  worldX,
  worldZ,
  expectedSurfaceBlockId: match.surfaceBlockId,
  expectedDecorationId: match.decorationId,
  expectedRuleId: match.ruleId,
  chunkProgramId: selectedChunkProgramId,
  coreProgramId: selectedCoreProgramId,
});
const latest = await rpc.getLatestBlockhash("confirmed");
const transaction = new Transaction({
  feePayer: payer.publicKey,
  recentBlockhash: latest.blockhash,
}).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  verifyInstruction,
);
transaction.sign(payer);
const simulation = await rpc.simulateTransaction(transaction);
if (simulation.value.err) {
  throw new Error(`Surface decoration verification simulation failed: ${JSON.stringify(simulation.value.err)}\n${(simulation.value.logs ?? []).join("\n")}`);
}
console.log(JSON.stringify({
  verified: true,
  coordinate: { x: worldX, z: worldZ },
  surfaceY: match.surfaceY,
  surfaceBlockId: match.surfaceBlockId,
  decorationId: match.decorationId,
  ruleId: match.ruleId,
  roll: match.roll,
}, null, 2));

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}
