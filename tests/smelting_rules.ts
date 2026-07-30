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
  createSmeltingMergeRecipe,
  recipeRequirements,
  smeltingMaterialAttributeProfiles,
  smeltingMaterialIdForBuildingMaterialId,
  smeltingMaterialIdForItemCode,
  smeltingMaterialIdForRecipeId,
  smeltingMaterialItemCode,
  smeltingMaterialPhysicalProfile,
  smeltingFuelForMaterialId,
  smeltingFuelForRawKey,
  smeltingMergeRecipeIdForMaterialId,
  smeltingMergeRecipeTableIdForMaterialId,
  smeltingRecipeIdForMaterialId,
  smeltingRecipeInputVolumeMm3,
  smeltingRecipePdaOutputVolumeMm3,
  smeltingRecipeRequiresFuel,
  smeltingRecipeTableIdForRecipeId,
  smeltingRecipeTableIdForMaterialId,
  smeltingRecipeYieldBps,
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
  NICECHUNK_SMELTING_RECIPE_AUTHORITY,
  RECIPE_MAX_INPUTS,
  encodeSmeltingRecipeArgs,
} from "../sdk/nicechunk-smelting.ts";
import {
  BLOCK_IDS,
  inputSlot,
  materialUnitVolumeMm3,
  outputSlot,
  primaryOutputVolumeMm3,
  resolveSmeltingSyncAuthority,
  selectedSmeltingMaterials,
} from "../scripts/sync-smelting-recipes.ts";

const coreMaterialIds = [
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

const expectedYieldBpsByMaterialId: Readonly<Record<string, number>> = Object.freeze({
  charcoal: 550,
  biochar_compost: 550,
  resin_binder: 600,
  ceramic_brick: 720,
  lime_ceramic: 720,
  quicklime: 720,
  salt_flux: 600,
  ash_cement: 580,
  glass_ingot: 800,
  obsidian_glass: 800,
  silicon_wafer: 600,
  ice_crystal: 600,
  iron_bloom: 620,
  copper_bloom: 620,
  alumina_plate: 720,
  nickel_iron: 600,
  carbon_plate: 550,
  carbon_steel: 600,
  basalt_fiber: 650,
  basalt_composite: 580,
  geopolymer_block: 580,
  coral_lime: 720,
  toxic_glass: 800,
  cotton_cloth: 650,
  white_dye: 600,
  yellow_dye: 600,
  red_dye: 600,
  blue_dye: 600,
  pink_dye: 600,
  wooden_plank: 950,
  wooden_stick: 980,
  squared_timber: 880,
  clear_glass_panel: 920,
  ice_blue_glass_panel: 940,
  amber_glass_panel: 930,
  basalt_reinforced_glass: 900,
  fired_clay_brick: 900,
  adobe_brick: 860,
  stone_brick: 960,
  deep_stone_brick: 940,
  basalt_brick: 920,
  sandstone_block: 900,
  cobblestone: 980,
  polished_stone_slab: 940,
  lime_plaster: 900,
  clay_plaster: 920,
  rammed_earth: 960,
  shell_terrazzo: 900,
  white_ceramic_tile: 940,
  blue_ceramic_tile: 920,
  volcanic_ash_concrete: 930,
  salt_crystal_block: 850,
  roof_tile_terracotta: 780,
  roof_tile_ice_blue: 940,
  roof_tile_shell_white: 930,
  roof_tile_charcoal: 920,
  roof_tile_ash_gray: 930,
  roof_tile_mycelium: 880,
  blasting_charge: 900,
});

const expectedMergeYieldBps = 10_000;

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
  it("defines the final material identities without plant fiber", () => {
    assert.deepEqual(smeltingRules.materials.slice(0, coreMaterialIds.length).map((entry: { id: string }) => entry.id), coreMaterialIds);
    assert.deepEqual(
      smeltingRules.materials.slice(coreMaterialIds.length).map((entry: { id: string }) => entry.id),
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

  it("verifies recipes without loading a payer key or accepting removed material ids", () => {
    let payerReads = 0;
    const authority = resolveSmeltingSyncAuthority(true, () => {
      payerReads += 1;
      throw new Error("payer key must not be read");
    });
    assert.equal(authority.toBase58(), NICECHUNK_SMELTING_RECIPE_AUTHORITY.toBase58());
    assert.equal(payerReads, 0);

    assert.throws(
      () => resolveSmeltingSyncAuthority(false, () => {
        payerReads += 1;
        throw new Error("payer key required");
      }),
      /payer key required/u,
    );
    assert.equal(payerReads, 1);
    assert.throws(
      () => selectedSmeltingMaterials("plant_fiber", smeltingRules.materials),
      /Unknown smelting material ids: plant_fiber/u,
    );
  });

  it("publishes the same rule data consumed by the forging page", () => {
    const publicRules = JSON.parse(readFileSync(
      new URL("../public/rules/smelting-rules.json", import.meta.url),
      "utf8",
    ));
    assert.deepEqual(publicRules, smeltingRules);
  });

  it("keeps every browser fuel consumable and aligned with the chain heat tiers", () => {
    assert.equal(smeltingFuelForRawKey("dryGrass")?.heatTier, 1);
    assert.equal(smeltingFuelForRawKey("trunk")?.heatTier, 2);
    assert.equal(smeltingFuelForMaterialId("charcoal")?.heatTier, 3);
    assert.equal(smeltingFuelForRawKey("coal")?.heatTier, 4);
    assert.equal(smeltingFuelForRawKey("basalt"), null);
    assert.equal(smeltingFuelForRawKey("lava"), null);
    assert.ok(smeltingRules.fuels.every((fuel: { consumable?: boolean }) => fuel.consumable === true));
  });

  it("rejects reusable entries because the contract consumes one fuel unit", () => {
    const invalidRules = structuredClone(smeltingRules);
    invalidRules.fuels[0].consumable = false;
    assert.throws(
      () => validateSmeltingRules(invalidRules),
      /Fuel dry_grass must be consumable/u,
    );
  });

  it("keeps primary process yields and lossless material merges explicit", () => {
    assert.deepEqual(
      Object.keys(expectedYieldBpsByMaterialId),
      smeltingRules.materials.map((entry: { id: string }) => entry.id),
    );

    for (const material of smeltingRules.materials) {
      const expectedYieldBps = expectedYieldBpsByMaterialId[material.id];
      assert.equal(material.yieldBps, expectedYieldBps, `${material.id} primary material yield`);
      assert.equal(smeltingRecipeYieldBps(material), expectedYieldBps, `${material.id} primary recipe yield`);
      assert.equal(material.mergeYieldBps, expectedMergeYieldBps, `${material.id} merge material yield`);

      const mergeRecipe = createSmeltingMergeRecipe(material);
      assert.ok(mergeRecipe, `${material.id} merge recipe`);
      assert.equal(mergeRecipe.yieldBps, expectedMergeYieldBps, `${material.id} merge recipe yield`);
      assert.equal(smeltingRecipeYieldBps(mergeRecipe), expectedMergeYieldBps, `${material.id} normalized merge yield`);
    }
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

  it("rejects references to the removed plant-fiber material", () => {
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
        recipeRequirements(rule).length <= RECIPE_MAX_INPUTS,
        `${materialId} exceeds the on-chain recipe input limit`,
      );
      const profile = smeltingMaterialAttributeProfiles[materialId];
      assert.ok(profile, `${materialId} needs an explicit engineering attribute profile`);
      assert.deepEqual(Object.keys(profile).sort(), [...SMELTING_MATERIAL_ATTRIBUTE_KEYS].sort());
    });
    assert.equal(smeltingMaterialIdForBuildingMaterialId(78), null);
    assert.equal(buildingMaterialIdForSmeltingMaterialId("cotton_cloth"), 0);
  });

  it("encodes one quantity-aware template per requirement and the exact primary output quantity", () => {
    for (const rule of smeltingRules.materials) {
      const materialId = rule.id;
      const encoded = encodeMaterialRule(materialId).data;
      const requirements = recipeRequirements(rule);
      const inputs = decodeInputs(encoded, requirements.length);

      assert.equal(encoded.readBigUInt64LE(0), BigInt(smeltingRecipeIdForMaterialId(materialId)), materialId);
      assert.equal(encoded.readUInt8(9), rule.requiredHeatTier, materialId);
      assert.equal(encoded.readUInt8(10), requirements.length, materialId);
      assert.equal(encoded.readUInt16LE(12), rule.yieldBps, materialId);
      requirements.forEach((requirement: { key: string; amount: number }, index: number) => {
        const key = requirement.key;
        const input = inputs[index];
        assert.equal(input.quantity, requirement.amount, `${materialId}:${key}:quantity`);
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
      assert.equal(output.quantity, rule.yieldCount, `${materialId}:yieldCount`);
    }
  });

  it("encodes all merge recipes with one input and one output unit", () => {
    assert.equal(smeltingRules.materials.length, 59);
    for (const rule of smeltingRules.materials) {
      const materialId = rule.id;
      const encoded = encodeSmeltingRecipeArgs({
        recipeId: smeltingMergeRecipeIdForMaterialId(materialId),
        enabled: true,
        minHeatTier: 0,
        yieldBps: rule.mergeYieldBps,
        inputs: [inputSlot(`material:${materialId}`)],
        outputs: [outputSlot(rule, PublicKey.default, materialUnitVolumeMm3(rule), 1)],
      });
      const input = decodeInputs(encoded, 1)[0];
      const output = decodeOutput(encoded);

      assert.equal(input.quantity, 1, `${materialId}:merge input quantity`);
      assert.equal(input.itemCode, smeltingMaterialItemCode(materialId), materialId);
      assert.equal(output.quantity, 1, `${materialId}:merge output quantity`);
      assert.equal(output.itemCode, smeltingMaterialItemCode(materialId), materialId);
      assert.equal(output.volumeMm3, materialUnitVolumeMm3(rule), materialId);
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
    assert.equal(charge.yieldBps, 900);
    assert.equal(smeltingRecipeRequiresFuel(charge), false);
    assert.equal(smeltingMaterialItemCode(charge.id), 1060);
    assert.equal(smeltingRecipeIdForMaterialId(charge.id), 1060);
    assert.equal(smeltingMergeRecipeIdForMaterialId(charge.id), 2060);
    assert.equal(smeltingRecipeTableIdForMaterialId(charge.id), 225);
    assert.equal(smeltingMergeRecipeTableIdForMaterialId(charge.id), 325);

    const encoded = encodeMaterialRule(charge.id).data;
    assert.equal(encoded.readUInt8(10), 5);
    const inputs = decodeInputs(encoded, 5);
    assert.deepEqual(inputs.slice(0, 2).map((slot) => slot.resource.worldY >>> 9), [BLOCK_IDS.ash, BLOCK_IDS.toxicWater]);
    assert.ok(inputs.slice(0, 2).every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
    assert.deepEqual(inputs.slice(2).map((slot) => slot.itemCode), [1001, 1002, 1004]);
    assert.deepEqual(inputs.slice(2).map((slot) => slot.quantity), [2, 2, 1]);
    assert.ok(inputs.slice(2).every((slot) => slot.kind === BACKPACK_SLOT_KIND_ITEM));
    assert.equal(decodeOutput(encoded).itemCode, 1060);
    assert.equal(decodeOutput(encoded).quantity, 1);
    assert.equal(decodeOutput(encoded).volumeMm3, 5_750_000);
  });
});

describe("cloth and dye recipe codec", () => {
  it("encodes cotton and dry grass as two quantity-aware templates", () => {
    assert.deepEqual(
      pickBlockIds(["cotton", "flowerWhite", "flowerYellow", "flowerRed", "flowerBlue", "flowerPink"]),
      [48, 49, 50, 51, 52, 53],
    );
    const encoded = encodeMaterialRule("cotton_cloth");
    assert.equal(encoded.data.readUInt8(10), 2);
    assert.equal(encoded.data.readUInt8(11), 1);
    assert.equal(encoded.data.readBigUInt64LE(0), 1025n);

    const inputs = decodeInputs(encoded.data, 2);
    assert.ok(inputs.every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
    assert.deepEqual(inputs.map((slot) => slot.resource.worldY >>> 9), [48, 29]);
    assert.deepEqual(inputs.map((slot) => slot.quantity), [4, 1]);

    const output = decodeOutput(encoded.data);
    assert.equal(output.itemCode, 1025);
    assert.equal(output.volumeMm3, 5_000_000);
  });

  it("encodes each flower dye recipe with its complete input-volume basis", () => {
    for (const [materialId, flowerKey] of dyeRules) {
      const encoded = encodeMaterialRule(materialId);
      assert.equal(encoded.data.readUInt8(10), 2);
      const inputs = decodeInputs(encoded.data, 2);
      assert.deepEqual(inputs.map((slot) => slot.resource.worldY >>> 9), [BLOCK_IDS[flowerKey], 17]);
      assert.deepEqual(inputs.map((slot) => slot.quantity), [2, 1]);
      assert.ok(inputs.every((slot) => slot.kind === BACKPACK_SLOT_KIND_BLOCK));
      const output = decodeOutput(encoded.data);
      assert.equal(output.itemCode, smeltingMaterialItemCode(materialId));
      assert.equal(output.volumeMm3, 3_000_000);
    }
  });

  it("preserves unit volume and quantity in lossless merge recipe outputs", () => {
    for (const materialId of clothAndDyeMaterialIds) {
      const rule = material(materialId);
      const input = inputSlot(`material:${materialId}`);
      const output = outputSlot(rule, PublicKey.default, materialUnitVolumeMm3(rule), 1);
      const data = encodeSmeltingRecipeArgs({
        recipeId: smeltingMergeRecipeIdForMaterialId(materialId),
        enabled: true,
        minHeatTier: rule.requiredHeatTier,
        yieldBps: rule.mergeYieldBps,
        inputs: [input],
        outputs: [output],
      });
      assert.equal(data.readUInt16LE(12), expectedMergeYieldBps);
      assert.equal(decodeOutput(data).volumeMm3, materialUnitVolumeMm3(rule));
      assert.equal(decodeOutput(data).quantity, 1);
    }
    assert.equal(materialUnitVolumeMm3(material("iron_bloom")), 250_000);
    assert.equal(inputSlot("material:white_dye").volumeMm3, 20_000);
    assert.throws(() => inputSlot("material:missing_material"), /No smelting material for input key/u);
  });

  it("encodes primary PDA output from complete recipe input volume", () => {
    assert.equal(primaryOutputVolumeMm3(material("cotton_cloth")), 5_000_000);
    assert.equal(primaryOutputVolumeMm3(material("white_dye")), 3_000_000);
    assert.equal(primaryOutputVolumeMm3(material("charcoal")), 5_000_000);
    assert.equal(primaryOutputVolumeMm3(material("deep_stone_brick")), 4_000_000);
  });

  it("uses the PDA output volume, actual input ratio, recipe yield, and skill bonus", () => {
    const cloth = material("cotton_cloth");
    const dye = material("white_dye");
    assert.equal(smeltingRecipeInputVolumeMm3(cloth), 5_000_000);
    assert.equal(smeltingRecipePdaOutputVolumeMm3(cloth), 5_000_000);
    assert.equal(smeltingRecipeInputVolumeMm3(dye), 3_000_000);
    assert.equal(smeltingRecipePdaOutputVolumeMm3(dye), 3_000_000);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: cloth,
      inputVolumeMm3: 5_000_000,
      skillOutputBps: 12_000,
    }), 390_000);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: dye,
      inputVolumeMm3: 3_000_000,
      skillOutputBps: 12_000,
    }), 216_000);
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: dye,
      inputVolumeMm3: 1_500_000,
      skillOutputBps: 15_000,
    }), 135_000);
  });

  it("produces 18.6 cm3 of copper bloom from 300 cm3 of inputs at level zero", () => {
    const copper = material("copper_bloom");
    assert.equal(calculateSmeltingOutputVolumeMm3({
      recipe: copper,
      inputVolumeMm3: 300_000,
      skillOutputBps: 10_000,
    }), 18_600);
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
  const inputs = recipeRequirements(rule).map((requirement: { key: string; amount: number }) => (
    inputSlot(requirement.key, requirement.amount)
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
