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
  const gameSource = fs.readFileSync("programs/nicechunk_game/src/lib.rs", "utf8");

  it("prefers client-configured executable aliases for live account scans", () => {
    for (const programKey of ["backpack", "market", "smelting"]) {
      const sourceProgram = contractDictionary.programs.find((program: { codeKey: string }) => program.codeKey === programKey);
      const resolved = resolveProgramAddress(programKey, runtimeConfig, contractDictionary.programs);
      assert.equal(resolved, runtimeConfig.chain.programs[programKey]);
      assert.notEqual(resolved, sourceProgram.programId);
    }
  });

  it("falls back to the standalone source ID when client config omits a program", () => {
    const sourceProgram = contractDictionary.programs.find((program: { codeKey: string }) => program.codeKey === "civilization");
    assert.equal(runtimeConfig.chain.programs.civilization, undefined);
    assert.equal(resolveProgramAddress("civilization", runtimeConfig, contractDictionary.programs), sourceProgram.programId);
  });

  it("routes current and legacy BuildSite scans to their owning programs", () => {
    assert.deepStrictEqual(programAccountScanTargets["build-site"], [
      { programKey: "building", sizes: [160] },
      { programKey: "chunk", sizes: [136] },
    ]);
    assert.deepStrictEqual(getProgramAccountScanTargets("build-site", "building"), [
      { programKey: "building", sizes: [160] },
    ]);
    assert.deepStrictEqual(getProgramAccountScanTargets("build-site", "chunk"), [
      { programKey: "chunk", sizes: [136] },
    ]);

    const accountTypesByProgram = mapProgramAccountTypes();
    for (const programKey of ["building", "chunk"]) {
      const buildSiteControls = (accountTypesByProgram.get(programKey) ?? []).filter((typeId) => typeId === "build-site");
      assert.deepStrictEqual(buildSiteControls, ["build-site"]);
    }
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
});
