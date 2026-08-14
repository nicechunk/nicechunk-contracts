export const programAccountScanTargets = Object.freeze({
  "global-config": [{ programKey: "core", sizes: [293] }],
  "player-profile": [{ programKey: "player", sizes: [773] }],
  "player-session": [{ programKey: "player", sizes: [184] }],
  "player-skills": [{ programKey: "skills", sizes: [480] }],
  "skill-rule-table": [{ programKey: "skills", sizes: [5264] }],
  "chunk-broken": [{ programKey: "chunk", sizes: [{ min: 16 }] }],
  "resource-drop-table": [{ programKey: "chunk", sizes: [{ min: 16 }] }],
  "guardian-registry": [{ programKey: "guardian", sizes: [160] }],
  "guardian-region": [{ programKey: "guardian", sizes: [256, 288] }],
  backpack: [{ programKey: "backpack", sizes: [8048] }],
  "material-physics-table": [{ programKey: "backpack", sizes: [1040] }],
  "forged-item": [{ programKey: "backpack", sizes: [752] }],
  "recipe-table": [{ programKey: "smelting", sizes: [9936] }],
  "market-user": [{ programKey: "market", sizes: [64] }],
  "market-listing": [{ programKey: "market", sizes: [216] }],
  "civilization-rule-book": [{ programKey: "civilization", sizes: [320] }],
  "civilization-rule-signature": [{ programKey: "civilization", sizes: [136] }],
  "civilization-rule-tally": [{ programKey: "civilization", sizes: [128] }],
  "civilization-execution-receipt": [{ programKey: "civilization", sizes: [128] }],
  "civilization-power-snapshot": [{ programKey: "civilization", sizes: [128] }],
  "civilization-citizen-power": [{ programKey: "civilization", sizes: [144] }],
  "build-site": [{ programKey: "building", sizes: [160] }],
  "building-manifest": [{ programKey: "building", sizes: [160] }],
  "building-shard": [{ programKey: "building", sizes: [{ min: 64, max: 8256 }] }],
});

export function getProgramAccountScanTargets(typeId, programKey = null) {
  const targets = programAccountScanTargets[typeId] ?? [];
  return programKey ? targets.filter((target) => target.programKey === programKey) : targets;
}

export function mapProgramAccountTypes(scanTargetsByType = programAccountScanTargets) {
  const typeMap = new Map();
  for (const [typeId, targets] of Object.entries(scanTargetsByType)) {
    for (const target of targets ?? []) {
      if (!target?.programKey) continue;
      if (!typeMap.has(target.programKey)) typeMap.set(target.programKey, []);
      const typeIds = typeMap.get(target.programKey);
      if (!typeIds.includes(typeId)) typeIds.push(typeId);
    }
  }
  return typeMap;
}

export function resolveProgramAddress(programKey, runtimeConfig, sourcePrograms = []) {
  const configuredAddress = runtimeConfig?.chain?.programs?.[programKey];
  if (typeof configuredAddress === "string" && configuredAddress.trim()) return configuredAddress.trim();
  const sourceProgram = sourcePrograms.find((program) => program?.codeKey === programKey);
  return typeof sourceProgram?.programId === "string" && sourceProgram.programId.trim()
    ? sourceProgram.programId.trim()
    : null;
}
