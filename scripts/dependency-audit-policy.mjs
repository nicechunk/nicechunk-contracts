const allowedDirectAdvisories = new Map([
  [
    "bigint-buffer",
    {
      severity: "high",
      advisoryUrls: new Set(["https://github.com/advisories/GHSA-3gc7-fjrx-p6mg"]),
      reason: "Transitive dependency of @solana/spl-token through @solana/buffer-layout-utils. No non-breaking upstream fix is available in the current Solana package line.",
    },
  ],
  [
    "uuid",
    {
      severity: "moderate",
      advisoryUrls: new Set(["https://github.com/advisories/GHSA-w5hq-g745-h8pq"]),
      reason: "Transitive dependency of @solana/web3.js through jayson. npm's suggested fix downgrades @solana/web3.js to an unusable pre-1.x version.",
    },
  ],
]);

const allowedTransitiveFindings = new Map([
  ["@solana/buffer-layout-utils", { severity: "high", via: new Set(["@solana/web3.js", "bigint-buffer"]) }],
  ["@solana/spl-token", { severity: "high", via: new Set(["@solana/buffer-layout-utils", "@solana/spl-token-group", "@solana/spl-token-metadata", "@solana/web3.js"]) }],
  ["@solana/spl-token-group", { severity: "moderate", via: new Set(["@solana/web3.js"]) }],
  ["@solana/spl-token-metadata", { severity: "moderate", via: new Set(["@solana/web3.js"]) }],
  ["@solana/web3.js", { severity: "moderate", via: new Set(["jayson"]) }],
  ["jayson", { severity: "moderate", via: new Set(["uuid"]) }],
]);

export function classifyVulnerabilities(vulnerabilities) {
  const decisions = new Map();

  const assess = (name, visiting = new Set()) => {
    if (decisions.has(name)) return decisions.get(name);
    const finding = vulnerabilities[name];
    if (!finding || visiting.has(name)) return null;

    const directPolicy = allowedDirectAdvisories.get(name);
    if (directPolicy) {
      const via = Array.isArray(finding.via) ? finding.via : [];
      const urls = via
        .filter((item) => item && typeof item === "object" && typeof item.url === "string")
        .map((item) => item.url);
      const onlyUrlAdvisories = via.length > 0 && urls.length === via.length;
      const allowed = onlyUrlAdvisories
        && urls.length === new Set(urls).size
        && finding.severity === directPolicy.severity
        && sameSet(new Set(urls), directPolicy.advisoryUrls);
      const decision = allowed ? { reason: directPolicy.reason } : null;
      decisions.set(name, decision);
      return decision;
    }

    const transitivePolicy = allowedTransitiveFindings.get(name);
    if (!transitivePolicy) {
      decisions.set(name, null);
      return null;
    }

    const via = Array.isArray(finding.via) ? finding.via : [];
    const onlyNamedDependencies = via.length > 0 && via.every((item) => typeof item === "string" && item.length > 0);
    if (!onlyNamedDependencies
      || via.length !== new Set(via).size
      || finding.severity !== transitivePolicy.severity
      || !sameSet(new Set(via), transitivePolicy.via)) {
      decisions.set(name, null);
      return null;
    }

    const nextVisiting = new Set(visiting).add(name);
    if (via.some((dependency) => !assess(dependency, nextVisiting))) {
      decisions.set(name, null);
      return null;
    }

    const decision = {
      reason: `Transitive audit finding inherited only from reviewed ${[...via].sort().join(", ")} finding(s).`,
    };
    decisions.set(name, decision);
    return decision;
  };

  const allowed = [];
  const unexpected = [];
  for (const [name, finding] of Object.entries(vulnerabilities)) {
    const decision = assess(name);
    if (decision) {
      allowed.push({ name, severity: finding.severity, reason: decision.reason });
    } else {
      unexpected.push({
        name,
        severity: finding.severity,
        via: finding.via,
        fixAvailable: finding.fixAvailable,
      });
    }
  }
  return { ok: unexpected.length === 0, allowed, unexpected };
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}
