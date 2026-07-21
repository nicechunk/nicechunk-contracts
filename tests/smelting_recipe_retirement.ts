import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "mocha";

import {
  BACKPACK_SLOT_RECORD_LEN,
  decodeBackpackSlotRecord,
} from "../sdk/nicechunk-backpack.ts";
import {
  createDisableSmeltingRecipeInstruction,
  deriveRecipeTablePda,
  encodeSmeltingRecipeArgs,
  NICECHUNK_SMELTING_PROGRAM_ID,
  RECIPE_MAX_INPUTS,
} from "../sdk/nicechunk-smelting.ts";
import {
  RETIRED_SMELTING_RECIPES,
  retiredSmeltingRecipeDefinition,
  selectedRetiredSmeltingRecipes,
  selectedSmeltingMaterials,
} from "../scripts/sync-smelting-recipes.ts";
// @ts-expect-error JavaScript smelting rules are tested through their public ESM exports.
import { smeltingRules } from "../src/data/smeltingRules.js";

const EXPECTED_TABLES = new Map([
  [220, "E8CtkK8VQHExofe83isN2KDQdUuSWjw7JhgpT9NVeCQG"],
  [320, "J275g7jRLpTkNHbxJT8Jfw1mbUFwTCprVJ9rFYnfjopr"],
]);

describe("retired smelting recipe sync", () => {
  it("preserves the legacy plant-fiber identities as disabled full records", () => {
    assert.deepEqual(
      RETIRED_SMELTING_RECIPES.map(({ recipeId, tableId, itemCode }) => ({ recipeId, tableId, itemCode })),
      [
        { recipeId: 1003, tableId: 220, itemCode: 1003 },
        { recipeId: 2003, tableId: 320, itemCode: 1003 },
      ],
    );

    for (const descriptor of RETIRED_SMELTING_RECIPES) {
      const [recipeTable] = deriveRecipeTablePda({ tableId: descriptor.tableId });
      assert.equal(recipeTable.toBase58(), EXPECTED_TABLES.get(descriptor.tableId));
      const definition = retiredSmeltingRecipeDefinition(descriptor, recipeTable);
      const encoded = encodeSmeltingRecipeArgs(definition.recipe);
      assert.equal(encoded.readBigUInt64LE(0), BigInt(descriptor.recipeId));
      assert.equal(encoded.readUInt8(8), 0);
      assert.ok(encoded.readUInt8(10) > 0);
      assert.equal(encoded.readUInt8(11), 1);

      const outputOffset = 16 + RECIPE_MAX_INPUTS * BACKPACK_SLOT_RECORD_LEN;
      const output = decodeBackpackSlotRecord(
        encoded.subarray(outputOffset, outputOffset + BACKPACK_SLOT_RECORD_LEN),
      );
      assert.equal(output.itemCode, 1003);
      assert.equal(output.itemId, 1003n);
      assert.equal(output.itemPda.toBase58(), recipeTable.toBase58());
      assert.equal(output.volumeMm3, 1_000_000);
    }
  });

  it("keeps the historical primary and merge inputs valid while disabled", () => {
    const primary = RETIRED_SMELTING_RECIPES.find((entry) => entry.recipeId === 1003);
    const merge = RETIRED_SMELTING_RECIPES.find((entry) => entry.recipeId === 2003);
    assert.ok(primary && merge);
    const primaryDefinition = retiredSmeltingRecipeDefinition(primary, PublicKey.default);
    const mergeDefinition = retiredSmeltingRecipeDefinition(merge, PublicKey.default);
    assert.deepEqual(
      primaryDefinition.recipe.inputs.map((slot) => slot.resource.worldY >> 9),
      [33, 33, 39],
    );
    assert.equal(mergeDefinition.recipe.inputs[0].itemCode, 1003);
  });

  it("forces the SDK upsert payload to disabled even if a caller passes enabled=true", () => {
    const descriptor = RETIRED_SMELTING_RECIPES[0];
    const [recipeTable] = deriveRecipeTablePda({ tableId: descriptor.tableId });
    const definition = retiredSmeltingRecipeDefinition(descriptor, recipeTable);
    const instruction = createDisableSmeltingRecipeInstruction({
      authority: PublicKey.default,
      recipeTable,
      recipe: { ...definition.recipe, enabled: true },
    });
    assert.equal(instruction.programId.toBase58(), NICECHUNK_SMELTING_PROGRAM_ID.toBase58());
    assert.equal(instruction.data.readUInt8(0), 3);
    assert.equal(instruction.data.readUInt8(1), 1);
    assert.equal(instruction.data.readBigUInt64LE(2), 1003n);
    assert.equal(instruction.data.readUInt8(10), 0);
  });

  it("couples targeted cotton migration with retirement but leaves unrelated syncs alone", () => {
    assert.deepEqual(selectedSmeltingMaterials("plant_fiber", smeltingRules.materials), []);
    assert.deepEqual(
      selectedRetiredSmeltingRecipes("plant_fiber").map((entry) => entry.recipeId),
      [1003, 2003],
    );
    assert.deepEqual(
      selectedSmeltingMaterials("cotton_cloth", smeltingRules.materials).map((entry: { id: string }) => entry.id),
      ["cotton_cloth"],
    );
    assert.deepEqual(
      selectedRetiredSmeltingRecipes("cotton_cloth").map((entry) => entry.recipeId),
      [1003, 2003],
    );
    assert.deepEqual(selectedRetiredSmeltingRecipes("white_dye"), []);
  });
});
