import { randomBytes } from "node:crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";

import { connection, readPayerKeypair } from "./core-script-utils.ts";
import {
  BACKPACK_BLUEPRINT_ITEM_CODE,
  BACKPACK_ITEM_CATEGORY_BLUEPRINT,
  BACKPACK_MAX_CAPACITY,
  createIssueBlueprintInstruction,
  decodeBackpack,
  decodeBlueprintItem,
  deriveBlueprintItemPda,
  NICECHUNK_BACKPACK_PROGRAM_ID,
  NICECHUNK_BLUEPRINT_ISSUER,
} from "../sdk/nicechunk-backpack.ts";
import {
  decodePlayerProfile,
  derivePlayerProfilePda,
  NICECHUNK_PLAYER_PROGRAM_ID,
} from "../sdk/nicechunk-player.ts";

const args = parseArgs(process.argv.slice(2));
const recipient = new PublicKey(requiredArg(args, "recipient"));
const payer = readPayerKeypair();
const conn = connection();

if (!payer.publicKey.equals(NICECHUNK_BLUEPRINT_ISSUER)) {
  throw new Error(
    `Configured payer ${payer.publicKey.toBase58()} is not the Blueprint issuer ${NICECHUNK_BLUEPRINT_ISSUER.toBase58()}.`,
  );
}

const [playerProfile] = derivePlayerProfilePda(recipient, NICECHUNK_PLAYER_PROGRAM_ID);
const playerInfo = await conn.getAccountInfo(playerProfile, "confirmed");
if (!playerInfo?.owner.equals(NICECHUNK_PLAYER_PROGRAM_ID)) {
  throw new Error(`Player profile is missing or invalid: ${playerProfile.toBase58()}.`);
}
const profile = decodePlayerProfile(Buffer.from(playerInfo.data));
if (!profile.owner.equals(recipient)) {
  throw new Error("Player profile owner does not match the requested recipient.");
}
if (profile.equippedBackpack.equals(PublicKey.default)) {
  throw new Error("The recipient has no equipped Backpack PDA.");
}

const backpackAddress = profile.equippedBackpack;
const backpackInfo = await conn.getAccountInfo(backpackAddress, "confirmed");
if (!backpackInfo?.owner.equals(NICECHUNK_BACKPACK_PROGRAM_ID)) {
  throw new Error(`Equipped Backpack PDA is missing or owned by another program: ${backpackAddress.toBase58()}.`);
}
const before = decodeBackpack(Buffer.from(backpackInfo.data));
if (!before.owner.equals(recipient)) {
  throw new Error("Equipped Backpack PDA owner does not match the requested recipient.");
}
const existing = before.slots.find((slot) => slot.category === BACKPACK_ITEM_CATEGORY_BLUEPRINT);
if (existing) {
  throw new Error(`Recipient already owns Blueprint #${existing.itemId.toString()} in the equipped backpack.`);
}
if (before.itemCount >= BACKPACK_MAX_CAPACITY) {
  throw new Error(`Backpack has reached the on-chain maximum capacity of ${BACKPACK_MAX_CAPACITY}.`);
}

const requestedId = args.get("blueprint-id");
const blueprintId = requestedId ? parseU64(requestedId) : await nextAvailableBlueprintId(conn);
const [blueprintItem] = deriveBlueprintItemPda({ itemId: blueprintId });

const latest = await conn.getLatestBlockhash("confirmed");
const transaction = new Transaction({
  feePayer: payer.publicKey,
  blockhash: latest.blockhash,
  lastValidBlockHeight: latest.lastValidBlockHeight,
}).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 180_000 }),
  createIssueBlueprintInstruction({
    issuer: payer.publicKey,
    recipient,
    backpack: backpackAddress,
    itemId: blueprintId,
  }),
);
transaction.sign(payer);

let signature = "";
try {
  signature = await conn.sendRawTransaction(transaction.serialize(), {
    maxRetries: 4,
    skipPreflight: false,
  });
  const confirmation = await conn.confirmTransaction({
    signature,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Blueprint transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
} catch (error) {
  if (error instanceof SendTransactionError) {
    const logs = await error.getLogs(conn).catch(() => null);
    if (logs?.length) console.error(logs.join("\n"));
  }
  throw error;
}

const verification = await readIssuedBlueprint({
  conn,
  recipient,
  backpackAddress,
  blueprintItem,
  blueprintId,
});

console.log(JSON.stringify({
  ok: true,
  cluster: conn.rpcEndpoint,
  signature,
  recipient: recipient.toBase58(),
  playerProfile: playerProfile.toBase58(),
  backpack: backpackAddress.toBase58(),
  blueprintId: blueprintId.toString(),
  blueprintItemPda: blueprintItem.toBase58(),
  before: { capacity: before.capacity, itemCount: before.itemCount },
  after: verification,
}, null, 2));

async function nextAvailableBlueprintId(conn: ReturnType<typeof connection>): Promise<bigint> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const entropy = BigInt(randomBytes(4).readUInt32LE(0) & 0xfffff);
    const candidate = (BigInt(Date.now()) << 20n) | entropy;
    const [address] = deriveBlueprintItemPda({ itemId: candidate });
    if (!await conn.getAccountInfo(address, "confirmed")) return candidate;
  }
  throw new Error("Unable to generate an unused Blueprint item ID.");
}

async function readIssuedBlueprint({
  conn,
  recipient,
  backpackAddress,
  blueprintItem,
  blueprintId,
}: {
  conn: ReturnType<typeof connection>;
  recipient: PublicKey;
  backpackAddress: PublicKey;
  blueprintItem: PublicKey;
  blueprintId: bigint;
}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [backpackInfo, itemInfo] = await conn.getMultipleAccountsInfo(
      [backpackAddress, blueprintItem],
      "confirmed",
    );
    if (backpackInfo?.owner.equals(NICECHUNK_BACKPACK_PROGRAM_ID)
      && itemInfo?.owner.equals(NICECHUNK_BACKPACK_PROGRAM_ID)) {
      const backpack = decodeBackpack(Buffer.from(backpackInfo.data));
      const item = decodeBlueprintItem(Buffer.from(itemInfo.data));
      const slotIndex = backpack.slots.findIndex((slot) => (
        slot.category === BACKPACK_ITEM_CATEGORY_BLUEPRINT
        && slot.itemCode === BACKPACK_BLUEPRINT_ITEM_CODE
        && slot.itemId === blueprintId
        && slot.itemPda.equals(blueprintItem)
      ));
      if (slotIndex >= 0 && item.itemId === blueprintId && item.owner.equals(recipient)) {
        return {
          capacity: backpack.capacity,
          itemCount: backpack.itemCount,
          slotIndex,
          blueprintPdaOwner: item.owner.toBase58(),
          verified: true,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("Transaction confirmed, but the Blueprint was not visible in the Backpack PDA during verification.");
}

function parseArgs(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    result.set(key, value);
    index += 1;
  }
  return result;
}

function requiredArg(args: Map<string, string>, key: string): string {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Usage: issue-blueprint --recipient <wallet> [--blueprint-id <u64>]. Missing --${key}.`);
  return value;
}

function parseU64(value: string): bigint {
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 0xffffffffffffffffn) {
    throw new Error("Blueprint ID must be an unsigned non-zero 64-bit integer.");
  }
  return parsed;
}
