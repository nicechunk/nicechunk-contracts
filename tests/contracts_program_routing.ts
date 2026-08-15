import assert from "assert";
import fs from "fs";

import {
  getProgramAccountScanTargets,
  mapProgramAccountTypes,
  programAccountScanTargets,
  resolveProgramAddress,
} from "../contracts/program-routing.js";

describe("contract browser program routing", () => {
  const runtimeConfig = JSON.parse(fs.readFileSync("public/mainnet.json", "utf8"));
  const contractDictionary = JSON.parse(fs.readFileSync("contracts/locales/en.json", "utf8"));
  const runtimeDictionary = JSON.parse(fs.readFileSync("public/contracts/locales/en.json", "utf8"));
  const gameSource = fs.readFileSync("programs/nicechunk_game/src/lib.rs", "utf8");
  const backpackSource = fs.readFileSync("programs/nicechunk_backpack/src/lib.rs", "utf8");
  const buildingSource = fs.readFileSync("programs/nicechunk_building/src/lib.rs", "utf8");
  const buildingState = fs.readFileSync("programs/nicechunk_building/src/building.rs", "utf8");
  const marketSource = fs.readFileSync("programs/nicechunk_market/src/lib.rs", "utf8");
  const browserSource = fs.readFileSync("contracts/contracts.js", "utf8");

  it("prefers client-configured executable aliases for live account scans", () => {
    for (const programKey of ["backpack", "market", "smelting"]) {
      const resolved = resolveProgramAddress(programKey, runtimeConfig, contractDictionary.programs);
      assert.equal(resolved, runtimeConfig.chain.programs[programKey]);
    }
  });

  it("falls back to the standalone source ID when client config omits a program", () => {
    const sourceProgram = contractDictionary.programs.find((program: { codeKey: string }) => program.codeKey === "civilization");
    assert.equal(runtimeConfig.chain.programs.civilization, undefined);
    assert.equal(resolveProgramAddress("civilization", runtimeConfig, contractDictionary.programs), sourceProgram.programId);
  });

  it("routes Skills authority and mass rules through their deployed program domains", () => {
    const skillsProgram = contractDictionary.programs.find((program: { codeKey: string }) => program.codeKey === "skills");
    assert.equal(runtimeConfig.chain.programs.skills, skillsProgram.programId);
    assert.deepStrictEqual(programAccountScanTargets["player-skills"], [
      { programKey: "skills", sizes: [480] },
    ]);
    assert.deepStrictEqual(programAccountScanTargets["skill-rule-table"], [
      { programKey: "skills", sizes: [5264] },
    ]);
    assert.deepStrictEqual(programAccountScanTargets["material-physics-table"], [
      { programKey: "backpack", sizes: [1040] },
    ]);
    assert.equal(programAccountScanTargets["blueprint-item"], undefined);
    assert.deepStrictEqual(programAccountScanTargets["forged-item"], [
      { programKey: "backpack", sizes: [752] },
    ]);
    assert.deepStrictEqual(programAccountScanTargets["market-user"], [
      { programKey: "market", sizes: [64] },
    ]);
  });

  it("routes final-format BuildSite scans only to the Building program", () => {
    assert.deepStrictEqual(programAccountScanTargets["build-site"], [
      { programKey: "building", sizes: [160] },
    ]);
    assert.deepStrictEqual(getProgramAccountScanTargets("build-site", "building"), [
      { programKey: "building", sizes: [160] },
    ]);
    assert.deepStrictEqual(getProgramAccountScanTargets("build-site", "chunk"), []);

    const accountTypesByProgram = mapProgramAccountTypes();
    const buildingControls = (accountTypesByProgram.get("building") ?? []).filter((typeId) => typeId === "build-site");
    const chunkControls = (accountTypesByProgram.get("chunk") ?? []).filter((typeId) => typeId === "build-site");
    assert.deepStrictEqual(buildingControls, ["build-site"]);
    assert.deepStrictEqual(chunkControls, []);
  });

  it("documents the unified wire envelope, namespace map, and current address domains", () => {
    const routerDiagram = contractDictionary.instructionSurface.diagrams.find(
      (diagram: { id: string }) => diagram.id === "unified-game-router",
    );
    assert.ok(routerDiagram);

    const nodes = new Map<string, { badge?: string; evidence?: string }>(
      routerDiagram.lanes.flatMap((lane: { nodes: Array<{ id: string; badge?: string; evidence?: string }> }) => (
        lane.nodes.map((node) => [node.id, node] as const)
      )),
    );
    const expectedNamespaces = new Map([
      ["game-ns-1", ["Backpack", "NS_BACKPACK", "1"]],
      ["game-ns-2", ["Chunk", "NS_CHUNK", "2"]],
      ["game-ns-3", ["Smelting", "NS_SMELTING", "3"]],
      ["game-ns-4", ["Market", "NS_MARKET", "4"]],
    ]);
    for (const [nodeId, [badge, constant, value]] of expectedNamespaces) {
      assert.equal(nodes.get(nodeId)?.badge, badge);
      assert.match(gameSource, new RegExp(`const ${constant}: u8 = ${value};`));
    }

    assert.equal(nodes.get("game-wire-payload")?.evidence, "[namespace, childTag, childPayload...]");
    assert.equal(runtimeConfig.chain.programs.backpack, runtimeConfig.chain.programs.market);
    assert.equal(runtimeConfig.chain.programs.market, runtimeConfig.chain.programs.smelting);
    assert.notEqual(runtimeConfig.chain.programs.chunk, runtimeConfig.chain.programs.backpack);
    assert.equal(contractDictionary.auditMatrix.rows.length, contractDictionary.programs.length);
    assert.ok(contractDictionary.auditMatrix.rows.some((row: { id: string }) => row.id === "game"));
  });

  it("keeps treasury land-contract documentation aligned with the deployed dispatchers", () => {
    const market = runtimeDictionary.programs.find((program: { id: string }) => program.id === "nicechunk-market");
    const building = runtimeDictionary.programs.find((program: { id: string }) => program.id === "nicechunk-building");
    const backpack = runtimeDictionary.programs.find((program: { id: string }) => program.id === "nicechunk-backpack");

    assert.deepStrictEqual(market.instructions.slice(0, 8).map((entry: string) => Number(entry.split(" ")[0])), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.match(market.instructions[4], /exactly 10 NCK per blank land contract/);
    assert.match(marketSource, /pub const BLANK_LAND_CONTRACT_PRICE_BASE_UNITS: u64 = 10_000_000;/);
    assert.match(marketSource, /4 => buy_treasury_contract/);
    assert.match(marketSource, /5 => update_land_contract_reservation/);
    assert.match(marketSource, /6 => update_land_contract_reservation/);
    assert.match(marketSource, /7 => update_land_contract_reservation/);

    assert.deepStrictEqual(building.instructions.slice(0, 7).map((entry: string) => Number(entry.split(" ")[0])), [0, 1, 2, 3, 4, 5, 6]);
    assert.match(building.instructions[building.instructions.length - 1], /All other building tags return InvalidInstruction/);
    assert.match(buildingSource, /6 => cancel_build_site_indexing/);
    assert.doesNotMatch(buildingSource, /publish_guardian_blueprint|guardian-blueprint/);
    assert.doesNotMatch(buildingSource, /7 =>/);
    assert.match(buildingState, /BUILD_SITE_MAGIC: \[u8; 8\] = \*b"NCKSITE3"/);
    assert.match(buildingState, /BUILDING_MANIFEST_MAGIC: \[u8; 8\] = \*b"NCKBLD03"/);
    assert.match(buildingState, /BUILDING_SHARD_MAGIC: \[u8; 8\] = \*b"NCKBDT02"/);

    assert.ok(backpack.instructions.some((entry: string) => /^9 retired construction-item issuance/.test(entry)));
    assert.match(backpackSource, /9 => Err\(NicechunkBackpackError::InvalidInstruction\.into\(\)\)/);
    assert.match(browserSource, /decodeMarketUserAccount/);
    assert.match(browserSource, /assertMagic\(data, "NCKSITE3", 160\)/);
    assert.match(browserSource, /assertMagic\(data, "NCKBLD03", 160\)/);
    assert.match(browserSource, /assertMagic\(data, "NCKBDT02"\)/);
  });
});
