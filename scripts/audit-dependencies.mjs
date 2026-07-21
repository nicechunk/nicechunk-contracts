import { spawnSync } from "node:child_process";
import { classifyVulnerabilities } from "./dependency-audit-policy.mjs";

const audit = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (!audit.stdout.trim()) {
  console.error(audit.stderr.trim() || "npm audit produced no JSON output.");
  process.exit(audit.status || 1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error("Failed to parse npm audit JSON output.");
  console.error(error);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const { allowed, unexpected } = classifyVulnerabilities(vulnerabilities);

console.log(JSON.stringify({
  ok: unexpected.length === 0,
  allowed,
  unexpected,
}, null, 2));

if (unexpected.length) {
  console.error("Dependency audit failed: unexpected vulnerabilities were found.");
  process.exit(1);
}
