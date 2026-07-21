import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDisableSmeltingRecipeInstruction,
  createInitializeRecipeTableInstruction,
  createUpsertSmeltingRecipeInstruction,
  deriveRecipeTablePda,
  NICECHUNK_SMELTING_PROGRAM_ID,
} from "../sdk/nicechunk-smelting.ts";
import {
  BACKPACK_ITEM_CATEGORY_MATERIAL,
  BACKPACK_SLOT_KIND_BLOCK,
  BACKPACK_SLOT_KIND_ITEM,
} from "../sdk/nicechunk-backpack.ts";
import { connection, readPayerKeypair } from "./core-script-utils.ts";
// @ts-ignore JavaScript smelting rules are consumed through their public ESM exports.
import * as smeltingRuleModule from "../src/data/smeltingRules.js";

const {
  deriveSmeltingMaterialProperties,
  recipeRequirements,
  smeltingMaterialById,
  smeltingMaterialInputKey,
  smeltingMaterialItemCode,
  smeltingMaterialUnitVolumeMm3,
  smeltingMergeRecipeIdForMaterialId,
  smeltingMergeRecipeTableIdForMaterialId,
  smeltingRecipePdaOutputVolumeMm3,
  smeltingRecipeIdForMaterialId,
  smeltingRecipeTableIdForMaterialId,
  smeltingRecipeYieldBps,
  smeltingRules,
} = smeltingRuleModule;

const BACKPACK_PACKED_Y_BITS = 9;
const MATERIAL_UNIT_VOLUME_MM3 = 1_000_000;
const DURABILITY_BPS_DENOMINATOR = 10_000;

interface RetiredSmeltingRecipeDescriptor {
  materialId: string;
  replacementMaterialId: string;
  kind: "primary" | "merge";
  recipeId: number;
  tableId: number;
  itemCode: number;
  minHeatTier: number;
  yieldBps: number;
  inputKeys?: readonly string[];
}

interface SmeltingMaterialRule {
  id: string;
  requiredHeatTier: number;
  unitVolumeMm3?: number;
}

export const BLOCK_IDS: Readonly<Record<string, number>> = Object.freeze({
  grass: 1,
  dirt: 2,
  stone: 3,
  deepStone: 4,
  sand: 5,
  gravel: 6,
  clay: 7,
  mud: 8,
  dryDirt: 9,
  saltFlat: 10,
  snow: 11,
  ice: 12,
  frozenSoil: 13,
  basalt: 14,
  ash: 15,
  bedrock: 16,
  water: 17,
  swampWater: 18,
  toxicWater: 19,
  lava: 20,
  quicksand: 21,
  trunk: 22,
  leaves: 23,
  pineTrunk: 24,
  pineLeaves: 25,
  deadWood: 26,
  giantRoot: 27,
  grassPlant: 28,
  dryGrass: 29,
  bush: 30,
  deadBush: 31,
  cactus: 32,
  reed: 33,
  swampGrass: 34,
  snowBush: 35,
  thorn: 36,
  moss: 37,
  lichen: 38,
  vine: 39,
  glowMycelium: 40,
  mushroom: 41,
  seaweed: 42,
  aquaticPlant: 43,
  coral: 44,
  deadCoral: 45,
  shellBed: 46,
  coal: 47,
  cotton: 48,
  flowerWhite: 49,
  flowerYellow: 50,
  flowerRed: 51,
  flowerBlue: 52,
  flowerPink: 53,
});

// Retired entries remain explicit migration records instead of active material
// rules. Upserting the full record with enabled=false preserves the occupied
// recipe slot and all historical item/table identities without a program
// upgrade or a destructive RecipeTable rewrite.
export const RETIRED_SMELTING_RECIPES: readonly RetiredSmeltingRecipeDescriptor[] = Object.freeze([
  Object.freeze({
    materialId: "plant_fiber",
    replacementMaterialId: "cotton_cloth",
    kind: "primary",
    recipeId: 1003,
    tableId: 220,
    itemCode: 1003,
    minHeatTier: 1,
    yieldBps: 6_500,
    inputKeys: Object.freeze(["reed", "reed", "vine"]),
  }),
  Object.freeze({
    materialId: "plant_fiber",
    replacementMaterialId: "cotton_cloth",
    kind: "merge",
    recipeId: 2003,
    tableId: 320,
    itemCode: 1003,
    minHeatTier: 1,
    yieldBps: 10_000,
  }),
]);

export function inputSlot(rawKey: string) {
  if (rawKey.startsWith("material:")) {
    const materialId = rawKey.slice("material:".length);
    const itemCode = smeltingMaterialItemCode(materialId);
    const material = smeltingMaterialById(materialId);
    if (!itemCode || !material) throw new Error(`No smelting material for input key: ${rawKey}`);
    return {
      kind: BACKPACK_SLOT_KIND_ITEM,
      category: BACKPACK_ITEM_CATEGORY_MATERIAL,
      flags: 0,
      quantity: 1,
      resource: { worldX: 0, worldY: 0, worldZ: 0 },
      itemCode,
      itemId: 0n,
      itemPda: PublicKey.default,
      volumeMm3: materialUnitVolumeMm3(material),
    };
  }
  const blockId = BLOCK_IDS[rawKey];
  if (!blockId) throw new Error(`No block id for smelting raw key: ${rawKey}`);
  return {
    kind: BACKPACK_SLOT_KIND_BLOCK,
    category: 0,
    flags: 0,
    quantity: 1,
    resource: { worldX: 0, worldY: blockId << BACKPACK_PACKED_Y_BITS, worldZ: 0 },
    itemCode: 0,
    itemId: 0n,
    itemPda: PublicKey.default,
    volumeMm3: 0,
  };
}

export function outputSlot(
  material: { id: string; unitVolumeMm3?: number },
  recipeTable: PublicKey,
  baseVolumeMm3 = materialUnitVolumeMm3(material),
) {
  const itemCode = smeltingMaterialItemCode(material.id);
  const itemId = smeltingRecipeIdForMaterialId(material.id);
  if (!itemCode || !itemId) throw new Error(`No stable smelting identity for output material: ${material.id}`);
  const metadata = smeltingOutputMetadata(material, baseVolumeMm3);
  return {
    kind: BACKPACK_SLOT_KIND_ITEM,
    category: BACKPACK_ITEM_CATEGORY_MATERIAL,
    flags: 0,
    quantity: 1,
    resource: { worldX: 0, worldY: 0, worldZ: 0 },
    itemCode,
    itemId: BigInt(itemId),
    itemPda: recipeTable,
    volumeMm3: metadata.volumeMm3,
    durabilityCurrent: metadata.durabilityMax,
    durabilityMax: metadata.durabilityMax,
    grade: metadata.grade,
    itemLevel: metadata.itemLevel,
    qualityBps: metadata.qualityBps,
    metadata: 0,
  };
}

export function retiredSmeltingRecipeDefinition(
  descriptor: RetiredSmeltingRecipeDescriptor,
  recipeTable: PublicKey,
) {
  const inputs = descriptor.kind === "primary"
    ? (descriptor.inputKeys ?? []).map((key) => inputSlot(key))
    : [retiredMaterialInputSlot(descriptor.itemCode)];
  if (!inputs.length) throw new Error(`Retired recipe ${descriptor.recipeId} requires preserved inputs`);
  return {
    materialId: descriptor.materialId,
    replacementMaterialId: descriptor.replacementMaterialId,
    kind: descriptor.kind,
    tableId: descriptor.tableId,
    recipeTable,
    recipe: {
      recipeId: BigInt(descriptor.recipeId),
      enabled: false,
      minHeatTier: descriptor.minHeatTier,
      yieldBps: descriptor.yieldBps,
      inputs,
      outputs: [retiredMaterialOutputSlot(descriptor.itemCode, recipeTable)],
    },
  };
}

function retiredMaterialInputSlot(itemCode: number) {
  return {
    kind: BACKPACK_SLOT_KIND_ITEM,
    category: BACKPACK_ITEM_CATEGORY_MATERIAL,
    flags: 0,
    quantity: 1,
    resource: { worldX: 0, worldY: 0, worldZ: 0 },
    itemCode,
    itemId: 0n,
    itemPda: PublicKey.default,
    volumeMm3: 0,
  };
}

function retiredMaterialOutputSlot(itemCode: number, recipeTable: PublicKey) {
  return {
    kind: BACKPACK_SLOT_KIND_ITEM,
    category: BACKPACK_ITEM_CATEGORY_MATERIAL,
    flags: 0,
    quantity: 1,
    resource: { worldX: 0, worldY: 0, worldZ: 0 },
    itemCode,
    itemId: BigInt(itemCode),
    itemPda: recipeTable,
    volumeMm3: MATERIAL_UNIT_VOLUME_MM3,
    durabilityCurrent: 4_488,
    durabilityMax: 4_488,
    grade: 7,
    itemLevel: 15,
    qualityBps: 8_570,
    metadata: 0,
  };
}

export function materialUnitVolumeMm3(material: { unitVolumeMm3?: number } = {}) {
  return smeltingMaterialUnitVolumeMm3(material);
}

export function primaryOutputVolumeMm3(material: SmeltingMaterialRule) {
  return smeltingRecipePdaOutputVolumeMm3(material);
}

export function smeltingOutputMetadata(material: { id: string }, baseVolumeMm3 = MATERIAL_UNIT_VOLUME_MM3) {
  const properties = deriveSmeltingMaterialProperties({ material });
  const attributes = properties.attributes ?? {};
  const qualityScore = clampInteger(properties.qualityScore, 1, 100);
  const grade = clampInteger(Math.floor(qualityScore / 10), 1, 10);
  const qualityBps = clampInteger(Math.round(4_500 + qualityScore * 55), 1, DURABILITY_BPS_DENOMINATOR);
  const volumeMm3 = clampInteger(baseVolumeMm3, 1, 0xffffffff);
  const durabilityMax = clampInteger(
    Math.round(
      (Number(attributes.durability) || 0) * 34
        + (Number(attributes.toughness) || 0) * 22
        + (Number(attributes.hardness) || 0) * 14
        + (Number(attributes.heatResistance) || 0) * 8
        + qualityScore * 8
        + grade * 120,
    ),
    1,
    0xffffffff,
  );
  const effectiveDurability = Math.floor(durabilityMax * qualityBps / DURABILITY_BPS_DENOMINATOR);
  return {
    volumeMm3,
    durabilityMax,
    grade,
    itemLevel: materialItemLevel(effectiveDurability, volumeMm3),
    qualityBps,
  };
}

function materialItemLevel(effectiveDurability: number, volumeMm3: number) {
  const durabilityLevel = Math.min(80, Math.floor(Math.sqrt(Math.floor(Math.max(0, effectiveDurability) / 25))));
  const volumeLevel = Math.min(20, Math.floor(Math.max(0, volumeMm3) / 500_000));
  return clampInteger(1 + durabilityLevel + volumeLevel, 1, 100);
}

function clampInteger(value: number, min: number, max: number) {
  const integer = Math.floor(Number(value));
  if (!Number.isFinite(integer)) return min;
  return Math.max(min, Math.min(max, integer));
}

async function sendTx(tx: Transaction, label: string) {
  const conn = connection();
  const payer = readPayerKeypair();
  tx.feePayer = payer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.sign(payer);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmTransactionOverHttp(conn, signature, lastValidBlockHeight);
  console.log(`${label}: ${signature}`);
  return signature;
}

async function confirmTransactionOverHttp(
  conn: ReturnType<typeof connection>,
  signature: string,
  lastValidBlockHeight: number,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    if (attempt % 10 === 9 && await conn.getBlockHeight("confirmed") > lastValidBlockHeight) {
      throw new Error(`Transaction ${signature} expired before confirmation.`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  throw new Error(`Transaction ${signature} was not confirmed before the polling timeout.`);
}

async function ensureRecipeTable(tableId: bigint) {
  const conn = connection();
  const payer = readPayerKeypair();
  const [recipeTable] = deriveRecipeTablePda({ tableId });
  const account = await conn.getAccountInfo(recipeTable, "confirmed");
  console.log(JSON.stringify({
    smeltingProgramId: NICECHUNK_SMELTING_PROGRAM_ID.toBase58(),
    recipeTable: recipeTable.toBase58(),
    tableId: tableId.toString(),
    authority: payer.publicKey.toBase58(),
    exists: Boolean(account?.data?.length),
  }, null, 2));

  if (!account?.data?.length) {
    await sendTx(
      new Transaction().add(createInitializeRecipeTableInstruction({ payer: payer.publicKey, tableId })),
      `initialize recipe table ${tableId}`,
    );
  }
  return recipeTable;
}

export async function syncSmeltingRecipes() {
  const payer = readPayerKeypair();
  const requestedIds = process.env.SMELTING_MATERIAL_IDS ?? "";
  const materials = selectedSmeltingMaterials(requestedIds);
  const retiredRecipes = selectedRetiredSmeltingRecipes(requestedIds);
  const tableCache = new Map<string, PublicKey>();
  async function recipeTableForId(tableIdNumber: number) {
    const tableId = BigInt(tableIdNumber);
    if (!tableCache.has(tableId.toString())) {
      tableCache.set(tableId.toString(), await ensureRecipeTable(tableId));
    }
    return tableCache.get(tableId.toString())!;
  }

  console.log(JSON.stringify({
    selectedMaterialIds: materials.map((material: { id: string }) => material.id),
    selectedMaterialCount: materials.length,
    selectedRetiredRecipeIds: retiredRecipes.map((entry) => entry.recipeId),
  }, null, 2));

  for (const material of materials) {
    const unitVolumeMm3 = materialUnitVolumeMm3(material);
    const outputVolumeMm3 = primaryOutputVolumeMm3(material);
    const recipeTable = await recipeTableForId(smeltingRecipeTableIdForMaterialId(material.id));
    const inputs = [];
    for (const requirement of recipeRequirements(material)) {
      for (let count = 0; count < requirement.amount; count += 1) {
        inputs.push(inputSlot(requirement.key));
      }
    }
    if (!inputs.length || inputs.length > 8) {
      throw new Error(`Recipe ${material.id} has unsupported input count ${inputs.length}`);
    }
    const recipeId = BigInt(smeltingRecipeIdForMaterialId(material.id));
    const tx = new Transaction().add(createUpsertSmeltingRecipeInstruction({
      authority: payer.publicKey,
      recipeTable,
      recipe: {
        recipeId,
        enabled: true,
        minHeatTier: material.requiredHeatTier,
        yieldBps: smeltingRecipeYieldBps(material),
        inputs,
        outputs: [outputSlot(material, recipeTable, outputVolumeMm3)],
      },
    }));
    await sendTx(tx, `upsert ${material.id} table ${smeltingRecipeTableIdForMaterialId(material.id)}`);

    const mergeRecipeTable = await recipeTableForId(smeltingMergeRecipeTableIdForMaterialId(material.id));
    const mergeRecipeId = BigInt(smeltingMergeRecipeIdForMaterialId(material.id));
    const mergeTx = new Transaction().add(createUpsertSmeltingRecipeInstruction({
      authority: payer.publicKey,
      recipeTable: mergeRecipeTable,
      recipe: {
        recipeId: mergeRecipeId,
        enabled: true,
        minHeatTier: 0,
        yieldBps: 10_000,
        inputs: [inputSlot(smeltingMaterialInputKey(material.id))],
        outputs: [outputSlot(material, mergeRecipeTable, unitVolumeMm3)],
      },
    }));
    await sendTx(mergeTx, `upsert ${material.id} merge table ${smeltingMergeRecipeTableIdForMaterialId(material.id)}`);
  }

  for (const descriptor of retiredRecipes) {
    const recipeTable = await recipeTableForId(descriptor.tableId);
    const definition = retiredSmeltingRecipeDefinition(descriptor, recipeTable);
    await sendTx(
      new Transaction().add(createDisableSmeltingRecipeInstruction({
        authority: payer.publicKey,
        recipeTable,
        recipe: definition.recipe,
      })),
      `disable retired recipe ${descriptor.recipeId}`,
    );
  }
}

export function selectedSmeltingMaterials(
  requestedIds = process.env.SMELTING_MATERIAL_IDS ?? "",
  materials = smeltingRules.materials,
) {
  const requested = parseRequestedMaterialIds(requestedIds);
  if (!requested.length) return materials;

  const knownIds = new Set([
    ...materials.map((material: SmeltingMaterialRule) => material.id),
    ...RETIRED_SMELTING_RECIPES.map((entry) => entry.materialId),
  ]);
  const unknownIds = [...new Set(requested)].filter((id) => !knownIds.has(id));
  if (unknownIds.length) {
    throw new Error(`Unknown smelting material ids: ${unknownIds.join(", ")}`);
  }
  const requestedSet = new Set(requested);
  return materials.filter((material: SmeltingMaterialRule) => requestedSet.has(material.id));
}

export function selectedRetiredSmeltingRecipes(
  requestedIds = process.env.SMELTING_MATERIAL_IDS ?? "",
) {
  const requested = parseRequestedMaterialIds(requestedIds);
  if (!requested.length) return RETIRED_SMELTING_RECIPES;
  const requestedSet = new Set(requested);
  return RETIRED_SMELTING_RECIPES.filter((entry) => (
    requestedSet.has(entry.materialId) || requestedSet.has(entry.replacementMaterialId)
  ));
}

function parseRequestedMaterialIds(requestedIds: string) {
  return String(requestedIds)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const directScriptPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === directScriptPath) {
  syncSmeltingRecipes().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
