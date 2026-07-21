import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CIVILIZATION_SIDE_AGREE,
  createFinalizeCivilizationRuleInstruction,
  decodeExecutionReceipt,
  decodeRuleBook,
  decodeRuleSignature,
  decodeRuleTally,
  deriveExecutionReceiptPda,
  deriveRuleBookPda,
  deriveRuleSignaturePda,
  deriveRuleTallyPda,
  encodePublishRuleArgs,
  NICECHUNK_CIVILIZATION_POWER_AUTHORITY,
  NICECHUNK_CIVILIZATION_PROGRAM_ID,
  RULE_STATUS_EXECUTED,
  RULE_STATUS_FINALIZED,
  RULE_STATUS_PUBLISHED,
} from "../sdk/nicechunk-civilization.ts";
import {
  createApplyCivilizationSurfaceDecorationRulesInstruction,
  decodeSurfaceDecorationTable,
  deriveSurfaceDecorationTablePda,
  encodeSurfaceDecorationRules,
  NICECHUNK_CHUNK_PROGRAM_ID,
  type SurfaceDecorationRuleInput,
} from "../sdk/nicechunk-chunk.ts";
import { deriveGlobalConfigPda, NICECHUNK_CORE_PROGRAM_ID } from "../sdk/nicechunk-core.ts";
// @ts-ignore The WebGL runtime rules are the canonical initialization fixture.
import { DEFAULT_SURFACE_DECORATION_RULES } from "../chunk.js/world/surface-decoration-rules.js";

const rpcUrl = requiredEnv("SOLANA_RPC_URL");
const payerPath = requiredEnv("PAYER_KEYPAIR");
const execute = process.argv.includes("--execute");
const unknownArgs = process.argv.slice(2).filter((argument) => argument !== "--execute");
if (unknownArgs.length) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

const connection = new Connection(rpcUrl, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
if (!payer.publicKey.equals(NICECHUNK_CIVILIZATION_POWER_AUTHORITY)) {
  throw new Error(
    `PAYER_KEYPAIR must be the deployed Civilization authority ${NICECHUNK_CIVILIZATION_POWER_AUTHORITY.toBase58()}; got ${payer.publicKey.toBase58()}`,
  );
}

const rules = DEFAULT_SURFACE_DECORATION_RULES as SurfaceDecorationRuleInput[];
if (rules.length !== 43) throw new Error(`Expected exactly 43 default surface-decoration rules; got ${rules.length}`);
const addedRuleIds = rules.slice(-6).map((rule) => rule.ruleId).join(",");
if (addedRuleIds !== "74,75,76,77,78,79") {
  throw new Error(`Expected cotton and flower rules 74-79 at the end of the table; got ${addedRuleIds}`);
}

const [globalConfig] = deriveGlobalConfigPda(NICECHUNK_CORE_PROGRAM_ID);
const [surfaceDecorationTable] = deriveSurfaceDecorationTablePda({
  globalConfig,
  programId: NICECHUNK_CHUNK_PROGRAM_ID,
});
const patchPayload = encodeSurfaceDecorationRules(rules);
const patchHash = sha256(patchPayload);
const textHash = sha256(Buffer.from("NiceChunk SurfaceDecorationTable revision 2: cotton and five-color flowers"));
const snapshotHash = sha256(Buffer.from(
  `nicechunk-surface-decoration-authority-v1:${payer.publicKey.toBase58()}`,
));
const ruleIdHash = sha256(Buffer.concat([
  textHash,
  patchHash,
  snapshotHash,
  NICECHUNK_CHUNK_PROGRAM_ID.toBuffer(),
  surfaceDecorationTable.toBuffer(),
]));
const [ruleBook] = deriveRuleBookPda({ ruleIdHash });
const [signature] = deriveRuleSignaturePda({ ruleBook, signer: payer.publicKey });
const [tally] = deriveRuleTallyPda({ ruleBook });
const [receipt] = deriveExecutionReceiptPda({ ruleBook });

console.log(JSON.stringify({
  mode: execute ? "execute" : "dry-run",
  rpcUrl,
  payer: payer.publicKey.toBase58(),
  coreProgram: NICECHUNK_CORE_PROGRAM_ID.toBase58(),
  chunkProgram: NICECHUNK_CHUNK_PROGRAM_ID.toBase58(),
  civilizationProgram: NICECHUNK_CIVILIZATION_PROGRAM_ID.toBase58(),
  globalConfig: globalConfig.toBase58(),
  surfaceDecorationTable: surfaceDecorationTable.toBase58(),
  ruleBook: ruleBook.toBase58(),
  signature: signature.toBase58(),
  tally: tally.toBase58(),
  receipt: receipt.toBase58(),
  ruleCount: rules.length,
  patchBytes: patchPayload.length,
  patchHash: hex(patchHash),
  textHash: hex(textHash),
  snapshotHash: hex(snapshotHash),
  ruleIdHash: hex(ruleIdHash),
}, null, 2));

await requireProgramAccount(NICECHUNK_CORE_PROGRAM_ID, "Core program");
await requireProgramAccount(NICECHUNK_CHUNK_PROGRAM_ID, "Chunk program");
await requireProgramAccount(NICECHUNK_CIVILIZATION_PROGRAM_ID, "Civilization program");
const globalConfigInfo = await connection.getAccountInfo(globalConfig, "confirmed");
if (!globalConfigInfo?.owner.equals(NICECHUNK_CORE_PROGRAM_ID)) {
  throw new Error(`GlobalConfig is missing or has the wrong owner: ${globalConfig.toBase58()}`);
}

const initialTable = await readTable();
const targetAlreadyApplied = sameRules(initialTable.rules, rules);
if (targetAlreadyApplied && initialTable.revision !== 2) {
  throw new Error(`The 43-rule table must be revision 2; got revision ${initialTable.revision}`);
}
if (!targetAlreadyApplied) {
  if (initialTable.revision !== 1) {
    throw new Error(`Refusing to replace unexpected SurfaceDecorationTable revision ${initialTable.revision}`);
  }
  if (initialTable.rules.length !== 37 || !sameRules(initialTable.rules, rules.slice(0, 37))) {
    throw new Error("The revision 1 table is not the exact 37-rule prefix of the requested table");
  }
}

let state = await inspectGovernance();
validateGovernance(state);
logState("initial", initialTable, state);

if (targetAlreadyApplied) {
  verifyFinal(initialTable, state);
  console.log(JSON.stringify({ ok: true, changed: false, reason: "already synchronized" }, null, 2));
  process.exit(0);
}

if (!execute) {
  const pending: TransactionInstruction[] = [];
  if (!state.ruleBook) pending.push(createLegacyPublishInstruction());
  if (!state.signature) pending.push(createLegacySignInstruction());
  if (!state.tally) pending.push(createFinalizeCivilizationRuleInstruction({
    payer: payer.publicKey,
    ruleBook,
    signatures: [signature],
  }));
  if (pending.length) {
    await simulateLegacy(pending, "next governance stages");
  } else if (!state.receipt) {
    const executionInstruction = createExecutionInstruction();
    const legacyWireBytes = await legacyWireSize([executionInstruction]);
    console.log(`Execution is ready; legacy wire size is ${legacyWireBytes} bytes, so --execute will create an ALT and simulate a v0 transaction.`);
  }
  console.log("Dry run complete. No account or program was modified. Re-run with --execute to apply the staged update.");
  process.exit(0);
}

if (!state.ruleBook) {
  await sendLegacy([createLegacyPublishInstruction()], "publish legacy RuleBook");
  state = await inspectGovernance();
  validateGovernance(state);
}
if (!state.signature) {
  await sendLegacy([createLegacySignInstruction()], "sign legacy RuleBook");
  state = await inspectGovernance();
  validateGovernance(state);
}
if (!state.tally) {
  await sendLegacy([createFinalizeCivilizationRuleInstruction({
    payer: payer.publicKey,
    ruleBook,
    signatures: [signature],
  })], "finalize RuleTally");
  state = await inspectGovernance();
  validateGovernance(state);
}
if (!state.receipt) {
  const executionInstruction = createExecutionInstruction();
  const lookupTable = await createLookupTable(executionInstruction);
  await sendV0([executionInstruction], lookupTable, "apply Chunk instruction 13");
  state = await inspectGovernance();
  validateGovernance(state);
}

const finalTable = await readTable();
verifyFinal(finalTable, state);
console.log(JSON.stringify({
  ok: true,
  changed: true,
  previousRevision: initialTable.revision,
  revision: finalTable.revision,
  ruleCount: finalTable.rules.length,
  ruleStatus: state.ruleBook?.status,
  tallyThresholdMet: state.tally?.thresholdMet,
  receiptExecuted: state.receipt?.executed,
}, null, 2));

function createLegacyPublishInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: NICECHUNK_CIVILIZATION_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ruleBook, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([0]),
      encodePublishRuleArgs({
        ruleIdHash,
        textHash,
        patchHash,
        snapshotHash,
        targetProgram: NICECHUNK_CHUNK_PROGRAM_ID,
        targetPda: surfaceDecorationTable,
        totalActivePower: 1,
        thresholdBps: 5_000,
        targetStatus: 1,
        riskLevel: 2,
      }),
    ]),
  });
}

function createLegacySignInstruction(): TransactionInstruction {
  const data = Buffer.alloc(42);
  data.writeUInt8(1, 0);
  data.writeUInt8(CIVILIZATION_SIDE_AGREE, 1);
  data.writeBigUInt64LE(1n, 2);
  snapshotHash.copy(data, 10);
  return new TransactionInstruction({
    programId: NICECHUNK_CIVILIZATION_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ruleBook, isSigner: false, isWritable: false },
      { pubkey: signature, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createExecutionInstruction(): TransactionInstruction {
  return createApplyCivilizationSurfaceDecorationRulesInstruction({
    executor: payer.publicKey,
    surfaceDecorationTable,
    globalConfig,
    ruleBook,
    tally,
    receipt,
    rules,
    chunkProgramId: NICECHUNK_CHUNK_PROGRAM_ID,
    civilizationProgramId: NICECHUNK_CIVILIZATION_PROGRAM_ID,
  });
}

async function inspectGovernance() {
  const [ruleBookInfo, signatureInfo, tallyInfo, receiptInfo] = await Promise.all([
    connection.getAccountInfo(ruleBook, "confirmed"),
    connection.getAccountInfo(signature, "confirmed"),
    connection.getAccountInfo(tally, "confirmed"),
    connection.getAccountInfo(receipt, "confirmed"),
  ]);
  for (const [name, info] of [["RuleBook", ruleBookInfo], ["RuleSignature", signatureInfo], ["RuleTally", tallyInfo], ["ExecutionReceipt", receiptInfo]] as const) {
    if (info && !info.owner.equals(NICECHUNK_CIVILIZATION_PROGRAM_ID)) {
      throw new Error(`${name} has the wrong owner: ${info.owner.toBase58()}`);
    }
  }
  return {
    ruleBook: ruleBookInfo ? decodeRuleBook(Buffer.from(ruleBookInfo.data)) : null,
    signature: signatureInfo ? decodeRuleSignature(Buffer.from(signatureInfo.data)) : null,
    tally: tallyInfo ? decodeRuleTally(Buffer.from(tallyInfo.data)) : null,
    receipt: receiptInfo ? decodeExecutionReceipt(Buffer.from(receiptInfo.data)) : null,
  };
}

function validateGovernance(state: Awaited<ReturnType<typeof inspectGovernance>>): void {
  if (!state.ruleBook && (state.signature || state.tally || state.receipt)) {
    throw new Error("Dependent governance accounts exist without the RuleBook");
  }
  if (state.ruleBook) {
    const value = state.ruleBook;
    if (!value.ruleIdHash.equals(ruleIdHash) || !value.textHash.equals(textHash) || !value.patchHash.equals(patchHash)
      || !value.snapshotHash.equals(snapshotHash) || !value.targetProgram.equals(NICECHUNK_CHUNK_PROGRAM_ID)
      || !value.targetPda.equals(surfaceDecorationTable) || value.totalActivePower !== 1n
      || value.requiredPower !== 1n || value.thresholdBps !== 5_000 || value.targetStatus !== 1 || value.riskLevel !== 2) {
      throw new Error("Existing RuleBook does not exactly match the requested surface-decoration proposal");
    }
    if (![RULE_STATUS_PUBLISHED, RULE_STATUS_FINALIZED, RULE_STATUS_EXECUTED].includes(value.status)) {
      throw new Error(`Unexpected RuleBook status ${value.status}`);
    }
  }
  if (state.signature && (!state.signature.ruleBook.equals(ruleBook) || !state.signature.signer.equals(payer.publicKey)
    || !state.signature.snapshotHash.equals(snapshotHash) || state.signature.snapshotPower !== 1n
    || state.signature.side !== CIVILIZATION_SIDE_AGREE)) {
    throw new Error("Existing RuleSignature does not exactly match the requested vote");
  }
  if (state.tally && (!state.tally.ruleBook.equals(ruleBook) || !state.tally.thresholdMet
    || state.tally.yesPower !== 1n || state.tally.noPower !== 0n || state.tally.abstainPower !== 0n
    || state.tally.challengePower !== 0n || state.tally.requiredPower !== 1n)) {
    throw new Error("Existing RuleTally does not exactly match the expected 1-of-1 result");
  }
  if (state.receipt && (!state.receipt.ruleBook.equals(ruleBook) || !state.receipt.executed)) {
    throw new Error("Existing ExecutionReceipt is not the expected executed receipt");
  }
}

async function readTable() {
  const info = await connection.getAccountInfo(surfaceDecorationTable, "confirmed");
  if (!info) throw new Error(`SurfaceDecorationTable is missing: ${surfaceDecorationTable.toBase58()}`);
  if (!info.owner.equals(NICECHUNK_CHUNK_PROGRAM_ID)) {
    throw new Error(`SurfaceDecorationTable has the wrong owner: ${info.owner.toBase58()}`);
  }
  return decodeSurfaceDecorationTable(Buffer.from(info.data));
}

function verifyFinal(table: Awaited<ReturnType<typeof readTable>>, state: Awaited<ReturnType<typeof inspectGovernance>>): void {
  if (table.revision !== 2 || table.rules.length !== 43 || !sameRules(table.rules, rules)) {
    throw new Error(`Final table mismatch: revision ${table.revision}, rules ${table.rules.length}`);
  }
  if (!state.ruleBook || state.ruleBook.status !== RULE_STATUS_EXECUTED) throw new Error("RuleBook is not executed");
  if (!state.tally?.thresholdMet) throw new Error("RuleTally threshold was not met");
  if (!state.receipt?.executed) throw new Error("ExecutionReceipt is not executed");
}

async function sendLegacy(instructions: TransactionInstruction[], label: string): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...instructions);
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(payer);
  await assertSimulation(transaction, label);
  const txSignature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 5 });
  const confirmation = await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
  console.log(`${label}: ${txSignature}`);
  return txSignature;
}

async function simulateLegacy(instructions: TransactionInstruction[], label: string): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...instructions);
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(payer);
  await assertSimulation(transaction, label);
  console.log(`${label} simulation passed; wire bytes: ${transaction.serialize().length}`);
}

async function assertSimulation(transaction: Transaction | VersionedTransaction, label: string): Promise<void> {
  const result = transaction instanceof VersionedTransaction
    ? await connection.simulateTransaction(transaction, { commitment: "confirmed" })
    : await connection.simulateTransaction(transaction);
  if (result.value.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(result.value.err)}\n${(result.value.logs ?? []).join("\n")}`);
  }
  console.log(`${label} simulation units: ${result.value.unitsConsumed ?? "unknown"}`);
}

async function createLookupTable(executionInstruction: TransactionInstruction): Promise<AddressLookupTableAccount> {
  const recentSlot = await connection.getSlot("finalized");
  const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });
  const addresses = uniquePublicKeys([
    executionInstruction.programId,
    ...executionInstruction.keys.filter((key) => !key.isSigner).map((key) => key.pubkey),
  ]);
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses,
  });
  await sendLegacy([createInstruction, extendInstruction], "create surface-decoration ALT");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [slot, lookup] = await Promise.all([
      connection.getSlot("confirmed"),
      connection.getAddressLookupTable(lookupTableAddress, { commitment: "confirmed" }),
    ]);
    if (lookup.value && slot > lookup.value.state.lastExtendedSlot) return lookup.value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`New ALT did not activate: ${lookupTableAddress.toBase58()}`);
}

async function sendV0(
  instructions: TransactionInstruction[],
  lookupTable: AddressLookupTableAccount,
  label: string,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ...instructions,
    ],
  }).compileToV0Message([lookupTable]);
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  await assertSimulation(transaction, label);
  const txSignature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 8 });
  const confirmation = await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
  console.log(`${label}: ${txSignature}`);
  return txSignature;
}

async function legacyWireSize(instructions: TransactionInstruction[]): Promise<number> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(payer);
  return transaction.serialize({ requireAllSignatures: true, verifySignatures: true }).length;
}

async function requireProgramAccount(address: PublicKey, label: string): Promise<void> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info?.executable) throw new Error(`${label} is missing or not executable: ${address.toBase58()}`);
}

function logState(
  phase: string,
  table: Awaited<ReturnType<typeof readTable>>,
  state: Awaited<ReturnType<typeof inspectGovernance>>,
): void {
  console.log(JSON.stringify({
    phase,
    tableRevision: table.revision,
    tableRuleCount: table.rules.length,
    ruleStatus: state.ruleBook?.status ?? "missing",
    signature: state.signature ? "present" : "missing",
    tally: state.tally ? { present: true, thresholdMet: state.tally.thresholdMet } : "missing",
    receipt: state.receipt ? { present: true, executed: state.receipt.executed } : "missing",
  }, null, 2));
}

function sameRules(left: SurfaceDecorationRuleInput[], right: SurfaceDecorationRuleInput[]): boolean {
  return Buffer.from(encodeSurfaceDecorationRules(left)).equals(Buffer.from(encodeSurfaceDecorationRules(right)));
}

function uniquePublicKeys(addresses: PublicKey[]): PublicKey[] {
  return [...new Map(addresses.map((address) => [address.toBase58(), address])).values()];
}

function sha256(value: Buffer | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

function hex(value: Buffer): string {
  return `sha256:${value.toString("hex")}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
