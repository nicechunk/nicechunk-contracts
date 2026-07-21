import { strict as assert } from "node:assert";
import { classifyVulnerabilities } from "../scripts/dependency-audit-policy.mjs";

function currentAllowedGraph(): Record<string, any> {
  return {
    "@solana/buffer-layout-utils": { severity: "high", via: ["@solana/web3.js", "bigint-buffer"] },
    "@solana/spl-token": { severity: "high", via: ["@solana/buffer-layout-utils", "@solana/spl-token-group", "@solana/spl-token-metadata", "@solana/web3.js"] },
    "@solana/spl-token-group": { severity: "moderate", via: ["@solana/web3.js"] },
    "@solana/spl-token-metadata": { severity: "moderate", via: ["@solana/web3.js"] },
    "@solana/web3.js": { severity: "moderate", via: ["jayson"] },
    "bigint-buffer": { severity: "high", via: [{ url: "https://github.com/advisories/GHSA-3gc7-fjrx-p6mg" }] },
    jayson: { severity: "moderate", via: ["uuid"] },
    uuid: { severity: "moderate", via: [{ url: "https://github.com/advisories/GHSA-w5hq-g745-h8pq" }] },
  };
}

describe("dependency audit allowlist policy", () => {
  it("allows only the fully reviewed advisory graph", () => {
    const result = classifyVulnerabilities(currentAllowedGraph());
    assert.equal(result.ok, true);
    assert.equal(result.allowed.length, 8);
    assert.deepEqual(result.unexpected, []);
  });

  it("rejects a new direct advisory on an otherwise reviewed parent", () => {
    const graph = currentAllowedGraph();
    graph["@solana/web3.js"].via.push({ url: "https://github.com/advisories/GHSA-new-direct" });
    const result = classifyVulnerabilities(graph);
    assert.equal(result.ok, false);
    assert.ok(result.unexpected.some((finding) => finding.name === "@solana/web3.js"));
    assert.ok(result.unexpected.some((finding) => finding.name === "@solana/spl-token"));
  });

  it("rejects empty, changed, or unknown advisory paths", () => {
    for (const mutate of [
      (graph: Record<string, any>) => { graph.uuid.via = []; },
      (graph: Record<string, any>) => { graph["bigint-buffer"].via[0].url = "https://github.com/advisories/GHSA-different"; },
      (graph: Record<string, any>) => { graph["@solana/spl-token"].via.push("unknown-package"); },
      (graph: Record<string, any>) => { graph.jayson.severity = "high"; },
    ]) {
      const graph = currentAllowedGraph();
      mutate(graph);
      assert.equal(classifyVulnerabilities(graph).ok, false);
    }
  });
});
