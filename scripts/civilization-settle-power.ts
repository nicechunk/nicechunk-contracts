import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublishPowerSnapshotInstruction,
  createSettleCitizenPowerInstruction,
  deriveCitizenPowerPda,
  derivePowerSnapshotPda,
  NICECHUNK_CIVILIZATION_POWER_AUTHORITY,
  NICECHUNK_CIVILIZATION_PROGRAM_ID,
} from "../sdk/nicechunk-civilization.ts";

type CitizenPowerInput = {
  wallet: string;
  power: bigint;
};

type CliArgs = {
  keypair: string;
  rpcUrl: string;
  citizens: CitizenPowerInput[];
  citizensFile: string;
  snapshotHash: string;
  windowStartEpoch: bigint;
  windowEndEpoch: bigint;
  expiresAt: bigint;
  send: boolean;
  offline: boolean;
  out: string;
};

const args = parseArgs(process.argv.slice(2));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(args.keypair, "utf8"))));
if (!authority.publicKey.equals(NICECHUNK_CIVILIZATION_POWER_AUTHORITY)) {
  throw new Error(`Civilization power settlement must be signed by ${NICECHUNK_CIVILIZATION_POWER_AUTHORITY.toBase58()}, got ${authority.publicKey.toBase58()}`);
}

const citizens = loadCitizens(args);
if (!citizens.length) throw new Error("At least one --citizen wallet:power entry or --citizens-file is required.");
const totalActivePower = citizens.reduce((sum, item) => sum + item.power, 0n);
if (totalActivePower <= 0n) throw new Error("Total active power must be positive.");
if (args.windowEndEpoch < args.windowStartEpoch) throw new Error("window-end-epoch must be >= window-start-epoch.");
if (args.expiresAt <= 0n) throw new Error("expires-at must be a Unix timestamp in seconds.");

const snapshotPreimage = {
  kind: "nicechunk.civilization.power_snapshot_preimage.v1",
  authority: authority.publicKey.toBase58(),
  civilization_program_id: NICECHUNK_CIVILIZATION_PROGRAM_ID.toBase58(),
  total_active_power: totalActivePower.toString(),
  window_start_epoch: args.windowStartEpoch.toString(),
  window_end_epoch: args.windowEndEpoch.toString(),
  expires_at: args.expiresAt.toString(),
  citizens: citizens.map((item) => ({
    wallet: new PublicKey(item.wallet).toBase58(),
    power: item.power.toString(),
  })),
};
const snapshotHash = args.snapshotHash || `sha256:${sha256(stableJson(snapshotPreimage))}`;
const [powerSnapshot] = derivePowerSnapshotPda({ snapshotHash });
const conn = args.offline ? null : new Connection(args.rpcUrl, "confirmed");
const snapshotStatus = await accountStatus(conn, powerSnapshot);
const citizenRows = await Promise.all(citizens.map(async (item) => {
  const citizen = new PublicKey(item.wallet);
  const [citizenPower] = deriveCitizenPowerPda({ powerSnapshot, citizen });
  const status = await accountStatus(conn, citizenPower);
  return {
    citizen: citizen.toBase58(),
    power: item.power.toString(),
    citizen_power_pda: citizenPower.toBase58(),
    account_status: status,
  };
}));

const instructions = [];
if (snapshotStatus.status === "missing" || snapshotStatus.status === "offline_unknown") {
  instructions.push({
    label: "publish_power_snapshot",
    ix: createPublishPowerSnapshotInstruction({
      authority: authority.publicKey,
      snapshotHash,
      totalActivePower,
      windowStartEpoch: args.windowStartEpoch,
      windowEndEpoch: args.windowEndEpoch,
      expiresAt: args.expiresAt,
    }),
  });
}
for (const row of citizenRows) {
  if (row.account_status.status !== "missing" && row.account_status.status !== "offline_unknown") continue;
  instructions.push({
    label: "settle_citizen_power",
    ix: createSettleCitizenPowerInstruction({
      authority: authority.publicKey,
      powerSnapshot,
      citizen: new PublicKey(row.citizen),
      power: BigInt(row.power),
    }),
  });
}

const result: Record<string, unknown> = {
  kind: "nicechunk.civilization.power_settlement_packet.v1",
  generated_at: new Date().toISOString(),
  send_requested: args.send,
  offline: args.offline,
  rpc_url: args.offline ? "" : args.rpcUrl,
  authority: authority.publicKey.toBase58(),
  authority_verified: true,
  civilization_program_id: NICECHUNK_CIVILIZATION_PROGRAM_ID.toBase58(),
  snapshot_hash: snapshotHash,
  snapshot_preimage_hash: `sha256:${sha256(stableJson(snapshotPreimage))}`,
  power_snapshot_pda: powerSnapshot.toBase58(),
  power_snapshot_status: snapshotStatus,
  total_active_power: totalActivePower.toString(),
  window_start_epoch: args.windowStartEpoch.toString(),
  window_end_epoch: args.windowEndEpoch.toString(),
  expires_at: args.expiresAt.toString(),
  citizens: citizenRows,
  instructions: instructions.map((item) => describeInstruction(item.label, item.ix)),
  transaction_signatures: [],
};

if (args.send) {
  if (!conn) throw new Error("--send cannot be used with --offline.");
  result.transaction_signatures = await sendInstructions(conn, authority, instructions);
}

if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): CliArgs {
  const parsed: CliArgs = {
    keypair: process.env.SOLANA_KEYPAIR || ".deploy/phantom-keypair.json",
    rpcUrl: process.env.SOLANA_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    citizens: [],
    citizensFile: "",
    snapshotHash: "",
    windowStartEpoch: 0n,
    windowEndEpoch: 27n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
    send: false,
    offline: false,
    out: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--keypair") parsed.keypair = values[++index];
    else if (value === "--url" || value === "--rpc-url") parsed.rpcUrl = values[++index];
    else if (value === "--citizen") parsed.citizens.push(parseCitizen(values[++index]));
    else if (value === "--citizens-file") parsed.citizensFile = values[++index];
    else if (value === "--snapshot-hash") parsed.snapshotHash = values[++index];
    else if (value === "--window-start-epoch") parsed.windowStartEpoch = BigInt(values[++index]);
    else if (value === "--window-end-epoch") parsed.windowEndEpoch = BigInt(values[++index]);
    else if (value === "--expires-at") parsed.expiresAt = BigInt(values[++index]);
    else if (value === "--send") parsed.send = true;
    else if (value === "--offline") parsed.offline = true;
    else if (value === "--out") parsed.out = values[++index];
    else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run civilization:settle-power -- --citizen WALLET:POWER [--citizen WALLET:POWER ...]
  npm run civilization:settle-power -- --citizens-file citizens.json [--send]

Options:
  --offline                 Build a deterministic settlement packet without RPC reads.
  --send                    Submit missing power snapshot / citizen power accounts.
  --snapshot-hash HASH      Use a precomputed sha256:... snapshot hash.
  --window-start-epoch N    Snapshot start epoch, default 0.
  --window-end-epoch N      Snapshot end epoch, default 27.
  --expires-at UNIX_SECONDS Snapshot expiry, default now + 30 days.
  --out PATH                Write the settlement packet JSON to a file.
`);
}

function loadCitizens(parsed: CliArgs): CitizenPowerInput[] {
  const values = [...parsed.citizens];
  if (parsed.citizensFile) {
    if (!existsSync(parsed.citizensFile)) throw new Error(`Missing citizens file: ${parsed.citizensFile}`);
    const file = JSON.parse(readFileSync(parsed.citizensFile, "utf8"));
    const entries = Array.isArray(file) ? file : file.citizens;
    if (!Array.isArray(entries)) throw new Error("citizens-file must be an array or an object with citizens[].");
    for (const entry of entries) {
      values.push({
        wallet: String(entry.wallet ?? entry.citizen ?? entry.address ?? ""),
        power: BigInt(entry.power ?? entry.civilization_value ?? entry.value ?? 0),
      });
    }
  }
  const byWallet = new Map<string, bigint>();
  for (const item of values) {
    const wallet = new PublicKey(item.wallet).toBase58();
    if (item.power <= 0n) throw new Error(`Citizen power must be positive for ${wallet}.`);
    byWallet.set(wallet, (byWallet.get(wallet) || 0n) + item.power);
  }
  return Array.from(byWallet.entries())
    .map(([wallet, power]) => ({ wallet, power }))
    .sort((left, right) => left.wallet.localeCompare(right.wallet));
}

function parseCitizen(value: string): CitizenPowerInput {
  const [wallet, power] = String(value || "").split(":");
  if (!wallet || !power) throw new Error("--citizen must use wallet:power.");
  return { wallet, power: BigInt(power) };
}

async function accountStatus(conn: Connection | null, address: PublicKey) {
  if (!conn) return { status: "offline_unknown", pda: address.toBase58() };
  const account = await conn.getAccountInfo(address, "confirmed");
  if (!account) return { status: "missing", pda: address.toBase58() };
  return {
    status: "exists",
    pda: address.toBase58(),
    owner: account.owner.toBase58(),
    lamports: account.lamports,
    bytes: account.data.length,
    data_hash: `sha256:${sha256(Buffer.from(account.data))}`,
  };
}

async function sendInstructions(conn: Connection, payer: Keypair, instructions: { label: string; ix: any }[]) {
  const signatures: string[] = [];
  for (const chunk of chunks(instructions, 8)) {
    const tx = new Transaction();
    for (const item of chunk) tx.add(item.ix);
    signatures.push(await sendAndConfirmTransaction(conn, tx, [payer], {
      commitment: "confirmed",
      skipPreflight: false,
      maxRetries: 5,
    }));
  }
  return signatures;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function describeInstruction(label: string, ix: { programId: PublicKey; keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer }) {
  return {
    label,
    program_id: ix.programId.toBase58(),
    account_count: ix.keys.length,
    data_bytes: ix.data.length,
    accounts: ix.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      signer: key.isSigner,
      writable: key.isWritable,
    })),
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, sortJson(inner)]),
  );
}
