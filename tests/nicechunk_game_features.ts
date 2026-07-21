import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("nicechunk unified game cluster features", () => {
  const cargo = readFileSync("programs/nicechunk_game/Cargo.toml", "utf8");
  const source = readFileSync("programs/nicechunk_game/src/lib.rs", "utf8");
  const dependencyNames = [
    "nicechunk_backpack",
    "nicechunk_chunk",
    "nicechunk_market",
    "nicechunk_smelting",
  ];

  it("forwards exactly the selected cluster to every routed child program", () => {
    const featureTable = cargo.match(/\[features\]([\s\S]*?)\n\[dependencies\]/)?.[1] ?? "";
    for (const cluster of ["devnet", "testnet", "mainnet"]) {
      const featureBody = featureTable.match(new RegExp(`${cluster}\\s*=\\s*\\[([\\s\\S]*?)\\]`))?.[1] ?? "";
      for (const dependency of dependencyNames) {
        assert.match(featureBody, new RegExp(`"${dependency}/${cluster}"`));
      }
    }
  });

  it("does not pin a cluster feature on unified child dependencies", () => {
    for (const dependency of dependencyNames) {
      const line = cargo.split("\n").find((entry) => entry.startsWith(`${dependency} =`)) ?? "";
      assert.match(line, /default-features = false/);
      assert.match(line, /"no-entrypoint"/);
      assert.match(line, /"unified-game"/);
      assert.doesNotMatch(line, /"(?:devnet|testnet|mainnet)"/);
    }
  });

  it("rejects missing or conflicting cluster selections at compile time", () => {
    assert.match(source, /Only one cluster feature can be enabled/);
    assert.match(source, /One cluster feature must be enabled/);
    assert.match(source, /all\(feature = "devnet", feature = "testnet"\)/);
    assert.match(source, /all\(feature = "devnet", feature = "mainnet"\)/);
    assert.match(source, /all\(feature = "testnet", feature = "mainnet"\)/);
  });
});
