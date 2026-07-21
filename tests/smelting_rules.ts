import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "mocha";

// @ts-expect-error JavaScript smelting rules are tested through their public ESM exports.
import * as smeltingRuleModule from "../src/data/smeltingRules.js";
const {
  SMELTING_MATERIAL_ATTRIBUTE_KEYS,
  BUILDING_MATERIAL_DIMENSIONS_VU,
  buildingMaterialIdForSmeltingMaterialId,
  calculateSmeltingOutputVolumeMm3,
  recipeRequirements,
  smeltingMaterialAttributeProfiles,
  smeltingMaterialIdForBuildingMaterialId,
  smeltingMaterialIdForItemCode,
  smeltingMaterialIdForRecipeId,
  smeltingMaterialItemCode,
  smeltingMaterialPhysicalProfile,
  smeltingMergeRecipeIdForMaterialId,
  smeltingMergeRecipeTableIdForMaterialId,
  smeltingRecipeIdForMaterialId,
  smeltingRecipeInputVolumeMm3,
  smeltingRecipePdaOutputVolumeMm3,
  smeltingRecipeRequiresFuel,
  smeltingRecipeTableIdForRecipeId,
  smeltingRecipeTableIdForMaterialId,
  smeltingRules,
  validateSmeltingRules,
} = smeltingRuleModule;
// @ts-expect-error Chunk.js publishes JavaScript renderer catalogs.
import { SMELTING_MATERIAL_MODEL_IDS } from "../chunk.js/renderer/smelting-material-models.js";
// @ts-expect-error Chunk.js publishes JavaScript world catalogs.
import { BLOCK_ID } from "../chunk.js/world/block-registry.js";
// @ts-expect-error Resource atlas is a JavaScript data module.
import { blockAtlas } from "../src/data/blockAtlas.js";
import {
  BACKPACK_ITEM_CATEGORY_MATERIAL,
  BACKPACK_SLOT_KIND_BLOCK,
  BACKPACK_SLOT_KIND_ITEM,
  BACKPACK_SLOT_RECORD_LEN,
  decodeBackpackSlotRecord,
} from "../sdk/nicechunk-backpack.ts";
import {
  RECIPE_MAX_INPUTS,
  encodeSmeltingRecipeArgs,
} from "../sdk/nicechunk-smelting.ts";
import {
  BLOCK_IDS,
  inputSlot,
  materialUnitVolumeMm3,
  outputSlot,
  primaryOutputVolumeMm3,
} from "../scripts/sync-smelting-recipes.ts";

const legacyMaterialIds = [
  "charcoal",
  "biochar_compost",
  "resin_binder",
  "ceramic_brick",
  "lime_ceramic",
  "quicklime",
  "salt_flux",
  "ash_cement",
  "glass_ingot",
  "obsidian_glass",
  "silicon_wafer",
  "ice_crystal",
  "iron_bloom",
  "copper_bloom",
  "alumina_plate",
  "nickel_iron",
  "carbon_plate",
  "carbon_steel",
  "basalt_fiber",
  "basalt_composite",
  "geopolymer_block",
  "coral_lime",
  "toxic_glass",
];

const clothAndDyeMaterialIds = [
  "cotton_cloth",
  "white_dye",
  "yellow_dye",
  "red_dye",
  "blue_dye",
  "pink_dye",
];

const buildingMaterialIds = [
  "wooden_plank", "wooden_stick", "squared_timber",
  "clear_glass_panel", "ice_blue_glass_panel", "amber_glass_panel", "basalt_reinforced_glass",
  "fired_clay_brick", "adobe_brick", "stone_brick", "deep_stone_brick", "basalt_brick",
  "sandstone_block", "cobblestone", "polished_stone_slab", "lime_plaster", "clay_plaster",
  "rammed_earth", "shell_terrazzo", "white_ceramic_tile", "blue_ceramic_tile",
  "volcanic_ash_concrete", "salt_crystal_block",
  "roof_tile_terracotta", "roof_tile_ice_blue", "roof_tile_shell_white", "roof_tile_charcoal",
  "roof_tile_ash_gray", "roof_tile_mycelium",
];

const utilityMaterialIds = ["blasting_charge"];

const ncmBuildingMaterialIds = [
  55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
  96, 97, 98, 99, 100, 101,
];

const dyeRules = [
  ["white_dye", "flowerWhite", "#f4f6ee"],
  ["yellow_dye", "flowerYellow", "#eec436"],
  ["red_dye", "flowerRed", "#cc4f46"],
  ["blue_dye", "flowerBlue", "#5288da"],
  ["pink_dye", "flowerPink", "#e287b2"],
] as const;

describe("smelting material rules", () => {
  it("keeps the game, resource atlas, and Chunk.js preview catalogs complete", () => {
    const atlasKeys = new Set(blockAtlas.map((entry: { key: string }) => entry.key));
    const gameBlockKeys = Object.keys(BLOCK_ID).filter((key) => key !== "air");
    assert.deepEqual(gameBlockKeys.filter((key) => !atlasKeys.has(key)), []);
    assert.equal(atlasKeys.size, gameBlockKeys.length);

    const previewIds = new Set(SMELTING_MATERIAL_MODEL_IDS);
    assert.deepEqual(
      smeltingRules.materials.map((entry: { id: string }) => entry.id).filter((id: string) => !previewIds.has(id)),
      [],
    );
  });

  it("defines objective volume, density, mass, and thermal properties for every material", () => {
    for (const entry of smeltingRules.materials) {
      const physical = smeltingMaterialPhysicalProfile(entry);
      assert.ok(physical, `Missing physical profile for ${entry.id}`);
      assert.ok(physical.unitVolumeMm3 > 0, `Missing volume for ${entry.id}`);
      assert.ok(physical.densityKgM3 > 0, `Missing density for ${entry.id}`);
      assert.ok(physical.massKg > 0, `Missing mass for ${entry.id}`);
      assert.ok(physical.thermalConductivityWMK >= 0, `Missing thermal conductivity for ${entry.id}`);
      assert.ok(physical.waterAbsorptionPct >= 0, `Missing water absorption for ${entry.id}`);
    }
  });
  it("retires plant fiber without shifting any existing material identity", () => {
    assert.deepEqual(smeltingRules.materials.slice(0, legacyMaterialIds.length).map((entry: { id: string }) => entry.id), legacyMaterialIds);
    assert.deepEqual(
      smeltingRules.materials.slice(legacyMaterialIds.length).map((entry: { id: string }) => entry.id),
      [...clothAndDyeMaterialIds, ...buildingMaterialIds, ...utilityMaterialIds],
    );
    assert.equal(smeltingRules.materials.length, 59);
    assert.equal(smeltingRules.materials.some((entry: { id: string }) => entry.id === "plant_fiber"), false);
    assert.equal(smeltingMaterialAttributeProfiles.plant_fiber, undefined);
    assert.equal(smeltingMaterialItemCode("plant_fiber"), 0);
    assert.equal(smeltingRecipeIdForMaterialId("plant_fiber"), 0);
    assert.equal(smeltingMergeRecipeIdForMaterialId("plant_fiber"), 0);
    assert.equal(smeltingMaterialIdForItemCode(1003), null);
    assert.equal(smeltingMaterialIdForRecipeId(1003), null);
    assert.equal(smeltingMaterialIdForRecipeId(2003), null);
    assert.equal(smeltingRecipeTableIdForRecipeId(1003), 0);
    assert.equal(smeltingRecipeTableIdForRecipeId(2003), 0);

    for (let index = 0; index < smeltingRules.materials.length; index += 1) {
      const material = smeltingRules.materials[index];
      const materialId = material.id;
      const itemCode = 1001 + index + (index >= 2 ? 1 : 0);
      assert.equal(smeltingMaterialItemCode(materialId), itemCode);
      assert.equal(smeltingMaterialIdForItemCode(itemCode), materialId);
      assert.equal(smeltingMaterialIdForRecipeId(itemCode), materialId);
      assert.equal(smeltingMaterialIdForRecipeId(itemCode + 1000), materialId);
      assert.equal(material.itemCode, itemCode);
      assert.equal(material.recipeId, itemCode);
      assert.equal(material.mergeRecipeId, itemCode + 1000);
      assert.equal(material.recipeTableId, smeltingRecipeTableIdForMaterialId(materialId));
      assert.equal(material.mergeRecipeTableId, smeltingMergeRecipeTableIdForMaterialId(materialId));
      assert.equal(smeltingRecipeTableIdForRecipeId(itemCode), material.recipeTableId);
      assert.equal(smeltingRecipeTableIdForRecipeId(itemCode + 1000), material.mergeRecipeTableId);
    }
  });

  it("publishes the same rule data consumed by the forging page", () => {
    const publicRules = JSON.parse(readFileSync(
      new URL("../public/rules/smelting-rules.json", import.meta.url),
      "utf8",
    ));
    assert.deepEqual(publicRules, smeltingRules);
  });

  it("defines the cloth inputs, dye colors, volumes, and explicit attributes", () => {
    const cloth = material("cotton_cloth");
    assert.deepEqual(cloth.rawInputs, [
      { key: "cotton", amount: 4 },
      { key: "dryGrass", amount: 1 },
    ]);
    assert.deepEqual(cloth.materialInputs ?? [], []);
    assert.equal(cloth.class, "fiber");
    assert.equal(cloth.forgeUse, "fabric");
    assert.equal(cloth.renderMode, "cloth");
    assert.equal(cloth.unitVolumeMm3, 1_000_000);

    for (const [materialId, flowerKey, dyeColor] of dyeRules) {
      const dye = material(materialId);
      assert.equal(dye.class, "chemical");
      assert.equal(dye.forgeUse, "dye");
      assert.equal(dye.dyeColor, dyeColor);
      assert.equal(dye.unitVolumeMm3, 20_000);
      assert.deepEqual(dye.rawInputs, [
        { key: flowerKey, amount: 2 },
        { key: "water", amount: 1 },
      ]);
    }

    for (const materialId of clothAndDyeMaterialIds) {
      const profile = smeltingMaterialAttributeProfiles[materialId];
      assert.ok(profile, `${materialId} needs an explicit attribute profile`);
      assert.deepEqual(Object.keys(profile).sort(), [...SMELTING_MATERIAL_ATTRIBUTE_KEYS].sort());
      for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) {
        assert.ok(Number.isInteger(profile[key]) && profile[key] >= 0 && profile[key] <= 100);
      }
    }
  });

  it("rejects references to the retired plant-fiber material", () => {
    assert.equal(validateSmeltingRules(smeltingRules), true);
    const invalidRules = structuredClone(smeltingRules);
    const cloth = invalidRules.materials.find((entry: { id: string }) => entry.id === "cotton_cloth");
    cloth.materialInputs = [{ key: "material:plant_fiber", amount: 1 }];
    assert.throws(
      () => validateSmeltingRules(invalidRules),
      /Material cotton_cloth references unknown material plant_fiber/u,
    );
  });

  it("keeps the appended recipe tables within one ten-record table", () => {
    for (const materialId of clothAndDyeMaterialIds) {
      assert.equal(smeltingRecipeTableIdForMaterialId(materialId), 222);
      assert.equal(smeltingMergeRecipeTableIdForMaterialId(materialId), 322);
    }
    assert.deepEqual(clothAndDyeMaterialIds.map((id) => smeltingRecipeIdForMaterialId(id)), [1025, 1026, 1027, 1028, 1029, 1030]);
    assert.deepEqual(clothAndDyeMaterialIds.map((id) => smeltingMergeRecipeIdForMaterialId(id)), [2025, 2026, 2027, 2028, 2029, 2030]);
  });

  it("maps every build_ncm manufactured material to one stable recipe identity", () => {
    assert.equal(buildingMaterialIds.length, 29);
    assert.equal(ncmBuildingMaterialIds.length, buildingMaterialIds.length);
    buildingMaterialIds.forEach((materialId, index) => {
      const rule = material(materialId);
      const itemCode = 1031 + index;
      const ncmMaterialId = ncmBuildingMaterialIds[index];
      const expectedTableId = 223 + Math.floor(index / 10);
      assert.equal(rule.buildingMaterialId, ncmMaterialId);
      assert.equal(smeltingMaterialIdForBuildingMaterialId(ncmMaterialId), materialId);
      assert.equal(buildingMaterialIdForSmeltingMaterialId(materialId), ncmMaterialId);
      assert.equal(smeltingMaterialItemCode(materialId), itemCode);
      assert.equal(smeltingMaterialIdForItemCode(itemCode), materialId);
      assert.equal(smeltingRecipeIdForMaterialId(materialId), itemCode);
      assert.equal(smeltingMergeRecipeIdForMaterialId(materialId), itemCode + 1000);
      assert.equal(smeltingRecipeTableIdForMaterialId(materialId), expectedTableId);
      assert.equal(smeltingMergeRecipeTableIdForMaterialId(materialId), expectedTableId + 100);
      assert.equal(rule.forgeUse, "construction");
      assert.equal(rule.renderMode, "building_component");
      assert.ok(Number.isInteger(rule.unitVolumeMm3) && rule.unitVolumeMm3 > 0);
      assert.deepEqual(rule.unitDimensionsVu, BUILDING_MATERIAL_DIMENSIONS_VU[ncmMaterialId]);
      assert.equal(
        rule.unitVolumeMm3,
        Math.round(rule.unitDimensionsVu.reduce((volume: number, dimension: number) => volume * dimension, 1_000_000)),
      );
      assert.ok(Number.isFinite(rule.densityKgM3) && rule.densityKgM3 > 0);
      assert.ok(Number.isFinite(rule.processSeconds) && rule.processSeconds > 0);
      assert.ok(Number.isInteger(rule.yieldBps) && rule.yieldBps > 0 && rule.yieldBps <= 10_000);
      assert.ok(recipeRequirements(rule).length > 0);
      assert.ok(
        recipeRequirements(rule).reduce((sum: number, input: { amount: number }) => sum + input.amount, 0) <= RECIPE_MAX_INPUTS,
        `${materialId} exceeds the on-chain recipe input limit`,
      );
      const profile = smeltingMaterialAttributeProfiles[materialId];
      assert.ok(profile, `${materialId} needs an explicit engineering attribute profile`);
      assert.deepEqual(Object.keys(profile).sort(), [...SMELTING_MATERIAL_ATTRIBUTE_KEYS].sort());
    });
    assert.equal(smeltingMaterialIdForBuildingMaterialId(78), null);
    assert.equal(buildingMaterialIdForSmeltingMaterialId("cotton_cloth"), 0);
  });

  it("encodes every build_ncm recipe input and output exactly as the PDA validator expects", () => {
    for (const materialId of buildingMaterialIds) {
      const rule = material(materialId);
      const encoded = encodeMaterialRule(materialId).data;
      const expectedKeys = recipeRequirements(rule).flatMap((requirement: { key: string; amount: number }) => (
        Array.from({ length: requirement.amount }, () => requirement.key)
      ));
      const inputs = decodeInputs(encoded, expectedKeys.length);

      assert.equal(encoded.readBigUInt64LE(0), BigInt(smeltingRecipeIdForMaterialId(materialId)), materialId);
      assert.equal(encoded.readUInt8(9), rule.requiredHeatTier, materialId);
      assert.equal(encoded.readUInt8(10), expectedKeys.length, materialId);
      assert.equal(encoded.readUInt16LE(12), rule.yieldBps, materialId);
      expectedKeys.forEach((key: string, index: number) => {
        const input = inputs[index];
        if (key.startsWith("material:")) {
          const inputMaterialId = key.slice("material:".length);
          assert.equal(input.kind, BACKPACK_SLOT_KIND_ITEM, `${materialId}:${key}`);
          assert.equal(input.category, BACKPACK_ITEM_CATEGORY_MATERIAL, `${materialId}:${key}`);
          assert.equal(input.itemCode, smeltingMaterialItemCode(inputMaterialId), `${materialId}:${key}`);
          assert.equal(input.itemId, 0n, `${materialId}:${key}`);
        } else {
          assert.equal(input.kind, BACKPACK_SLOT_KIND_BLOCK, `${materialId}:${key}`);
          assert.equal(input.resource.worldY >> 9, BLOCK_IDS[key], `${materialId}:${key}`);
        }
      });

      const output = decodeOutput(encoded);
      assert.equal(output.kind, BACKPACK_SLOT_KIND_ITEM, materialId);
      assert.equal(output.category, BACKPACK_ITEM_CATEGORY_MATERIAL, materialId);
      assert.equal(output.itemCode, smeltingMaterialItemCode(materialId), materialId);
      assert.equal(output.itemId, BigInt(smeltingRecipeIdForMaterialId(materialId)), materialId);
      assert.equal(output.volumeMm3, primaryOutputVolumeMm3(rule), materialId);
    }
  });

  it("uses zero-heat PDA recipes only for ambient manufacturing", () => {
    const ambient = buildingMaterialIds.map(material).filter((rule) => rule.requiredHeatTier === 0);
    const heated = buildingMaterialIds.map(material).filter((rule) => rule.requiredHeatTier > 0);
    assert.ok(ambient.length > 0);
    assert.ok(heated.length > 0);
    assert.ok(ambient.every((rule) => smeltingRecipeRequiresFuel(rule) === false));
    assert.ok(heated.every((rule) => smeltingRecipeRequiresFuel(rule) === true));
    assert.ok(ambient.every((rule) => ["carpentry", "lamination", "drying", "masonry", "pressing", "polishing", "mixing", "compaction", "crystallization"].includes(rule.processType)));
    assert.ok(heated.every((rule) => ["glassmaking", "kiln", "glaze_firing"].includes(rule.processType)));
  });

  it("appends one cold-processed blasting charge without shifting existing identities", () => {
    const charge = material("blasting_charge");
    assert.deepEqual(charge.rawInputs, [
      { key: "ash", amount: 1 },
      { key: "toxicWater", amount: 1 },
    ]);
    assert.deepEqual(charge.materialInputs, [
      { key: "material:charcoal", amount: 2 },
      { key: "material:biochar_compost", amount: 2 },
      { key: "material:resin_binder", amount: 1 },
    ]);
    assert.equal(recipeRequirements(charge).reduce((sum: number, input: { amount: number }) => sum + input.amount, 0), 7);
    assert.equal(charge.requiredHeatTier, 0);
    assert.equal(charge.processType, "cold_compaction");
    assert.equal(charge.station, "explosives_bench");
    assert.equal(charge.forgeUse, "explosive");
    assert.equal(charge.renderMode, "blasting_charge");
    assert.equal(charge.unitVolumeMm3, 750_000);
    assert.equal(charge.yieldBps, 9_000);
    assert.equal(smeltingRecipeRequiresFuel(charge), false);
    assert.equal(smeltingMaterialItemCode(charge.id), 1060);
    assert.equal(smeltingRecipeIdForMaterialId(charge.id), 1060);
    assert.equal(smeltingMergeRecipeIdForMaterialId(charge.id), 2060);
    assert.equal(smeltingRecipeTableIdForMaterialId(charge.id), 225);
    assert.equal(smeltingMergeRecipeTableIdForMaterialId(charge.id), 325);

    const encoded = encodeMaterialRule(charge.id).data;
    const inputs = decodeInputs(encoded, 7);
    assert.deepEqual(inputs.slice(0, 2).map((slot) => slot.resource.worldY >>> 9), [BLOCK_IDS.ash, BLOCK_IDS.toxicWater]);
    assert.ok(inputs.slice(0, 2).every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
    assert.deepEqual(inputs.slice(2).map((slot) => slot.itemCode), [1001, 1001, 1002, 1002, 1004]);
    assert.ok(inputs.slice(2).every((slot) => slot.kind === BACKPACK_SLOT_KIND_ITEM));
    assert.equal(decodeOutput(encoded).itemCode, 1060);
    assert.equal(decodeOutput(encoded).volumeMm3, 750_000);
  });
});

describe("cloth and dye recipe codec", () => {
  it("encodes four cotton blocks plus one dry-grass block", () => {
    assert.deepEqual(
      pickBlockIds(["cotton", "flowerWhite", "flowerYellow", "flowerRed", "flowerBlue", "flowerPink"]),
      [48, 49, 50, 51, 52, 53],
    );
    const encoded = encodeMaterialRule("cotton_cloth");
    assert.equal(encoded.data.readUInt8(10), 5);
    assert.equal(encoded.data.readUInt8(11), 1);
    assert.equal(encoded.data.readBigUInt64LE(0), 1025n);

    const inputs = decodeInputs(encoded.data, 5);
    assert.ok(inputs.every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
    assert.deepEqual(inputs.map((slot) => slot.resource.worldY >>> 9), [48, 48, 48, 48, 29]);

    const output = decodeOutput(encoded.data);
    assert.equal(output.itemCode, 1025);
    assert.equal(output.volumeMm3, 1_000_000);
  });

  it("encodes each flower dye with water and a 20 cm3 output", () => {
    for (const [materialId, flowerKey] of dyeRules) {
      const encoded = encodeMaterialRule(materialId);
      assert.equal(encoded.data.readUInt8(10), 3);
      const inputs = decodeInputs(encoded.data, 3);
      assert.deepEqual(inputs.map((slot) => slot.resource.worldY >>> 9), [BLOCK_IDS[flowerKey], BLOCK_IDS[flowerKey], 17]);
      assert.ok(inputs.every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
      const output = decodeOutput(encoded.data);
      assert.equal(output.itemCode, smeltingMaterialItemCode(materialId));
      assert.equal(output.volumeMm3, 20_000);
    }
  });

  it("preserves unit volume in merge recipe outputs", () => {
    for (const materialId of clothAndDyeMaterialIds) {
      const rule = material(materialId);
      const input = inputSlot(`material:${materialId}`);
      const output = outputSlot(rule, PublicKey.default);
      const data = encodeSmeltingRecipeArgs({
        recipeId: smeltingMergeRecipeIdForMaterialId(materialId),
        enabled: true,
        minHeatTier: rule.requiredHeatTier,
        yieldBps: 10_000,
        inputs: [input],
        outputs: [output],
      });
      assert.equal(decodeOutput(data).volumeMm3, materialUnitVolumeMm3(rule));
    }
    assert.equal(materialUnitVolumeMm3(material("iron_bloom")), 250_000);
    assert.equal(inputSlot("material:white_dye").volumeMm3, 20_000);
    assert.throws(() => inputSlot("material:missing_material"), /No smelting material for input key/u);
  });

  it("encodes PDA output volume per recipe instead of one shared output size", () => {
    assert.equal(primaryOutputVolumeMm3(material("cotton_cloth")), 1_000_000);
    assert.equal(primaryOutputVolumeMm3(material("white_dye")), 20_000);

    const charcoal = material("charcoal");
    assert.equal(primaryOutputVolumeMm3(material("charcoal")), 750_000);
  });

  it("uses the PDA output volume, actual input ratio, recipe yield, and skill loss", () => {
    const cloth = material("cotton_cloth");
    const dye = material("white_dye");
    assert.equal(smeltingRecipeInputVolumeMm3(cloth), 5_000_000);
    assert.equal(smeltingRecipePdaOutputVolumeMm3(cloth), 1_000_000);
    assert.equal(smeltingRecipeInputVolumeMm3(dye), 3_000_000);
    assert.equal(smeltingRecipePdaOutputVolumeMm3(dye), 20_000);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: cloth,
      inputVolumeMm3: 5_000_000,
      skillOutputBps: 7_000,
    }), 455_000);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: dye,
      inputVolumeMm3: 3_000_000,
      skillOutputBps: 7_000,
    }), 8_400);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: dye,
      inputVolumeMm3: 1_500_000,
      skillOutputBps: 10_000,
    }), 6_000);
  });
});

function material(materialId: string): any {
  const rule = smeltingRules.materials.find((entry: { id: string }) => entry.id === materialId);
  assert.ok(rule, `Missing material rule ${materialId}`);
  return rule;
}

function pickBlockIds(keys: string[]): number[] {
  return keys.map((key) => BLOCK_IDS[key]);
}

function encodeMaterialRule(materialId: string) {
  const rule = material(materialId);
  const inputs = recipeRequirements(rule).flatMap((requirement: { key: string; amount: number }) => (
    Array.from({ length: requirement.amount }, () => inputSlot(requirement.key))
  ));
  const output = outputSlot(rule, PublicKey.default, primaryOutputVolumeMm3(rule));
  return {
    data: encodeSmeltingRecipeArgs({
      recipeId: smeltingRecipeIdForMaterialId(materialId),
      enabled: true,
      minHeatTier: rule.requiredHeatTier,
      yieldBps: rule.yieldBps,
      inputs,
      outputs: [output],
    }),
  };
}

function decodeInputs(data: Buffer, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const offset = 16 + index * BACKPACK_SLOT_RECORD_LEN;
    return decodeBackpackSlotRecord(data.subarray(offset, offset + BACKPACK_SLOT_RECORD_LEN));
  });
}

function decodeOutput(data: Buffer) {
  const offset = 16 + RECIPE_MAX_INPUTS * BACKPACK_SLOT_RECORD_LEN;
  return decodeBackpackSlotRecord(data.subarray(offset, offset + BACKPACK_SLOT_RECORD_LEN));
}
