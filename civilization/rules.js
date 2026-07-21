import { initI18n, t } from "../src/i18n.js";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  CIVILIZATION_SIDE_ABSTAIN,
  CIVILIZATION_SIDE_AGREE,
  CIVILIZATION_SIDE_CHALLENGE,
  CIVILIZATION_SIDE_REJECT,
  CITIZEN_POWER_MAGIC,
  CITIZEN_POWER_LEN,
  civilizationRequiredPower,
  civilizationThresholdMet,
  createExecuteCivilizationRuleReceiptInstruction,
  createFinalizeCivilizationRuleInstruction,
  createPublishPowerSnapshotInstruction,
  createPublishCivilizationRuleInstruction,
  createSettleCitizenPowerInstruction,
  createSignCivilizationRuleInstruction,
  deriveCitizenPowerPda,
  deriveCivilizationAdapterAuthorityPda,
  deriveExecutionReceiptPda,
  derivePowerSnapshotPda,
  deriveRuleBookPda,
  deriveRuleSignaturePda,
  deriveRuleTallyPda,
  NICECHUNK_CIVILIZATION_POWER_AUTHORITY,
  POWER_SNAPSHOT_MAGIC,
  POWER_SNAPSHOT_LEN,
} from "../sdk/nicechunk-civilization.ts";
import { createNicechunkRpcFetch, getNicechunkRpcUrl } from "../src/rpcConfig.js";
import { finishSiteLoading, setSiteLoadingProgress } from "../src/site-ui.js";
import { assertNicechunkWalletNetwork } from "../src/solanaNetwork.js";
import { buildWalletLoginUrl, detectWalletProviders, getWalletSession, persistConnectedWallet } from "../src/walletSession.js";
import { ruleTargetModules, ruleTargets, ruleTargetStatuses } from "./rule-targets.js";
import {
  createApplyCivilizationSmeltingRecipeInstruction,
  encodeCivilizationSmeltingRecipePatch,
  RECIPE_RECORD_LEN,
  RECIPE_TABLE_HEADER_LEN,
  RECIPE_TABLE_MAGIC,
  RECIPE_TABLE_MAX_RECIPES,
} from "../sdk/nicechunk-smelting.ts";
import { deriveGlobalConfigPda } from "../sdk/nicechunk-core.ts";
import {
  createApplyCivilizationResourceDropRulesInstruction,
  deriveResourceDropTablePda,
  encodeCivilizationResourceDropRulesPatch,
} from "../sdk/nicechunk-chunk.ts";
import { resourceDropRules } from "../src/data/resourceDropRules.js";
import "./style.css";
import "./rules.css";
import "../src/site-header.css";

const state = {
  status: "governable",
  module: "all",
  query: "",
  proposalEnvelope: null,
  signedProof: null,
  deployPacket: null,
  sourceDeployPacket: null,
  validation: null,
  chainPlan: null,
  draftDirtyAfterProof: false,
  pdaReads: {},
  pdaBrowser: {
    family: "liveTargets",
    status: "idle",
    rows: [],
    selected: null,
    read: null,
    message: "",
  },
};

const metricsTarget = document.querySelector("#ruleLibraryMetrics");
const statusTabsTarget = document.querySelector("#ruleStatusTabs");
const moduleFiltersTarget = document.querySelector("#ruleModuleFilters");
const searchInput = document.querySelector("#ruleTargetSearch");
const countTarget = document.querySelector("#ruleTargetCount");
const listTarget = document.querySelector("#ruleTargetList");
const moduleSelect = document.querySelector("#ruleComposerModule");
const pdaSelect = document.querySelector("#ruleComposerPda");
const composerForm = document.querySelector("#ruleComposerForm");
const refreshOldHashButton = document.querySelector("#refreshOldValueHash");
const oldValueHashStatus = document.querySelector("#oldValueHashStatus");
const previewTarget = document.querySelector("#rulePreviewJson");
const copyButton = document.querySelector("#copyRulePreview");
const validateButton = document.querySelector("#validateRuleProposal");
const signButton = document.querySelector("#signRuleProposal");
const stageButton = document.querySelector("#stageRuleDeployment");
const flowStepsTarget = document.querySelector("#ruleFlowSteps");
const flowStatusTarget = document.querySelector("#ruleFlowStatus");
const deployPacketTarget = document.querySelector("#ruleDeployPacketJson");
const copyDeployPacketButton = document.querySelector("#copyDeployPacket");
const powerThresholdMeter = document.querySelector("#powerThresholdMeter");
const readinessTarget = document.querySelector("#ruleDeploymentReadiness");
const deployAuditTarget = document.querySelector("#ruleDeployPacketAudit");
const deployHistoryTarget = document.querySelector("#ruleDeployHistory");
const clearDeployPacketsButton = document.querySelector("#clearDeployPackets");
const deployPacketImportInput = document.querySelector("#ruleDeployPacketImport");
const importDeployPacketButton = document.querySelector("#importDeployPacket");
const buildRuleChainTxButton = document.querySelector("#buildRuleChainTx");
const submitRuleChainTxButton = document.querySelector("#submitRuleChainTx");
const buildRuleFinalizeTxButton = document.querySelector("#buildRuleFinalizeTx");
const submitRuleFinalizeTxButton = document.querySelector("#submitRuleFinalizeTx");
const buildRuleExecuteTxButton = document.querySelector("#buildRuleExecuteTx");
const submitRuleExecuteTxButton = document.querySelector("#submitRuleExecuteTx");
const chainStatusTarget = document.querySelector("#ruleChainStatus");
const chainProofSummaryTarget = document.querySelector("#ruleChainProofSummary");
const chainTxPreviewTarget = document.querySelector("#ruleChainTxPreview");
const finalizeSignatureInput = document.querySelector("#ruleFinalizeSignaturePdas");
const signatureCurrentTarget = document.querySelector("#ruleSignatureCurrent");
const signatureSummaryTarget = document.querySelector("#ruleSignatureSummary");
const pdaBrowserFamilySelect = document.querySelector("#pdaBrowserFamily");
const pdaBrowserAddressInput = document.querySelector("#pdaBrowserAddress");
const pdaBrowserScanButton = document.querySelector("#pdaBrowserScan");
const pdaBrowserLoadAddressButton = document.querySelector("#pdaBrowserLoadAddress");
const pdaBrowserStatusTarget = document.querySelector("#pdaBrowserStatus");
const pdaBrowserListTarget = document.querySelector("#pdaBrowserList");
const pdaBrowserDetailTarget = document.querySelector("#pdaBrowserDetail");
const toast = document.querySelector("#ruleLibraryToast");
const deployPacketStorageKey = "nicechunk.civilization.deployPackets";
const civilizationProgramId = "3MRG4UjxTK1rMq7TGM4bX1GrD8C36bQtt1RdTmJD7Jah";
const civilizationProgramExplorerUrl = `https://explorer.solana.com/address/${civilizationProgramId}?cluster=devnet`;
const civilizationProgramCapabilities = {
  requiredSchema: "power_snapshot_v1",
  chainSubmitEnabled: false,
  reasonKey: "civilization.ruleLibrary.chain.programUpgradeRequired",
};
const civilizationPowerAuthority = NICECHUNK_CIVILIZATION_POWER_AUTHORITY.toBase58();
const fallbackDevnetRpcUrl = "https://api.devnet.solana.com";
const targetProgramIds = {
  smelting: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7",
  resources: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7",
  forging: civilizationProgramId,
  market: "B4G7rVwF8gbN9Sx3FgcdKeL8pHjn4LtMS4BiiFMEqqAh",
  guardian: "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK",
  knowledge: civilizationProgramId,
  civic: civilizationProgramId,
  assets: civilizationProgramId,
  player: "CHZHsBCGn58ih2WrPfKSYhvCEjMPGhArTiYCH7AWWBkB",
  world: "9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu",
};
const defaultSmeltingRecipePatch = {
  recipe_id: 1001,
  enabled: true,
  min_heat_tier: 2,
  yield_bps: 9600,
  inputs: [
    { kind: "block", quantity: 1, resource: { world_x: 1, world_y: 0, world_z: 2 } },
  ],
  outputs: [
    {
      kind: "item",
      category: 1,
      quantity: 1,
      item_code: 101,
      item_id: 501,
      item_pda: "CEzcpJe9UTq5FmVzpTfgPffMbqdG97YJeFMJYwUSFhNF",
      volume_mm3: 1_000_000,
      durability_current: 10_000,
      durability_max: 10_000,
      grade: 1,
      item_level: 1,
      quality_bps: 9600,
    },
  ],
};
const pdaBrowserFamilies = [
  { id: "liveTargets", mode: "known" },
  { id: "globalConfig", mode: "known" },
  { id: "civilizationRuleBooks", mode: "scan", programId: civilizationProgramId, dataSize: 320, magic: "NCKCVR01" },
  { id: "civilizationSignatures", mode: "scan", programId: civilizationProgramId, dataSize: 136, magic: "NCKCVS01" },
  { id: "civilizationTallies", mode: "scan", programId: civilizationProgramId, dataSize: 128, magic: "NCKCVT01" },
  { id: "civilizationReceipts", mode: "scan", programId: civilizationProgramId, dataSize: 128, magic: "NCKCVE01" },
  { id: "civilizationPowerSnapshots", mode: "scan", programId: civilizationProgramId, dataSize: 128, magic: "NCKCVP01" },
  { id: "civilizationCitizenPowers", mode: "scan", programId: civilizationProgramId, dataSize: 144, magic: "NCKCVC01" },
  { id: "playerProfiles", mode: "scan", programId: targetProgramIds.player, dataSize: 773, magic: "NCKPLY01" },
  { id: "playerProgress", mode: "scan", programId: targetProgramIds.resources, dataSize: 128, magic: "NCKPRG01" },
  { id: "backpacks", mode: "scan", programId: targetProgramIds.resources, dataSize: 8048, magic: "NCKBPK01" },
];

setSiteLoadingProgress(30);
await initI18n();
setSiteLoadingProgress(64);
renderRuleLibrary();
finishSiteLoading();

window.addEventListener("nicechunk:languagechange", renderRuleLibrary);

pdaBrowserFamilySelect?.addEventListener("change", () => {
  state.pdaBrowser.family = pdaBrowserFamilySelect.value;
  state.pdaBrowser.status = "idle";
  state.pdaBrowser.rows = [];
  state.pdaBrowser.selected = null;
  state.pdaBrowser.read = null;
  state.pdaBrowser.message = "";
  renderPdaBrowser();
});

pdaBrowserScanButton?.addEventListener("click", loadPdaBrowserFamily);
pdaBrowserLoadAddressButton?.addEventListener("click", loadManualPdaAddress);
pdaBrowserListTarget?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pda-browser-address]");
  if (!button) return;
  loadPdaBrowserRow(button.dataset.pdaBrowserAddress);
});

searchInput?.addEventListener("input", () => {
  state.query = searchInput.value.trim().toLowerCase();
  renderRuleTargets();
});

composerForm?.addEventListener("input", () => {
  renderRulePreview();
  resetFlowAfterEdit();
});
composerForm?.addEventListener("change", (event) => {
  if (event.target === moduleSelect) {
    updatePdaOptions();
    applyComposerTargetDefaults(selectedComposerTarget(), { updateTitle: true });
  } else if (event.target === pdaSelect) {
    applyComposerTargetDefaults(selectedComposerTarget(), { updateTitle: true });
  }
  renderRulePreview();
  resetFlowAfterEdit();
});

refreshOldHashButton?.addEventListener("click", refreshComposerOldValueHash);

copyButton?.addEventListener("click", async () => {
  const value = previewTarget?.textContent ?? "";
  if (!value) return;
  await navigator.clipboard?.writeText(value).catch(() => {});
  showToast(t("civilization.ruleLibrary.form.copied"));
});

copyDeployPacketButton?.addEventListener("click", async () => {
  const value = deployPacketTarget?.textContent ?? "";
  if (!value) return;
  await navigator.clipboard?.writeText(value).catch(() => {});
  showToast(t("civilization.ruleLibrary.flow.deployCopied"));
});

chainProofSummaryTarget?.addEventListener("click", async (event) => {
  const button = event.target?.closest?.("[data-copy-chain-proof]");
  if (!button) return;
  const proof = state.chainPlan?.post_submit_proof;
  if (!proof) return;
  await navigator.clipboard?.writeText(JSON.stringify(proof, null, 2)).catch(() => {});
  showToast(t("civilization.ruleLibrary.chainProof.copied"));
});

clearDeployPacketsButton?.addEventListener("click", () => {
  localStorage.removeItem(deployPacketStorageKey);
  renderDeployHistory();
  showToast(t("civilization.ruleLibrary.history.cleared"));
});

deployHistoryTarget?.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-load-deploy-packet-index]");
  if (!button) return;
  void loadDeployPacketFromHistory(Number(button.dataset.loadDeployPacketIndex));
});

importDeployPacketButton?.addEventListener("click", async () => {
  const result = await importDeployPacketFromText();
  setFlowStatus(result.ok ? "success" : "error", result.message);
});

validateButton?.addEventListener("click", async () => {
  const result = await validateProposal();
  setFlowStatus(result.ok ? "success" : "error", result.messages.join(" "));
});

signButton?.addEventListener("click", async () => {
  const result = await signProposal();
  setFlowStatus(result.ok ? "success" : "error", result.message);
});

stageButton?.addEventListener("click", async () => {
  const result = await stageDeployPacket();
  setFlowStatus(result.ok ? "success" : "error", result.message);
});

buildRuleChainTxButton?.addEventListener("click", async () => {
  const result = await buildRuleChainPlan();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

submitRuleChainTxButton?.addEventListener("click", async () => {
  const result = await submitRuleChainTransaction();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

buildRuleFinalizeTxButton?.addEventListener("click", async () => {
  const result = await buildFinalizeChainPlan();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

submitRuleFinalizeTxButton?.addEventListener("click", async () => {
  const result = await submitFinalizeChainTransaction();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

buildRuleExecuteTxButton?.addEventListener("click", async () => {
  const result = await buildExecuteReceiptChainPlan();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

submitRuleExecuteTxButton?.addEventListener("click", async () => {
  const result = await submitExecuteReceiptChainTransaction();
  setChainStatus(result.ok ? "success" : "error", result.message);
});

finalizeSignatureInput?.addEventListener("input", () => {
  state.chainPlan = null;
  renderFinalizeSignatureCollector();
  renderChainPlan();
  if (chainStatusTarget) chainStatusTarget.textContent = "";
});

listTarget?.addEventListener("click", (event) => {
  const pdaButton = event.target.closest("[data-load-target-pda]");
  if (pdaButton) {
    loadRuleTargetPda(pdaButton.dataset.loadTargetPda);
    return;
  }
  const button = event.target.closest("[data-draft-rule-target]");
  if (!button) return;
  selectRuleTarget(button.dataset.draftRuleTarget);
});

function renderRuleLibrary() {
  document.title = t("civilization.ruleLibrary.meta.title");
  renderMetrics();
  renderStatusTabs();
  renderModuleFilters();
  updateComposerOptions();
  renderRuleTargets();
  renderRulePreview({ preferProposal: true });
  renderFlowState();
  renderDeploymentReadiness();
  renderDeployPacket();
  renderDeployHistory();
  renderFinalizeSignatureCollector();
  renderChainPlan();
  renderPdaBrowser();
}

function renderMetrics() {
  if (!metricsTarget) return;
  metricsTarget.replaceChildren(
    ...ruleTargetStatuses.map((status) => {
      const count = ruleTargets.filter((target) => target.status === status).length;
      const card = document.createElement("div");
      card.className = `rule-metric-card ${status}`;
      card.innerHTML = `
        <span class="rule-metric-value">${count}</span>
        <span class="rule-metric-label">${t(`civilization.ruleLibrary.status.${status}`)}</span>
      `;
      return card;
    }),
  );
}

function renderPdaBrowser() {
  if (!pdaBrowserFamilySelect || !pdaBrowserListTarget || !pdaBrowserDetailTarget || !pdaBrowserStatusTarget) return;
  const currentFamily = state.pdaBrowser.family;
  pdaBrowserFamilySelect.replaceChildren(
    ...pdaBrowserFamilies.map((family) => {
      const option = document.createElement("option");
      option.value = family.id;
      option.textContent = t(`civilization.ruleLibrary.pdaBrowser.families.${family.id}.title`);
      return option;
    }),
  );
  pdaBrowserFamilySelect.value = currentFamily;
  pdaBrowserStatusTarget.dataset.type = state.pdaBrowser.status;
  pdaBrowserStatusTarget.textContent = browserStatusText();
  pdaBrowserListTarget.innerHTML = renderPdaBrowserList();
  pdaBrowserDetailTarget.innerHTML = renderPdaBrowserDetail();
}

function browserStatusText() {
  if (state.pdaBrowser.status === "loading") return t("civilization.ruleLibrary.pdaBrowser.loading");
  if (state.pdaBrowser.status === "error") return t("civilization.ruleLibrary.pdaBrowser.failed", { reason: state.pdaBrowser.message });
  if (state.pdaBrowser.status === "loaded") {
    return t("civilization.ruleLibrary.pdaBrowser.loaded", { count: state.pdaBrowser.rows.length });
  }
  return t("civilization.ruleLibrary.pdaBrowser.idle");
}

function renderPdaBrowserList() {
  const family = pdaBrowserFamilies.find((item) => item.id === state.pdaBrowser.family);
  if (!state.pdaBrowser.rows.length) {
    return `
      <div class="pda-browser-empty">
        <strong>${t(`civilization.ruleLibrary.pdaBrowser.families.${family?.id || "liveTargets"}.title`)}</strong>
        <span>${t(`civilization.ruleLibrary.pdaBrowser.families.${family?.id || "liveTargets"}.body`)}</span>
      </div>
    `;
  }
  return `
    <div class="pda-browser-row-list">
      ${state.pdaBrowser.rows.map((row) => `
        <button type="button" data-pda-browser-address="${escapeHtml(row.pda)}" data-active="${String(state.pdaBrowser.selected?.pda === row.pda)}">
          <strong>${escapeHtml(row.title)}</strong>
          <code>${escapeHtml(row.pda)}</code>
          <span>${escapeHtml(row.kind)} / ${escapeHtml(row.source)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderPdaBrowserDetail() {
  const read = state.pdaBrowser.read;
  if (!read) {
    return `
      <div class="pda-browser-empty">
        <strong>${t("civilization.ruleLibrary.pdaBrowser.detailTitle")}</strong>
        <span>${t("civilization.ruleLibrary.pdaBrowser.detailEmpty")}</span>
      </div>
    `;
  }
  if (read.status === "loading") {
    return `<p class="rule-live-pda-empty">${t("civilization.ruleLibrary.pdaReader.loadingBody")}</p>`;
  }
  if (read.status === "error") {
    return `<p class="rule-live-pda-empty error">${t("civilization.ruleLibrary.pdaReader.failed", { reason: read.reason })}</p>`;
  }
  if (read.status === "missing") {
    return `<p class="rule-live-pda-empty error">${t("civilization.ruleLibrary.pdaReader.missing", { pda: shortAddress(read.pda) })}</p>`;
  }
  return renderLoadedPdaRead(null, read);
}

async function loadPdaBrowserFamily() {
  const family = pdaBrowserFamilies.find((item) => item.id === state.pdaBrowser.family) ?? pdaBrowserFamilies[0];
  state.pdaBrowser.status = "loading";
  state.pdaBrowser.rows = [];
  state.pdaBrowser.selected = null;
  state.pdaBrowser.read = null;
  state.pdaBrowser.message = "";
  renderPdaBrowser();
  try {
    const rows = family.mode === "scan"
      ? await scanPdaBrowserFamily(family)
      : knownPdaBrowserRows(family);
    state.pdaBrowser.rows = rows.slice(0, 20);
    state.pdaBrowser.status = "loaded";
    state.pdaBrowser.message = "";
    if (state.pdaBrowser.rows[0]) {
      renderPdaBrowser();
      await loadPdaBrowserRow(state.pdaBrowser.rows[0].pda);
      return;
    }
  } catch (error) {
    state.pdaBrowser.status = "error";
    state.pdaBrowser.message = error?.message || String(error);
  }
  renderPdaBrowser();
}

async function loadManualPdaAddress() {
  const value = String(pdaBrowserAddressInput?.value ?? "").trim();
  try {
    const pda = new PublicKey(value).toBase58();
    const row = { pda, title: t("civilization.ruleLibrary.pdaBrowser.manualRow"), kind: "manual", source: "manual", decoder: "auto" };
    state.pdaBrowser.rows = [row, ...state.pdaBrowser.rows.filter((item) => item.pda !== pda)].slice(0, 20);
    state.pdaBrowser.status = "loaded";
    renderPdaBrowser();
    await loadPdaBrowserRow(pda);
  } catch {
    state.pdaBrowser.status = "error";
    state.pdaBrowser.message = t("civilization.ruleLibrary.pdaBrowser.invalidAddress");
    renderPdaBrowser();
  }
}

async function loadPdaBrowserRow(pda) {
  const row = state.pdaBrowser.rows.find((item) => item.pda === pda) || {
    pda,
    title: shortAddress(pda),
    kind: "manual",
    source: "manual",
    decoder: "auto",
  };
  state.pdaBrowser.selected = row;
  state.pdaBrowser.read = { status: "loading", pda };
  renderPdaBrowser();
  try {
    const result = await readPdaAccountWithFallback(new PublicKey(pda));
    const account = result.value;
    if (!account) {
      state.pdaBrowser.read = { status: "missing", pda };
    } else {
      const data = new Uint8Array(account.data);
      state.pdaBrowser.read = {
        status: "loaded",
        pda,
        owner: account.owner.toBase58(),
        lamports: account.lamports,
        bytes: data.length,
        slot: result.context.slot,
        dataHash: `sha256:${await sha256HexBytes(data)}`,
        decoded: decodePdaBrowserAccount(row, data),
      };
    }
  } catch (error) {
    state.pdaBrowser.read = { status: "error", pda, reason: error?.message || String(error) };
  }
  renderPdaBrowser();
}

function knownPdaBrowserRows(family) {
  if (family.id === "globalConfig") {
    const [globalConfig] = deriveGlobalConfigPda();
    return [{
      pda: globalConfig.toBase58(),
      title: t("civilization.ruleLibrary.pdaBrowser.families.globalConfig.title"),
      kind: "GlobalConfig",
      source: "derived",
      decoder: "globalConfig",
    }];
  }
  const rows = [];
  for (const target of ruleTargets.filter((item) => item.status === "governable")) {
    extractTargetPdas(target).forEach((pda, index) => {
      rows.push({
        pda,
        title: `${t(`civilization.ruleLibrary.targets.${target.id}.title`)}${index ? ` #${index + 1}` : ""}`,
        kind: target.pda,
        source: target.id,
        targetId: target.id,
        decoder: target.id,
      });
    });
  }
  return rows;
}

async function scanPdaBrowserFamily(family) {
  const config = {
    commitment: "confirmed",
    filters: [{ dataSize: family.dataSize }],
  };
  const result = await getProgramAccountsWithFallback(new PublicKey(family.programId), config);
  return result
    .filter(({ account }) => ascii(new Uint8Array(account.data).slice(0, 8)) === family.magic)
    .slice(0, 20)
    .map(({ pubkey, account }, index) => ({
      pda: pubkey.toBase58(),
      title: `${t(`civilization.ruleLibrary.pdaBrowser.families.${family.id}.title`)} #${index + 1}`,
      kind: ascii(new Uint8Array(account.data).slice(0, 8)),
      source: `scan:${shortAddress(family.programId)}`,
      decoder: family.id,
    }));
}

async function getProgramAccountsWithFallback(programId, config) {
  const urls = Array.from(new Set([getNicechunkRpcUrl(), fallbackDevnetRpcUrl].filter(Boolean)));
  let lastError = null;
  for (const rpcUrl of urls) {
    try {
      const conn = new Connection(rpcUrl, {
        commitment: "confirmed",
        fetch: createNicechunkRpcFetch("civilization-pda-browser-scan"),
      });
      return await withTimeout(
        conn.getProgramAccounts(programId, config),
        15_000,
        `RPC scan timed out after 15s: ${new URL(rpcUrl).host}`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("RPC scan failed.");
}

function decodePdaBrowserAccount(row, data) {
  if (row.targetId) return decodeTargetPdaData({ id: row.targetId }, data);
  const magic = ascii(data.slice(0, 8));
  if (magic === "NCKDRP02") return decodeResourceDropTable(data);
  if (magic === RECIPE_TABLE_MAGIC) return decodeSmeltingRecipeTable(data);
  if (magic === "NCKCFG01") return decodeGlobalConfigAccount(data);
  if (magic === "NCKBPK01") return decodeBackpackAccount(data);
  if (magic === "NCKPLY01") return decodePlayerProfileAccount(data);
  if (magic === "NCKSES01") return decodePlayerSessionAccount(data);
  if (magic === "NCKPRG01") return decodePlayerProgressAccount(data);
  if (magic === "NCKCVR01") return decodeCivilizationRuleBookAccount(data);
  if (magic === "NCKCVS01") return decodeCivilizationSignatureAccount(data);
  if (magic === "NCKCVT01") return decodeCivilizationTallyAccount(data);
  if (magic === "NCKCVE01") return decodeCivilizationReceiptAccount(data);
  if (magic === "NCKCVP01") return decodeCivilizationPowerSnapshotAccount(data);
  if (magic === "NCKCVC01") return decodeCivilizationCitizenPowerAccount(data);
  return {
    kind: t("civilization.ruleLibrary.pdaReader.rawAccount"),
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: magic || "unknown" },
      { label: t("civilization.ruleLibrary.pdaReader.firstBytes"), value: toHex(data.slice(0, 32)) },
    ],
    rows: [],
  };
}

function renderStatusTabs() {
  if (!statusTabsTarget) return;
  statusTabsTarget.replaceChildren(
    ...ruleTargetStatuses.map((status) => {
      const button = document.createElement("button");
      button.className = "rule-filter-button";
      button.type = "button";
      button.dataset.active = String(state.status === status);
      button.textContent = t(`civilization.ruleLibrary.status.${status}`);
      button.addEventListener("click", () => {
        state.status = status;
        renderStatusTabs();
        renderRuleTargets();
      });
      return button;
    }),
  );
}

function renderModuleFilters() {
  if (!moduleFiltersTarget) return;
  const modules = ["all", ...ruleTargetModules];
  moduleFiltersTarget.replaceChildren(
    ...modules.map((module) => {
      const button = document.createElement("button");
      button.className = "rule-module-button";
      button.type = "button";
      button.dataset.active = String(state.module === module);
      button.textContent = module === "all" ? t("civilization.ruleLibrary.modules.all") : t(`civilization.ruleLibrary.modules.${module}`);
      button.addEventListener("click", () => {
        state.module = module;
        renderModuleFilters();
        renderRuleTargets();
      });
      return button;
    }),
  );
}

function renderRuleTargets() {
  if (!listTarget || !countTarget) return;
  const targets = filteredTargets();
  countTarget.textContent = t("civilization.ruleLibrary.library.count", {
    shown: targets.length,
    total: ruleTargets.length,
  });
  listTarget.replaceChildren(...targets.map(renderRuleTargetCard));
}

function renderRuleTargetCard(target) {
  const card = document.createElement("article");
  card.className = `rule-target-card ${target.status}`;
  const editableFields = target.editableFields.length ? target.editableFields : [t("civilization.ruleLibrary.library.noEditableFields")];
  card.innerHTML = `
    <div class="rule-target-topline">
      <div>
        <span class="rule-target-status">${t(`civilization.ruleLibrary.status.${target.status}`)}</span>
        <h3>${t(`civilization.ruleLibrary.targets.${target.id}.title`)}</h3>
      </div>
      <span class="rule-risk-pill ${target.risk}">${target.risk}</span>
    </div>
    <p class="rule-target-summary">${t(`civilization.ruleLibrary.targets.${target.id}.summary`)}</p>
    <div class="rule-target-meta">
      <span>${t("civilization.ruleLibrary.card.module")}: <strong>${t(`civilization.ruleLibrary.modules.${target.module}`)}</strong></span>
      <span>${t("civilization.ruleLibrary.card.pda")}: <code>${target.pda}</code></span>
      <span>${t("civilization.ruleLibrary.card.authority")}: <code>${target.authority}</code></span>
    </div>
    <div class="rule-target-columns">
      ${renderChipBlock("civilization.ruleLibrary.card.editableFields", editableFields)}
      ${renderChipBlock("civilization.ruleLibrary.card.validatorGates", target.validatorGates)}
      ${renderChipBlock("civilization.ruleLibrary.card.proofs", target.proofRefs)}
    </div>
    ${renderChainEvidence(target.chainEvidence)}
    ${renderPdaReader(target)}
    <div class="rule-target-actions">
      <button class="secondary-action rule-draft-button" type="button" data-draft-rule-target="${target.id}">${t("civilization.ruleLibrary.card.draftRule")}</button>
    </div>
    <details class="rule-pda-details">
      <summary>${t("civilization.ruleLibrary.card.pdaDetails")}</summary>
      <div class="rule-pda-detail-grid">
        <div>
          <span>${t("civilization.ruleLibrary.card.currentSource")}</span>
          <code>${target.currentSource}</code>
        </div>
        <div>
          <span>${t("civilization.ruleLibrary.card.pdaRefs")}</span>
          <code>${target.pdaRefs.join("\\n")}</code>
        </div>
      </div>
    </details>
  `;
  return card;
}

function renderPdaReader(target) {
  const pda = extractTargetPda(target);
  const read = state.pdaReads[target.id];
  const isLoading = read?.status === "loading";
  const buttonLabel = read?.status === "loaded"
    ? t("civilization.ruleLibrary.pdaReader.reload")
    : t("civilization.ruleLibrary.pdaReader.load");
  return `
    <div class="rule-live-pda-panel ${escapeHtml(read?.status || "idle")}">
      <div class="rule-live-pda-heading">
        <div>
          <span>${t("civilization.ruleLibrary.pdaReader.title")}</span>
          <strong>${pda ? escapeHtml(shortAddress(pda)) : t("civilization.ruleLibrary.pdaReader.unavailableTitle")}</strong>
        </div>
        <button class="secondary-action rule-live-pda-button" type="button" data-load-target-pda="${escapeHtml(target.id)}" ${!pda || isLoading ? "disabled" : ""}>
          ${isLoading ? t("civilization.ruleLibrary.pdaReader.loading") : buttonLabel}
        </button>
      </div>
      ${renderPdaReaderBody(target, pda, read)}
    </div>
  `;
}

function renderPdaReaderBody(target, pda, read) {
  if (!pda) {
    return `<p class="rule-live-pda-empty">${t("civilization.ruleLibrary.pdaReader.unavailableBody")}</p>`;
  }
  if (!read) {
    return `<p class="rule-live-pda-empty">${t("civilization.ruleLibrary.pdaReader.idle", { pda: shortAddress(pda) })}</p>`;
  }
  if (read.status === "loading") {
    return `<p class="rule-live-pda-empty">${t("civilization.ruleLibrary.pdaReader.loadingBody")}</p>`;
  }
  if (read.status === "error") {
    return `<p class="rule-live-pda-empty error">${t("civilization.ruleLibrary.pdaReader.failed", { reason: read.reason })}</p>`;
  }
  if (read.status === "missing") {
    return `<p class="rule-live-pda-empty error">${t("civilization.ruleLibrary.pdaReader.missing", { pda: shortAddress(pda) })}</p>`;
  }
  return renderLoadedPdaRead(target, read);
}

function renderLoadedPdaRead(_target, read) {
  const decoded = read.decoded;
  return `
    <div class="rule-live-pda-meta">
      <span><b>${t("civilization.ruleLibrary.pdaReader.pda")}</b><code>${escapeHtml(read.pda)}</code></span>
      <span><b>${t("civilization.ruleLibrary.pdaReader.owner")}</b><code>${escapeHtml(read.owner)}</code></span>
      <span><b>${t("civilization.ruleLibrary.pdaReader.lamports")}</b><code>${escapeHtml(String(read.lamports))}</code></span>
      <span><b>${t("civilization.ruleLibrary.pdaReader.bytes")}</b><code>${escapeHtml(String(read.bytes))}</code></span>
      <span><b>${t("civilization.ruleLibrary.pdaReader.slot")}</b><code>${escapeHtml(String(read.slot))}</code></span>
      <span><b>${t("civilization.ruleLibrary.pdaReader.dataHash")}</b><code>${escapeHtml(read.dataHash)}</code></span>
    </div>
    <div class="rule-live-pda-decoder">
      <div class="rule-live-pda-decoder-heading">
        <span>${t("civilization.ruleLibrary.pdaReader.decoded")}</span>
        <strong>${escapeHtml(decoded.kind)}</strong>
      </div>
      <div class="rule-live-pda-fields">
        ${decoded.fields.map((field) => `<span><b>${escapeHtml(field.label)}</b><code>${escapeHtml(String(field.value))}</code></span>`).join("")}
      </div>
      ${decoded.rows?.length ? `
        <div class="rule-live-pda-rows">
          ${decoded.rows.map((row) => `
            <article>
              <strong>${escapeHtml(row.title)}</strong>
              <div>
                ${row.fields.map((field) => `<span><b>${escapeHtml(field.label)}</b><code>${escapeHtml(String(field.value))}</code></span>`).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<p class="rule-live-pda-empty">${t("civilization.ruleLibrary.pdaReader.noRows")}</p>`}
    </div>
  `;
}

function renderChainEvidence(evidence) {
  if (!evidence) return "";
  const metricRows = evidence.metrics ?? [
    { label: t("civilization.ruleLibrary.card.testRecipe"), value: `${evidence.testTableId}:${evidence.testRecipeId}` },
    { label: t("civilization.ruleLibrary.card.recipeTable"), value: evidence.recipeTablePda },
    { label: t("civilization.ruleLibrary.card.executionState"), value: `${evidence.ruleStatus} / tally=${evidence.tallyThresholdMet} / receipt=${evidence.receiptExecuted}` },
    { label: t("civilization.ruleLibrary.card.writtenYield"), value: String(evidence.writtenYieldBps) },
    { label: t("civilization.ruleLibrary.card.updatedSlot"), value: String(evidence.updatedSlot ?? "") },
  ];
  const txRows = (evidence.transactions ?? []).map((tx) => `
    <a href="https://explorer.solana.com/tx/${escapeHtml(tx.signature)}?cluster=devnet" target="_blank" rel="noreferrer">
      <span>${escapeHtml(tx.phase)}</span>
      <code>${escapeHtml(tx.signature)}</code>
    </a>
  `).join("");
  return `
    <div class="rule-chain-evidence">
      <div class="rule-chain-evidence-heading">
        <span>${t("civilization.ruleLibrary.card.chainEvidence")}</span>
        <strong>${escapeHtml(evidence.status)}</strong>
      </div>
      <div class="rule-chain-evidence-grid">
        <span><b>${t("civilization.ruleLibrary.card.verifiedAt")}</b><code>${escapeHtml(evidence.verifiedAt)}</code></span>
        <span><b>${t("civilization.ruleLibrary.card.patchBytes")}</b><code>${escapeHtml(String(evidence.compactPatchBytes))}</code></span>
        <span><b>${t("civilization.ruleLibrary.card.adapterBytes")}</b><code>${escapeHtml(String(evidence.adapterInstructionBytes))}</code></span>
        ${metricRows.map((row) => `<span><b>${escapeHtml(row.label)}</b><code>${escapeHtml(row.value)}</code></span>`).join("")}
      </div>
      <div class="rule-chain-evidence-txs">${txRows}</div>
    </div>
  `;
}

function renderChipBlock(titleKey, values) {
  return `
    <div class="rule-chip-block">
      <span>${t(titleKey)}</span>
      <div>
        ${values.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}
      </div>
    </div>
  `;
}

function filteredTargets() {
  return ruleTargets.filter((target) => {
    if (target.status !== state.status) return false;
    if (state.module !== "all" && target.module !== state.module) return false;
    if (!state.query) return true;
    const haystack = [
      target.id,
      target.status,
      target.module,
      target.pda,
      target.authority,
      target.currentSource,
      ...target.proofRefs,
      ...target.editableFields,
      ...target.validatorGates,
      ...target.pdaRefs,
      t(`civilization.ruleLibrary.targets.${target.id}.title`),
      t(`civilization.ruleLibrary.targets.${target.id}.summary`),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query);
  });
}

function updateComposerOptions() {
  if (!moduleSelect || !pdaSelect) return;
  const currentModule = moduleSelect.value || "smelting";
  moduleSelect.replaceChildren(
    ...ruleTargetModules.map((module) => {
      const option = document.createElement("option");
      option.value = module;
      option.textContent = t(`civilization.ruleLibrary.modules.${module}`);
      return option;
    }),
  );
  moduleSelect.value = ruleTargetModules.includes(currentModule) ? currentModule : "smelting";
  updatePdaOptions();
}

function updatePdaOptions() {
  if (!moduleSelect || !pdaSelect) return;
  const selectedModule = moduleSelect.value;
  const targets = ruleTargets.filter((target) => target.module === selectedModule);
  const currentTargetId = pdaSelect.value;
  pdaSelect.replaceChildren(
    ...targets.map((target) => {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = `${target.pda} - ${t(`civilization.ruleLibrary.targets.${target.id}.title`)}`;
      return option;
    }),
  );
  if (targets.some((target) => target.id === currentTargetId)) pdaSelect.value = currentTargetId;
  else if (targets[0]) pdaSelect.value = targets[0].id;
}

function renderRulePreview({ preferProposal = false } = {}) {
  if (!composerForm || !previewTarget) return;
  if (preferProposal && state.proposalEnvelope) {
    previewTarget.textContent = JSON.stringify(state.proposalEnvelope, null, 2);
    renderPowerThreshold({
      threshold_path: state.proposalEnvelope.readable?.threshold_path,
      signature_side: state.proposalEnvelope.civilization_power_snapshot?.signature_side,
      civilization_power_snapshot: state.proposalEnvelope.civilization_power_snapshot,
    });
    return;
  }
  const preview = buildProposalDraft();
  previewTarget.textContent = JSON.stringify(preview, null, 2);
  renderPowerThreshold(preview);
}

function buildProposalDraft() {
  const form = new FormData(composerForm);
  const targetId = String(form.get("pda") ?? "");
  const target = ruleTargets.find((item) => item.id === targetId) ?? ruleTargets[0];
  const thresholdPath = String(form.get("threshold") ?? "");
  const signatureSide = String(form.get("signatureSide") ?? "agree");
  const baseSnapshot = buildCivilizationPowerSnapshot(form);
  const snapshot = {
    ...baseSnapshot,
    threshold_bps: thresholdBpsForPath(thresholdPath),
    ...thresholdRequirement(baseSnapshot.total_active_power, thresholdPath),
    signature_side: signatureSide,
  };
  const targetProgram = targetProgramIds[target?.module] || targetProgramIds.civic;
  const targetPdaAddress = extractTargetPda(target);
  return {
    rule_book_pda: "future_rule_book_pda",
    title: String(form.get("title") ?? ""),
    target_module: String(form.get("module") ?? ""),
    target_program: targetProgram,
    target_pda: targetPdaAddress || target?.pda || "",
    target_pda_address: targetPdaAddress,
    target_pda_label: target?.pda ?? "",
    target_id: target?.id ?? "",
    target_status: target?.status ?? "",
    patch_type: String(form.get("patchType") ?? ""),
    old_value_hash: String(form.get("oldHash") ?? ""),
    proposed_value: parseMaybeJson(String(form.get("proposedValue") ?? "")),
    risk_level: String(form.get("risk") ?? ""),
    threshold_path: thresholdPath,
    challenge_window: String(form.get("challengeWindow") ?? ""),
    signature_side: signatureSide,
    civilization_power_snapshot: snapshot,
    validator_gates: String(form.get("validatorGates") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    public_receipts: ["text_hash", "patch_hash", "power_snapshot_pda", "RuleExecuted|RuleRejected"],
  };
}

async function validateProposal() {
  state.draftDirtyAfterProof = false;
  const draft = buildProposalDraft();
  const target = ruleTargets.find((item) => item.id === draft.target_id);
  const messages = [];
  let ok = true;

  if (!draft.title.trim()) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.titleRequired"));
  }
  if (!target) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.targetRequired"));
  }
  if (!String(draft.old_value_hash).startsWith("sha256:")) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.oldHashRequired"));
  }
  if (!isJsonText(String(new FormData(composerForm).get("proposedValue") ?? ""))) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.proposedJsonRequired"));
  }
  if (!draft.validator_gates.length) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.gatesRequired"));
  }
  if (!Number.isFinite(draft.civilization_power_snapshot.total_active_power) || draft.civilization_power_snapshot.total_active_power <= 0) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.totalPowerRequired"));
  }
  if (!Number.isFinite(draft.civilization_power_snapshot.signer_snapshot_power) || draft.civilization_power_snapshot.signer_snapshot_power <= 0) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.signerPowerRequired"));
  }
  if (draft.civilization_power_snapshot.signer_snapshot_power > draft.civilization_power_snapshot.total_active_power) {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.signerPowerTooHigh"));
  }
  if (target?.status === "adapter") {
    messages.push(t("civilization.ruleLibrary.validation.adapterRequired"));
  }
  if ((target?.status === "readonly" || target?.status === "protected") && draft.patch_type !== "read_only_challenge") {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.readOnlyRequiresChallenge"));
  }
  if (target?.status === "protected" && draft.threshold_path !== "natural_90" && draft.threshold_path !== "reject") {
    ok = false;
    messages.push(t("civilization.ruleLibrary.validation.protectedThreshold"));
  }

  let proposal = null;
  try {
    proposal = await buildProposalEnvelope(draft, target);
  } catch (error) {
    ok = false;
    messages.push(error?.message || t("civilization.ruleLibrary.validation.proposedJsonRequired"));
  }
  state.proposalEnvelope = ok ? proposal : null;
  state.validation = { ok, messages, targetStatus: target?.status ?? "unknown" };
  state.signedProof = null;
  state.deployPacket = null;
  state.sourceDeployPacket = null;
  state.chainPlan = null;
  if (previewTarget && proposal) previewTarget.textContent = JSON.stringify(proposal, null, 2);
  renderFlowState();
  renderDeploymentReadiness();
  renderDeployPacket();
  renderChainPlan();
  return { ok, messages: messages.length ? messages : [t("civilization.ruleLibrary.validation.passed")] };
}

async function buildProposalEnvelope(draft, target) {
  const targetPatch = await buildTargetPatchBinding(draft, target);
  const targetProgram = targetProgramIds[target?.module] || targetProgramIds.civic;
  const targetPdaAddress = extractTargetPda(target);
  const targetRefs = {
    target_id: draft.target_id,
    target_module: draft.target_module,
    target_status: target?.status ?? "unknown",
    target_program: targetProgram,
    target_pda: targetPdaAddress || draft.target_pda,
    target_pda_address: targetPdaAddress,
    target_pda_label: target?.pda ?? "",
    pda_refs: target?.pdaRefs ?? [],
    current_source: target?.currentSource ?? "",
    proof_refs: target?.proofRefs ?? [],
  };
  const patch = {
    target_module: draft.target_module,
    target_program: targetProgram,
    target_pda: targetRefs.target_pda,
    target_pda_address: targetPdaAddress,
    target_pda_label: target?.pda ?? "",
    target_id: draft.target_id,
    patch_type: draft.patch_type,
    old_value_hash: draft.old_value_hash,
    proposed_value: draft.proposed_value,
    validator_gates: draft.validator_gates,
    ...(targetPatch.patchMetadata ? { target_adapter_patch: targetPatch.patchMetadata } : {}),
  };
  const snapshot = {
    ...draft.civilization_power_snapshot,
    threshold_bps: thresholdBpsForPath(draft.threshold_path),
    ...thresholdRequirement(draft.civilization_power_snapshot.total_active_power, draft.threshold_path),
    signature_side: draft.signature_side,
  };
  const readable = {
    title: draft.title,
    risk_level: draft.risk_level,
    threshold_path: draft.threshold_path,
    challenge_window: draft.challenge_window,
    target_status: target?.status ?? "unknown",
    target_authority: target?.authority ?? "",
    target_program: targetProgram,
    target_pda: targetRefs.target_pda,
    target_pda_label: target?.pda ?? "",
  };
  const patchCanonical = stableJsonStringify(patch);
  const readableCanonical = stableJsonStringify(readable);
  const snapshotCanonical = stableJsonStringify(snapshot);
  const targetRefsCanonical = stableJsonStringify(targetRefs);
  const patchHash = targetPatch.patchHash ?? `sha256:${await sha256Hex(patchCanonical)}`;
  const textHash = `sha256:${await sha256Hex(readableCanonical)}`;
  const snapshotHash = `sha256:${await sha256Hex(snapshotCanonical)}`;
  const targetRefHash = `sha256:${await sha256Hex(targetRefsCanonical)}`;
  const ruleIdHash = `sha256:${await sha256Hex(`${textHash}:${patchHash}:${snapshotHash}:${targetRefHash}`)}`;
  const ruleId = `civ_rule_${ruleIdHash.slice(7, 27)}`;
  const derivedPdas = deriveDeploymentPdas({
    ruleIdHash,
    targetProgram,
    targetPdaAddress: targetRefs.target_pda,
    snapshotHash,
  });
  return {
    kind: "nicechunk.civilization.rule_book.v1",
    rule_id: ruleId,
    rule_id_hash: ruleIdHash,
    rule_book_pda: derivedPdas.rule_book_pda,
    text_hash: textHash,
    patch_hash: patchHash,
    snapshot_hash: snapshotHash,
    target_ref_hash: targetRefHash,
    readable,
    patch,
    civilization_power_snapshot: snapshot,
    target_refs: targetRefs,
    lifecycle: {
      status: "draft_validated",
      next: "wallet_signature",
    },
  };
}

async function buildTargetPatchBinding(draft, target) {
  if (target?.id === "smelting-recipes") {
    const recipe = buildSmeltingRecipeFromPatch(draft.proposed_value);
    const patchBytes = encodeCivilizationSmeltingRecipePatch(recipe);
    return {
      patchHash: `sha256:${await sha256HexBytes(patchBytes)}`,
      patchMetadata: {
        adapter_instruction: "apply_civilization_recipe_receipt",
        sdk_builder: "createApplyCivilizationSmeltingRecipeInstruction",
        byte_encoding: "encodeSmeltingRecipeArgs",
        hash_preimage: "raw_smelting_recipe_bytes",
        data_len: patchBytes.length,
        data_hex: patchBytes.toString("hex"),
        recipe_id: String(recipe.recipeId),
      },
    };
  }
  if (target?.id === "resource-drops") {
    const rules = buildResourceDropRulesFromPatch(draft.proposed_value);
    const patchBytes = encodeCivilizationResourceDropRulesPatch(rules);
    return {
      patchHash: `sha256:${await sha256HexBytes(patchBytes)}`,
      patchMetadata: {
        adapter_instruction: "apply_civilization_resource_drop_receipt",
        sdk_builder: "createApplyCivilizationResourceDropRulesInstruction",
        byte_encoding: "encodeCivilizationResourceDropRulesPatch",
        hash_preimage: "raw_resource_drop_table_bytes",
        data_len: patchBytes.length,
        data_hex: patchBytes.toString("hex"),
        rule_count: rules.length,
      },
    };
  }
  return {};
}

function buildSmeltingRecipeFromPatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Smelting recipe patch must be a JSON object with recipe_id, inputs, and outputs.");
  }
  const recipeId = value.recipeId ?? value.recipe_id;
  if (recipeId == null || !String(recipeId).trim()) {
    throw new Error("Smelting recipe patch requires recipe_id.");
  }
  const inputs = Array.isArray(value.inputs) ? value.inputs.map(normalizeBackpackSlotPatch) : [];
  const outputs = Array.isArray(value.outputs) ? value.outputs.map(normalizeBackpackSlotPatch) : [];
  if (!inputs.length || !outputs.length) {
    throw new Error("Smelting recipe patch requires at least one input and one output slot.");
  }
  return {
    recipeId,
    enabled: value.enabled !== false,
    minHeatTier: clampInteger(value.minHeatTier ?? value.min_heat_tier ?? value.requiredHeatTier ?? value.required_heat_tier, 1, 255, 1),
    yieldBps: clampInteger(value.yieldBps ?? value.yield_bps, 1, 10_000, 10_000),
    inputs,
    outputs,
  };
}

function normalizeBackpackSlotPatch(slot) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    throw new Error("Recipe input/output slots must be JSON objects.");
  }
  const kindValue = slot.kind ?? slot.type;
  const kind = kindValue === "item" || kindValue === 2 ? 2 : 1;
  const itemPdaValue = slot.itemPda ?? slot.item_pda;
  return {
    kind,
    category: positiveIntegerAllowZero(slot.category ?? (kind === 2 ? 1 : 0), 0),
    flags: positiveIntegerAllowZero(slot.flags, 0),
    quantity: positiveInteger(slot.quantity, 1),
    resource: normalizeResourcePatch(slot.resource),
    itemCode: positiveIntegerAllowZero(slot.itemCode ?? slot.item_code, 0),
    itemId: slot.itemId ?? slot.item_id ?? 0,
    itemPda: itemPdaValue ? new PublicKey(itemPdaValue) : PublicKey.default,
    volumeMm3: positiveIntegerAllowZero(slot.volumeMm3 ?? slot.volume_mm3, 0),
    durabilityCurrent: positiveIntegerAllowZero(slot.durabilityCurrent ?? slot.durability_current, 0),
    durabilityMax: positiveIntegerAllowZero(slot.durabilityMax ?? slot.durability_max, 0),
    grade: positiveIntegerAllowZero(slot.grade, 0),
    itemLevel: positiveIntegerAllowZero(slot.itemLevel ?? slot.item_level, 0),
    qualityBps: positiveIntegerAllowZero(slot.qualityBps ?? slot.quality_bps, 0),
    metadata: positiveIntegerAllowZero(slot.metadata, 0),
  };
}

function normalizeResourcePatch(resource) {
  const value = resource && typeof resource === "object" ? resource : {};
  return {
    worldX: Math.trunc(Number(value.worldX ?? value.world_x ?? 0)) || 0,
    worldY: Math.trunc(Number(value.worldY ?? value.world_y ?? 0)) || 0,
    worldZ: Math.trunc(Number(value.worldZ ?? value.world_z ?? 0)) || 0,
  };
}

function buildResourceDropRulesFromPatch(value) {
  const source = Array.isArray(value) ? value : value?.rules;
  if (!Array.isArray(source)) {
    throw new Error("Resource drop patch must be a JSON array or an object with rules[].");
  }
  if (source.length !== resourceDropRules.length) {
    throw new Error(`Resource drop patch must replace exactly ${resourceDropRules.length} rules.`);
  }
  return source.map(normalizeResourceDropRulePatch);
}

function normalizeResourceDropRulePatch(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error("Resource drop rule entries must be JSON objects.");
  }
  return {
    sourceBlockId: clampInteger(rule.sourceBlockId ?? rule.source_block_id, 0, 0xffff, 0),
    dropBlockId: clampInteger(rule.dropBlockId ?? rule.drop_block_id, 0, 0xffff, 0),
    chanceBps: clampInteger(rule.chanceBps ?? rule.chance_bps, 0, 10_000, 0),
    minAltitude: clampInteger(rule.minAltitude ?? rule.min_altitude, -0x8000, 0x7fff, -0x8000),
    maxAltitude: clampInteger(rule.maxAltitude ?? rule.max_altitude, -0x8000, 0x7fff, 0x7fff),
    minDepth: clampInteger(rule.minDepth ?? rule.min_depth, -0x8000, 0x7fff, 0),
    maxDepth: clampInteger(rule.maxDepth ?? rule.max_depth, -0x8000, 0x7fff, 0x7fff),
    salt: clampInteger(rule.salt, 0, 0xff, 0),
    minVolumeMm3: clampInteger(rule.minVolumeMm3 ?? rule.min_volume_mm3, 0, 0xffffffff, 1),
    maxVolumeMm3: clampInteger(rule.maxVolumeMm3 ?? rule.max_volume_mm3, 0, 0xffffffff, 1),
  };
}

async function signProposal() {
  const validation = await ensureValidatedProposal();
  if (!validation.ok) return { ok: false, message: validation.messages.join(" ") };
  const oldHashPreflight = await verifyProposalOldValueHashBeforeSign(state.proposalEnvelope, { context: "sign" });
  if (!oldHashPreflight.ok) return oldHashPreflight;
  const provider = await getSigningProvider();
  if (!provider.ok) return provider;
  const message = buildSigningMessage(state.proposalEnvelope);
  try {
    const encoded = new TextEncoder().encode(message);
    const result = await provider.provider.signMessage(encoded, "utf8");
    const signatureBytes = result?.signature ?? result;
    if (!signatureBytes?.length) throw new Error("Missing signature");
    const signer = publicKeyToString(result?.publicKey || provider.provider.publicKey);
    const messageHash = `sha256:${await sha256HexBytes(encoded)}`;
    const signatureBytesArray = signatureBytes instanceof Uint8Array ? signatureBytes : new Uint8Array(signatureBytes);
    const signatureVerified = verifyEd25519Signature({
      signer,
      message,
      signatureBytes: signatureBytesArray,
    });
    if (!signatureVerified) throw new Error("Wallet signature could not be verified against the signer public key.");
    const derivedPdas = deriveDeploymentPdas({
      ruleIdHash: state.proposalEnvelope.rule_id_hash,
      signer,
      targetProgram: state.proposalEnvelope.target_refs?.target_program || state.proposalEnvelope.patch?.target_program,
      targetPdaAddress: state.proposalEnvelope.target_refs?.target_pda || state.proposalEnvelope.patch?.target_pda,
      snapshotHash: state.proposalEnvelope.snapshot_hash,
    });
    state.signedProof = {
      kind: "nicechunk.civilization.rule_signature.v1",
      rule_id: state.proposalEnvelope.rule_id,
      signer,
      rule_signature_pda: derivedPdas.rule_signature_pda,
      citizen_power_pda: derivedPdas.citizen_power_pda,
      side: state.proposalEnvelope.civilization_power_snapshot.signature_side,
      snapshot_power: state.proposalEnvelope.civilization_power_snapshot.signer_snapshot_power,
      snapshot_hash: state.proposalEnvelope.snapshot_hash,
      wallet_name: provider.name,
      signed_at: new Date().toISOString(),
      message,
      message_hash: messageHash,
      old_value_preflight: oldHashPreflight.proof,
      signature_base64: bytesToBase64(signatureBytesArray),
      signature_verified: signatureVerified,
      signature_verified_at: new Date().toISOString(),
    };
    state.deployPacket = null;
    state.chainPlan = null;
    renderFlowState();
    renderDeploymentReadiness();
    renderFinalizeSignatureCollector();
    renderDeployPacket();
    renderChainPlan();
    return { ok: true, message: t("civilization.ruleLibrary.flow.signed", { signer: shortAddress(signer) }) };
  } catch (error) {
    return { ok: false, message: t("civilization.ruleLibrary.flow.signFailed", { reason: error?.message ?? "wallet rejected" }) };
  }
}

async function verifyProposalOldValueHashBeforeSign(proposal, { context = "sign" } = {}) {
  const isDeploy = context === "deploy";
  const target = ruleTargets.find((item) => item.id === proposal?.patch?.target_id);
  if (!target || target.status !== "governable") {
    return {
      ok: true,
      proof: {
        kind: "nicechunk.civilization.old_value_preflight.v1",
        status: "skipped",
        reason: "target is not a live governable PDA",
        context,
        target_id: target?.id || proposal?.patch?.target_id || "",
      },
    };
  }
  const targetPda = proposal?.target_refs?.target_pda || proposal?.patch?.target_pda || extractTargetPda(target);
  const expectedOldHash = String(proposal?.patch?.old_value_hash || "");
  if (!targetPda) {
    const message = t("civilization.ruleLibrary.form.oldHashMissingTarget");
    setOldValueHashStatus("warning", message);
    return { ok: false, message };
  }

  setOldValueHashStatus("loading", t(isDeploy ? "civilization.ruleLibrary.flow.oldHashDeployPreflight" : "civilization.ruleLibrary.flow.oldHashPreflight"));
  try {
    const result = await readPdaAccountWithFallback(new PublicKey(targetPda));
    const account = result.value;
    if (!account) {
      const message = t("civilization.ruleLibrary.form.oldHashAccountMissing", { pda: shortAddress(targetPda) });
      setOldValueHashStatus("warning", message);
      return { ok: false, message };
    }
    const data = new Uint8Array(account.data);
    const dataHash = `sha256:${await sha256HexBytes(data)}`;
    const proof = {
      kind: "nicechunk.civilization.old_value_preflight.v1",
      status: expectedOldHash === dataHash ? "verified" : "stale",
      context,
      target_id: target.id,
      target_pda: targetPda,
      expected_old_value_hash: expectedOldHash,
      live_old_value_hash: dataHash,
      read_slot: result.context.slot,
      bytes: data.length,
      owner: account.owner.toBase58(),
    };
    state.pdaReads[target.id] = {
      status: "loaded",
      pda: targetPda,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      slot: result.context.slot,
      dataHash,
      decoded: decodeTargetPdaData(target, data),
    };
    renderRuleTargets();
    if (expectedOldHash !== dataHash) {
      const message = t(isDeploy ? "civilization.ruleLibrary.flow.oldHashDeployStale" : "civilization.ruleLibrary.flow.oldHashStale", {
        expected: shortHash(expectedOldHash),
        live: shortHash(dataHash),
      });
      setOldValueHashStatus("error", message);
      return { ok: false, message, proof };
    }
    const message = t(isDeploy ? "civilization.ruleLibrary.flow.oldHashDeployVerified" : "civilization.ruleLibrary.flow.oldHashVerified", {
      hash: shortHash(dataHash),
      slot: result.context.slot,
    });
    setOldValueHashStatus("success", message);
    return { ok: true, proof, message };
  } catch (error) {
    const reason = error?.message || String(error);
    const message = t(isDeploy ? "civilization.ruleLibrary.flow.oldHashDeployPreflightFailed" : "civilization.ruleLibrary.flow.oldHashPreflightFailed", { reason });
    setOldValueHashStatus("error", message);
    return { ok: false, message };
  }
}

async function stageDeployPacket() {
  const validation = await ensureValidatedProposal();
  if (!validation.ok) return { ok: false, message: validation.messages.join(" ") };
  if (!state.signedProof) return { ok: false, message: t("civilization.ruleLibrary.flow.signBeforeStage") };
  const signedProofCheck = await verifySignedProofForProposal({
    proposal: state.proposalEnvelope,
    signedProof: state.signedProof,
  });
  if (!signedProofCheck.ok) return signedProofCheck;
  state.signedProof = signedProofCheck.signedProof;
  const deployOldHashPreflight = await verifyProposalOldValueHashBeforeSign(state.proposalEnvelope, { context: "deploy" });
  if (!deployOldHashPreflight.ok) return deployOldHashPreflight;
  const targetStatus = state.validation?.targetStatus;
  const deployStatus = targetStatus === "governable"
    ? "ready_for_civilization_program_submit"
    : targetStatus === "adapter"
      ? "blocked_until_contract_adapter_exists"
      : "challenge_or_read_only_evidence_packet";
  const derivedPdas = deriveDeploymentPdas({
    ruleIdHash: state.proposalEnvelope.rule_id_hash,
    signer: state.signedProof.signer,
    targetProgram: state.proposalEnvelope.target_refs?.target_program || state.proposalEnvelope.patch?.target_program,
    targetPdaAddress: state.proposalEnvelope.target_refs?.target_pda || state.proposalEnvelope.patch?.target_pda,
    snapshotHash: state.proposalEnvelope.snapshot_hash,
  });
  state.proposalEnvelope = {
    ...state.proposalEnvelope,
    rule_book_pda: derivedPdas.rule_book_pda,
  };
  state.signedProof = {
    ...state.signedProof,
    rule_signature_pda: derivedPdas.rule_signature_pda,
  };
  const signatureCollection = await buildDeploySignatureCollection();
  if (!signatureCollection.ok) return signatureCollection;
  const lineage = await buildDeployPacketLineage({
    sourcePacket: state.sourceDeployPacket,
    signatureCollection: signatureCollection.collection,
  });
  state.deployPacket = {
    kind: "nicechunk.civilization.deploy_packet.v1",
    deploy_status: deployStatus,
    staged_at: new Date().toISOString(),
    derived_pdas: derivedPdas,
    rule_book: state.proposalEnvelope,
    signature: state.signedProof,
    deploy_old_value_preflight: deployOldHashPreflight.proof,
    signature_collection: signatureCollection.collection,
    lineage,
    threshold_result: buildThresholdResult(state.proposalEnvelope, state.signedProof),
    execution_hint: {
      civilization_program_id: civilizationProgramId,
      civilization_program_status: "deployed_on_devnet",
      civilization_program_explorer_url: civilizationProgramExplorerUrl,
      sdk_module: "sdk/nicechunk-civilization.ts",
      publish_instruction: "createPublishCivilizationRuleInstruction",
      sign_instruction: "createSignCivilizationRuleInstruction",
      finalize_instruction: "createFinalizeCivilizationRuleInstruction",
      execute_receipt_instruction: "createExecuteCivilizationRuleReceiptInstruction",
      target_adapter_instruction: targetStatus === "governable"
        ? targetAdapterBuilderName(state.proposalEnvelope.patch.target_id)
        : "target_adapter_required",
      pda_seeds: {
        rule_book_pda: ["rule-book", "rule_id_hash"],
        rule_signature_pda: ["rule-signature", "rule_book_pda", "signer"],
        power_snapshot_pda: ["power-snapshot", "snapshot_hash"],
        citizen_power_pda: ["citizen-power", "power_snapshot_pda", "signer"],
        rule_tally_pda: ["rule-tally", "rule_book_pda"],
        execution_receipt_pda: ["rule-execution", "rule_book_pda"],
        adapter_authority_pda: ["civilization-adapter", "rule_book_pda", "target_program"],
      },
      pda_addresses: {
        rule_book_pda: derivedPdas.rule_book_pda,
        rule_signature_pda: derivedPdas.rule_signature_pda,
        power_snapshot_pda: derivedPdas.power_snapshot_pda,
        citizen_power_pda: derivedPdas.citizen_power_pda,
        rule_tally_pda: derivedPdas.rule_tally_pda,
        execution_receipt_pda: derivedPdas.execution_receipt_pda,
        adapter_authority_pda: derivedPdas.adapter_authority_pda,
        target_program: derivedPdas.target_program,
        target_pda: derivedPdas.target_pda,
      },
      current_chain_status: targetStatus === "governable"
        ? "devnet_civilization_program_live_receipt_submit_ready"
        : deployStatus,
    },
  };
  state.deployPacket.lineage.current_deploy_packet_hash = await deployPacketContentHash(state.deployPacket);
  state.deployPacket.local_audit = await buildLocalDeployPacketAudit(state.deployPacket, { includeReadiness: true });
  state.sourceDeployPacket = state.deployPacket;
  state.chainPlan = null;
  persistDeployPacket(state.deployPacket);
  renderFlowState();
  renderDeploymentReadiness();
  renderFinalizeSignatureCollector();
  renderDeployPacket();
  renderDeployHistory();
  renderChainPlan();
  return { ok: true, message: t("civilization.ruleLibrary.flow.staged") };
}

async function buildRuleChainPlan() {
  try {
    const context = await buildRuleChainContext({ requireTargetPda: true });
    if (!context.ok) return context;
    const { payer, target, targetProgram, targetPdaKey, ruleBook, signaturePda } = context;
    const publication = await readRuleBookPublicationProof({ ruleBook });
    if (!publication.ok) throw new Error(publication.message);
    const signatureProof = await readCurrentSignatureProof({ ruleBook, signaturePda, signer: payer });
    if (!signatureProof.ok) {
      state.chainPlan = buildBlockedChainPlan(target, signatureProof.message, {
        phase: "publish_sign",
        status: signatureProof.status,
        rule_id: state.proposalEnvelope.rule_id,
        rule_id_hash: state.proposalEnvelope.rule_id_hash,
        payer: payer.toBase58(),
        rule_book_pda: ruleBook.toBase58(),
        rule_signature_pda: signaturePda.toBase58(),
        publish_mode: publication.exists ? "sign_existing_rule" : "publish_and_sign_rule",
        publication_proof: publication.proof,
        signature_proof: signatureProof.proof,
      });
      renderChainPlan();
      return { ok: false, message: signatureProof.message };
    }
    const side = sideCode(state.proposalEnvelope.civilization_power_snapshot.signature_side);
    const instructions = [];
    const powerReadiness = await readCivilizationPowerReadiness({ payer });
    if (!powerReadiness.ok) {
      state.chainPlan = buildBlockedChainPlan(target, powerReadiness.message, {
        phase: "publish_sign",
        status: powerReadiness.status,
        rule_id: state.proposalEnvelope.rule_id,
        rule_id_hash: state.proposalEnvelope.rule_id_hash,
        payer: payer.toBase58(),
        rule_book_pda: ruleBook.toBase58(),
        rule_signature_pda: signaturePda.toBase58(),
        civilization_power_accounts: [powerReadiness.proof],
      });
      renderChainPlan();
      return { ok: false, message: powerReadiness.message };
    }
    const powerInstructions = await buildCivilizationPowerInstructions({ payer, readiness: powerReadiness });
    instructions.push(...powerInstructions.map((item) => describeInstruction(item.label, item.ix)));
    if (!publication.exists) {
      instructions.push(describeInstruction("publish_rule_book", createPublishCivilizationRuleInstruction({
        payer,
        ruleIdHash: state.proposalEnvelope.rule_id_hash,
        textHash: state.proposalEnvelope.text_hash,
        patchHash: state.proposalEnvelope.patch_hash,
        snapshotHash: state.proposalEnvelope.snapshot_hash,
        targetProgram,
        targetPda: targetPdaKey,
        totalActivePower: state.proposalEnvelope.civilization_power_snapshot.total_active_power,
        thresholdBps: state.proposalEnvelope.civilization_power_snapshot.threshold_bps,
        targetStatus: targetStatusCode(target?.status),
        riskLevel: riskLevelCode(state.proposalEnvelope.readable.risk_level),
      })));
    }
    const signIx = createSignCivilizationRuleInstruction({
      signer: payer,
      ruleBook,
      snapshotHash: state.proposalEnvelope.snapshot_hash,
      side,
      snapshotPower: state.proposalEnvelope.civilization_power_snapshot.signer_snapshot_power,
    });
    instructions.push(describeInstruction("sign_rule", signIx));
    state.chainPlan = {
      kind: "nicechunk.civilization.chain_plan.v1",
      phase: "publish_sign",
      status: "ready_to_submit",
      cluster: "devnet",
      rpc_url: getNicechunkRpcUrl(),
      rule_id: state.proposalEnvelope.rule_id,
      rule_id_hash: state.proposalEnvelope.rule_id_hash,
      payer: payer.toBase58(),
      target_program: targetProgram.toBase58(),
      target_pda: targetPdaKey.toBase58(),
      rule_book_pda: ruleBook.toBase58(),
      rule_signature_pda: signaturePda.toBase58(),
      publish_mode: publication.exists ? "sign_existing_rule" : "publish_and_sign_rule",
      publication_proof: publication.proof,
      signature_proof: signatureProof.proof,
      instructions,
      civilization_power_accounts: [
        powerReadiness.proof,
        ...powerInstructions.map((item) => item.proof),
      ],
      next_phase: "finalize_tally",
      threshold_result: state.deployPacket?.threshold_result,
      note: publication.exists
        ? "The rule book PDA already exists and matches this deploy packet, so this transaction only writes this signer's rule signature PDA."
        : "This transaction writes the rule book PDA and this signer's rule signature PDA. It does not mutate the target gameplay PDA.",
    };
    await sealChainPlan();
    renderChainPlan();
    const simulation = await attachPreSubmitSimulation({ phase: "publish_sign", payer });
    if (!simulation.ok && simulation.blockSubmit) return simulation;
    renderChainPlan();
    return { ok: true, message: t("civilization.ruleLibrary.chain.built") };
  } catch (error) {
    const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
    state.chainPlan = buildBlockedChainPlan(target, error?.message || "invalid chain plan", { phase: "publish_sign" });
    renderChainPlan();
    return { ok: false, message: t("civilization.ruleLibrary.chain.buildFailed", { reason: error?.message || "invalid chain plan" }) };
  }
}

async function buildCivilizationPowerInstructions({ payer, readiness = null }) {
  const proposal = state.proposalEnvelope;
  const snapshot = proposal?.civilization_power_snapshot || {};
  const powerReadiness = readiness ?? await readCivilizationPowerReadiness({ payer });
  if (!powerReadiness.ok) throw new Error(powerReadiness.message);
  const powerSnapshot = new PublicKey(powerReadiness.power_snapshot_pda);
  const citizenPower = new PublicKey(powerReadiness.citizen_power_pda);
  const instructions = [];
  if (powerReadiness.can_publish_snapshot) {
    instructions.push({
      label: "publish_power_snapshot",
      ix: createPublishPowerSnapshotInstruction({
        authority: payer,
        snapshotHash: proposal.snapshot_hash,
        totalActivePower: snapshot.total_active_power,
        windowStartEpoch: dateEpoch(snapshot.window_start),
        windowEndEpoch: dateEpoch(snapshot.window_end),
        expiresAt: Math.floor(Date.now() / 1000) + positiveInteger(snapshot.validity_days, 30) * 86_400,
      }),
      proof: {
        account: "power_snapshot_pda",
        pda: powerSnapshot.toBase58(),
        status: "create_if_missing",
        snapshot_hash: proposal.snapshot_hash,
        total_active_power: snapshot.total_active_power,
        trusted_power_authority: civilizationPowerAuthority,
      },
    });
  }
  if (powerReadiness.can_settle_citizen_power) {
    instructions.push({
      label: "settle_citizen_power",
      ix: createSettleCitizenPowerInstruction({
        authority: payer,
        powerSnapshot,
        citizen: payer,
        power: snapshot.signer_snapshot_power,
      }),
      proof: {
        account: "citizen_power_pda",
        pda: citizenPower.toBase58(),
        status: "create_if_missing",
        snapshot_hash: proposal.snapshot_hash,
        signer: payer.toBase58(),
        snapshot_power: snapshot.signer_snapshot_power,
        trusted_power_authority: civilizationPowerAuthority,
      },
    });
  }
  return instructions;
}

async function readCivilizationPowerReadiness({ payer }) {
  const proposal = state.proposalEnvelope;
  const [powerSnapshot] = derivePowerSnapshotPda({ snapshotHash: proposal.snapshot_hash });
  const [citizenPower] = deriveCitizenPowerPda({ powerSnapshot, citizen: payer });
  const payerIsPowerAuthority = payer.toBase58() === civilizationPowerAuthority;
  const [snapshotAccount, citizenAccount] = await Promise.all([
    readAccountMaybe(powerSnapshot),
    readAccountMaybe(citizenPower),
  ]);
  const snapshotProof = accountReadinessProof({
    account: "power_snapshot_pda",
    pubkey: powerSnapshot,
    read: snapshotAccount,
    expectedMagic: POWER_SNAPSHOT_MAGIC,
    expectedLen: POWER_SNAPSHOT_LEN,
  });
  const citizenProof = accountReadinessProof({
    account: "citizen_power_pda",
    pubkey: citizenPower,
    read: citizenAccount,
    expectedMagic: CITIZEN_POWER_MAGIC,
    expectedLen: CITIZEN_POWER_LEN,
  });
  const proof = {
    kind: "nicechunk.civilization.power_readiness.v1",
    trusted_power_authority: civilizationPowerAuthority,
    submitter: payer.toBase58(),
    submitter_is_power_authority: payerIsPowerAuthority,
    snapshot_hash: proposal.snapshot_hash,
    power_snapshot_pda: powerSnapshot.toBase58(),
    citizen_power_pda: citizenPower.toBase58(),
    accounts: [snapshotProof, citizenProof],
  };
  if (snapshotProof.status === "invalid" || citizenProof.status === "invalid") {
    return {
      ok: false,
      status: "blocked_invalid_civilization_power_account",
      message: t("civilization.ruleLibrary.chain.powerAccountInvalid"),
      proof,
      power_snapshot_pda: powerSnapshot.toBase58(),
      citizen_power_pda: citizenPower.toBase58(),
    };
  }
  const snapshotMissing = snapshotProof.status === "missing";
  const citizenMissing = citizenProof.status === "missing";
  if (snapshotMissing && !payerIsPowerAuthority) {
    return {
      ok: false,
      status: "blocked_power_snapshot_unsettled",
      message: t("civilization.ruleLibrary.chain.powerSnapshotMissing", { authority: shortAddress(civilizationPowerAuthority) }),
      proof,
      power_snapshot_pda: powerSnapshot.toBase58(),
      citizen_power_pda: citizenPower.toBase58(),
    };
  }
  if (citizenMissing && !payerIsPowerAuthority) {
    return {
      ok: false,
      status: "blocked_citizen_power_unsettled",
      message: t("civilization.ruleLibrary.chain.citizenPowerMissing", { authority: shortAddress(civilizationPowerAuthority) }),
      proof,
      power_snapshot_pda: powerSnapshot.toBase58(),
      citizen_power_pda: citizenPower.toBase58(),
    };
  }
  return {
    ok: true,
    status: "civilization_power_ready",
    proof,
    power_snapshot_pda: powerSnapshot.toBase58(),
    citizen_power_pda: citizenPower.toBase58(),
    can_publish_snapshot: snapshotMissing && payerIsPowerAuthority,
    can_settle_citizen_power: citizenMissing && payerIsPowerAuthority,
  };
}

function accountReadinessProof({ account, pubkey, read, expectedMagic, expectedLen }) {
  const value = read?.result?.value;
  if (!read?.exists || !value) {
    return {
      account,
      pda: pubkey.toBase58(),
      status: "missing",
      expected_magic: expectedMagic,
      expected_len: expectedLen,
      read_error: read?.error || "",
    };
  }
  const data = new Uint8Array(value.data || []);
  const owner = value.owner?.toBase58?.() || String(value.owner || "");
  const magic = ascii(data.slice(0, 8));
  const ownerVerified = owner === civilizationProgramId;
  const magicVerified = magic === expectedMagic;
  const lenVerified = data.length === expectedLen;
  return {
    account,
    pda: pubkey.toBase58(),
    status: ownerVerified && magicVerified && lenVerified ? "exists" : "invalid",
    owner,
    owner_verified: ownerVerified,
    magic,
    magic_verified: magicVerified,
    bytes: data.length,
    len_verified: lenVerified,
    expected_magic: expectedMagic,
    expected_len: expectedLen,
    slot: read.result?.context?.slot ?? null,
  };
}

async function readAccountMaybe(pubkey) {
  try {
    const result = await readPdaAccountWithFallback(pubkey);
    return { exists: Boolean(result.value), result };
  } catch (error) {
    return { exists: false, error: error?.message || String(error) };
  }
}

function dateEpoch(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor(timestamp / 86_400_000));
}

async function buildFinalizeChainPlan() {
  try {
    const context = await buildRuleChainContext({ transactionPhase: "finalize_tally" });
    if (!context.ok) return context;
    const { payer, ruleBook, tallyPda } = context;
    const signatureSet = collectFinalizeSignaturePdas(context);
    if (!signatureSet.ok) throw new Error(signatureSet.message);
    const signatureProofs = await readFinalizeSignatureProofs({ ruleBook, signatureSet });
    if (!signatureProofs.ok) {
      state.chainPlan = buildBlockedChainPlan(context.target, signatureProofs.message, {
        phase: "finalize_tally",
        status: signatureProofs.status,
        rule_id: state.proposalEnvelope.rule_id,
        rule_id_hash: state.proposalEnvelope.rule_id_hash,
        payer: payer.toBase58(),
        rule_book_pda: ruleBook.toBase58(),
        rule_signature_pdas: signatureSet.signatures.map((item) => item.toBase58()),
        signature_proofs: signatureProofs.proofs,
      });
      renderChainPlan();
      return { ok: false, message: signatureProofs.message };
    }
    const finalizeIx = createFinalizeCivilizationRuleInstruction({
      payer,
      ruleBook,
      signatures: signatureSet.signatures,
    });
    const threshold = buildFinalizeThresholdResult(signatureProofs.proofs);
    const ruleSignaturePdas = signatureSet.signatures.map((item) => item.toBase58());
    const additionalSignaturePdas = signatureSet.additionalSignaturePdas.map((item) => item.toBase58());
    const signatureSetHash = await finalizeSignatureSetHash(ruleSignaturePdas);
    const deployCollectionHash = await deploySignatureCollectionHash(ruleSignaturePdas);
    const signatureProofSetHash = await finalizeSignatureProofSetHash(signatureProofs.proofs);
    const thresholdResultHash = await finalizeThresholdResultHash(threshold);
    state.chainPlan = {
      kind: "nicechunk.civilization.chain_plan.v1",
      phase: "finalize_tally",
      status: "ready_to_submit",
      cluster: "devnet",
      rpc_url: getNicechunkRpcUrl(),
      rule_id: state.proposalEnvelope.rule_id,
      rule_id_hash: state.proposalEnvelope.rule_id_hash,
      payer: payer.toBase58(),
      rule_book_pda: ruleBook.toBase58(),
      rule_signature_pdas: ruleSignaturePdas,
      signature_source: {
        current_signer_signature_pda: signatureSet.currentSignaturePda.toBase58(),
        additional_signature_pdas: additionalSignaturePdas,
        total_signature_pdas: signatureSet.signatures.length,
        signature_set_hash: signatureSetHash,
        deploy_signature_collection_hash: deployCollectionHash,
        staged_signature_collection_hash: state.deployPacket?.signature_collection?.signature_collection_hash || "",
        signature_proof_set_hash: signatureProofSetHash,
        threshold_result_hash: thresholdResultHash,
        note: "Each supplied signature PDA was read before building this plan. The program will recount the same public accounts on chain.",
      },
      signature_proofs: signatureProofs.proofs,
      rule_tally_pda: tallyPda.toBase58(),
      threshold_result: threshold,
      projected_threshold_met: Boolean(threshold.threshold_met),
      instructions: [describeInstruction("finalize_rule_tally", finalizeIx)],
      next_phase: threshold.threshold_met ? "execute_rule_receipt" : "collect_more_signatures",
      note: threshold.threshold_met
        ? "This transaction recounts public signature PDAs and freezes a passing tally PDA."
        : "This transaction can publish the current public tally, but the rule stays signable and execute receipt remains blocked until enough agree power is present.",
    };
    await sealChainPlan();
    renderChainPlan();
    const simulation = await attachPreSubmitSimulation({ phase: "finalize_tally", payer });
    if (!simulation.ok && simulation.blockSubmit) return simulation;
    renderChainPlan();
    return { ok: true, message: t("civilization.ruleLibrary.chain.finalizeBuilt") };
  } catch (error) {
    const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
    state.chainPlan = buildBlockedChainPlan(target, error?.message || "invalid finalize plan", { phase: "finalize_tally" });
    renderChainPlan();
    return { ok: false, message: t("civilization.ruleLibrary.chain.buildFailed", { reason: error?.message || "invalid finalize plan" }) };
  }
}

async function buildExecuteReceiptChainPlan() {
  try {
    const context = await buildRuleChainContext({ transactionPhase: "execute" });
    if (!context.ok) return context;
    const { payer, target, targetProgram, targetPdaKey, ruleBook, tallyPda, receiptPda } = context;
    const readiness = await readExecuteReadiness({ ruleBook, tallyPda, receiptPda });
    const executePhase = targetUsesTargetAdapter(target) ? "execute_target_adapter" : "execute_rule_receipt";
    const adapterAuthorityPda = targetUsesTargetAdapter(target)
      ? deriveCivilizationAdapterAuthorityPda({ ruleBook, targetProgram })[0]
      : null;
    if (!readiness.ok) {
      state.chainPlan = buildBlockedChainPlan(
        ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id),
        readiness.message,
        {
          phase: executePhase,
          status: readiness.status,
          rule_id: state.proposalEnvelope.rule_id,
          executor: payer.toBase58(),
          rule_book_pda: ruleBook.toBase58(),
          rule_tally_pda: tallyPda.toBase58(),
          execution_receipt_pda: receiptPda.toBase58(),
          adapter_authority_pda: adapterAuthorityPda?.toBase58?.() ?? "",
          target_program: targetProgram.toBase58(),
          target_pda: targetPdaKey?.toBase58?.() ?? "",
          threshold_result: readiness.tallyProof?.threshold_result,
          tally_proof: readiness.tallyProof?.proof,
          receipt_proof: readiness.receiptProof?.proof,
        },
      );
      renderChainPlan();
      return { ok: false, message: readiness.message };
    }
    const threshold = readiness.tallyProof.threshold_result;
    const targetExecution = buildTargetAdapterInstruction({
      target,
      payer,
      targetProgram,
      targetPdaKey,
      ruleBook,
      tallyPda,
      receiptPda,
    });
    const targetPreimageProof = targetUsesTargetAdapter(target)
      ? await readTargetPdaPreSubmitProof({
        target,
        targetPda: targetPdaKey,
        expectedOldValueHash: state.proposalEnvelope.patch.old_value_hash,
      })
      : null;
    if (targetPreimageProof && !targetPreimageProof.verified) {
      state.chainPlan = buildBlockedChainPlan(target, t("civilization.ruleLibrary.chain.targetPreimageChanged", {
        reason: targetPreimageProof.mismatches.join(", ") || targetPreimageProof.status,
      }), {
        phase: targetExecution.phase,
        status: "blocked_target_preimage",
        rule_id: state.proposalEnvelope.rule_id,
        executor: payer.toBase58(),
        target_pda: targetPdaKey?.toBase58?.() ?? "",
        execute_target_preimage: targetPreimageProof,
      });
      renderChainPlan();
      return { ok: false, message: state.chainPlan.reason };
    }
    const executeIx = targetExecution.ix ?? createExecuteCivilizationRuleReceiptInstruction({
      executor: payer,
      ruleBook,
    });
    const executeProofBinding = await buildExecuteProofBinding(readiness, { targetPreimageProof });
    const executeTargetBinding = buildExecuteTargetBinding({
      phase: targetExecution.phase,
      targetId: target?.id || "",
      targetProgram: targetProgram.toBase58(),
      targetPda: targetPdaKey?.toBase58?.() ?? "",
      ruleBookPda: ruleBook.toBase58(),
      ruleTallyPda: tallyPda.toBase58(),
      executionReceiptPda: receiptPda.toBase58(),
      adapterAuthorityPda: adapterAuthorityPda?.toBase58?.() ?? "",
      instructionName: targetExecution.instructionName,
    });
    state.chainPlan = {
      kind: "nicechunk.civilization.chain_plan.v1",
      phase: targetExecution.phase,
      status: "ready_to_submit",
      cluster: "devnet",
      rpc_url: getNicechunkRpcUrl(),
      rule_id: state.proposalEnvelope.rule_id,
      rule_id_hash: state.proposalEnvelope.rule_id_hash,
      target_id: target?.id || "",
      executor: payer.toBase58(),
      rule_book_pda: ruleBook.toBase58(),
      rule_tally_pda: tallyPda.toBase58(),
      execution_receipt_pda: receiptPda.toBase58(),
      adapter_authority_pda: adapterAuthorityPda?.toBase58?.() ?? "",
      target_program: targetProgram.toBase58(),
      target_pda: targetPdaKey?.toBase58?.() ?? "",
      execute_target_binding: executeTargetBinding,
      execute_target_binding_hash: await executeTargetBindingHash(executeTargetBinding),
      ...(targetPreimageProof ? { execute_target_preimage: targetPreimageProof } : {}),
      execute_proof_binding: executeProofBinding,
      execute_proof_binding_hash: await executeProofBindingHash(executeProofBinding),
      threshold_result: threshold,
      tally_proof: readiness.tallyProof.proof,
      receipt_proof: readiness.receiptProof.proof,
      instructions: [describeInstruction(targetExecution.instructionName, executeIx)],
      ...(targetExecution.addressLookupTablePlan ? { address_lookup_table_plan: targetExecution.addressLookupTablePlan } : {}),
      next_phase: "done",
      note: targetExecution.note,
    };
    await sealChainPlan();
    renderChainPlan();
    const simulation = await attachPreSubmitSimulation({ phase: targetExecution.phase, payer });
    if (!simulation.ok && simulation.blockSubmit) return simulation;
    renderChainPlan();
    return { ok: true, message: t("civilization.ruleLibrary.chain.executeBuilt") };
  } catch (error) {
    const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
    state.chainPlan = buildBlockedChainPlan(target, error?.message || "invalid execute receipt plan", { phase: "execute_rule_receipt" });
    renderChainPlan();
    return { ok: false, message: t("civilization.ruleLibrary.chain.buildFailed", { reason: error?.message || "invalid execute receipt plan" }) };
  }
}

async function submitRuleChainTransaction() {
  return submitChainTransaction("publish_sign", buildRuleChainPlan, "submitted");
}

async function submitFinalizeChainTransaction() {
  return submitChainTransaction("finalize_tally", buildFinalizeChainPlan, "finalizeSubmitted");
}

async function submitExecuteReceiptChainTransaction() {
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const phase = targetUsesTargetAdapter(target) ? "execute_target_adapter" : "execute_rule_receipt";
  return submitChainTransaction(phase, buildExecuteReceiptChainPlan, "executeSubmitted");
}

async function attachPreSubmitSimulation({ phase, payer }) {
  const simulation = await simulatePreSubmitTransaction({ phase, payer });
  state.chainPlan = {
    ...state.chainPlan,
    pre_submit_simulation: simulation,
    status: simulation.status === "failed" ? "blocked_simulation_failed" : state.chainPlan?.status,
  };
  renderChainPlan();
  if (simulation.status === "failed") {
    return {
      ok: false,
      blockSubmit: true,
      message: t("civilization.ruleLibrary.chain.simulationFailed", {
        reason: simulation.error || simulation.err || "simulation failed",
      }),
    };
  }
  return { ok: true, blockSubmit: false, message: "" };
}

async function simulatePreSubmitTransaction({ phase, payer }) {
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  if (phase === "execute_target_adapter" && target?.id === "resource-drops") {
    return {
      status: "skipped",
      ok: true,
      reason: "resource_drop_adapter_uses_runtime_address_lookup_table",
      note: "The resource-drop adapter creates and activates an Address Lookup Table at submit time, so the final v0 message cannot be simulated before that lookup table exists.",
    };
  }
  const attempts = [];
  for (const rpcUrl of civilizationRpcUrls()) {
    const conn = new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createNicechunkRpcFetch("civilization-rule-simulate"),
    });
    try {
      const tx = await buildRuleChainTransaction(phase, payer, conn, { skipProofChecks: true });
      const includeAccounts = collectSimulationAccounts(tx);
      const result = await withTimeout(
        conn.simulateTransaction(tx, undefined, includeAccounts),
        20_000,
        `RPC simulation timed out after 20s: ${hostLabel(rpcUrl)}`,
      );
      const value = result.value ?? {};
      const logs = Array.isArray(value.logs) ? value.logs : [];
      const simulation = {
        status: value.err ? "failed" : "passed",
        ok: !value.err,
        rpc_url: rpcUrl,
        host: hostLabel(rpcUrl),
        simulated_at: new Date().toISOString(),
        attempts,
        err: value.err ?? null,
        units_consumed: value.unitsConsumed ?? null,
        return_data: value.returnData ?? null,
        log_count: logs.length,
        logs_tail: logs.slice(-12),
        account_count: includeAccounts.length,
      };
      if (value.err) {
        simulation.error = JSON.stringify(value.err);
      }
      return simulation;
    } catch (error) {
      const unavailable = simulationUnavailableError(error);
      attempts.push({
        rpc_url: rpcUrl,
        host: hostLabel(rpcUrl),
        status: unavailable ? "unavailable" : "failed",
        reason: error?.message || String(error),
      });
      if (unavailable) continue;
      return failedSimulationResult({ rpcUrl, error, attempts });
    }
  }
  return {
    status: "unavailable",
    ok: true,
    rpc_url: attempts.at(-1)?.rpc_url || "",
    host: attempts.at(-1)?.host || "rpc",
    simulated_at: new Date().toISOString(),
    attempts,
    reason: attempts.map((item) => `${item.host}: ${item.reason}`).join(" | "),
    note: "Simulation could not be read from the available RPC endpoints. The transaction plan is still built from PDA proofs; submit will run normal wallet/RPC preflight.",
  };
}

function failedSimulationResult({ rpcUrl, error, attempts }) {
  const logs = Array.isArray(error?.logs) ? error.logs : [];
  return {
    status: "failed",
    ok: false,
    rpc_url: rpcUrl,
    host: hostLabel(rpcUrl),
    simulated_at: new Date().toISOString(),
    attempts,
    error: error?.message || String(error),
    log_count: logs.length,
    logs_tail: logs.slice(-12),
  };
}

function simulationUnavailableError(error) {
  const message = error?.message || String(error);
  if (/RPC simulation timed out|failed to fetch|NetworkError|429|too many requests|rate limit|503|504/ui.test(message)) {
    return true;
  }
  const logs = Array.isArray(error?.logs) ? error.logs : [];
  if (logs.length || /failed to simulate transaction|Simulation failed|InstructionError|custom program error/ui.test(message)) {
    return false;
  }
  return true;
}

function collectSimulationAccounts(tx) {
  const accounts = new Map();
  if (tx.feePayer) accounts.set(tx.feePayer.toBase58(), tx.feePayer);
  for (const instruction of tx.instructions ?? []) {
    if (instruction.programId) accounts.set(instruction.programId.toBase58(), instruction.programId);
    for (const key of instruction.keys ?? []) {
      if (key.pubkey) accounts.set(key.pubkey.toBase58(), key.pubkey);
    }
  }
  return Array.from(accounts.values()).slice(0, 24);
}

async function submitChainTransaction(phase, buildPlan, successKey) {
  const plan = state.chainPlan?.phase === phase && state.chainPlan?.status === "ready_to_submit"
    ? { ok: true }
    : await buildPlan();
  if (!plan.ok) return plan;
  const capability = ensureCivilizationProgramSubmitCapability(phase);
  if (!capability.ok) return capability;
  if (state.chainPlan?.phase !== phase || state.chainPlan?.status !== "ready_to_submit") {
    return { ok: false, message: t("civilization.ruleLibrary.chain.notReady") };
  }
  const planIntegrity = await verifyChainPlanIntegrity();
  if (!planIntegrity.ok) {
    state.chainPlan = {
      ...state.chainPlan,
      status: "blocked_plan_integrity",
      plan_integrity_errors: planIntegrity.errors,
    };
    renderChainPlan();
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.planIntegrityFailed", {
        reason: planIntegrity.errors.join("; "),
      }),
    };
  }
  const providerResult = await getTransactionProvider();
  if (!providerResult.ok) return providerResult;
  const walletCheck = ensureChainPlanWalletMatchesProvider(phase, providerResult.provider);
  if (!walletCheck.ok) return walletCheck;
  try {
    state.chainPlan = {
      ...state.chainPlan,
      status: "submitting",
      submitted_at: new Date().toISOString(),
    };
    renderChainPlan();
    setChainStatus("pending", t("civilization.ruleLibrary.chain.submitting"));
    await assertNicechunkWalletNetwork(providerResult.provider, { requestSwitch: true });
    const signatures = await submitChainTransactionWithFallback({
      phase,
      provider: providerResult.provider,
    });
    const signature = signatures[signatures.length - 1];
    const postSubmitProof = await buildPostSubmitProof({
      phase,
      payer: new PublicKey(publicKeyToString(providerResult.provider.publicKey)),
      transactionSignatures: signatures,
      submittedRpcUrl: state.chainPlan?.submitted_rpc_url || "",
    });
    state.chainPlan = {
      ...state.chainPlan,
      status: "submitted",
      transaction_signature: signature,
      transaction_signatures: signatures,
      submitted_rpc_url: state.chainPlan?.submitted_rpc_url,
      post_submit_proof: postSubmitProof,
      explorer_url: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      submitted_at: new Date().toISOString(),
    };
    renderChainPlan();
    return { ok: true, message: t(`civilization.ruleLibrary.chain.${successKey}`, { signature: shortAddress(signature) }) };
  } catch (error) {
    return { ok: false, message: t("civilization.ruleLibrary.chain.submitFailed", { reason: error?.message || String(error) }) };
  }
}

function ensureCivilizationProgramSubmitCapability(phase) {
  if (civilizationProgramCapabilities.chainSubmitEnabled) return { ok: true };
  state.chainPlan = {
    ...state.chainPlan,
    status: "blocked_program_upgrade",
    blocked_phase: phase,
    required_program_schema: civilizationProgramCapabilities.requiredSchema,
    block_reason: t(civilizationProgramCapabilities.reasonKey),
  };
  renderChainPlan();
  setChainStatus("error", t(civilizationProgramCapabilities.reasonKey));
  return {
    ok: false,
    message: t(civilizationProgramCapabilities.reasonKey),
  };
}

function ensureChainPlanWalletMatchesProvider(phase, provider) {
  const connectedWallet = publicKeyToString(provider.publicKey);
  const plannedWallet = chainPlanActorForPhase(state.chainPlan, phase);
  if (!plannedWallet || !connectedWallet || plannedWallet === connectedWallet) {
    return { ok: true };
  }
  state.chainPlan = {
    ...state.chainPlan,
    status: "stale_wallet_mismatch",
    planned_actor: plannedWallet,
    connected_wallet: connectedWallet,
    stale_reason: "connected_wallet_changed_after_plan_build",
  };
  renderChainPlan();
  return {
    ok: false,
    message: t("civilization.ruleLibrary.chain.walletMismatch", {
      planned: shortAddress(plannedWallet),
      connected: shortAddress(connectedWallet),
    }),
  };
}

function chainPlanActorForPhase(plan, phase) {
  if (!plan) return "";
  if (phase === "publish_sign" || phase === "finalize_tally") return plan.payer || "";
  if (phase === "execute_rule_receipt" || phase === "execute_target_adapter") return plan.executor || "";
  return "";
}

async function sealChainPlan() {
  if (!state.chainPlan || !state.deployPacket) return;
  const deployPacketHash = await deployPacketContentHash(state.deployPacket);
  const binding = {
    kind: "nicechunk.civilization.chain_plan_binding.v1",
    deploy_packet_hash: deployPacketHash,
    deploy_lineage_hash: state.deployPacket.lineage?.current_deploy_packet_hash || deployPacketHash,
    deploy_packet_kind: state.deployPacket.kind || "",
    rule_id_hash: state.deployPacket.rule_book?.rule_id_hash || "",
    rule_book_pda: state.deployPacket.derived_pdas?.rule_book_pda || "",
    current_signature_pda: state.deployPacket.signature?.rule_signature_pda || "",
    signature_count: state.deployPacket.signature_collection?.signature_count ?? 0,
    signature_collection_hash: state.deployPacket.signature_collection?.signature_collection_hash || "",
    sealed_at: new Date().toISOString(),
  };
  const plan = {
    ...state.chainPlan,
    built_from_deploy_packet: binding,
    plan_hash_algorithm: "sha256:stable_json_without_runtime_fields",
  };
  state.chainPlan = {
    ...plan,
    plan_hash: await chainPlanContentHash(plan),
  };
}

async function verifyChainPlanIntegrity() {
  const errors = [];
  if (!state.chainPlan) return { ok: false, errors: [t("civilization.ruleLibrary.chain.planMissing")] };
  if (!state.deployPacket) return { ok: false, errors: [t("civilization.ruleLibrary.chain.deployPacketMissing")] };
  const binding = state.chainPlan.built_from_deploy_packet;
  if (!binding) errors.push(t("civilization.ruleLibrary.chain.planBindingMissing"));
  const currentDeployHash = await deployPacketContentHash(state.deployPacket);
  if (binding?.deploy_packet_hash !== currentDeployHash) {
    errors.push(t("civilization.ruleLibrary.chain.deployPacketHashMismatch"));
  }
  const currentSignatureCollectionHash = state.deployPacket?.signature_collection?.signature_collection_hash || "";
  if ((binding?.signature_collection_hash || "") !== currentSignatureCollectionHash) {
    errors.push(t("civilization.ruleLibrary.chain.deploySignatureCollectionChanged", {
      reason: "signature_collection_hash",
    }));
  }
  const expectedPlanHash = await chainPlanContentHash(state.chainPlan);
  if (state.chainPlan.plan_hash !== expectedPlanHash) {
    errors.push(t("civilization.ruleLibrary.chain.planHashMismatch"));
  }
  if (state.chainPlan.phase === "finalize_tally") {
    const signatureSetCheck = await verifyFinalizePlanSignatureSet();
    if (!signatureSetCheck.ok) errors.push(signatureSetCheck.message);
  }
  if (state.chainPlan.phase === "publish_sign") {
    const publicationModeCheck = await verifyPublishPlanPublicationMode();
    if (!publicationModeCheck.ok) errors.push(publicationModeCheck.message);
  }
  if (state.chainPlan.phase === "execute_rule_receipt" || state.chainPlan.phase === "execute_target_adapter") {
    const targetBindingCheck = await verifyExecutePlanTargetBinding();
    if (!targetBindingCheck.ok) errors.push(targetBindingCheck.message);
    const proofBindingCheck = await verifyExecutePlanProofBinding();
    if (!proofBindingCheck.ok) errors.push(proofBindingCheck.message);
  }
  return { ok: errors.length === 0, errors };
}

async function verifyPublishPlanPublicationMode() {
  try {
    const plannedMode = state.chainPlan?.publish_mode || "";
    const ruleBookPda = state.chainPlan?.rule_book_pda || state.deployPacket?.derived_pdas?.rule_book_pda || "";
    if (!plannedMode || !ruleBookPda) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.publishModeChanged", { reason: "missing_publish_plan_binding" }),
      };
    }
    const publication = await readRuleBookPublicationProof({ ruleBook: new PublicKey(ruleBookPda) });
    if (!publication.ok) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.publishModeChanged", { reason: publication.message }),
      };
    }
    const currentMode = publication.exists ? "sign_existing_rule" : "publish_and_sign_rule";
    if (plannedMode !== currentMode) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.publishModeChanged", {
          reason: `${plannedMode}->${currentMode}`,
        }),
      };
    }
    const plannedProof = state.chainPlan?.publication_proof || {};
    const currentProof = publication.proof || {};
    if (plannedProof.exists !== currentProof.exists) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.publishModeChanged", { reason: "publication_existence_changed" }),
      };
    }
    if (currentProof.exists && plannedProof.data_hash && currentProof.data_hash && plannedProof.data_hash !== currentProof.data_hash) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.publishModeChanged", { reason: "rule_book_data_hash_changed" }),
      };
    }
    return { ok: true, message: "" };
  } catch (error) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.publishModeChanged", {
        reason: error?.message || String(error),
      }),
    };
  }
}

async function verifyFinalizePlanSignatureSet() {
  const planned = Array.isArray(state.chainPlan?.rule_signature_pdas)
    ? state.chainPlan.rule_signature_pdas.map(String)
    : [];
  const plannedHash = state.chainPlan?.signature_source?.signature_set_hash || "";
  const current = collectFinalizeSignaturePdas();
  if (!current.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.signatureSetChanged", { reason: current.message }),
    };
  }
  const currentPdas = current.signatures.map((item) => item.toBase58());
  const currentHash = await finalizeSignatureSetHash(currentPdas);
  const currentDeployCollectionHash = await deploySignatureCollectionHash(currentPdas);
  const plannedDeployCollectionHash = state.chainPlan?.signature_source?.deploy_signature_collection_hash || "";
  const stagedDeployCollectionHash = state.chainPlan?.signature_source?.staged_signature_collection_hash || "";
  const packetCollectionHash = state.deployPacket?.signature_collection?.signature_collection_hash || "";
  const sameList = planned.length === currentPdas.length && planned.every((pda, index) => pda === currentPdas[index]);
  const sameHash = !plannedHash || plannedHash === currentHash;
  const sameDeployCollectionHash = (!plannedDeployCollectionHash || plannedDeployCollectionHash === currentDeployCollectionHash)
    && (!stagedDeployCollectionHash || stagedDeployCollectionHash === currentDeployCollectionHash)
    && (!packetCollectionHash || packetCollectionHash === currentDeployCollectionHash);
  if (!sameList || !sameHash || !sameDeployCollectionHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.signatureSetChanged", {
        reason: sameDeployCollectionHash ? `${planned.length}->${currentPdas.length}` : "signature_collection_hash",
      }),
    };
  }
  const ruleBookPda = state.chainPlan?.rule_book_pda || state.deployPacket?.derived_pdas?.rule_book_pda || "";
  if (!ruleBookPda) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.finalizeProofChanged", { reason: "missing_rule_book_pda" }),
    };
  }
  const signatureProofs = await readFinalizeSignatureProofs({
    ruleBook: new PublicKey(ruleBookPda),
    signatureSet: current,
  });
  if (!signatureProofs.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.finalizeProofChanged", { reason: signatureProofs.message }),
    };
  }
  const proofCheck = await verifyFinalizeProofBinding(signatureProofs.proofs);
  if (!proofCheck.ok) return proofCheck;
  return { ok: true, message: "" };
}

async function verifyFinalizeProofBinding(proofs) {
  const plannedProofHash = state.chainPlan?.signature_source?.signature_proof_set_hash || "";
  const plannedThresholdHash = state.chainPlan?.signature_source?.threshold_result_hash || "";
  if (!plannedProofHash || !plannedThresholdHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.finalizeProofChanged", { reason: "missing_finalize_proof_binding" }),
    };
  }
  const currentProofHash = await finalizeSignatureProofSetHash(proofs);
  const currentThreshold = buildFinalizeThresholdResult(proofs);
  const currentThresholdHash = await finalizeThresholdResultHash(currentThreshold);
  const mismatches = [];
  if (plannedProofHash !== currentProofHash) mismatches.push("signature_proof_set_hash");
  if (plannedThresholdHash !== currentThresholdHash) mismatches.push("threshold_result_hash");
  const plannedThreshold = state.chainPlan?.threshold_result || {};
  for (const key of ["signature_count", "yes_power", "no_power", "abstain_power", "challenge_power", "threshold_met"]) {
    if (plannedThreshold[key] !== currentThreshold[key]) mismatches.push(`threshold_result.${key}`);
  }
  if (mismatches.length === 0) return { ok: true, message: "" };
  return {
    ok: false,
    message: t("civilization.ruleLibrary.chain.finalizeProofChanged", {
      reason: Array.from(new Set(mismatches)).join(", "),
    }),
  };
}

async function finalizeSignatureSetHash(ruleSignaturePdas) {
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: "nicechunk.civilization.finalize_signature_set.v1",
    rule_signature_pdas: ruleSignaturePdas,
  }))}`;
}

async function finalizeSignatureProofSetHash(proofs) {
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: "nicechunk.civilization.finalize_signature_proof_set.v1",
    proofs: (proofs || []).map((proof) => ({
      pda: proof.pda || "",
      exists: Boolean(proof.exists),
      status: proof.status || "",
      data_hash: proof.data_hash || "",
      signer: proof.signer || "",
      rule_book: proof.rule_book || "",
      snapshot_hash: proof.snapshot_hash || "",
      side: proof.side || "",
      snapshot_power_u64: proof.snapshot_power_u64 ?? String(proof.snapshot_power ?? 0),
      expected_signature_pda: proof.expected_signature_pda || "",
      signature_pda_seed_verified: Boolean(proof.signature_pda_seed_verified),
      current_signer: Boolean(proof.current_signer),
      mismatches: Array.isArray(proof.mismatches) ? proof.mismatches : [],
    })),
  }))}`;
}

async function finalizeThresholdResultHash(threshold) {
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: "nicechunk.civilization.finalize_threshold_result.v1",
    threshold_result: threshold || {},
  }))}`;
}

async function verifyExecutePlanTargetBinding() {
  const planned = state.chainPlan?.execute_target_binding;
  const plannedHash = state.chainPlan?.execute_target_binding_hash || "";
  if (!planned || !plannedHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeTargetChanged", { reason: "missing_execute_target_binding" }),
    };
  }
  const currentHash = await executeTargetBindingHash(planned);
  if (plannedHash !== currentHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeTargetChanged", { reason: "execute_target_binding_hash_mismatch" }),
    };
  }
  const expected = expectedExecuteTargetBinding();
  if (!expected.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeTargetChanged", { reason: expected.reason }),
    };
  }
  const mismatches = [];
  for (const key of Object.keys(expected.binding)) {
    if (planned[key] !== expected.binding[key]) mismatches.push(key);
  }
  const expectedHash = await executeTargetBindingHash(expected.binding);
  if (plannedHash !== expectedHash) mismatches.push("execute_target_binding_hash");
  if (mismatches.length === 0) return { ok: true, message: "" };
  return {
    ok: false,
    message: t("civilization.ruleLibrary.chain.executeTargetChanged", {
      reason: Array.from(new Set(mismatches)).join(", "),
    }),
  };
}

function expectedExecuteTargetBinding() {
  const packet = state.deployPacket;
  const pdas = packet?.derived_pdas;
  const targetId = packet?.rule_book?.patch?.target_id || "";
  const target = ruleTargets.find((item) => item.id === targetId);
  if (!pdas || !targetId || !target) return { ok: false, reason: "missing_deploy_target_facts" };
  const phase = targetUsesTargetAdapter(target) ? "execute_target_adapter" : "execute_rule_receipt";
  return {
    ok: true,
    binding: buildExecuteTargetBinding({
      phase,
      targetId,
      targetProgram: pdas.target_program || "",
      targetPda: pdas.target_pda || "",
      ruleBookPda: pdas.rule_book_pda || "",
      ruleTallyPda: pdas.rule_tally_pda || "",
      executionReceiptPda: pdas.execution_receipt_pda || "",
      adapterAuthorityPda: pdas.adapter_authority_pda || "",
      instructionName: executeInstructionNameForTarget(target),
    }),
  };
}

function buildExecuteTargetBinding({
  phase,
  targetId,
  targetProgram,
  targetPda,
  ruleBookPda,
  ruleTallyPda,
  executionReceiptPda,
  adapterAuthorityPda = "",
  instructionName,
}) {
  return {
    kind: "nicechunk.civilization.execute_target_binding.v1",
    phase,
    target_id: targetId,
    target_program: targetProgram,
    target_pda: targetPda,
    rule_book_pda: ruleBookPda,
    rule_tally_pda: ruleTallyPda,
    execution_receipt_pda: executionReceiptPda,
    adapter_authority_pda: adapterAuthorityPda,
    instruction_name: instructionName,
  };
}

async function executeTargetBindingHash(binding) {
  return `sha256:${await sha256Hex(stableJsonStringify(binding))}`;
}

async function verifyExecutePlanProofBinding() {
  const ruleBookPda = state.chainPlan?.rule_book_pda || state.deployPacket?.derived_pdas?.rule_book_pda || "";
  const tallyPda = state.chainPlan?.rule_tally_pda || state.deployPacket?.derived_pdas?.rule_tally_pda || "";
  const receiptPda = state.chainPlan?.execution_receipt_pda || state.deployPacket?.derived_pdas?.execution_receipt_pda || "";
  if (!ruleBookPda || !tallyPda || !receiptPda) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeProofChanged", { reason: "missing_execute_proof_pdas" }),
    };
  }
  const readiness = await readExecuteReadiness({
    ruleBook: new PublicKey(ruleBookPda),
    tallyPda: new PublicKey(tallyPda),
    receiptPda: new PublicKey(receiptPda),
  });
  if (!readiness.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeProofChanged", { reason: readiness.message }),
    };
  }
  let targetPreimageProof = null;
  const targetId = state.deployPacket?.rule_book?.patch?.target_id || "";
  const target = ruleTargets.find((item) => item.id === targetId);
  if (targetUsesTargetAdapter(target)) {
    const targetPda = state.chainPlan?.target_pda || state.deployPacket?.derived_pdas?.target_pda || "";
    if (!targetPda) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.chain.executeProofChanged", { reason: "missing_target_pda" }),
      };
    }
    targetPreimageProof = await readTargetPdaPreSubmitProof({
      target,
      targetPda: new PublicKey(targetPda),
      expectedOldValueHash: state.deployPacket?.rule_book?.patch?.old_value_hash || "",
    });
  }
  return verifyExecuteProofBinding(readiness, { targetPreimageProof });
}

async function verifyExecuteProofBinding(readiness, { targetPreimageProof = null } = {}) {
  const planned = state.chainPlan?.execute_proof_binding;
  const plannedHash = state.chainPlan?.execute_proof_binding_hash || "";
  if (!planned || !plannedHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeProofChanged", { reason: "missing_execute_proof_binding" }),
    };
  }
  const plannedSelfHash = await executeProofBindingHash(planned);
  if (plannedSelfHash !== plannedHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.chain.executeProofChanged", { reason: "execute_proof_binding_hash_mismatch" }),
    };
  }
  const current = await buildExecuteProofBinding(readiness, { targetPreimageProof });
  const currentHash = await executeProofBindingHash(current);
  const mismatches = [];
  if (plannedHash !== currentHash) mismatches.push("execute_proof_binding_hash");
  for (const key of Object.keys(current)) {
    if (planned[key] !== current[key]) mismatches.push(key);
  }
  const plannedThreshold = state.chainPlan?.threshold_result || {};
  const currentThreshold = readiness.tallyProof?.threshold_result || {};
  for (const key of ["yes_power", "no_power", "abstain_power", "challenge_power", "threshold_met", "finalized_slot"]) {
    if (plannedThreshold[key] !== currentThreshold[key]) mismatches.push(`threshold_result.${key}`);
  }
  if (mismatches.length === 0) return { ok: true, message: "" };
  return {
    ok: false,
    message: t("civilization.ruleLibrary.chain.executeProofChanged", {
      reason: Array.from(new Set(mismatches)).join(", "),
    }),
  };
}

async function buildExecuteProofBinding(readiness, { targetPreimageProof = null } = {}) {
  const tallyProof = readiness?.tallyProof || {};
  const receiptProof = readiness?.receiptProof || {};
  return {
    kind: "nicechunk.civilization.execute_proof_binding.v1",
    tally_status: tallyProof.status || "",
    receipt_status: receiptProof.status || "",
    threshold_met: Boolean(tallyProof.thresholdMet),
    receipt_exists: Boolean(receiptProof.exists),
    tally_proof_hash: await executeProofHash("tally", tallyProof.proof),
    receipt_proof_hash: await executeProofHash("receipt", receiptProof.proof),
    ...(targetPreimageProof ? {
      target_preimage_status: targetPreimageProof.status || "",
      target_preimage_data_hash: targetPreimageProof.data_hash || "",
      target_preimage_old_value_hash: targetPreimageProof.expected_old_value_hash || "",
      target_preimage_verified: Boolean(targetPreimageProof.verified),
      target_preimage_proof_hash: await executeProofHash("target_preimage", targetPreimageProof),
    } : {}),
    threshold_result_hash: await executeThresholdResultHash(tallyProof.threshold_result),
  };
}

async function executeProofBindingHash(binding) {
  return `sha256:${await sha256Hex(stableJsonStringify(binding))}`;
}

async function executeProofHash(kind, proof) {
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: `nicechunk.civilization.execute_${kind}_proof.v1`,
    proof: {
      source: proof?.source || "",
      pda: proof?.pda || "",
      exists: Boolean(proof?.exists),
      status: proof?.status || "",
      data_hash: proof?.data_hash || "",
      owner: proof?.owner || "",
      expected_owner: proof?.expected_owner || "",
      expected_old_value_hash: proof?.expected_old_value_hash || "",
      old_value_hash_verified: Boolean(proof?.old_value_hash_verified),
      rule_book: proof?.rule_book || proof?.expected_rule_book || "",
      threshold_met: Boolean(proof?.threshold_met),
      yes_power_u64: proof?.yes_power_u64 ?? String(proof?.yes_power ?? 0),
      no_power_u64: proof?.no_power_u64 ?? String(proof?.no_power ?? 0),
      abstain_power_u64: proof?.abstain_power_u64 ?? String(proof?.abstain_power ?? 0),
      challenge_power_u64: proof?.challenge_power_u64 ?? String(proof?.challenge_power ?? 0),
      finalized_slot: proof?.finalized_slot || "",
      executed: Boolean(proof?.executed),
      executed_slot: proof?.executed_slot || "",
      executor: proof?.executor || "",
      mismatches: Array.isArray(proof?.mismatches) ? proof.mismatches : [],
    },
  }))}`;
}

async function executeThresholdResultHash(threshold) {
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: "nicechunk.civilization.execute_threshold_result.v1",
    threshold_result: threshold || {},
  }))}`;
}

async function chainPlanContentHash(plan) {
  return `sha256:${await sha256Hex(stableJsonStringify(normalizeChainPlanForHash(plan)))}`;
}

function normalizeChainPlanForHash(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const copy = JSON.parse(JSON.stringify(plan));
  delete copy.plan_hash;
  delete copy.status;
  delete copy.pre_submit_simulation;
  delete copy.post_submit_proof;
  delete copy.rpc_attempts;
  delete copy.submitted_at;
  delete copy.submitted_rpc_url;
  delete copy.transaction_signature;
  delete copy.transaction_signatures;
  delete copy.explorer_url;
  delete copy.planned_actor;
  delete copy.connected_wallet;
  delete copy.stale_reason;
  delete copy.plan_integrity_errors;
  return copy;
}

async function buildPostSubmitProof({ phase, payer, transactionSignatures = [], submittedRpcUrl = "" }) {
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const ruleBook = deriveRuleBookPda({ ruleIdHash: state.proposalEnvelope.rule_id_hash })[0];
  const signaturePda = deriveRuleSignaturePda({ ruleBook, signer: payer })[0];
  const tallyPda = deriveRuleTallyPda({ ruleBook })[0];
  const receiptPda = deriveExecutionReceiptPda({ ruleBook })[0];
  const targetPda = extractTargetPda(target);
  const targetProgram = new PublicKey(targetProgramIds[target?.module] || targetProgramIds.civic);
  const proof = {
    kind: "nicechunk.civilization.post_submit_proof.v1",
    phase,
    verified_at: new Date().toISOString(),
    rule_book_pda: ruleBook.toBase58(),
    plan_binding: await buildPostSubmitPlanBindingProof({ phase, transactionSignatures, submittedRpcUrl }),
  };
  if (phase === "publish_sign") {
    proof.rule_book = await readRuleBookPostSubmitProof({ ruleBook });
    proof.signature = await readSignaturePostSubmitProof({ ruleBook, signaturePda, signer: payer });
    proof.status = proof.plan_binding.verified && proof.rule_book.verified && proof.signature.verified ? "verified" : "needs_review";
    return proof;
  }
  if (phase === "finalize_tally") {
    proof.rule_book = await readRuleBookPostSubmitProof({ ruleBook });
    proof.tally = await readTallyPostSubmitProof({ ruleBook, tallyPda });
    proof.status = proof.plan_binding.verified && proof.rule_book.verified && proof.tally.verified ? "verified" : "needs_review";
    return proof;
  }
  proof.rule_book = await readRuleBookPostSubmitProof({ ruleBook });
  proof.tally = await readTallyPostSubmitProof({ ruleBook, tallyPda });
  proof.receipt = await readReceiptPostSubmitProof({ ruleBook, receiptPda });
  if (targetPda) proof.target_pda = await readTargetPdaPostSubmitProof({
    target,
    targetPda,
    targetPreimageProof: state.chainPlan?.execute_target_preimage,
  });
  if (phase === "execute_target_adapter") {
    proof.adapter_authority = buildAdapterAuthorityPostSubmitProof({ ruleBook, targetProgram });
  }
  const targetVerified = phase !== "execute_target_adapter" || Boolean(proof.target_pda?.verified);
  const adapterAuthorityVerified = phase !== "execute_target_adapter" || Boolean(proof.adapter_authority?.verified);
  proof.status = proof.plan_binding.verified && proof.rule_book.verified && proof.tally.verified && proof.receipt.verified && targetVerified && adapterAuthorityVerified ? "verified" : "needs_review";
  return proof;
}

async function buildPostSubmitPlanBindingProof({ phase, transactionSignatures = [], submittedRpcUrl = "" }) {
  const plan = state.chainPlan || {};
  const binding = plan.built_from_deploy_packet || {};
  const currentDeployPacketHash = state.deployPacket ? await deployPacketContentHash(state.deployPacket) : "";
  const expectedPlanHash = plan ? await chainPlanContentHash(plan) : "";
  const signatureCollectionHash = state.deployPacket?.signature_collection?.signature_collection_hash || "";
  const transactionSignatureList = Array.isArray(transactionSignatures) ? transactionSignatures.map(String) : [];
  const mismatches = [];
  if (!plan.plan_hash || plan.plan_hash !== expectedPlanHash) mismatches.push("plan_hash");
  if (!binding.deploy_packet_hash || binding.deploy_packet_hash !== currentDeployPacketHash) mismatches.push("deploy_packet_hash");
  if ((binding.signature_collection_hash || "") !== signatureCollectionHash) mismatches.push("signature_collection_hash");
  if (plan.phase !== phase) mismatches.push("phase");
  if (!transactionSignatureList.length) mismatches.push("transaction_signature");
  const payload = {
    kind: "nicechunk.civilization.post_submit_plan_binding.v1",
    phase,
    plan_hash: plan.plan_hash || "",
    expected_plan_hash: expectedPlanHash,
    deploy_packet_hash: currentDeployPacketHash,
    bound_deploy_packet_hash: binding.deploy_packet_hash || "",
    deploy_lineage_hash: binding.deploy_lineage_hash || "",
    signature_collection_hash: signatureCollectionHash,
    transaction_signatures: transactionSignatureList,
    submitted_rpc_url: submittedRpcUrl,
  };
  return {
    source: "chain_plan_binding",
    exists: true,
    verified: mismatches.length === 0,
    status: mismatches.length ? "mismatch" : "verified",
    owner: "local-proof",
    bytes: stableJsonStringify(payload).length,
    read_slot: "",
    data_hash: `sha256:${await sha256Hex(stableJsonStringify(payload))}`,
    host: submittedRpcUrl ? hostLabel(submittedRpcUrl) : "",
    mismatches,
    ...payload,
  };
}

function buildAdapterAuthorityPostSubmitProof({ ruleBook, targetProgram }) {
  const [adapterAuthority, adapterAuthorityBump] = deriveCivilizationAdapterAuthorityPda({
    ruleBook,
    targetProgram,
  });
  const expected = state.deployPacket?.derived_pdas?.adapter_authority_pda || "";
  const pda = adapterAuthority.toBase58();
  const mismatches = [];
  if (expected && expected !== pda) mismatches.push("adapter_authority_pda");
  return {
    source: "adapter_authority_pda",
    pda,
    exists: true,
    verified: mismatches.length === 0,
    status: mismatches.length ? "mismatch" : "verified",
    expected_owner: targetProgram.toBase58(),
    bytes: "signer-only PDA",
    seed: "civilization-adapter",
    rule_book: ruleBook.toBase58(),
    bump: adapterAuthorityBump,
    mismatches,
  };
}

async function submitChainTransactionWithFallback({ phase, provider }) {
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const urls = civilizationRpcUrls();
  const failures = [];
  for (const [index, rpcUrl] of urls.entries()) {
    const conn = new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createNicechunkRpcFetch("civilization-rule-submit"),
    });
    try {
      state.chainPlan = {
        ...state.chainPlan,
        rpc_attempts: [
          ...(state.chainPlan?.rpc_attempts ?? []),
          { rpc_url: rpcUrl, host: hostLabel(rpcUrl), status: "submitting", attempt: index + 1 },
        ],
      };
      renderChainPlan();
      const signatures = phase === "execute_target_adapter" && target?.id === "resource-drops"
        ? await signAndSendResourceDropAdapterTransaction(provider, conn)
        : [await signAndSendWalletTransaction(
          provider,
          await buildRuleChainTransaction(phase, provider.publicKey, conn),
          conn,
        )];
      state.chainPlan = {
        ...state.chainPlan,
        submitted_rpc_url: rpcUrl,
        rpc_attempts: markRpcAttempt(state.chainPlan?.rpc_attempts, rpcUrl, {
          status: "submitted",
          signatures,
        }),
      };
      renderChainPlan();
      return signatures;
    } catch (error) {
      const reason = error?.message || String(error);
      failures.push(`${hostLabel(rpcUrl)}: ${reason}`);
      state.chainPlan = {
        ...state.chainPlan,
        rpc_attempts: markRpcAttempt(state.chainPlan?.rpc_attempts, rpcUrl, {
          status: isRetryableRpcSubmitError(error) && rpcUrl !== urls.at(-1) ? "retrying_next_rpc" : "failed",
          reason,
        }),
      };
      renderChainPlan();
      if (!isRetryableRpcSubmitError(error) || rpcUrl === urls.at(-1)) {
        throw new Error(failures.join(" | "));
      }
    }
  }
  throw new Error(failures.join(" | "));
}

function civilizationRpcUrls() {
  return Array.from(new Set([getNicechunkRpcUrl(), fallbackDevnetRpcUrl].filter(Boolean)));
}

function isRetryableRpcSubmitError(error) {
  const message = `${error?.message || ""} ${error?.stack || ""}`.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function hostLabel(rpcUrl) {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "rpc";
  }
}

function markRpcAttempt(attempts, rpcUrl, patch) {
  const list = [...(attempts ?? [])];
  let index = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.rpc_url === rpcUrl) {
      index = i;
      break;
    }
  }
  if (index === -1) return [...list, { rpc_url: rpcUrl, host: hostLabel(rpcUrl), ...patch }];
  list[index] = { ...list[index], ...patch };
  return list;
}

async function buildRuleChainTransaction(phase, publicKey, conn, { skipProofChecks = false } = {}) {
  const payer = new PublicKey(publicKeyToString(publicKey));
  if (phase === "publish_sign" && state.signedProof?.signer && state.signedProof.signer !== payer.toBase58()) {
    throw new Error("Connected wallet does not match the signed deploy packet.");
  }
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const targetProgram = new PublicKey(targetProgramIds[target?.module] || targetProgramIds.civic);
  const ruleBook = deriveRuleBookPda({ ruleIdHash: state.proposalEnvelope.rule_id_hash })[0];
  const tx = new Transaction();
  if (phase === "publish_sign") {
    const targetPda = extractTargetPda(target);
    if (!targetPda) throw new Error(t("civilization.ruleLibrary.chain.noTargetPda"));
    const signaturePda = deriveRuleSignaturePda({ ruleBook, signer: payer })[0];
    let shouldPublish = state.chainPlan?.publish_mode !== "sign_existing_rule";
    if (!skipProofChecks) {
      const publication = await readRuleBookPublicationProof({ ruleBook });
      if (!publication.ok) throw new Error(publication.message);
      const signatureProof = await readCurrentSignatureProof({ ruleBook, signaturePda, signer: payer });
      if (!signatureProof.ok) throw new Error(signatureProof.message);
      shouldPublish = !publication.exists;
    }
    if (shouldPublish) {
      for (const item of await buildCivilizationPowerInstructions({ payer })) {
        tx.add(item.ix);
      }
      tx.add(createPublishCivilizationRuleInstruction({
        payer,
        ruleIdHash: state.proposalEnvelope.rule_id_hash,
        textHash: state.proposalEnvelope.text_hash,
        patchHash: state.proposalEnvelope.patch_hash,
        snapshotHash: state.proposalEnvelope.snapshot_hash,
        targetProgram,
        targetPda: new PublicKey(targetPda),
        totalActivePower: state.proposalEnvelope.civilization_power_snapshot.total_active_power,
        thresholdBps: state.proposalEnvelope.civilization_power_snapshot.threshold_bps,
        targetStatus: targetStatusCode(target?.status),
        riskLevel: riskLevelCode(state.proposalEnvelope.readable.risk_level),
      }));
    }
    tx.add(createSignCivilizationRuleInstruction({
      signer: payer,
      ruleBook,
      snapshotHash: state.proposalEnvelope.snapshot_hash,
      side: sideCode(state.proposalEnvelope.civilization_power_snapshot.signature_side),
      snapshotPower: state.proposalEnvelope.civilization_power_snapshot.signer_snapshot_power,
    }));
  } else if (phase === "finalize_tally") {
    const packetSigner = new PublicKey(state.signedProof.signer);
    const signaturePda = deriveRuleSignaturePda({ ruleBook, signer: packetSigner })[0];
    const signatureSet = collectFinalizeSignaturePdas({
      payer,
      ruleBook,
      signaturePda,
    });
    if (!signatureSet.ok) throw new Error(signatureSet.message);
    if (!skipProofChecks) {
      const signatureProofs = await readFinalizeSignatureProofs({ ruleBook, signatureSet });
      if (!signatureProofs.ok) throw new Error(signatureProofs.message);
      const proofBinding = await verifyFinalizeProofBinding(signatureProofs.proofs);
      if (!proofBinding.ok) throw new Error(proofBinding.message);
    }
    tx.add(createFinalizeCivilizationRuleInstruction({
      payer,
      ruleBook,
      signatures: signatureSet.signatures,
    }));
  } else if (phase === "execute_rule_receipt") {
    const [tallyPda] = deriveRuleTallyPda({ ruleBook });
    const [receiptPda] = deriveExecutionReceiptPda({ ruleBook });
    if (!skipProofChecks) {
      const readiness = await readExecuteReadiness({ ruleBook, tallyPda, receiptPda });
      if (!readiness.ok) throw new Error(readiness.message);
      const targetPreimageProof = await readTargetPdaPreSubmitProof({
        target,
        targetPda: new PublicKey(targetPda),
        expectedOldValueHash: state.proposalEnvelope.patch.old_value_hash,
      });
      if (!targetPreimageProof.verified) {
        throw new Error(t("civilization.ruleLibrary.chain.targetPreimageChanged", {
          reason: targetPreimageProof.mismatches.join(", ") || targetPreimageProof.status,
        }));
      }
      const proofBinding = await verifyExecuteProofBinding(readiness, { targetPreimageProof });
      if (!proofBinding.ok) throw new Error(proofBinding.message);
    }
    tx.add(createExecuteCivilizationRuleReceiptInstruction({
      executor: payer,
      ruleBook,
    }));
  } else if (phase === "execute_target_adapter") {
    const targetPda = extractTargetPda(target);
    if (!targetPda) throw new Error(t("civilization.ruleLibrary.chain.noTargetPda"));
    const [tallyPda] = deriveRuleTallyPda({ ruleBook });
    const [receiptPda] = deriveExecutionReceiptPda({ ruleBook });
    if (!skipProofChecks) {
      const readiness = await readExecuteReadiness({ ruleBook, tallyPda, receiptPda });
      if (!readiness.ok) throw new Error(readiness.message);
      const proofBinding = await verifyExecuteProofBinding(readiness);
      if (!proofBinding.ok) throw new Error(proofBinding.message);
    }
    const targetExecution = buildTargetAdapterInstruction({
      target,
      payer,
      targetProgram,
      targetPdaKey: new PublicKey(targetPda),
      ruleBook,
      tallyPda,
      receiptPda,
    });
    tx.add(targetExecution.ix);
  } else {
    throw new Error(`Unknown civilization transaction phase: ${phase}`);
  }
  tx.feePayer = payer;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return tx;
}

async function signAndSendResourceDropAdapterTransaction(provider, conn) {
  if (typeof provider.signTransaction !== "function") {
    throw new Error("Resource drop adapter execution requires a wallet with signTransaction for v0 transactions.");
  }
  const payer = new PublicKey(publicKeyToString(provider.publicKey));
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const targetProgram = new PublicKey(targetProgramIds[target?.module] || targetProgramIds.civic);
  const targetPda = extractTargetPda(target);
  if (!targetPda) throw new Error(t("civilization.ruleLibrary.chain.noTargetPda"));
  const targetPdaKey = new PublicKey(targetPda);
  const [ruleBook] = deriveRuleBookPda({ ruleIdHash: state.proposalEnvelope.rule_id_hash });
  const [tallyPda] = deriveRuleTallyPda({ ruleBook });
  const [receiptPda] = deriveExecutionReceiptPda({ ruleBook });
  const readiness = await readExecuteReadiness({ ruleBook, tallyPda, receiptPda });
  if (!readiness.ok) throw new Error(readiness.message);
  const proofBinding = await verifyExecuteProofBinding(readiness);
  if (!proofBinding.ok) throw new Error(proofBinding.message);
  const targetExecution = buildTargetAdapterInstruction({
    target,
    payer,
    targetProgram,
    targetPdaKey,
    ruleBook,
    tallyPda,
    receiptPda,
  });
  const lookupSignature = await createAndExtendLookupTable(
    provider,
    conn,
    resourceDropLookupTableEntries({ targetProgram, targetPdaKey, ruleBook, tallyPda, receiptPda }).map((entry) => entry.pubkey),
  );
  const lookupTable = await waitForLatestLookupTable(conn, payer, lookupSignature.lookupTableAddress, lookupSignature.createdSlot);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      targetExecution.ix,
    ],
  }).compileToV0Message([lookupTable]);
  const transaction = new VersionedTransaction(message);
  const signed = await provider.signTransaction(transaction);
  const executeSignature = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 8,
  });
  await conn.confirmTransaction({ signature: executeSignature, blockhash, lastValidBlockHeight }, "confirmed");
  return [lookupSignature.signature, executeSignature];
}

async function createAndExtendLookupTable(provider, conn, addresses) {
  const payer = new PublicKey(publicKeyToString(provider.publicKey));
  const recentSlot = await conn.getSlot("confirmed");
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer,
    payer,
    recentSlot,
  });
  const uniqueAddresses = Array.from(new Map(addresses.map((address) => [address.toBase58(), address])).values());
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer,
    authority: payer,
    lookupTable: lookupTableAddress,
    addresses: uniqueAddresses,
  });
  const tx = new Transaction().add(createIx, extendIx);
  tx.feePayer = payer;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return { signature, lookupTableAddress, createdSlot: recentSlot };
}

async function waitForLatestLookupTable(conn, _payer, lookupTableAddress, createdSlot) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const [slot, table] = await Promise.all([
      conn.getSlot("confirmed"),
      conn.getAddressLookupTable(lookupTableAddress, { commitment: "confirmed" }),
    ]);
    if (slot > createdSlot && table.value) return table.value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Address lookup table did not activate: ${lookupTableAddress.toBase58()}`);
}

async function buildRuleChainContext({ requireTargetPda = false, transactionPhase = "publish_sign" } = {}) {
  const validation = await ensureValidatedProposal();
  if (!validation.ok) return { ok: false, message: validation.messages.join(" ") };
  if (!state.signedProof) return { ok: false, message: t("civilization.ruleLibrary.flow.signBeforeStage") };
  if (!state.deployPacket) {
    const staged = await stageDeployPacket();
    if (!staged.ok) return staged;
  }
  const target = ruleTargets.find((item) => item.id === state.proposalEnvelope?.patch?.target_id);
  const packetSigner = state.signedProof?.signer;
  if (!packetSigner) return { ok: false, message: t("civilization.ruleLibrary.chain.noSigner") };
  const targetPda = extractTargetPda(target);
  if (requireTargetPda && !targetPda) {
    state.chainPlan = buildBlockedChainPlan(target, t("civilization.ruleLibrary.chain.noTargetPda"), { phase: "publish_sign" });
    renderChainPlan();
    return { ok: false, message: t("civilization.ruleLibrary.chain.noTargetPda") };
  }
  const payer = transactionPayerForPhase(transactionPhase, packetSigner);
  const signatureSigner = new PublicKey(packetSigner);
  const targetProgram = new PublicKey(targetProgramIds[target?.module] || targetProgramIds.civic);
  const targetPdaKey = targetPda ? new PublicKey(targetPda) : null;
  const [ruleBook] = deriveRuleBookPda({ ruleIdHash: state.proposalEnvelope.rule_id_hash });
  const [signaturePda] = deriveRuleSignaturePda({ ruleBook, signer: signatureSigner });
  const [tallyPda] = deriveRuleTallyPda({ ruleBook });
  const [receiptPda] = deriveExecutionReceiptPda({ ruleBook });
  return {
    ok: true,
    payer,
    target,
    targetProgram,
    targetPdaKey,
    ruleBook,
    signaturePda,
    tallyPda,
    receiptPda,
  };
}

function transactionPayerForPhase(phase, packetSigner) {
  if (phase === "publish_sign") return new PublicKey(packetSigner);
  const session = getWalletSession();
  const sessionKey = parsePublicKeyString(session.walletAddress);
  if (sessionKey) return sessionKey;
  for (const provider of detectWalletProviders()) {
    const providerKey = parsePublicKeyString(publicKeyToString(provider.publicKey));
    if (providerKey) return providerKey;
  }
  return new PublicKey(packetSigner);
}

function collectFinalizeSignaturePdas(context = {}) {
  const currentSignaturePda = context.signaturePda ?? deriveCurrentSignaturePda();
  if (!currentSignaturePda) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.signatures.currentMissing"),
      signatures: [],
      currentSignaturePda: null,
      additionalSignaturePdas: [],
    };
  }
  const parsed = parseAdditionalSignaturePdas();
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message,
      signatures: [currentSignaturePda],
      currentSignaturePda,
      additionalSignaturePdas: [],
    };
  }
  const unique = new Map([[currentSignaturePda.toBase58(), currentSignaturePda]]);
  for (const pda of parsed.pdas) unique.set(pda.toBase58(), pda);
  const signatures = Array.from(unique.values());
  return {
    ok: true,
    signatures,
    currentSignaturePda,
    additionalSignaturePdas: signatures.filter((pda) => pda.toBase58() !== currentSignaturePda.toBase58()),
  };
}

async function buildDeploySignatureCollection() {
  const signatureSet = collectFinalizeSignaturePdas();
  if (!signatureSet.ok) {
    return { ok: false, message: signatureSet.message };
  }
  const currentSignerPda = signatureSet.currentSignaturePda.toBase58();
  const ruleSignaturePdas = signatureSet.signatures.map((pda) => pda.toBase58());
  const signatureCollectionHash = await deploySignatureCollectionHash(ruleSignaturePdas);
  return {
    ok: true,
    collection: {
      kind: "nicechunk.civilization.signature_collection.v1",
      source: "composer_finalize_signature_pdas",
      hash_algorithm: "sha256:stable_json_civilization_signature_collection.v1",
      signature_collection_hash: signatureCollectionHash,
      current_signer_signature_pda: currentSignerPda,
      additional_signature_pdas: signatureSet.additionalSignaturePdas.map((pda) => pda.toBase58()),
      rule_signature_pdas: ruleSignaturePdas,
      signature_count: ruleSignaturePdas.length,
      updated_at: new Date().toISOString(),
      note: "Forward this collection with the deploy packet so later signers and finalizers can preserve known public signature PDAs.",
    },
  };
}

async function buildDeployPacketLineage({ sourcePacket, signatureCollection }) {
  const sourceHash = sourcePacket ? await deployPacketContentHash(sourcePacket) : "";
  const previousLineage = sourcePacket?.lineage || {};
  const previousHop = Number(previousLineage.hop ?? 0);
  return {
    kind: "nicechunk.civilization.deploy_lineage.v1",
    hop: sourcePacket ? previousHop + 1 : 0,
    source: sourcePacket ? "imported_or_loaded_deploy_packet" : "local_first_signer",
    previous_deploy_packet_hash: sourceHash,
    previous_signer: sourcePacket?.signature?.signer || "",
    previous_signature_pda: sourcePacket?.signature?.rule_signature_pda || "",
    previous_staged_at: sourcePacket?.staged_at || "",
    current_signer: state.signedProof?.signer || "",
    current_signature_pda: state.signedProof?.rule_signature_pda || "",
    preserved_signature_count: signatureCollection?.signature_count ?? 0,
    preserved_signature_pdas: signatureCollection?.rule_signature_pdas ?? [],
    preserved_signature_collection_hash: signatureCollection?.signature_collection_hash || "",
    created_at: new Date().toISOString(),
    note: sourcePacket
      ? "This deploy packet was restaged after importing or loading a previous packet, preserving its public signature PDA set."
      : "This deploy packet starts a new local signature lineage.",
  };
}

async function deployPacketContentHash(packet) {
  return `sha256:${await sha256Hex(stableJsonStringify(normalizeDeployPacketForHash(packet)))}`;
}

async function deploySignatureCollectionHash(ruleSignaturePdas) {
  const canonicalPdas = Array.from(new Set((ruleSignaturePdas || []).map(String))).sort();
  return `sha256:${await sha256Hex(stableJsonStringify({
    kind: "nicechunk.civilization.signature_collection_hash.v1",
    hash_algorithm: "sha256:stable_json_civilization_signature_collection.v1",
    rule_signature_pdas: canonicalPdas,
  }))}`;
}

function normalizeDeployPacketForHash(packet) {
  if (!packet || typeof packet !== "object") return packet;
  const copy = JSON.parse(JSON.stringify(packet));
  delete copy.local_audit;
  if (copy.lineage) delete copy.lineage.current_deploy_packet_hash;
  return copy;
}

function deriveCurrentSignaturePda() {
  if (!state.proposalEnvelope?.rule_id_hash || !state.signedProof?.signer) return null;
  try {
    const [ruleBook] = deriveRuleBookPda({ ruleIdHash: state.proposalEnvelope.rule_id_hash });
    const [signaturePda] = deriveRuleSignaturePda({ ruleBook, signer: new PublicKey(state.signedProof.signer) });
    return signaturePda;
  } catch {
    return null;
  }
}

function parseAdditionalSignaturePdas() {
  const raw = String(finalizeSignatureInput?.value ?? "").trim();
  if (!raw) return { ok: true, pdas: [] };
  const values = raw
    .split(/[\s,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const pdas = [];
  for (const value of values) {
    try {
      pdas.push(new PublicKey(value));
    } catch {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.signatures.invalid", { value }),
        pdas: [],
      };
    }
  }
  return { ok: true, pdas };
}

async function readFinalizeSignatureProofs({ ruleBook, signatureSet }) {
  const proofs = [];
  const failures = [];
  const seenSigners = new Map();
  const totalActivePower = toU64BigInt(state.proposalEnvelope?.civilization_power_snapshot?.total_active_power);
  let countedSnapshotPower = 0n;
  for (const signaturePda of signatureSet.signatures) {
    const pda = signaturePda.toBase58();
    try {
      const result = await readPdaAccountWithFallback(signaturePda);
      const account = result.value;
      if (!account) {
        const proof = {
          source: "on_chain_rule_signature_pda",
          pda,
          current_signer: pda === signatureSet.currentSignaturePda?.toBase58(),
          exists: false,
          status: "missing",
        };
        proofs.push(proof);
        failures.push({ status: "blocked_finalize_signature_missing", pda });
        continue;
      }
      const data = new Uint8Array(account.data);
      const decoded = decodeCivilizationSignatureProofData(data);
      const expectedSignaturePda = deriveRuleSignaturePda({
        ruleBook,
        signer: new PublicKey(decoded.signer),
      })[0].toBase58();
      const mismatches = [];
      if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
      if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
      if (decoded.snapshot_hash !== stripSha256(state.proposalEnvelope.snapshot_hash)) mismatches.push("snapshot_hash");
      if (expectedSignaturePda !== pda) mismatches.push("signature_pda_seed");
      const snapshotPower = toU64BigInt(decoded.snapshot_power_u64 ?? decoded.snapshot_power);
      if (totalActivePower === null || snapshotPower === null || snapshotPower > totalActivePower) mismatches.push("snapshot_power_exceeds_total");
      if (snapshotPower !== null) {
        countedSnapshotPower += snapshotPower;
        if (totalActivePower === null || countedSnapshotPower > totalActivePower) {
          mismatches.push("signature_set_power_exceeds_total");
        }
      }
      if (seenSigners.has(decoded.signer)) mismatches.push("duplicate_signer");
      seenSigners.set(decoded.signer, pda);
      const proof = {
        source: "on_chain_rule_signature_pda",
        pda,
        expected_signature_pda: expectedSignaturePda,
        signature_pda_seed_verified: expectedSignaturePda === pda,
        current_signer: pda === signatureSet.currentSignaturePda?.toBase58(),
        exists: true,
        status: mismatches.length ? "mismatch" : "verified",
        owner: account.owner.toBase58(),
        lamports: account.lamports,
        bytes: data.length,
        read_slot: result.context.slot,
        data_hash: `sha256:${await sha256HexBytes(data)}`,
        mismatches,
        ...decoded,
      };
      proofs.push(proof);
      if (mismatches.length) {
        failures.push({ status: "blocked_finalize_signature_mismatch", pda, fields: mismatches.join(", ") });
      }
    } catch (error) {
      const reason = error?.message || String(error);
      proofs.push({
        source: "on_chain_rule_signature_pda",
        pda,
        current_signer: pda === signatureSet.currentSignaturePda?.toBase58(),
        exists: false,
        status: "read_failed",
        read_error: reason,
      });
      failures.push({ status: "blocked_finalize_signature_read_failed", pda, reason });
    }
  }
  if (!failures.length) return { ok: true, status: "ready_to_submit", message: "", proofs };
  const missing = failures.filter((item) => item.status === "blocked_finalize_signature_missing");
  const mismatched = failures.filter((item) => item.status === "blocked_finalize_signature_mismatch");
  if (missing.length) {
    return {
      ok: false,
      status: "blocked_finalize_signature_missing",
      message: t("civilization.ruleLibrary.chain.finalizeSignatureMissing", { count: String(missing.length) }),
      proofs,
    };
  }
  if (mismatched.length) {
    return {
      ok: false,
      status: "blocked_finalize_signature_mismatch",
      message: t("civilization.ruleLibrary.chain.finalizeSignatureMismatch", {
        fields: mismatched.map((item) => `${shortAddress(item.pda)}:${item.fields}`).join(", "),
      }),
      proofs,
    };
  }
  return {
    ok: false,
    status: "blocked_finalize_signature_read_failed",
    message: t("civilization.ruleLibrary.chain.finalizeSignatureReadFailed", {
      reason: failures.map((item) => `${shortAddress(item.pda)}:${item.reason || item.status}`).join(", "),
    }),
    proofs,
  };
}

function buildFinalizeThresholdResult(proofs) {
  const totalActivePower = toU64BigInt(state.proposalEnvelope?.civilization_power_snapshot?.total_active_power);
  const rawRequiredYesPower = state.proposalEnvelope?.civilization_power_snapshot?.required_yes_power
    ?? requiredPower(totalActivePower, state.proposalEnvelope?.readable?.threshold_path);
  const requiredYesPower = toU64BigInt(rawRequiredYesPower);
  const thresholdBlocked = requiredYesPower === null;
  let yesPower = 0n;
  let noPower = 0n;
  let abstainPower = 0n;
  let challengePower = 0n;
  const result = {
    source: "decoded_public_rule_signature_pdas",
    signature_count: proofs.filter((proof) => proof.exists && proof.status === "verified").length,
    total_active_power: totalActivePower?.toString() ?? "0",
    required_yes_power: thresholdBlocked ? null : requiredYesPower.toString(),
    threshold_blocked: thresholdBlocked,
    blocked_reason: thresholdBlocked ? "reject_threshold_path" : "",
    yes_power: "0",
    no_power: "0",
    abstain_power: "0",
    challenge_power: "0",
    threshold_met: false,
    signatures: proofs.map((proof) => ({
      pda: proof.pda,
      signer: proof.signer,
      side: proof.side,
      snapshot_power_u64: proof.snapshot_power_u64 ?? String(proof.snapshot_power ?? 0),
      status: proof.status,
    })),
  };
  for (const proof of proofs) {
    if (!proof.exists || proof.status !== "verified") continue;
    const power = toU64BigInt(proof.snapshot_power_u64 ?? proof.snapshot_power) ?? 0n;
    if (proof.side === "agree") yesPower += power;
    else if (proof.side === "reject") noPower += power;
    else if (proof.side === "abstain") abstainPower += power;
    else if (proof.side === "challenge") challengePower += power;
  }
  result.yes_power = yesPower.toString();
  result.no_power = noPower.toString();
  result.abstain_power = abstainPower.toString();
  result.challenge_power = challengePower.toString();
  result.threshold_met = thresholdMetForRule({
    yesPower,
    noPower,
    requiredPower: requiredYesPower,
  });
  result.projected_passes_after_this_signature = result.threshold_met;
  return result;
}

async function readRuleBookPublicationProof({ ruleBook }) {
  try {
    const result = await readPdaAccountWithFallback(ruleBook);
    const account = result.value;
    if (!account) {
      return {
        ok: true,
        exists: false,
        message: "",
        proof: {
          source: "on_chain_rule_book_pda",
          pda: ruleBook.toBase58(),
          exists: false,
          publish_mode: "publish_and_sign_rule",
        },
      };
    }
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationRuleBookProofData(data);
    const expected = expectedRuleBookChainFields();
    const mismatches = Object.entries(expected)
      .filter(([, value]) => value !== undefined && value !== "")
      .filter(([key, value]) => decoded[key] !== value)
      .map(([key]) => key);
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    const proof = {
      source: "on_chain_rule_book_pda",
      pda: ruleBook.toBase58(),
      exists: true,
      publish_mode: mismatches.length ? "blocked_chain_mismatch" : "sign_existing_rule",
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      expected,
      mismatches,
      ...decoded,
    };
    if (mismatches.length) {
      return {
        ok: false,
        exists: true,
        message: t("civilization.ruleLibrary.chain.ruleBookHashMismatch", { fields: mismatches.join(", ") }),
        proof,
      };
    }
    return { ok: true, exists: true, message: "", proof };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      message: t("civilization.ruleLibrary.chain.ruleBookReadFailed", { reason: error?.message || String(error) }),
      proof: {
        source: "on_chain_rule_book_pda",
        pda: ruleBook.toBase58(),
        read_error: error?.message || String(error),
      },
    };
  }
}

function decodeCivilizationRuleBookProofData(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  if (magic !== "NCKCVR01") throw new Error(`Invalid RuleBook magic: ${magic}`);
  const totalActivePower = view.getBigUint64(236, true);
  const requiredPower = view.getBigUint64(244, true);
  const yesPower = view.getBigUint64(256, true);
  const noPower = view.getBigUint64(264, true);
  const abstainPower = view.getBigUint64(272, true);
  const challengePower = view.getBigUint64(280, true);
  return {
    magic,
    version: view.getUint16(8, true),
    bump: data[10] ?? 0,
    status: data[11] ?? 0,
    author: pubkeyAt(data, 12),
    rule_id_hash: toHex(data.slice(44, 76)),
    text_hash: toHex(data.slice(76, 108)),
    patch_hash: toHex(data.slice(108, 140)),
    snapshot_hash: toHex(data.slice(140, 172)),
    target_program: pubkeyAt(data, 172),
    target_pda: pubkeyAt(data, 204),
    total_active_power: safeU64Number(totalActivePower),
    total_active_power_u64: totalActivePower.toString(),
    required_power: safeU64Number(requiredPower),
    required_power_u64: requiredPower.toString(),
    threshold_bps: view.getUint16(252, true),
    target_status: data[254] ?? 0,
    risk_level: data[255] ?? 0,
    yes_power: safeU64Number(yesPower),
    yes_power_u64: yesPower.toString(),
    no_power: safeU64Number(noPower),
    no_power_u64: noPower.toString(),
    abstain_power: safeU64Number(abstainPower),
    abstain_power_u64: abstainPower.toString(),
    challenge_power: safeU64Number(challengePower),
    challenge_power_u64: challengePower.toString(),
    created_slot: readU64String(view, 288),
    finalized_slot: readU64String(view, 296),
    executed_slot: readU64String(view, 304),
  };
}

function expectedRuleBookChainFields() {
  const proposal = state.proposalEnvelope || {};
  const snapshot = proposal.civilization_power_snapshot || {};
  const target = ruleTargets.find((item) => item.id === proposal.patch?.target_id);
  const thresholdBps = Number(snapshot.threshold_bps ?? thresholdBpsForPath(proposal.readable?.threshold_path));
  const totalActivePower = toU64BigInt(snapshot.total_active_power) ?? 0n;
  const expected = {
    rule_id_hash: stripSha256(proposal.rule_id_hash),
    text_hash: stripSha256(proposal.text_hash),
    patch_hash: stripSha256(proposal.patch_hash),
    snapshot_hash: stripSha256(proposal.snapshot_hash),
    target_program: proposal.target_refs?.target_program || proposal.patch?.target_program || "",
    target_pda: proposal.target_refs?.target_pda || proposal.patch?.target_pda || "",
    total_active_power: safeU64Number(totalActivePower),
    total_active_power_u64: totalActivePower.toString(),
    threshold_bps: thresholdBps,
    target_status: targetStatusCode(target?.status),
    risk_level: riskLevelCode(proposal.readable?.risk_level),
  };
  if (thresholdBps > 0 && totalActivePower > 0n) {
    try {
      const requiredPower = civilizationRequiredPower(totalActivePower, thresholdBps);
      expected.required_power = safeU64Number(requiredPower);
      expected.required_power_u64 = requiredPower.toString();
    } catch {
      expected.required_power = undefined;
      expected.required_power_u64 = undefined;
    }
  }
  return expected;
}

async function readCurrentSignatureProof({ ruleBook, signaturePda, signer }) {
  try {
    const result = await readPdaAccountWithFallback(signaturePda);
    const account = result.value;
    if (!account) {
      return {
        ok: true,
        exists: false,
        status: "ready_to_submit",
        message: "",
        proof: {
          source: "on_chain_rule_signature_pda",
          pda: signaturePda.toBase58(),
          exists: false,
          signer: signer.toBase58(),
        },
      };
    }
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationSignatureProofData(data);
    const expectedSignaturePda = deriveRuleSignaturePda({
      ruleBook,
      signer: new PublicKey(decoded.signer),
    })[0].toBase58();
    const mismatches = [];
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    if (decoded.signer !== signer.toBase58()) mismatches.push("signer");
    if (decoded.snapshot_hash !== stripSha256(state.proposalEnvelope.snapshot_hash)) mismatches.push("snapshot_hash");
    if (expectedSignaturePda !== signaturePda.toBase58()) mismatches.push("signature_pda_seed");
    const proof = {
      source: "on_chain_rule_signature_pda",
      pda: signaturePda.toBase58(),
      expected_signature_pda: expectedSignaturePda,
      signature_pda_seed_verified: expectedSignaturePda === signaturePda.toBase58(),
      exists: true,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      mismatches,
      ...decoded,
    };
    if (mismatches.length) {
      return {
        ok: false,
        exists: true,
        status: "blocked_signature_mismatch",
        message: t("civilization.ruleLibrary.chain.signatureMismatch", { fields: mismatches.join(", ") }),
        proof,
      };
    }
    return {
      ok: false,
      exists: true,
      status: "blocked_signature_exists",
      message: t("civilization.ruleLibrary.chain.signatureAlreadyExists"),
      proof,
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      status: "blocked_signature_read_failed",
      message: t("civilization.ruleLibrary.chain.signatureReadFailed", { reason: error?.message || String(error) }),
      proof: {
        source: "on_chain_rule_signature_pda",
        pda: signaturePda.toBase58(),
        signer: signer.toBase58(),
        read_error: error?.message || String(error),
      },
    };
  }
}

function decodeCivilizationSignatureProofData(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  if (magic !== "NCKCVS01") throw new Error(`Invalid RuleSignature magic: ${magic}`);
  const snapshotPower = view.getBigUint64(108, true);
  return {
    magic,
    version: view.getUint16(8, true),
    bump: data[10] ?? 0,
    side: sideName(data[11] ?? 0),
    side_code: data[11] ?? 0,
    rule_book: pubkeyAt(data, 12),
    signer: pubkeyAt(data, 44),
    snapshot_hash: toHex(data.slice(76, 108)),
    snapshot_power: safeU64Number(snapshotPower),
    snapshot_power_u64: snapshotPower.toString(),
    signed_slot: readU64String(view, 116),
    signed_at: readI64String(view, 124),
  };
}

async function readFinalizedTallyProof({ ruleBook, tallyPda }) {
  const localPreview = state.deployPacket?.threshold_result || buildThresholdResult(state.proposalEnvelope, state.signedProof);
  const expectedTallyPda = deriveRuleTallyPda({ ruleBook })[0].toBase58();
  try {
    const result = await readPdaAccountWithFallback(tallyPda);
    const account = result.value;
    if (!account) {
      return {
        ok: false,
        thresholdMet: false,
        status: "blocked_tally_missing",
        message: t("civilization.ruleLibrary.chain.tallyMissing"),
        threshold_result: localPreview,
        proof: {
          source: "on_chain_rule_tally_pda",
          pda: tallyPda.toBase58(),
          expected_tally_pda: expectedTallyPda,
          tally_pda_seed_verified: expectedTallyPda === tallyPda.toBase58(),
          expected_rule_book: ruleBook.toBase58(),
          exists: false,
          fallback_preview: localPreview,
        },
      };
    }
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationTallyProofData(data);
    const mismatches = [];
    if (expectedTallyPda !== tallyPda.toBase58()) mismatches.push("tally_pda_seed");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    if (mismatches.length) {
      return {
        ok: false,
        thresholdMet: false,
        status: "blocked_tally_mismatch",
        message: t("civilization.ruleLibrary.chain.tallyRuleMismatch"),
        threshold_result: localPreview,
        proof: {
          source: "on_chain_rule_tally_pda",
          pda: tallyPda.toBase58(),
          expected_tally_pda: expectedTallyPda,
          tally_pda_seed_verified: expectedTallyPda === tallyPda.toBase58(),
          expected_rule_book: ruleBook.toBase58(),
          decoded_rule_book: decoded.rule_book,
          mismatches,
          read_slot: result.context.slot,
          data_hash: `sha256:${await sha256HexBytes(data)}`,
        },
      };
    }
    const threshold = {
      source: "on_chain_rule_tally_pda",
      threshold_path: state.proposalEnvelope.readable.threshold_path,
      threshold_bps: state.proposalEnvelope.civilization_power_snapshot.threshold_bps,
      total_active_power: String(state.proposalEnvelope.civilization_power_snapshot.total_active_power),
      required_yes_power: decoded.required_power_u64,
      yes_power: decoded.yes_power_u64,
      no_power: decoded.no_power_u64,
      abstain_power: decoded.abstain_power_u64,
      challenge_power: decoded.challenge_power_u64,
      threshold_met: decoded.threshold_met,
      finalized_slot: decoded.finalized_slot,
      read_slot: result.context.slot,
      projected_passes_after_this_signature: decoded.threshold_met,
      note: "Execution readiness is based on the public RuleTally PDA, not a local signature preview.",
    };
    return {
      ok: decoded.threshold_met,
      thresholdMet: decoded.threshold_met,
      status: decoded.threshold_met ? "ready_to_submit" : "blocked_threshold",
      message: decoded.threshold_met
        ? t("civilization.ruleLibrary.chain.tallyPassed")
        : t("civilization.ruleLibrary.chain.thresholdBlocked"),
      threshold_result: threshold,
      proof: {
        source: "on_chain_rule_tally_pda",
        pda: tallyPda.toBase58(),
        expected_tally_pda: expectedTallyPda,
        tally_pda_seed_verified: true,
        owner: account.owner.toBase58(),
        lamports: account.lamports,
        bytes: data.length,
        read_slot: result.context.slot,
        data_hash: `sha256:${await sha256HexBytes(data)}`,
        ...decoded,
      },
    };
  } catch (error) {
    return {
      ok: false,
      thresholdMet: false,
      status: "blocked_tally_read_failed",
      message: t("civilization.ruleLibrary.chain.tallyReadFailed", { reason: error?.message || String(error) }),
      threshold_result: localPreview,
      proof: {
        source: "on_chain_rule_tally_pda",
        pda: tallyPda.toBase58(),
        expected_tally_pda: expectedTallyPda,
        tally_pda_seed_verified: expectedTallyPda === tallyPda.toBase58(),
        expected_rule_book: ruleBook.toBase58(),
        read_error: error?.message || String(error),
        fallback_preview: localPreview,
      },
    };
  }
}

async function readExecuteReadiness({ ruleBook, tallyPda, receiptPda }) {
  const tallyProof = await readFinalizedTallyProof({ ruleBook, tallyPda });
  if (!tallyProof.ok || !tallyProof.thresholdMet) {
    return {
      ok: false,
      status: tallyProof.status,
      message: tallyProof.message,
      tallyProof,
      receiptProof: null,
    };
  }
  const receiptProof = await readExecutionReceiptProof({ ruleBook, receiptPda });
  if (!receiptProof.ok) {
    return {
      ok: false,
      status: receiptProof.status,
      message: receiptProof.message,
      tallyProof,
      receiptProof,
    };
  }
  return {
    ok: true,
    status: "ready_to_submit",
    message: "",
    tallyProof,
    receiptProof,
  };
}

async function readExecutionReceiptProof({ ruleBook, receiptPda }) {
  const expectedReceiptPda = deriveExecutionReceiptPda({ ruleBook })[0].toBase58();
  try {
    const result = await readPdaAccountWithFallback(receiptPda);
    const account = result.value;
    if (!account) {
      return {
        ok: true,
        exists: false,
        status: "ready_to_submit",
        message: "",
        proof: {
          source: "on_chain_execution_receipt_pda",
          pda: receiptPda.toBase58(),
          expected_execution_receipt_pda: expectedReceiptPda,
          execution_receipt_pda_seed_verified: expectedReceiptPda === receiptPda.toBase58(),
          expected_rule_book: ruleBook.toBase58(),
          exists: false,
        },
      };
    }
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationReceiptProofData(data);
    const mismatches = [];
    if (expectedReceiptPda !== receiptPda.toBase58()) mismatches.push("execution_receipt_pda_seed");
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    const proof = {
      source: "on_chain_execution_receipt_pda",
      pda: receiptPda.toBase58(),
      expected_execution_receipt_pda: expectedReceiptPda,
      execution_receipt_pda_seed_verified: expectedReceiptPda === receiptPda.toBase58(),
      expected_rule_book: ruleBook.toBase58(),
      exists: true,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      mismatches,
      ...decoded,
    };
    if (mismatches.length) {
      return {
        ok: false,
        exists: true,
        status: "blocked_receipt_mismatch",
        message: t("civilization.ruleLibrary.chain.receiptRuleMismatch", { fields: mismatches.join(", ") }),
        proof,
      };
    }
    return {
      ok: false,
      exists: true,
      status: "blocked_receipt_exists",
      message: t("civilization.ruleLibrary.chain.receiptAlreadyExists"),
      proof,
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      status: "blocked_receipt_read_failed",
      message: t("civilization.ruleLibrary.chain.receiptReadFailed", { reason: error?.message || String(error) }),
      proof: {
        source: "on_chain_execution_receipt_pda",
        pda: receiptPda.toBase58(),
        expected_execution_receipt_pda: expectedReceiptPda,
        execution_receipt_pda_seed_verified: expectedReceiptPda === receiptPda.toBase58(),
        expected_rule_book: ruleBook.toBase58(),
        read_error: error?.message || String(error),
      },
    };
  }
}

async function readRuleBookPostSubmitProof({ ruleBook }) {
  try {
    const result = await readPdaAccountWithFallback(ruleBook);
    const account = result.value;
    if (!account) return missingPostSubmitProof("on_chain_rule_book_pda", ruleBook);
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationRuleBookProofData(data);
    const expected = expectedRuleBookChainFields();
    const mismatches = Object.entries(expected)
      .filter(([, value]) => value !== undefined && value !== "")
      .filter(([key, value]) => decoded[key] !== value)
      .map(([key]) => key);
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    return {
      source: "on_chain_rule_book_pda",
      pda: ruleBook.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      mismatches,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      expected,
      ...decoded,
    };
  } catch (error) {
    return failedPostSubmitProof("on_chain_rule_book_pda", ruleBook, error);
  }
}

async function readSignaturePostSubmitProof({ ruleBook, signaturePda, signer }) {
  try {
    const result = await readPdaAccountWithFallback(signaturePda);
    const account = result.value;
    if (!account) return missingPostSubmitProof("on_chain_rule_signature_pda", signaturePda);
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationSignatureProofData(data);
    const expectedSignaturePda = deriveRuleSignaturePda({
      ruleBook,
      signer: new PublicKey(decoded.signer),
    })[0].toBase58();
    const mismatches = [];
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    if (decoded.signer !== signer.toBase58()) mismatches.push("signer");
    if (decoded.snapshot_hash !== stripSha256(state.proposalEnvelope.snapshot_hash)) mismatches.push("snapshot_hash");
    if (expectedSignaturePda !== signaturePda.toBase58()) mismatches.push("signature_pda_seed");
    return {
      source: "on_chain_rule_signature_pda",
      pda: signaturePda.toBase58(),
      expected_signature_pda: expectedSignaturePda,
      signature_pda_seed_verified: expectedSignaturePda === signaturePda.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      mismatches,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      ...decoded,
    };
  } catch (error) {
    return failedPostSubmitProof("on_chain_rule_signature_pda", signaturePda, error);
  }
}

async function readTallyPostSubmitProof({ ruleBook, tallyPda }) {
  try {
    const result = await readPdaAccountWithFallback(tallyPda);
    const account = result.value;
    if (!account) return missingPostSubmitProof("on_chain_rule_tally_pda", tallyPda);
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationTallyProofData(data);
    const mismatches = [];
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    return {
      source: "on_chain_rule_tally_pda",
      pda: tallyPda.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      mismatches,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      ...decoded,
    };
  } catch (error) {
    return failedPostSubmitProof("on_chain_rule_tally_pda", tallyPda, error);
  }
}

async function readReceiptPostSubmitProof({ ruleBook, receiptPda }) {
  try {
    const result = await readPdaAccountWithFallback(receiptPda);
    const account = result.value;
    if (!account) return missingPostSubmitProof("on_chain_execution_receipt_pda", receiptPda);
    const data = new Uint8Array(account.data);
    const decoded = decodeCivilizationReceiptProofData(data);
    const mismatches = [];
    if (account.owner.toBase58() !== civilizationProgramId) mismatches.push("owner");
    if (decoded.rule_book !== ruleBook.toBase58()) mismatches.push("rule_book");
    if (!decoded.executed) mismatches.push("executed");
    return {
      source: "on_chain_execution_receipt_pda",
      pda: receiptPda.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      mismatches,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      ...decoded,
    };
  } catch (error) {
    return failedPostSubmitProof("on_chain_execution_receipt_pda", receiptPda, error);
  }
}

async function readTargetPdaPreSubmitProof({ target, targetPda, expectedOldValueHash }) {
  const publicKey = new PublicKey(targetPda);
  try {
    const result = await readPdaAccountWithFallback(publicKey);
    const account = result.value;
    if (!account) return {
      ...missingPostSubmitProof("pre_submit_target_pda", publicKey),
      expected_old_value_hash: expectedOldValueHash || "",
      old_value_hash_verified: false,
    };
    const data = new Uint8Array(account.data);
    const dataHash = `sha256:${await sha256HexBytes(data)}`;
    const expectedOwner = targetProgramIds[target?.module] || "";
    const mismatches = [
      ...(expectedOwner && account.owner.toBase58() !== expectedOwner ? ["owner"] : []),
      ...(expectedOldValueHash && expectedOldValueHash !== dataHash ? ["old_value_hash"] : []),
    ];
    return {
      source: "pre_submit_target_pda",
      target_id: target?.id || "",
      pda: publicKey.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      status: mismatches.length ? "mismatch" : "verified",
      mismatches,
      owner: account.owner.toBase58(),
      expected_owner: expectedOwner,
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: dataHash,
      expected_old_value_hash: expectedOldValueHash || "",
      old_value_hash_verified: Boolean(expectedOldValueHash) && expectedOldValueHash === dataHash,
    };
  } catch (error) {
    return {
      ...failedPostSubmitProof("pre_submit_target_pda", publicKey, error),
      expected_old_value_hash: expectedOldValueHash || "",
      old_value_hash_verified: false,
    };
  }
}

async function readTargetPdaPostSubmitProof({ target, targetPda, targetPreimageProof = null }) {
  const publicKey = new PublicKey(targetPda);
  try {
    const result = await readPdaAccountWithFallback(publicKey);
    const account = result.value;
    if (!account) return missingPostSubmitProof("on_chain_target_pda", publicKey);
    const data = new Uint8Array(account.data);
    const expectedOwner = targetProgramIds[target?.module] || "";
    const patchProof = await buildTargetPatchPostSubmitProof({ target, data });
    const mismatches = [
      ...(expectedOwner && account.owner.toBase58() !== expectedOwner ? ["owner"] : []),
      ...(patchProof.ok ? [] : patchProof.mismatches),
    ];
    return {
      source: "on_chain_target_pda",
      target_id: target?.id || "",
      pda: publicKey.toBase58(),
      exists: true,
      verified: mismatches.length === 0,
      mismatches,
      owner: account.owner.toBase58(),
      expected_owner: expectedOwner,
      lamports: account.lamports,
      bytes: data.length,
      read_slot: result.context.slot,
      data_hash: `sha256:${await sha256HexBytes(data)}`,
      pre_execute_data_hash: targetPreimageProof?.data_hash || "",
      expected_old_value_hash: targetPreimageProof?.expected_old_value_hash || state.proposalEnvelope?.patch?.old_value_hash || "",
      old_value_hash_verified: Boolean(targetPreimageProof?.old_value_hash_verified),
      target_patch_proof: patchProof,
    };
  } catch (error) {
    return failedPostSubmitProof("on_chain_target_pda", publicKey, error);
  }
}

async function buildTargetPatchPostSubmitProof({ target, data }) {
  if (target?.id === "resource-drops") return buildResourceDropTargetPatchProof(data);
  if (target?.id === "smelting-recipes") return buildSmeltingTargetPatchProof(data);
  return {
    kind: "nicechunk.civilization.target_patch_proof.v1",
    target_id: target?.id || "",
    ok: true,
    status: "not_applicable",
    readable_summary: {
      scope: "not_applicable",
    },
    mismatches: [],
  };
}

async function buildResourceDropTargetPatchProof(data) {
  const mismatches = [];
  const expectedRules = buildResourceDropRulesFromPatch(state.proposalEnvelope.patch.proposed_value);
  const expectedBytes = encodeCivilizationResourceDropRulesPatch(expectedRules);
  const expectedHash = `sha256:${await sha256HexBytes(expectedBytes)}`;
  const magic = ascii(data.slice(0, 8));
  const version = data[8] ?? 0;
  const ruleCount = data[10] ?? 0;
  const actualEnd = 16 + ruleCount * 23;
  if (magic !== "NCKDRP02") mismatches.push("magic");
  if (version !== 2) mismatches.push("version");
  if (ruleCount !== expectedRules.length) mismatches.push("rule_count");
  if (actualEnd > data.length) mismatches.push("rule_bytes");
  const actualBytes = actualEnd <= data.length
    ? concatBytes(new Uint8Array([ruleCount]), data.slice(16, actualEnd))
    : new Uint8Array();
  const actualHash = `sha256:${await sha256HexBytes(actualBytes)}`;
  if (state.proposalEnvelope.patch_hash !== expectedHash) mismatches.push("proposal_patch_hash");
  if (expectedHash !== actualHash) mismatches.push("patch_hash");
  return {
    kind: "nicechunk.civilization.target_patch_proof.v1",
    target_id: "resource-drops",
    byte_encoding: "encodeCivilizationResourceDropRulesPatch",
    expected_patch_hash: expectedHash,
    proposal_patch_hash: state.proposalEnvelope.patch_hash,
    actual_patch_hash: actualHash,
    expected_rule_count: expectedRules.length,
    actual_rule_count: ruleCount,
    readable_summary: summarizeResourceDropRulesPatch(expectedRules),
    ok: mismatches.length === 0,
    mismatches,
  };
}

async function buildSmeltingTargetPatchProof(data) {
  const mismatches = [];
  const recipe = buildSmeltingRecipeFromPatch(state.proposalEnvelope.patch.proposed_value);
  const expectedBytes = encodeCivilizationSmeltingRecipePatch(recipe);
  const expectedHash = `sha256:${await sha256HexBytes(expectedBytes)}`;
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  const version = data.length >= 10 ? view.getUint16(8, true) : 0;
  const initialized = data[11] === 1;
  if (magic !== RECIPE_TABLE_MAGIC) mismatches.push("magic");
  if (version !== 2) mismatches.push("version");
  if (!initialized) mismatches.push("initialized");
  const recipeId = BigInt(recipe.recipeId).toString();
  const record = extractSmeltingRecipePatchBytes(data, recipeId);
  if (!record.found) mismatches.push("recipe_id");
  const actualHash = `sha256:${await sha256HexBytes(record.bytes)}`;
  if (state.proposalEnvelope.patch_hash !== expectedHash) mismatches.push("proposal_patch_hash");
  if (expectedHash !== actualHash) mismatches.push("patch_hash");
  return {
    kind: "nicechunk.civilization.target_patch_proof.v1",
    target_id: "smelting-recipes",
    byte_encoding: "encodeCivilizationSmeltingRecipePatch",
    expected_patch_hash: expectedHash,
    proposal_patch_hash: state.proposalEnvelope.patch_hash,
    actual_patch_hash: actualHash,
    recipe_id: recipeId,
    record_index: record.index,
    readable_summary: summarizeSmeltingRecipePatch(recipe),
    ok: mismatches.length === 0,
    mismatches,
  };
}

function summarizeResourceDropRulesPatch(rules) {
  const nonZeroDrops = rules.filter((rule) => Number(rule.chanceBps) > 0);
  return {
    scope: "replace_full_resource_drop_table",
    rule_count: rules.length,
    nonzero_drop_count: nonZeroDrops.length,
    sample_rules: nonZeroDrops.slice(0, 8).map((rule) => ({
      source_block_id: rule.sourceBlockId,
      drop_block_id: rule.dropBlockId,
      chance_bps: rule.chanceBps,
      altitude: `${rule.minAltitude}..${rule.maxAltitude}`,
      depth: `${rule.minDepth}..${rule.maxDepth}`,
      volume_mm3: `${rule.minVolumeMm3}..${rule.maxVolumeMm3}`,
      salt: rule.salt,
    })),
  };
}

function summarizeSmeltingRecipePatch(recipe) {
  return {
    scope: "upsert_smelting_recipe",
    recipe_id: String(recipe.recipeId),
    enabled: Boolean(recipe.enabled),
    min_heat_tier: recipe.minHeatTier,
    yield_bps: recipe.yieldBps,
    input_count: recipe.inputs.length,
    output_count: recipe.outputs.length,
    inputs: recipe.inputs.slice(0, 6).map(summarizeRecipeSlotPatch),
    outputs: recipe.outputs.slice(0, 6).map(summarizeRecipeSlotPatch),
  };
}

function summarizeRecipeSlotPatch(slot) {
  return {
    kind: slot.kind === 2 ? "item" : "resource",
    category: slot.category,
    quantity: slot.quantity,
    item_code: slot.itemCode,
    item_id: String(slot.itemId ?? 0),
    resource: {
      x: slot.resource.worldX,
      y: slot.resource.worldY,
      z: slot.resource.worldZ,
    },
    volume_mm3: slot.volumeMm3,
    durability: `${slot.durabilityCurrent}/${slot.durabilityMax}`,
    grade: slot.grade,
    quality_bps: slot.qualityBps,
  };
}

function extractSmeltingRecipePatchBytes(data, recipeId) {
  const view = dataView(data);
  for (let index = 0; index < RECIPE_TABLE_MAX_RECIPES; index += 1) {
    const offset = RECIPE_TABLE_HEADER_LEN + index * RECIPE_RECORD_LEN;
    if (offset + RECIPE_RECORD_LEN > data.length) break;
    if (readU64String(view, offset) !== recipeId) continue;
    const inputCount = data[offset + 10] ?? 0;
    const outputCount = data[offset + 11] ?? 0;
    const inputBase = offset + 16;
    const outputBase = inputBase + 8 * 80;
    const inputEnd = inputBase + inputCount * 80;
    const outputEnd = outputBase + outputCount * 80;
    if (inputEnd > outputBase || outputEnd > offset + RECIPE_RECORD_LEN) {
      return { found: true, index, bytes: new Uint8Array() };
    }
    return {
      found: true,
      index,
      bytes: concatBytes(
        data.slice(offset, offset + 16),
        data.slice(inputBase, inputEnd),
        data.slice(outputBase, outputEnd),
      ),
    };
  }
  return { found: false, index: -1, bytes: new Uint8Array() };
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function missingPostSubmitProof(source, publicKey) {
  return {
    source,
    pda: publicKey.toBase58(),
    exists: false,
    verified: false,
    status: "missing_after_submit",
  };
}

function failedPostSubmitProof(source, publicKey, error) {
  return {
    source,
    pda: publicKey.toBase58(),
    exists: false,
    verified: false,
    status: "read_failed_after_submit",
    reason: error?.message || String(error),
  };
}

function decodeCivilizationTallyProofData(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  if (magic !== "NCKCVT01") throw new Error(`Invalid RuleTally magic: ${magic}`);
  const yesPower = view.getBigUint64(44, true);
  const noPower = view.getBigUint64(52, true);
  const abstainPower = view.getBigUint64(60, true);
  const challengePower = view.getBigUint64(68, true);
  const requiredPower = view.getBigUint64(76, true);
  return {
    magic,
    version: view.getUint16(8, true),
    bump: data[10] ?? 0,
    threshold_met: data[11] === 1,
    rule_book: pubkeyAt(data, 12),
    yes_power: safeU64Number(yesPower),
    yes_power_u64: yesPower.toString(),
    no_power: safeU64Number(noPower),
    no_power_u64: noPower.toString(),
    abstain_power: safeU64Number(abstainPower),
    abstain_power_u64: abstainPower.toString(),
    challenge_power: safeU64Number(challengePower),
    challenge_power_u64: challengePower.toString(),
    required_power: safeU64Number(requiredPower),
    required_power_u64: requiredPower.toString(),
    finalized_slot: readU64String(view, 84),
  };
}

function decodeCivilizationReceiptProofData(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  if (magic !== "NCKCVE01") throw new Error(`Invalid ExecutionReceipt magic: ${magic}`);
  return {
    magic,
    version: view.getUint16(8, true),
    bump: data[10] ?? 0,
    executed: data[11] === 1,
    rule_book: pubkeyAt(data, 12),
    executor: pubkeyAt(data, 44),
    executed_slot: readU64String(view, 76),
    executed_at: readI64String(view, 84),
  };
}

async function ensureValidatedProposal() {
  if (state.proposalEnvelope && state.validation?.ok) return { ok: true, messages: [] };
  return validateProposal();
}

function renderFlowState() {
  if (!flowStepsTarget) return;
  const steps = [
    { id: "draft", done: true },
    { id: "validate", done: Boolean(state.validation?.ok), blocked: state.validation && !state.validation.ok },
    { id: "sign", done: Boolean(state.signedProof) },
    { id: "stage", done: Boolean(state.deployPacket) },
  ];
  flowStepsTarget.replaceChildren(
    ...steps.map((step) => {
      const item = document.createElement("li");
      item.className = "rule-flow-step";
      item.dataset.done = String(Boolean(step.done));
      item.dataset.blocked = String(Boolean(step.blocked));
      item.innerHTML = `
        <span>${t(`civilization.ruleLibrary.flow.steps.${step.id}.label`)}</span>
        <strong>${t(`civilization.ruleLibrary.flow.steps.${step.id}.${step.done ? "done" : step.blocked ? "blocked" : "pending"}`)}</strong>
      `;
      return item;
    }),
  );
}

function renderFinalizeSignatureCollector() {
  if (!signatureCurrentTarget || !signatureSummaryTarget) return;
  const signatureSet = collectFinalizeSignaturePdas();
  const currentPda = signatureSet.currentSignaturePda?.toBase58?.() ?? "";
  signatureCurrentTarget.innerHTML = currentPda
    ? `
      <span>${t("civilization.ruleLibrary.signatures.current")}</span>
      <code>${escapeHtml(currentPda)}</code>
    `
    : `
      <span>${t("civilization.ruleLibrary.signatures.current")}</span>
      <strong>${t("civilization.ruleLibrary.signatures.currentPending")}</strong>
    `;
  if (!currentPda) {
    signatureSummaryTarget.dataset.type = "pending";
    signatureSummaryTarget.textContent = t("civilization.ruleLibrary.signatures.currentPending");
    return;
  }
  signatureSummaryTarget.dataset.type = signatureSet.ok ? "ok" : "error";
  signatureSummaryTarget.textContent = signatureSet.ok
    ? t("civilization.ruleLibrary.signatures.summary", {
      count: signatureSet.signatures.length,
      additional: signatureSet.additionalSignaturePdas.length,
    })
    : signatureSet.message;
}

function renderDeploymentReadiness() {
  if (!readinessTarget) return;
  const readiness = buildDeploymentReadiness();
  readinessTarget.innerHTML = `
    <div class="rule-readiness-summary ${readiness.level}">
      <span>${t(`civilization.ruleLibrary.readiness.level.${readiness.level}`)}</span>
      <strong>${t(`civilization.ruleLibrary.readiness.status.${readiness.status}`)}</strong>
    </div>
    <div class="rule-readiness-grid">
      ${renderReadinessBlock("checks", readiness.checks)}
      ${renderReadinessBlock("blockers", readiness.blockers)}
      ${renderReadinessBlock("instructions", readiness.instructions)}
      ${renderReadinessBlock("pdas", readiness.pdas)}
    </div>
  `;
}

function renderDeployPacketAudit() {
  if (!deployAuditTarget) return;
  const audit = buildDeployPacketAudit();
  deployAuditTarget.innerHTML = `
    <div class="rule-deploy-audit-summary ${audit.level}">
      <span>${t(`civilization.ruleLibrary.deployAudit.level.${audit.level}`)}</span>
      <strong>${escapeHtml(audit.title)}</strong>
      <small>${escapeHtml(audit.body)}</small>
    </div>
    <div class="rule-deploy-audit-grid">
      ${audit.checks.map((check) => `
        <article class="rule-deploy-audit-card ${check.level}">
          <span>${escapeHtml(check.label)}</span>
          <strong>${escapeHtml(check.value)}</strong>
          ${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}
        </article>
      `).join("")}
    </div>
    ${audit.sequence.length ? `
      <div class="rule-deploy-sequence">
        <span>${t("civilization.ruleLibrary.deployAudit.sequence")}</span>
        <ol>
          ${audit.sequence.map((step) => `
            <li class="${step.level}">
              <strong>${escapeHtml(step.label)}</strong>
              <small>${escapeHtml(step.detail)}</small>
            </li>
          `).join("")}
        </ol>
      </div>
    ` : ""}
  `;
}

function buildDeployPacketAudit() {
  if (!state.deployPacket) {
    return {
      level: "pending",
      title: t("civilization.ruleLibrary.deployAudit.empty.title"),
      body: t("civilization.ruleLibrary.deployAudit.empty.body"),
      checks: [
        auditCheck("pending", "proposal", t("civilization.ruleLibrary.deployAudit.checks.proposal.pending"), t("civilization.ruleLibrary.deployAudit.details.validateFirst")),
        auditCheck("pending", "signature", t("civilization.ruleLibrary.deployAudit.checks.signature.pending"), t("civilization.ruleLibrary.deployAudit.details.signFirst")),
        auditCheck("pending", "packet", t("civilization.ruleLibrary.deployAudit.checks.packet.pending"), t("civilization.ruleLibrary.deployAudit.details.stageFirst")),
      ],
      sequence: [],
    };
  }
  const packet = state.deployPacket;
  const target = ruleTargets.find((item) => item.id === (packet.rule_book?.patch?.target_id || packet.rule_book?.target_refs?.target_id));
  const shape = verifyDeployPacketShape(packet);
  const hashOk = [
    packet.rule_book?.text_hash,
    packet.rule_book?.patch_hash,
    packet.rule_book?.snapshot_hash,
    packet.rule_book?.target_ref_hash,
  ].every((value) => String(value || "").startsWith("sha256:"));
  const pdaOk = deployPacketPdasMatch(packet);
  const signatureOk = Boolean(packet.signature?.signature_verified) && !shape.errors.some((error) => error === t("civilization.ruleLibrary.history.errors.signatureProof"));
  const threshold = packet.threshold_result || {};
  const thresholdIntegrity = inspectDeployThresholdResult(packet);
  const hashBinding = inspectDeployRuleBookHashBinding(packet);
  const projectedPasses = Boolean(threshold.projected_passes_after_this_signature || threshold.threshold_met);
  const targetStatus = packet.rule_book?.target_refs?.target_status || target?.status || "unknown";
  const executionLevel = executionAuditLevel({ target, targetStatus });
  const signatureSet = inspectDeploySignatureCollection(packet);
  const lineage = inspectDeployLineage(packet);
  const oldValuePreflight = inspectDeployOldValuePreflight(packet);
  const checks = [
    auditCheck(shape.ok ? "ok" : "error", "packet", shape.ok
      ? t("civilization.ruleLibrary.deployAudit.checks.packet.ok")
      : t("civilization.ruleLibrary.deployAudit.checks.packet.error"), shape.ok ? packet.kind : shape.errors.join("; ")),
    auditCheck(hashOk ? "ok" : "error", "hashes", hashOk
      ? t("civilization.ruleLibrary.deployAudit.checks.hashes.ok")
      : t("civilization.ruleLibrary.deployAudit.checks.hashes.error"), shortHash(packet.rule_book?.patch_hash || "")),
    auditCheck(hashBinding.level, "hashBinding", t(`civilization.ruleLibrary.deployAudit.checks.hashBinding.${hashBinding.level}`), hashBinding.detail),
    auditCheck(signatureOk ? "ok" : "error", "signature", signatureOk
      ? t("civilization.ruleLibrary.deployAudit.checks.signature.ok")
      : t("civilization.ruleLibrary.deployAudit.checks.signature.error"), packet.signature?.signer ? shortAddress(packet.signature.signer) : ""),
    auditCheck(pdaOk ? "ok" : "error", "pdas", pdaOk
      ? t("civilization.ruleLibrary.deployAudit.checks.pdas.ok")
      : t("civilization.ruleLibrary.deployAudit.checks.pdas.error"), packet.derived_pdas?.rule_book_pda ? shortAddress(packet.derived_pdas.rule_book_pda) : ""),
    auditCheck(projectedPasses ? "ok" : "warning", "threshold", projectedPasses
      ? t("civilization.ruleLibrary.deployAudit.checks.threshold.ok")
      : t("civilization.ruleLibrary.deployAudit.checks.threshold.warning"), thresholdDetail(threshold)),
    auditCheck(thresholdIntegrity.level, "thresholdIntegrity", t(`civilization.ruleLibrary.deployAudit.checks.thresholdIntegrity.${thresholdIntegrity.level}`), thresholdIntegrity.detail),
    auditCheck(lineage.level, "lineage", t(`civilization.ruleLibrary.deployAudit.checks.lineage.${lineage.level}`), lineage.detail),
    auditCheck(signatureSet.level, "signatures", t(`civilization.ruleLibrary.deployAudit.checks.signatures.${signatureSet.level}`), signatureSet.detail),
    auditCheck(oldValuePreflight.level, "oldValuePreflight", t(`civilization.ruleLibrary.deployAudit.checks.oldValuePreflight.${oldValuePreflight.level}`), oldValuePreflight.detail),
    auditCheck(executionLevel, "execution", t(`civilization.ruleLibrary.deployAudit.checks.execution.${executionLevel}`), executionDetail({ target, targetStatus, packet })),
  ];
  const level = checks.some((check) => check.level === "error")
    ? "error"
    : checks.some((check) => check.level === "warning")
      ? "warning"
      : "ready";
  return {
    level,
    title: t(`civilization.ruleLibrary.deployAudit.summary.${level}.title`),
    body: t(`civilization.ruleLibrary.deployAudit.summary.${level}.body`),
    checks,
    sequence: buildDeploySequence({ target, targetStatus, threshold }),
  };
}

function inspectDeployThresholdResult(packet) {
  if (!packet?.threshold_result) {
    return {
      level: "error",
      detail: t("civilization.ruleLibrary.deployAudit.details.thresholdMissing"),
    };
  }
  const check = verifyDeployThresholdResult(packet);
  if (!check.ok) {
    return {
      level: "error",
      detail: t("civilization.ruleLibrary.deployAudit.details.thresholdMismatch", {
        fields: check.fields.join(", "),
      }),
    };
  }
  return {
    level: "ok",
    detail: t("civilization.ruleLibrary.deployAudit.details.thresholdRecount", {
      side: packet.signature?.side || "unknown",
      yes: formatInteger(packet.threshold_result.projected_yes_power_after_this_signature ?? packet.threshold_result.yes_power ?? 0),
      no: formatInteger(packet.threshold_result.projected_no_power_after_this_signature ?? packet.threshold_result.no_power ?? 0),
      required: formatInteger(packet.threshold_result.required_yes_power ?? 0),
    }),
  };
}

function inspectDeploySignatureCollection(packet) {
  const collection = packet?.signature_collection;
  if (!collection) {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.signatureSetMissing"),
    };
  }
  const check = verifyDeploySignatureCollection(packet);
  if (!check.ok) {
    return {
      level: "error",
      detail: check.errors.join("; "),
    };
  }
  const hashCheck = packet?.local_audit?.signature_collection_hash_check;
  if (hashCheck && !hashCheck.ok) {
    return {
      level: "error",
      detail: (hashCheck.errors || []).join("; "),
    };
  }
  if (!collection.signature_collection_hash || !hashCheck) {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.signatureSetHashPending"),
    };
  }
  return {
    level: "ok",
    detail: t("civilization.ruleLibrary.deployAudit.details.signatureSet", {
      count: check.ruleSignaturePdas.length,
      additional: check.additionalCount,
      hash: shortHash(collection.signature_collection_hash || hashCheck.expected || ""),
    }),
  };
}

function inspectDeployOldValuePreflight(packet) {
  const proof = packet?.deploy_old_value_preflight;
  if (!proof) {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.oldValuePreflightMissing"),
    };
  }
  if (proof.status === "skipped") {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.oldValuePreflightSkipped", {
        reason: proof.reason || "skipped",
      }),
    };
  }
  const expected = String(proof.expected_old_value_hash || "");
  const live = String(proof.live_old_value_hash || "");
  const verified = proof.status === "verified" && expected && live && expected === live;
  if (!verified) {
    return {
      level: "error",
      detail: t("civilization.ruleLibrary.deployAudit.details.oldValuePreflightMismatch", {
        expected: shortHash(expected),
        live: shortHash(live),
      }),
    };
  }
  return {
    level: "ok",
    detail: t("civilization.ruleLibrary.deployAudit.details.oldValuePreflightOk", {
      hash: shortHash(live),
      slot: proof.read_slot ?? "",
    }),
  };
}

function deployPacketRequiresOldValuePreflight(packet) {
  const target = ruleTargets.find((item) => item.id === (packet?.rule_book?.patch?.target_id || packet?.rule_book?.target_refs?.target_id));
  return target?.status === "governable";
}

async function verifyDeployOldValuePreflightForUse(packet) {
  if (!deployPacketRequiresOldValuePreflight(packet)) {
    return {
      ok: true,
      message: "",
      liveCheck: {
        kind: "nicechunk.civilization.old_value_live_check.v1",
        status: "skipped",
        checked_at: new Date().toISOString(),
      },
    };
  }
  const preflight = inspectDeployOldValuePreflight(packet);
  if (preflight.level !== "ok") {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.errors.oldValuePreflight", { reason: preflight.detail }),
      liveCheck: {
        kind: "nicechunk.civilization.old_value_live_check.v1",
        status: "blocked",
        checked_at: new Date().toISOString(),
        reason: preflight.detail,
      },
    };
  }
  const target = ruleTargets.find((item) => item.id === (packet?.rule_book?.patch?.target_id || packet?.rule_book?.target_refs?.target_id));
  const targetPda = packet?.rule_book?.target_refs?.target_pda || packet?.rule_book?.patch?.target_pda || extractTargetPda(target);
  const expectedOldHash = String(packet?.rule_book?.patch?.old_value_hash || "");
  if (!targetPda || !expectedOldHash) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.errors.oldValueLiveMissing"),
      liveCheck: {
        kind: "nicechunk.civilization.old_value_live_check.v1",
        status: "blocked",
        checked_at: new Date().toISOString(),
        target_id: target?.id || "",
        target_pda: targetPda || "",
        expected_old_value_hash: expectedOldHash,
      },
    };
  }
  try {
    const result = await readPdaAccountWithFallback(new PublicKey(targetPda));
    const account = result.value;
    if (!account) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.form.oldHashAccountMissing", { pda: shortAddress(targetPda) }),
        liveCheck: {
          kind: "nicechunk.civilization.old_value_live_check.v1",
          status: "missing",
          checked_at: new Date().toISOString(),
          target_id: target?.id || "",
          target_pda: targetPda,
          expected_old_value_hash: expectedOldHash,
        },
      };
    }
    const data = new Uint8Array(account.data);
    const liveHash = `sha256:${await sha256HexBytes(data)}`;
    const ok = liveHash === expectedOldHash;
    const liveCheck = {
      kind: "nicechunk.civilization.old_value_live_check.v1",
      status: ok ? "verified" : "stale",
      checked_at: new Date().toISOString(),
      target_id: target?.id || "",
      target_pda: targetPda,
      expected_old_value_hash: expectedOldHash,
      live_old_value_hash: liveHash,
      read_slot: result.context.slot,
      bytes: data.length,
      owner: account.owner.toBase58(),
    };
    if (!ok) {
      return {
        ok: false,
        message: t("civilization.ruleLibrary.history.errors.oldValueLiveStale", {
          expected: shortHash(expectedOldHash),
          live: shortHash(liveHash),
        }),
        liveCheck,
      };
    }
    return { ok: true, message: "", liveCheck };
  } catch (error) {
    const reason = error?.message || String(error);
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.errors.oldValueLiveReadFailed", { reason }),
      liveCheck: {
        kind: "nicechunk.civilization.old_value_live_check.v1",
        status: "failed",
        checked_at: new Date().toISOString(),
        target_id: target?.id || "",
        target_pda: targetPda,
        expected_old_value_hash: expectedOldHash,
        reason,
      },
    };
  }
}

function inspectDeployLineage(packet) {
  if (!packet?.lineage) {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.lineageMissing"),
    };
  }
  const check = verifyDeployLineage(packet);
  if (!check.ok) {
    return {
      level: "error",
      detail: check.errors.join("; "),
    };
  }
  const contentHashClaim = packet.local_audit?.content_hash_claim;
  if (contentHashClaim && !contentHashClaim.ok) {
    return {
      level: "error",
      detail: (contentHashClaim.errors || []).join("; "),
    };
  }
  const lineageHashCheck = packet?.local_audit?.deploy_lineage_hash_check;
  if (lineageHashCheck && !lineageHashCheck.ok) {
    return {
      level: "error",
      detail: (lineageHashCheck.errors || []).join("; "),
    };
  }
  const lineage = packet.lineage || {};
  const collectionHash = shortHash(lineage.preserved_signature_collection_hash || packet.signature_collection?.signature_collection_hash || "");
  if (Number(lineage.hop || 0) > 0) {
    return {
      level: "ok",
      detail: t("civilization.ruleLibrary.deployAudit.details.lineageRestaged", {
        hop: String(lineage.hop),
        previousSigner: shortAddress(lineage.previous_signer || ""),
        previousHash: shortHash(lineage.previous_deploy_packet_hash || ""),
        count: String(lineage.preserved_signature_count ?? 0),
        collectionHash,
      }),
    };
  }
  return {
    level: "ok",
    detail: t("civilization.ruleLibrary.deployAudit.details.lineageFirst", {
      signer: shortAddress(lineage.current_signer || packet.signature?.signer || ""),
      count: String(lineage.preserved_signature_count ?? 0),
      collectionHash,
    }),
  };
}

function auditCheck(level, key, value, detail = "") {
  return {
    level,
    label: t(`civilization.ruleLibrary.deployAudit.labels.${key}`),
    value,
    detail,
  };
}

function inspectDeployRuleBookHashBinding(packet) {
  const check = packet?.local_audit?.rule_book_hash_binding;
  if (!check) {
    return {
      level: "warning",
      detail: t("civilization.ruleLibrary.deployAudit.details.hashBindingPending"),
    };
  }
  if (!check.ok) {
    return {
      level: "error",
      detail: t("civilization.ruleLibrary.deployAudit.details.hashBindingMismatch", {
        fields: (check.fields || []).join(", "),
      }),
    };
  }
  return {
    level: "ok",
    detail: t("civilization.ruleLibrary.deployAudit.details.hashBindingOk", {
      rule: shortHash(check.expected?.rule_id_hash || packet?.rule_book?.rule_id_hash || ""),
      patch: shortHash(check.expected?.patch_hash || packet?.rule_book?.patch_hash || ""),
    }),
  };
}

function deployPacketPdasMatch(packet) {
  const expected = safeDeriveDeploymentPdas({
    ruleIdHash: packet?.rule_book?.rule_id_hash,
    signer: packet?.signature?.signer,
    targetProgram: packet?.rule_book?.target_refs?.target_program || packet?.rule_book?.patch?.target_program,
    targetPdaAddress: packet?.rule_book?.target_refs?.target_pda || packet?.rule_book?.patch?.target_pda,
  });
  if (!expected || !packet?.derived_pdas) return false;
  return [
    "rule_book_pda",
    "rule_signature_pda",
    "power_snapshot_pda",
    "citizen_power_pda",
    "rule_tally_pda",
    "execution_receipt_pda",
    "adapter_authority_pda",
  ].every((key) => packet.derived_pdas[key] === expected[key]);
}

function thresholdDetail(threshold) {
  const yes = threshold.projected_yes_power_after_this_signature ?? threshold.yes_power ?? 0;
  const required = threshold.required_yes_power ?? 0;
  const total = threshold.total_active_power ?? 0;
  return `${formatInteger(yes)} / ${formatInteger(required)} required · ${formatInteger(total)} total`;
}

function executionAuditLevel({ target, targetStatus }) {
  if (targetStatus === "governable" && targetUsesTargetAdapter(target)) return "ok";
  if (targetStatus === "governable") return "warning";
  return "error";
}

function executionDetail({ target, targetStatus, packet }) {
  if (targetStatus === "governable" && targetUsesTargetAdapter(target)) {
    return t("civilization.ruleLibrary.deployAudit.details.adapterLive", {
      adapter: packet.execution_hint?.target_adapter_instruction || "target_adapter",
    });
  }
  if (targetStatus === "governable") return t("civilization.ruleLibrary.deployAudit.details.receiptOnly");
  if (targetStatus === "adapter") return t("civilization.ruleLibrary.deployAudit.details.adapterMissing");
  if (targetStatus === "readonly") return t("civilization.ruleLibrary.deployAudit.details.readonly");
  if (targetStatus === "protected") return t("civilization.ruleLibrary.deployAudit.details.protected");
  return t("civilization.ruleLibrary.deployAudit.details.unknown");
}

function buildDeploySequence({ target, targetStatus, threshold }) {
  const adapterLive = targetStatus === "governable" && targetUsesTargetAdapter(target);
  const receiptOnly = targetStatus === "governable" && !targetUsesTargetAdapter(target);
  return [
    {
      level: "ok",
      label: "publish_sign",
      detail: t("civilization.ruleLibrary.deployAudit.sequenceDetails.publish"),
    },
    {
      level: threshold?.projected_passes_after_this_signature || threshold?.threshold_met ? "ok" : "warning",
      label: "finalize_tally",
      detail: t("civilization.ruleLibrary.deployAudit.sequenceDetails.finalize"),
    },
    {
      level: adapterLive ? "ok" : receiptOnly ? "warning" : "error",
      label: adapterLive ? "execute_target_adapter" : "execute_rule_receipt",
      detail: adapterLive
        ? t("civilization.ruleLibrary.deployAudit.sequenceDetails.adapter")
        : receiptOnly
          ? t("civilization.ruleLibrary.deployAudit.sequenceDetails.receipt")
          : t("civilization.ruleLibrary.deployAudit.sequenceDetails.blocked"),
    },
  ];
}

function renderReadinessBlock(type, items) {
  const safeItems = items.length ? items : [{ level: "ok", label: t("civilization.ruleLibrary.readiness.none") }];
  return `
    <div class="rule-readiness-block">
      <span>${t(`civilization.ruleLibrary.readiness.blocks.${type}`)}</span>
      <ul>
        ${safeItems.map((item) => `
          <li class="${item.level || "pending"}">
            <strong>${escapeHtml(item.label)}</strong>
            ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function buildDeploymentReadiness() {
  const draft = composerForm ? buildProposalDraft() : null;
  const target = ruleTargets.find((item) => item.id === (state.proposalEnvelope?.patch?.target_id || draft?.target_id));
  const status = target?.status ?? "unknown";
  const checks = [
    {
      level: target ? "ok" : "error",
      label: target ? t("civilization.ruleLibrary.readiness.checks.targetSelected") : t("civilization.ruleLibrary.validation.targetRequired"),
      detail: target ? `${target.pda} / ${target.authority}` : "",
    },
    {
      level: state.validation?.ok ? "ok" : state.validation ? "error" : "pending",
      label: t("civilization.ruleLibrary.readiness.checks.validated"),
      detail: state.proposalEnvelope?.rule_id ?? t("civilization.ruleLibrary.readiness.pending"),
    },
    {
      level: state.signedProof ? "ok" : "pending",
      label: t("civilization.ruleLibrary.readiness.checks.signed"),
      detail: state.signedProof ? `${shortAddress(state.signedProof.signer)} / ${state.signedProof.side}` : t("civilization.ruleLibrary.readiness.pending"),
    },
    {
      level: state.deployPacket ? "ok" : "pending",
      label: t("civilization.ruleLibrary.readiness.checks.packet"),
      detail: state.deployPacket?.deploy_status ?? t("civilization.ruleLibrary.readiness.pending"),
    },
  ];
  const blockers = buildDeploymentBlockers(status, target);
  if (!state.validation?.ok) blockers.unshift({ level: "pending", label: t("civilization.ruleLibrary.readiness.blockers.validation") });
  if (!state.signedProof) blockers.unshift({ level: "pending", label: t("civilization.ruleLibrary.readiness.blockers.signature") });
  if (!state.deployPacket) blockers.unshift({ level: "pending", label: t("civilization.ruleLibrary.readiness.blockers.packet") });
  const instructions = buildInstructionPlan(status);
  const pdas = buildPdaPlan(status, target);
  const hardBlock = blockers.some((item) => item.level === "error");
  const pending = blockers.some((item) => item.level === "pending");
  const warning = blockers.some((item) => item.level === "warning");
  return {
    status,
    level: hardBlock ? "error" : pending ? "pending" : warning ? "warning" : status === "governable" ? "ready" : "warning",
    checks,
    blockers,
    instructions,
    pdas,
  };
}

function buildDeploymentBlockers(status, target) {
  if (status === "governable") {
    return [
      { level: "ok", label: t("civilization.ruleLibrary.readiness.blockers.chainSubmit") },
      {
        level: targetUsesTargetAdapter(target) ? "ok" : "warning",
        label: t("civilization.ruleLibrary.readiness.blockers.adapterExecution"),
      },
    ];
  }
  if (status === "adapter") {
    return [
      { level: "error", label: t("civilization.ruleLibrary.readiness.blockers.adapter") },
      { level: "pending", label: t("civilization.ruleLibrary.readiness.blockers.chainSubmit") },
    ];
  }
  if (status === "readonly") {
    return [{ level: "error", label: t("civilization.ruleLibrary.readiness.blockers.readonly") }];
  }
  if (status === "protected") {
    return [{ level: "error", label: t("civilization.ruleLibrary.readiness.blockers.protected") }];
  }
  return [{ level: "error", label: t("civilization.ruleLibrary.readiness.blockers.unknown") }];
}

function buildInstructionPlan(status) {
  const base = [
    { level: "pending", label: "publish_rule_book", detail: "rule_book_pda + text_hash + patch_hash + snapshot_hash" },
    { level: "pending", label: "sign_rule", detail: "rule_signature_pda + signer + side + snapshot_power" },
    { level: "pending", label: "finalize_rule_tally", detail: "yes/no/abstain/challenge power recount from signature PDAs" },
  ];
  if (status === "readonly" || status === "protected") {
    return [
      ...base,
      { level: "pending", label: "record_challenge", detail: "evidence hash only; no target PDA write" },
    ];
  }
  const target = ruleTargets.find((item) => item.id === (state.proposalEnvelope?.patch?.target_id || buildProposalDraft()?.target_id));
  if (target?.id === "smelting-recipes") {
    return [
      ...base,
      { level: "pending", label: "apply_civilization_recipe_receipt", detail: "CPI execute_rule_receipt, verify patch_hash, then upsert smelting recipe PDA" },
    ];
  }
  if (target?.id === "resource-drops") {
    return [
      ...base,
      { level: "pending", label: "apply_civilization_resource_drop_receipt", detail: "CPI execute_rule_receipt, verify patch_hash, then replace the bounded ResourceDropTable PDA" },
    ];
  }
  return [
    ...base,
    { level: "pending", label: "execute_rule_receipt", detail: "write public execution receipt; target adapter still required for gameplay PDA mutation" },
  ];
}

function buildPdaPlan(status, target) {
  const pdas = [
    { level: "pending", label: "rule_book_pda", detail: "stores readable hash, machine patch hash, target refs" },
    { level: "pending", label: "civilization_power_snapshot_pda", detail: "freezes activity-derived power window" },
    { level: "pending", label: "rule_signature_pda", detail: "one signer, one side, one frozen power value" },
    { level: "pending", label: "rule_tally_pda", detail: "public recount result and final threshold state" },
    { level: "pending", label: "execution_receipt_pda", detail: "public receipt after finalized threshold passes" },
  ];
  if (!target) return pdas;
  if (status === "governable" || status === "adapter") {
    pdas.push({ level: status === "governable" ? "pending" : "error", label: target.pda, detail: target.pdaRefs.join(" | ") });
  } else {
    pdas.push({ level: "error", label: target.pda, detail: t("civilization.ruleLibrary.readiness.noTargetWrite") });
  }
  return pdas;
}

function buildTargetAdapterInstruction({
  target,
  payer,
  targetProgram,
  targetPdaKey,
  ruleBook,
  tallyPda,
  receiptPda,
}) {
  if (target?.id !== "smelting-recipes") {
    if (target?.id === "resource-drops") {
      if (!targetPdaKey) throw new Error(t("civilization.ruleLibrary.chain.noTargetPda"));
      const [globalConfig] = deriveGlobalConfigPda();
      const rules = buildResourceDropRulesFromPatch(state.proposalEnvelope.patch.proposed_value);
      return {
        phase: "execute_target_adapter",
        instructionName: "apply_civilization_resource_drop_receipt",
        ix: createApplyCivilizationResourceDropRulesInstruction({
          executor: payer,
          resourceDropTable: targetPdaKey,
          globalConfig,
          ruleBook,
          tally: tallyPda,
          receipt: receiptPda,
          rules,
          chunkProgramId: targetProgram,
        }),
        addressLookupTablePlan: buildResourceDropAddressLookupTablePlan({
          targetProgram,
          targetPdaKey,
          ruleBook,
          tallyPda,
          receiptPda,
        }),
        note: "This transaction calls the chunk resource-drop adapter through a v0 transaction with an Address Lookup Table because the full 37-rule patch is larger than a legacy Solana transaction. The adapter CPI writes the civilization execution receipt, verifies patch_hash against the full ResourceDropTable bytes, then replaces the bounded table PDA.",
      };
    }
    return {
      phase: "execute_rule_receipt",
      instructionName: "execute_rule_receipt",
      ix: null,
      note: "This transaction writes a public execution receipt after the finalized tally proves the rule can pass.",
    };
  }
  if (!targetPdaKey) throw new Error(t("civilization.ruleLibrary.chain.noTargetPda"));
  const recipe = buildSmeltingRecipeFromPatch(state.proposalEnvelope.patch.proposed_value);
  return {
    phase: "execute_target_adapter",
    instructionName: "apply_civilization_recipe_receipt",
    ix: createApplyCivilizationSmeltingRecipeInstruction({
      executor: payer,
      recipeTable: targetPdaKey,
      ruleBook,
      tally: tallyPda,
      receipt: receiptPda,
      recipe,
      smeltingProgramId: targetProgram,
    }),
    note: "This transaction calls the smelting adapter. The adapter CPI writes the civilization execution receipt, verifies patch_hash against the recipe bytes, then updates the recipe table PDA.",
  };
}

function renderDeployPacket() {
  if (!deployPacketTarget) return;
  deployPacketTarget.textContent = state.deployPacket
    ? JSON.stringify(state.deployPacket, null, 2)
    : t("civilization.ruleLibrary.flow.noDeployPacket");
  renderDeployPacketAudit();
}

function renderChainPlan() {
  if (!chainTxPreviewTarget) return;
  chainTxPreviewTarget.textContent = state.chainPlan
    ? JSON.stringify(state.chainPlan, null, 2)
    : t("civilization.ruleLibrary.chain.noPlan");
  renderChainProofSummary();
}

function renderChainProofSummary() {
  if (!chainProofSummaryTarget) return;
  const plan = state.chainPlan;
  const proof = state.chainPlan?.post_submit_proof;
  const simulation = state.chainPlan?.pre_submit_simulation;
  if (!plan && !proof && !simulation) {
    chainProofSummaryTarget.hidden = true;
    chainProofSummaryTarget.replaceChildren();
    return;
  }
  chainProofSummaryTarget.hidden = false;
  chainProofSummaryTarget.innerHTML = `
    ${plan ? renderChainPhaseSummary(plan) : ""}
    ${simulation ? renderPreSubmitSimulationSummary(simulation) : ""}
    ${proof ? renderPostSubmitProofSummary(proof) : ""}
  `;
}

function renderChainPhaseSummary(plan) {
  const phaseStatus = chainPhaseStatus(plan.status);
  const checks = buildChainPhaseChecks(plan);
  return `
    <section class="rule-chain-summary-section">
      <div class="rule-chain-proof-heading ${phaseStatus}">
        <span>${t("civilization.ruleLibrary.chainPhase.title")}</span>
        <div class="rule-chain-proof-actions">
          <strong>${t(`civilization.ruleLibrary.chainPhase.status.${phaseStatus}`)}</strong>
        </div>
        <small>${escapeHtml(plan.phase || "")}${plan.next_phase ? ` · ${escapeHtml(plan.next_phase)}` : ""}</small>
      </div>
      <div class="rule-chain-phase-card ${phaseStatus}">
        <dl>
          ${renderProofField("phase", plan.phase || "")}
          ${renderProofField("status", plan.status || "")}
          ${renderProofField("next", plan.next_phase || "")}
          ${renderProofField("planHash", plan.plan_hash || "")}
          ${renderProofField("deployPacket", plan.built_from_deploy_packet?.deploy_packet_hash || "")}
          ${renderProofField("instructions", plan.instructions?.length ?? "")}
          ${renderProofField("reason", plan.reason || plan.note || "")}
        </dl>
        <div class="rule-chain-phase-checks">
          <span>${t("civilization.ruleLibrary.chainPhase.checks")}</span>
          <ul>
            ${checks.map((check) => `
              <li class="${check.level}">
                <strong>${escapeHtml(check.label)}</strong>
                ${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}
              </li>
            `).join("")}
          </ul>
        </div>
      </div>
    </section>
  `;
}

function chainPhaseStatus(status) {
  if (status === "ready_to_submit" || status === "submitted") return "ready";
  if (status === "submitting") return "pending";
  if (String(status || "").startsWith("blocked")) return "blocked";
  return "pending";
}

function buildChainPhaseChecks(plan) {
  const checks = [];
  if (plan.rule_book_pda) {
    checks.push(phaseCheck("ruleBook", plan.rule_book_pda, plan.publication_proof || plan.rule_book));
  }
  if (plan.plan_hash || plan.built_from_deploy_packet?.deploy_packet_hash) {
    checks.push({
      level: plan.plan_integrity_errors?.length ? "error" : "ok",
      label: t("civilization.ruleLibrary.chainPhase.items.planIdentity"),
      detail: [
        shortHash(plan.plan_hash || ""),
        shortHash(plan.built_from_deploy_packet?.deploy_packet_hash || ""),
      ].filter(Boolean).join(" · "),
    });
  }
  if (plan.rule_signature_pda) {
    checks.push(phaseCheck("signature", plan.rule_signature_pda, plan.signature_proof || plan.signature));
  }
  if (Array.isArray(plan.rule_signature_pdas)) {
    checks.push({
      level: plan.signature_proofs?.every((proof) => proof.status === "verified") ? "ok" : plan.status?.startsWith("blocked") ? "error" : "pending",
      label: t("civilization.ruleLibrary.chainPhase.items.signatures"),
      detail: `${plan.rule_signature_pdas.length} PDA(s)`,
    });
  }
  if (plan.rule_tally_pda) {
    checks.push(phaseCheck("tally", plan.rule_tally_pda, plan.tally_proof || plan.tally));
  }
  if (plan.execution_receipt_pda) {
    checks.push(phaseCheck("receipt", plan.execution_receipt_pda, plan.receipt_proof || plan.receipt));
  }
  if (plan.adapter_authority_pda) {
    checks.push({
      level: plan.status?.startsWith("blocked") ? "pending" : "ok",
      label: t("civilization.ruleLibrary.chainPhase.items.adapterAuthority"),
      detail: `${shortAddress(plan.adapter_authority_pda)} · seed=civilization-adapter`,
    });
  }
  if (plan.target_pda) {
    checks.push({
      level: plan.status?.startsWith("blocked") ? "pending" : "ok",
      label: t("civilization.ruleLibrary.chainPhase.items.target"),
      detail: shortAddress(plan.target_pda),
    });
  }
  if (plan.pre_submit_simulation) {
    checks.push({
      level: plan.pre_submit_simulation.status === "failed" ? "error" : plan.pre_submit_simulation.status === "passed" ? "ok" : "warning",
      label: t("civilization.ruleLibrary.chainPhase.items.simulation"),
      detail: `${plan.pre_submit_simulation.status || ""}${plan.pre_submit_simulation.host ? ` / ${plan.pre_submit_simulation.host}` : ""}`,
    });
  }
  if (!checks.length && plan.reason) {
    checks.push({ level: "error", label: t("civilization.ruleLibrary.chainPhase.items.blocker"), detail: plan.reason });
  }
  return checks.length ? checks : [{ level: "pending", label: t("civilization.ruleLibrary.chainPhase.items.waiting"), detail: "" }];
}

function phaseCheck(type, pda, proof) {
  const exists = proof?.exists;
  const verified = proof?.verified || proof?.status === "verified" || proof?.status === "ready_to_submit" || proof?.publish_mode === "publish_and_sign_rule" || proof?.publish_mode === "sign_existing_rule";
  const level = verified ? "ok" : exists === false || proof?.status === "missing" ? "warning" : proof?.status === "mismatch" || proof?.status === "read_failed" ? "error" : "pending";
  const detailParts = [shortAddress(pda)];
  if (proof?.status) detailParts.push(proof.status);
  if (proof?.publish_mode) detailParts.push(proof.publish_mode);
  if (proof?.mismatches?.length) detailParts.push(`mismatch: ${proof.mismatches.join(", ")}`);
  if (proof?.read_error || proof?.reason) detailParts.push(proof.read_error || proof.reason);
  return {
    level,
    label: t(`civilization.ruleLibrary.chainPhase.items.${type}`),
    detail: detailParts.filter(Boolean).join(" · "),
  };
}

function renderPreSubmitSimulationSummary(simulation) {
  const status = simulation.status || "unavailable";
  const statusKey = status === "passed" ? "passed" : status === "failed" ? "failed" : status === "skipped" ? "skipped" : "unavailable";
  const attempts = Array.isArray(simulation.attempts) ? simulation.attempts : [];
  return `
    <section class="rule-chain-summary-section">
      <div class="rule-chain-proof-heading ${status === "passed" ? "verified" : status === "failed" ? "failed" : "needs-review"}">
        <span>${t("civilization.ruleLibrary.chainSimulation.title")}</span>
        <div class="rule-chain-proof-actions">
          <strong>${t(`civilization.ruleLibrary.chainSimulation.status.${statusKey}`)}</strong>
        </div>
        <small>${escapeHtml(simulation.host || "")} · ${escapeHtml(simulation.simulated_at || "")}</small>
      </div>
      <div class="rule-chain-simulation-card ${statusKey}">
        <dl>
          ${renderProofField("status", t(`civilization.ruleLibrary.chainSimulation.status.${statusKey}`))}
          ${renderProofField("host", simulation.host || "")}
          ${renderProofField("units", simulation.units_consumed ?? "")}
          ${renderProofField("logs", simulation.log_count ?? "")}
          ${renderProofField("accounts", simulation.account_count ?? "")}
          ${renderProofField("reason", simulation.error || simulation.reason || simulation.note || "")}
        </dl>
        ${attempts.length ? `
          <div class="rule-chain-simulation-attempts">
            <span>${t("civilization.ruleLibrary.chainSimulation.attempts")}</span>
            <ul>
              ${attempts.map((attempt) => `
                <li>
                  <strong>${escapeHtml(attempt.host || "")}</strong>
                  <small>${escapeHtml(attempt.status || "")}${attempt.reason ? ` · ${escapeHtml(attempt.reason)}` : ""}</small>
                </li>
              `).join("")}
            </ul>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderPostSubmitProofSummary(proof) {
  const accounts = [
    ["planBinding", proof.plan_binding],
    ["ruleBook", proof.rule_book],
    ["signature", proof.signature],
    ["tally", proof.tally],
    ["receipt", proof.receipt],
    ["targetPda", proof.target_pda],
    ["adapterAuthority", proof.adapter_authority],
  ].filter(([, account]) => account);
  return `
    <section class="rule-chain-summary-section">
      <div class="rule-chain-proof-heading ${proof.status === "verified" ? "verified" : "needs-review"}">
        <span>${t("civilization.ruleLibrary.chainProof.title")}</span>
        <div class="rule-chain-proof-actions">
          <strong>${t(`civilization.ruleLibrary.chainProof.status.${proof.status === "verified" ? "verified" : "needsReview"}`)}</strong>
          <button class="rule-copy-button" type="button" data-copy-chain-proof>${t("civilization.ruleLibrary.chainProof.copy")}</button>
        </div>
        <small>${escapeHtml(proof.phase || "")} · ${escapeHtml(proof.verified_at || "")}</small>
      </div>
      <div class="rule-chain-proof-grid">
        ${accounts.map(([type, account]) => renderChainProofCard(type, account)).join("")}
      </div>
    </section>
  `;
}

function renderChainProofCard(type, account) {
  const statusKey = account.verified ? "verified" : account.exists === false ? "missing" : "needsReview";
  const mismatches = Array.isArray(account.mismatches) && account.mismatches.length
    ? account.mismatches.join(", ")
    : t("civilization.ruleLibrary.chainProof.none");
  return `
    <article class="rule-chain-proof-card ${account.verified ? "verified" : "needs-review"}">
      <div>
        <span>${t(`civilization.ruleLibrary.chainProof.accounts.${type}`)}</span>
        <strong>${t(`civilization.ruleLibrary.chainProof.status.${statusKey}`)}</strong>
      </div>
      ${renderExplorerPdaLink(account.pda)}
      <dl>
        ${renderProofField("owner", shortAddress(account.owner || account.expected_owner || ""))}
        ${renderProofField("slot", account.read_slot || account.finalized_slot || account.executed_slot || "")}
        ${renderProofField("bytes", account.bytes ?? "")}
        ${renderProofField("hash", shortHash(account.data_hash || ""))}
        ${account.pre_execute_data_hash ? renderProofField("oldHash", shortHash(account.pre_execute_data_hash)) : ""}
        ${account.target_patch_proof ? renderTargetPatchProofFields(account.target_patch_proof) : ""}
        ${renderProofField("mismatch", mismatches)}
      </dl>
    </article>
  `;
}

function renderTargetPatchProofFields(patchProof) {
  const summary = patchProof.readable_summary
    ? stableJsonStringify(patchProof.readable_summary)
    : "";
  return `
    ${renderProofField("patchHash", `${shortHash(patchProof.actual_patch_hash || "")} / ${shortHash(patchProof.expected_patch_hash || "")}`)}
    ${summary ? renderProofField("writtenSummary", summary) : ""}
  `;
}

function renderExplorerPdaLink(pda) {
  if (!pda) return "<code>—</code>";
  const safePda = escapeHtml(pda);
  return `
    <a class="rule-chain-proof-pda" href="${explorerAddressUrl(pda)}" target="_blank" rel="noreferrer">
      <code>${safePda}</code>
    </a>
  `;
}

function renderProofField(key, value) {
  return `
    <div>
      <dt>${t(`civilization.ruleLibrary.chainProof.fields.${key}`)}</dt>
      <dd>${escapeHtml(String(value || "—"))}</dd>
    </div>
  `;
}

function explorerAddressUrl(address) {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
}

function renderDeployHistory() {
  if (!deployHistoryTarget) return;
  const packets = loadDeployPackets();
  if (!packets.length) {
    deployHistoryTarget.innerHTML = `<p class="rule-history-empty">${t("civilization.ruleLibrary.history.empty")}</p>`;
    return;
  }
  deployHistoryTarget.innerHTML = `
    <ul class="rule-history-list">
      ${packets.map((packet) => {
        const check = deployPacketHistoryCheck(packet);
        const index = packets.indexOf(packet);
        return `
          <li class="${check.level}">
            <div>
              <strong>${escapeHtml(packet?.rule_book?.rule_id || t("civilization.ruleLibrary.history.unknownRule"))}</strong>
              <span>${escapeHtml(packet?.deploy_status || "unknown")} / ${escapeHtml(packet?.staged_at || "")}</span>
              <small>${escapeHtml(check.detail)}</small>
            </div>
            <button class="rule-history-load" type="button" data-load-deploy-packet-index="${index}" ${check.loadable ? "" : "disabled"}>
              ${t("civilization.ruleLibrary.history.load")}
            </button>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function deployPacketHistoryCheck(packet) {
  const shape = verifyDeployPacketShape(packet);
  if (!shape.ok) {
    return {
      level: "error",
      loadable: false,
      detail: shape.errors.join("; "),
    };
  }
  const contentHashClaim = packet?.local_audit?.content_hash_claim;
  if (contentHashClaim && !contentHashClaim.ok) {
    return {
      level: "error",
      loadable: false,
      detail: (contentHashClaim.errors || []).join("; "),
    };
  }
  const signatureCollectionHashClaim = packet?.local_audit?.signature_collection_hash_check;
  if (signatureCollectionHashClaim && !signatureCollectionHashClaim.ok) {
    return {
      level: "error",
      loadable: false,
      detail: (signatureCollectionHashClaim.errors || []).join("; "),
    };
  }
  const lineageHashClaim = packet?.local_audit?.deploy_lineage_hash_check;
  if (lineageHashClaim && !lineageHashClaim.ok) {
    return {
      level: "error",
      loadable: false,
      detail: (lineageHashClaim.errors || []).join("; "),
    };
  }
  const hashBindingClaim = packet?.local_audit?.rule_book_hash_binding;
  if (hashBindingClaim && !hashBindingClaim.ok) {
    return {
      level: "error",
      loadable: false,
      detail: t("civilization.ruleLibrary.history.errors.ruleBookHashBinding", {
        fields: (hashBindingClaim.fields || []).join(", "),
      }),
    };
  }
  const oldValuePreflight = inspectDeployOldValuePreflight(packet);
  if (deployPacketRequiresOldValuePreflight(packet) && oldValuePreflight.level !== "ok") {
    return {
      level: "error",
      loadable: false,
      detail: oldValuePreflight.detail,
    };
  }
  if (contentHashClaim?.ok) {
    return {
      level: "ok",
      loadable: true,
      detail: t("civilization.ruleLibrary.history.auditOk"),
    };
  }
  return {
    level: "warning",
    loadable: true,
    detail: t("civilization.ruleLibrary.history.auditPending"),
  };
}

async function loadDeployPacketFromHistory(index) {
  const packets = loadDeployPackets();
  const packet = packets[index];
  const check = verifyDeployPacketShape(packet);
  if (!packet || !check.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: check.errors.join("; ") || t("civilization.ruleLibrary.history.unknownRule"),
    }));
    return;
  }
  const contentHashCheck = await verifyDeployPacketContentHashClaim(packet);
  if (!contentHashCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: contentHashCheck.errors.join("; "),
    }));
    return;
  }
  const hashBindingCheck = await verifyDeployRuleBookHashBinding(packet.rule_book);
  if (!hashBindingCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: t("civilization.ruleLibrary.history.errors.ruleBookHashBinding", {
        fields: hashBindingCheck.fields.join(", "),
      }),
    }));
    return;
  }
  const signatureCollectionHashCheck = await verifyDeploySignatureCollectionHash(packet);
  if (!signatureCollectionHashCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: signatureCollectionHashCheck.errors.join("; "),
    }));
    return;
  }
  const lineageHashCheck = await verifyDeployLineageHashBinding(packet);
  if (!lineageHashCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: lineageHashCheck.errors.join("; "),
    }));
    return;
  }
  const signatureCheck = await verifySignedProofForProposal({
    proposal: packet.rule_book,
    signedProof: packet.signature,
  });
  if (!signatureCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: signatureCheck.message,
    }));
    return;
  }
  const oldValueUseCheck = await verifyDeployOldValuePreflightForUse(packet);
  if (!oldValueUseCheck.ok) {
    setFlowStatus("error", t("civilization.ruleLibrary.history.loadFailed", {
      reason: oldValueUseCheck.message,
    }));
    return;
  }
  const verifiedPacket = { ...packet, signature: signatureCheck.signedProof };
  verifiedPacket.local_audit = await buildLocalDeployPacketAudit(verifiedPacket);
  verifiedPacket.local_audit.old_value_live_check = oldValueUseCheck.liveCheck;
  applyVerifiedDeployPacket(verifiedPacket);
  setFlowStatus("success", t("civilization.ruleLibrary.history.loaded"));
}

async function importDeployPacketFromText() {
  const raw = String(deployPacketImportInput?.value ?? "").trim();
  if (!raw) {
    return { ok: false, message: t("civilization.ruleLibrary.history.importEmpty") };
  }
  let packet = null;
  try {
    packet = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: error?.message || "invalid JSON" }),
    };
  }
  const check = verifyDeployPacketShape(packet);
  if (!check.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: check.errors.join("; ") }),
    };
  }
  const contentHashCheck = await verifyDeployPacketContentHashClaim(packet);
  if (!contentHashCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: contentHashCheck.errors.join("; ") }),
    };
  }
  const hashBindingCheck = await verifyDeployRuleBookHashBinding(packet.rule_book);
  if (!hashBindingCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", {
        reason: t("civilization.ruleLibrary.history.errors.ruleBookHashBinding", {
          fields: hashBindingCheck.fields.join(", "),
        }),
      }),
    };
  }
  const signatureCollectionHashCheck = await verifyDeploySignatureCollectionHash(packet);
  if (!signatureCollectionHashCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: signatureCollectionHashCheck.errors.join("; ") }),
    };
  }
  const lineageHashCheck = await verifyDeployLineageHashBinding(packet);
  if (!lineageHashCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: lineageHashCheck.errors.join("; ") }),
    };
  }
  const signatureCheck = await verifySignedProofForProposal({
    proposal: packet.rule_book,
    signedProof: packet.signature,
  });
  if (!signatureCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: signatureCheck.message }),
    };
  }
  const oldValueUseCheck = await verifyDeployOldValuePreflightForUse(packet);
  if (!oldValueUseCheck.ok) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.history.importFailed", { reason: oldValueUseCheck.message }),
    };
  }
  const verifiedPacket = { ...packet, signature: signatureCheck.signedProof };
  verifiedPacket.local_audit = await buildLocalDeployPacketAudit(verifiedPacket);
  verifiedPacket.local_audit.old_value_live_check = oldValueUseCheck.liveCheck;
  applyVerifiedDeployPacket(verifiedPacket, { imported: true });
  persistDeployPacket(verifiedPacket);
  renderDeployHistory();
  if (deployPacketImportInput) deployPacketImportInput.value = "";
  return {
    ok: true,
    message: t("civilization.ruleLibrary.history.imported", {
      signer: shortAddress(verifiedPacket.signature?.signer || ""),
      signaturePda: shortAddress(verifiedPacket.signature?.rule_signature_pda || ""),
    }),
  };
}

function applyVerifiedDeployPacket(packet, { imported = false } = {}) {
  state.draftDirtyAfterProof = false;
  state.proposalEnvelope = packet.rule_book;
  state.signedProof = packet.signature;
  state.deployPacket = packet;
  state.sourceDeployPacket = packet;
  state.validation = {
    ok: true,
    messages: [imported ? t("civilization.ruleLibrary.history.importedShort") : t("civilization.ruleLibrary.history.loaded")],
    targetStatus: packet.rule_book?.target_refs?.target_status ?? packet.rule_book?.readable?.target_status ?? "unknown",
  };
  state.chainPlan = null;
  applyDeployPacketToComposer(packet);
  seedFinalizeSignaturePdas(packet);
  renderFlowState();
  renderDeploymentReadiness();
  renderFinalizeSignatureCollector();
  renderDeployPacket();
  renderChainPlan();
}

function seedFinalizeSignaturePdas(packet) {
  if (!finalizeSignatureInput) return;
  const collectionCheck = verifyDeploySignatureCollection(packet);
  const packetSignaturePda = packet?.signature?.rule_signature_pda;
  const seedPdas = collectionCheck.ok && collectionCheck.ruleSignaturePdas.length
    ? collectionCheck.ruleSignaturePdas
    : packetSignaturePda
      ? [packetSignaturePda]
      : [];
  if (!seedPdas.length) return;
  let parsed = parseAdditionalSignaturePdas();
  if (!parsed.ok) {
    finalizeSignatureInput.value = seedPdas.join("\n");
    return;
  }
  const values = new Set(parsed.pdas.map((pda) => pda.toBase58()));
  for (const signaturePda of seedPdas) values.add(signaturePda);
  finalizeSignatureInput.value = Array.from(values).join("\n");
}

function applyDeployPacketToComposer(packet) {
  if (!composerForm) return;
  const proposal = packet?.rule_book;
  const targetId = proposal?.patch?.target_id || proposal?.target_refs?.target_id;
  const target = ruleTargets.find((item) => item.id === targetId);
  if (target && moduleSelect && pdaSelect) {
    moduleSelect.value = target.module;
    updatePdaOptions();
    pdaSelect.value = target.id;
  }
  const fields = {
    title: proposal?.readable?.title,
    patchType: proposal?.patch?.patch_type,
    oldHash: proposal?.patch?.old_value_hash,
    proposedValue: proposal?.patch?.proposed_value ? JSON.stringify(proposal.patch.proposed_value, null, 2) : "",
    risk: proposal?.readable?.risk_level,
    threshold: proposal?.readable?.threshold_path,
    challengeWindow: proposal?.readable?.challenge_window,
    validatorGates: proposal?.patch?.validator_gates?.join(", "),
    dailyEmission: proposal?.civilization_power_snapshot?.daily_emission,
    validityDays: proposal?.civilization_power_snapshot?.validity_days,
    snapshotDays: proposal?.civilization_power_snapshot?.snapshot_days,
    settlementLagDays: proposal?.civilization_power_snapshot?.settlement_lag_days,
    signerPower: proposal?.civilization_power_snapshot?.signer_snapshot_power,
    totalPower: proposal?.civilization_power_snapshot?.total_active_power,
    signatureSide: proposal?.civilization_power_snapshot?.signature_side,
  };
  for (const [name, value] of Object.entries(fields)) {
    const element = composerForm.elements.namedItem(name);
    if (element && value !== undefined && value !== null) element.value = String(value);
  }
  if (previewTarget && proposal) previewTarget.textContent = JSON.stringify(proposal, null, 2);
  if (proposal) renderPowerThreshold({
    threshold_path: proposal.readable?.threshold_path,
    signature_side: proposal.civilization_power_snapshot?.signature_side,
    civilization_power_snapshot: proposal.civilization_power_snapshot,
  });
}

function deriveDeploymentPdas({ ruleIdHash, signer = "", targetProgram = "", targetPdaAddress = "", snapshotHash = "" }) {
  const [ruleBook, ruleBookBump] = deriveRuleBookPda({ ruleIdHash });
  const [tallyPda, tallyBump] = deriveRuleTallyPda({ ruleBook });
  const [receiptPda, receiptBump] = deriveExecutionReceiptPda({ ruleBook });
  const snapshotHashValue = snapshotHash || state.proposalEnvelope?.snapshot_hash || state.deployPacket?.rule_book?.snapshot_hash || "";
  let powerSnapshotPda = "";
  let powerSnapshotBump = null;
  let signaturePda = "";
  let signatureBump = null;
  let citizenPowerPda = "";
  let citizenPowerBump = null;
  let adapterAuthorityPda = "";
  let adapterAuthorityBump = null;
  if (snapshotHashValue) {
    const [derivedPowerSnapshot, derivedPowerSnapshotBump] = derivePowerSnapshotPda({ snapshotHash: snapshotHashValue });
    powerSnapshotPda = derivedPowerSnapshot.toBase58();
    powerSnapshotBump = derivedPowerSnapshotBump;
  }
  if (signer) {
    const [derivedSignature, derivedSignatureBump] = deriveRuleSignaturePda({ ruleBook, signer: new PublicKey(signer) });
    signaturePda = derivedSignature.toBase58();
    signatureBump = derivedSignatureBump;
    if (powerSnapshotPda) {
      const [derivedCitizenPower, derivedCitizenPowerBump] = deriveCitizenPowerPda({
        powerSnapshot: new PublicKey(powerSnapshotPda),
        citizen: new PublicKey(signer),
      });
      citizenPowerPda = derivedCitizenPower.toBase58();
      citizenPowerBump = derivedCitizenPowerBump;
    }
  }
  if (targetProgram) {
    const [derivedAdapterAuthority, derivedAdapterAuthorityBump] = deriveCivilizationAdapterAuthorityPda({
      ruleBook,
      targetProgram: new PublicKey(targetProgram),
    });
    adapterAuthorityPda = derivedAdapterAuthority.toBase58();
    adapterAuthorityBump = derivedAdapterAuthorityBump;
  }
  return {
    civilization_program_id: civilizationProgramId,
    rule_id_hash: ruleIdHash,
    signer,
    target_program: targetProgram,
    target_pda: targetPdaAddress,
    rule_book_pda: ruleBook.toBase58(),
    rule_book_bump: ruleBookBump,
    rule_signature_pda: signaturePda,
    rule_signature_bump: signatureBump,
    power_snapshot_pda: powerSnapshotPda,
    power_snapshot_bump: powerSnapshotBump,
    citizen_power_pda: citizenPowerPda,
    citizen_power_bump: citizenPowerBump,
    rule_tally_pda: tallyPda.toBase58(),
    rule_tally_bump: tallyBump,
    execution_receipt_pda: receiptPda.toBase58(),
    execution_receipt_bump: receiptBump,
    adapter_authority_pda: adapterAuthorityPda,
    adapter_authority_bump: adapterAuthorityBump,
  };
}

async function verifySignedProofForProposal({ proposal, signedProof }) {
  const expectedMessage = buildSigningMessage(proposal);
  const message = String(signedProof?.message ?? "");
  if (!proposal || signedProof?.kind !== "nicechunk.civilization.rule_signature.v1") {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.flow.signatureProofInvalid", { reason: "missing signature proof" }),
    };
  }
  const mismatches = [];
  if (signedProof.rule_id !== proposal.rule_id) mismatches.push("rule_id");
  if (signedProof.snapshot_hash !== proposal.snapshot_hash) mismatches.push("snapshot_hash");
  if (message !== expectedMessage) mismatches.push("message");
  if (signedProof.side !== proposal.civilization_power_snapshot?.signature_side) mismatches.push("side");
  const signedPower = toU64BigInt(signedProof.snapshot_power);
  const proposalPower = toU64BigInt(proposal.civilization_power_snapshot?.signer_snapshot_power);
  if (signedPower === null || proposalPower === null || signedPower !== proposalPower) mismatches.push("snapshot_power");
  try {
    const expectedPdas = deriveDeploymentPdas({
      ruleIdHash: proposal.rule_id_hash,
      signer: signedProof.signer,
      targetProgram: proposal.target_refs?.target_program || proposal.patch?.target_program,
      targetPdaAddress: proposal.target_refs?.target_pda || proposal.patch?.target_pda,
      snapshotHash: proposal.snapshot_hash,
    });
    if (signedProof.rule_signature_pda !== expectedPdas.rule_signature_pda) mismatches.push("rule_signature_pda");
    if (signedProof.citizen_power_pda && signedProof.citizen_power_pda !== expectedPdas.citizen_power_pda) mismatches.push("citizen_power_pda");
  } catch {
    mismatches.push("rule_signature_pda");
  }
  let signatureBytes = null;
  try {
    signatureBytes = base64ToBytes(signedProof.signature_base64);
  } catch {
    mismatches.push("signature_base64");
  }
  const expectedMessageHash = `sha256:${await sha256HexBytes(new TextEncoder().encode(expectedMessage))}`;
  if (signedProof.message_hash && signedProof.message_hash !== expectedMessageHash) mismatches.push("message_hash");
  let signatureVerified = false;
  if (signatureBytes && signedProof.signer && message === expectedMessage) {
    signatureVerified = verifyEd25519Signature({
      signer: signedProof.signer,
      message,
      signatureBytes,
    });
  }
  if (!signatureVerified) mismatches.push("ed25519_signature");
  if (mismatches.length) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.flow.signatureProofInvalid", { reason: Array.from(new Set(mismatches)).join(", ") }),
    };
  }
  return {
    ok: true,
    message: "",
    signedProof: {
      ...signedProof,
      message_hash: expectedMessageHash,
      signature_verified: true,
      signature_verified_at: new Date().toISOString(),
    },
  };
}

function verifyEd25519Signature({ signer, message, signatureBytes }) {
  try {
    const publicKey = new PublicKey(signer);
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  } catch {
    return false;
  }
}

function resetFlowAfterEdit() {
  const hadActiveProof = Boolean(
    state.proposalEnvelope
    || state.signedProof
    || state.deployPacket
    || state.sourceDeployPacket
    || state.validation
    || state.chainPlan,
  );
  if (hadActiveProof) state.draftDirtyAfterProof = true;
  const shouldWarn = hadActiveProof || state.draftDirtyAfterProof;
  state.proposalEnvelope = null;
  state.signedProof = null;
  state.deployPacket = null;
  state.sourceDeployPacket = null;
  state.validation = null;
  state.chainPlan = null;
  renderFlowState();
  renderDeploymentReadiness();
  renderFinalizeSignatureCollector();
  renderDeployPacket();
  renderChainPlan();
  if (flowStatusTarget) {
    flowStatusTarget.textContent = shouldWarn ? t("civilization.ruleLibrary.flow.draftChanged") : "";
    flowStatusTarget.dataset.type = shouldWarn ? "warning" : "";
  }
  if (chainStatusTarget) chainStatusTarget.textContent = "";
}

function selectRuleTarget(targetId) {
  const target = ruleTargets.find((item) => item.id === targetId);
  if (!target || !moduleSelect || !pdaSelect || !composerForm) return;
  moduleSelect.value = target.module;
  updatePdaOptions();
  pdaSelect.value = target.id;
  applyComposerTargetDefaults(target, { updateTitle: true });
  renderRulePreview();
  resetFlowAfterEdit();
  document.querySelector("#add-rule")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedComposerTarget() {
  const targetId = String(pdaSelect?.value ?? "");
  return ruleTargets.find((item) => item.id === targetId) ?? null;
}

async function refreshComposerOldValueHash() {
  if (!composerForm) return;
  const target = selectedComposerTarget();
  const targetPda = extractTargetPda(target);
  if (!target || !targetPda) {
    setOldValueHashStatus("warning", t("civilization.ruleLibrary.form.oldHashMissingTarget"));
    showToast(t("civilization.ruleLibrary.form.oldHashMissingTarget"));
    return;
  }

  const oldHashInput = composerForm.elements.namedItem("oldHash");
  if (!oldHashInput) return;
  refreshOldHashButton.disabled = true;
  setOldValueHashStatus("loading", t("civilization.ruleLibrary.form.oldHashRefreshing"));
  try {
    const result = await readPdaAccountWithFallback(new PublicKey(targetPda));
    const account = result.value;
    if (!account) {
      setOldValueHashStatus("warning", t("civilization.ruleLibrary.form.oldHashAccountMissing", { pda: shortAddress(targetPda) }));
      showToast(t("civilization.ruleLibrary.form.oldHashAccountMissing", { pda: shortAddress(targetPda) }));
      return;
    }
    const data = new Uint8Array(account.data);
    const dataHash = `sha256:${await sha256HexBytes(data)}`;
    oldHashInput.value = dataHash;
    state.pdaReads[target.id] = {
      status: "loaded",
      pda: targetPda,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      slot: result.context.slot,
      dataHash,
      decoded: decodeTargetPdaData(target, data),
    };
    renderRulePreview();
    resetFlowAfterEdit();
    renderRuleTargets();
    setOldValueHashStatus("success", t("civilization.ruleLibrary.form.oldHashRefreshed", {
      hash: shortHash(dataHash),
      slot: result.context.slot,
    }));
    showToast(t("civilization.ruleLibrary.form.oldHashRefreshed", {
      hash: shortHash(dataHash),
      slot: result.context.slot,
    }));
  } catch (error) {
    const reason = error?.message || String(error);
    setOldValueHashStatus("error", t("civilization.ruleLibrary.form.oldHashRefreshFailed", { reason }));
    showToast(t("civilization.ruleLibrary.form.oldHashRefreshFailed", { reason }));
  } finally {
    refreshOldHashButton.disabled = false;
  }
}

function setOldValueHashStatus(type, message) {
  if (!oldValueHashStatus) return;
  oldValueHashStatus.dataset.type = type || "";
  oldValueHashStatus.textContent = message || "";
}

function applyComposerTargetDefaults(target, { updateTitle = false } = {}) {
  if (!target || !composerForm) return;
  const formTitle = composerForm.elements.namedItem("title");
  const patchType = composerForm.elements.namedItem("patchType");
  const risk = composerForm.elements.namedItem("risk");
  const threshold = composerForm.elements.namedItem("threshold");
  const gates = composerForm.elements.namedItem("validatorGates");
  const proposedValue = composerForm.elements.namedItem("proposedValue");
  if (formTitle && updateTitle) formTitle.value = `${t(`civilization.ruleLibrary.targets.${target.id}.title`)} proposal`;
  if (patchType) patchType.value = target.status === "readonly" || target.status === "protected" ? "read_only_challenge" : "upsert_config_path";
  if (risk) risk.value = target.risk;
  if (threshold) threshold.value = target.status === "protected" ? "natural_90" : "civilization_50";
  if (gates) gates.value = target.validatorGates.slice(0, 3).join(", ");
  if (proposedValue) proposedValue.value = defaultProposedValueForTarget(target);
}

function defaultProposedValueForTarget(target) {
  if (target?.id === "smelting-recipes") {
    return JSON.stringify(defaultSmeltingRecipePatch, null, 2);
  }
  if (target?.id === "resource-drops") {
    return JSON.stringify({ rules: resourceDropRules.map(serializeResourceDropRuleForProposal) }, null, 2);
  }
  if (target?.status === "readonly" || target?.status === "protected") {
    return JSON.stringify({ evidence_hash: "sha256:challenge-evidence", reason: "read_only_challenge" }, null, 2);
  }
  return JSON.stringify({ field_path: target?.editableFields?.[0] ?? "config.value", new_value: "replace with bounded value" }, null, 2);
}

async function getSigningProvider() {
  const providers = detectWalletProviders();
  if (!providers.length) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.flow.noWallet", { url: buildWalletLoginUrl({ redirectPath: "/civilization/rules.html#add-rule" }).toString() }),
    };
  }
  const session = getWalletSession();
  for (const provider of providers) {
    const publicKey = publicKeyToString(provider.publicKey);
    if (session.walletAddress && publicKey === session.walletAddress && typeof provider.signMessage === "function") {
      return { ok: true, provider, name: session.walletName || "Solana" };
    }
  }
  const provider = providers.find((item) => typeof item.signMessage === "function");
  if (!provider) return { ok: false, message: t("civilization.ruleLibrary.flow.signMessageUnavailable") };
  try {
    const result = await provider.connect?.();
    const publicKey = publicKeyToString(result?.publicKey || provider.publicKey);
    if (publicKey) persistConnectedWallet({ walletAddress: publicKey, walletName: providerName(provider) });
    return { ok: true, provider, name: providerName(provider) };
  } catch (error) {
    return { ok: false, message: t("civilization.ruleLibrary.flow.connectFailed", { reason: error?.message ?? "connect rejected" }) };
  }
}

async function getTransactionProvider() {
  const providers = detectWalletProviders();
  if (!providers.length) {
    return {
      ok: false,
      message: t("civilization.ruleLibrary.flow.noWallet", { url: buildWalletLoginUrl({ redirectPath: "/civilization/rules.html#add-rule" }).toString() }),
    };
  }
  const session = getWalletSession();
  for (const provider of providers) {
    const publicKey = publicKeyToString(provider.publicKey);
    if (session.walletAddress && publicKey === session.walletAddress && hasTransactionSigner(provider)) {
      return { ok: true, provider, name: session.walletName || providerName(provider) };
    }
  }
  const provider = providers.find(hasTransactionSigner);
  if (!provider) return { ok: false, message: t("civilization.ruleLibrary.chain.walletTxUnavailable") };
  try {
    const result = await provider.connect?.();
    const publicKey = publicKeyToString(result?.publicKey || provider.publicKey);
    if (publicKey) persistConnectedWallet({ walletAddress: publicKey, walletName: providerName(provider) });
    return { ok: true, provider, name: providerName(provider) };
  } catch (error) {
    return { ok: false, message: t("civilization.ruleLibrary.flow.connectFailed", { reason: error?.message ?? "connect rejected" }) };
  }
}

function hasTransactionSigner(provider) {
  return typeof provider?.signTransaction === "function" || typeof provider?.signAndSendTransaction === "function";
}

async function signAndSendWalletTransaction(provider, transaction, conn) {
  if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(transaction);
    const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({
      signature,
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight: transaction.lastValidBlockHeight,
    }, "confirmed");
    return signature;
  }
  if (typeof provider.signAndSendTransaction !== "function") {
    throw new Error("Wallet does not support transaction signing.");
  }
  const result = await provider.signAndSendTransaction(transaction);
  const signature = typeof result === "string" ? result : result?.signature;
  if (!signature) throw new Error("Wallet did not return a transaction signature.");
  await conn.confirmTransaction({
    signature,
    blockhash: transaction.recentBlockhash,
    lastValidBlockHeight: transaction.lastValidBlockHeight,
  }, "confirmed");
  return signature;
}

function buildSigningMessage(proposal) {
  return [
    "NiceChunk Civilization Rule Proposal",
    `rule_id=${proposal.rule_id}`,
    `rule_id_hash=${proposal.rule_id_hash}`,
    `text_hash=${proposal.text_hash}`,
    `patch_hash=${proposal.patch_hash}`,
    `snapshot_hash=${proposal.snapshot_hash}`,
    `target_ref_hash=${proposal.target_ref_hash}`,
    `target_program=${proposal.target_refs.target_program}`,
    `target_pda=${proposal.patch.target_pda}`,
    `target_pda_label=${proposal.target_refs.target_pda_label}`,
    `threshold_path=${proposal.readable.threshold_path}`,
    `snapshot_window=${proposal.civilization_power_snapshot.window_start}..${proposal.civilization_power_snapshot.window_end}`,
    `signature_side=${proposal.civilization_power_snapshot.signature_side}`,
    `snapshot_power=${proposal.civilization_power_snapshot.signer_snapshot_power}`,
    "Only sign if the readable rule and machine patch match what you reviewed.",
  ].join("\n");
}

function buildCivilizationPowerSnapshot(form) {
  const dailyEmission = positiveInteger(form.get("dailyEmission"), 1_000_000);
  const validityDays = clampInteger(form.get("validityDays"), 1, 365, 30);
  const snapshotDays = clampInteger(form.get("snapshotDays"), 1, 180, 28);
  const settlementLagDays = clampInteger(form.get("settlementLagDays"), 1, 30, 1);
  const totalActivePower = positiveInteger(form.get("totalPower"), 2_000_000);
  const signerPower = Math.max(0, Math.floor(Number(form.get("signerPower") ?? 120_000)));
  const { start, end } = snapshotWindow(snapshotDays, settlementLagDays);
  return {
    model: "activity_window_expiring_cv_v1",
    daily_emission: dailyEmission,
    validity_days: validityDays,
    snapshot_days: snapshotDays,
    settlement_lag_days: settlementLagDays,
    window_start: start,
    window_end: end,
    total_active_power: totalActivePower,
    signer_snapshot_power: signerPower,
    source_categories: {
      exploration_mining_bps: 2500,
      production_smelting_bps: 2000,
      forging_equipment_bps: 1500,
      market_real_liquidity_bps: 1000,
      guardian_service_bps: 1500,
      audit_challenge_governance_bps: 1500,
    },
    anti_abuse_gates: ["wallet_cap", "category_cap", "maturity", "duplicate_decay", "anomaly_penalty"],
  };
}

function renderPowerThreshold(preview) {
  if (!powerThresholdMeter) return;
  const snapshot = preview.civilization_power_snapshot;
  const required = requiredPower(snapshot.total_active_power, preview.threshold_path);
  const projectedYes = preview.signature_side === "agree" ? snapshot.signer_snapshot_power : 0;
  const percent = snapshot.total_active_power ? Math.min(100, Math.round((projectedYes / snapshot.total_active_power) * 100)) : 0;
  powerThresholdMeter.innerHTML = `
    <div class="power-meter-row">
      <span>${t("civilization.ruleLibrary.power.window")}</span>
      <strong>${snapshot.window_start} -> ${snapshot.window_end}</strong>
    </div>
    <div class="power-meter-track" aria-hidden="true"><span style="width: ${percent}%"></span></div>
    <div class="power-meter-row">
      <span>${t("civilization.ruleLibrary.power.required")}</span>
      <strong>${formatInteger(required)} / ${formatInteger(snapshot.total_active_power)} CV</strong>
    </div>
    <div class="power-meter-row">
      <span>${t("civilization.ruleLibrary.power.signerWeight")}</span>
      <strong>${formatInteger(snapshot.signer_snapshot_power)} CV (${preview.signature_side})</strong>
    </div>
  `;
}

function buildThresholdResult(proposal, signature) {
  const snapshot = proposal.civilization_power_snapshot;
  const thresholdPath = proposal.readable?.threshold_path || proposal.threshold_path || "civilization_50";
  const required = snapshot.required_yes_power ?? requiredPower(snapshot.total_active_power, thresholdPath);
  const thresholdBlocked = !Number.isFinite(Number(required));
  const projectedYesPower = signature.side === "agree" ? signature.snapshot_power : 0;
  const projectedNoPower = signature.side === "reject" ? signature.snapshot_power : 0;
  return {
    threshold_path: thresholdPath,
    threshold_bps: snapshot.threshold_bps ?? thresholdBpsForPath(thresholdPath),
    total_active_power: snapshot.total_active_power,
    required_yes_power: thresholdBlocked ? null : required,
    threshold_blocked: thresholdBlocked,
    blocked_reason: thresholdBlocked ? "reject_threshold_path" : "",
    projected_yes_power_after_this_signature: projectedYesPower,
    projected_no_power_after_this_signature: projectedNoPower,
    projected_passes_after_this_signature: thresholdMetForRule({
      yesPower: projectedYesPower,
      noPower: projectedNoPower,
      requiredPower: required,
    }),
    note: "A real rule would aggregate all rule_signature_pda accounts from the frozen snapshot before execution.",
  };
}

function thresholdBpsForPath(path) {
  if (path === "natural_90") return 9000;
  if (path === "reject") return 0;
  return 5000;
}

function requiredPower(totalPower, path) {
  const bps = thresholdBpsForPath(path);
  if (!bps) return Infinity;
  const total = toU64BigInt(totalPower);
  if (total === null || total === 0n) return Infinity;
  return safeU64Number(civilizationRequiredPower(total, bps));
}

function thresholdRequirement(totalPower, path) {
  const required = requiredPower(totalPower, path);
  const thresholdBlocked = !Number.isFinite(Number(required));
  return {
    required_yes_power: thresholdBlocked ? null : required,
    threshold_blocked: thresholdBlocked,
    blocked_reason: thresholdBlocked ? "reject_threshold_path" : "",
  };
}

function thresholdMetForRule({ yesPower, noPower = 0, requiredPower }) {
  const required = toU64BigInt(requiredPower);
  if (required === null) return false;
  return civilizationThresholdMet({
    yesPower: toU64BigInt(yesPower) ?? 0n,
    noPower: toU64BigInt(noPower) ?? 0n,
    requiredPower: required,
  });
}

function safeU64Number(value) {
  const parsed = typeof value === "bigint" ? value : toU64BigInt(value);
  if (parsed === null) return 0;
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed.toString();
}

function toU64BigInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return BigInt(Math.trunc(value));
  }
  const normalized = String(value).trim();
  if (!/^\d+$/u.test(normalized)) return null;
  return BigInt(normalized);
}

function snapshotWindow(snapshotDays, settlementLagDays) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - settlementLagDays));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - snapshotDays + 1);
  return { start: isoDate(start), end: isoDate(end) };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveIntegerAllowZero(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatInteger(value) {
  const exact = toU64BigInt(value);
  if (exact === null) return "blocked";
  try {
    return new Intl.NumberFormat("en-US").format(exact);
  } catch {
    return exact.toString();
  }
}

function persistDeployPacket(packet) {
  const packets = loadDeployPackets();
  packets.unshift(packet);
  localStorage.setItem(deployPacketStorageKey, JSON.stringify(packets.slice(0, 10)));
}

function buildBlockedChainPlan(target, reason, extra = {}) {
  return {
    kind: "nicechunk.civilization.chain_plan.v1",
    status: "blocked",
    reason,
    target_id: target?.id || "",
    target_pda_label: target?.pda || "",
    pda_refs: target?.pdaRefs || [],
    ...extra,
  };
}

function describeInstruction(name, ix) {
  return {
    name,
    program_id: ix.programId.toBase58(),
    account_count: ix.keys.length,
    data_bytes: ix.data.length,
    accounts: ix.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      signer: key.isSigner,
      writable: key.isWritable,
    })),
  };
}

function extractTargetPda(target) {
  return extractTargetPdas(target)[0] || "";
}

function extractTargetPdas(target) {
  if (!target) return [];
  if (target.id === "resource-drops") {
    const [globalConfig] = deriveGlobalConfigPda();
    const [resourceDropTable] = deriveResourceDropTablePda({
      globalConfig,
      programId: new PublicKey(targetProgramIds.resources),
    });
    return [resourceDropTable.toBase58()];
  }
  const refs = [target.pda, ...(target.pdaRefs || [])];
  const addresses = [];
  for (const ref of refs) {
    const match = String(ref).match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (!match) continue;
    for (const candidate of match) {
      try {
        const address = new PublicKey(candidate).toBase58();
        if (!addresses.includes(address)) addresses.push(address);
      } catch {
        continue;
      }
    }
  }
  return addresses;
}

async function loadRuleTargetPda(targetId) {
  const target = ruleTargets.find((item) => item.id === targetId);
  if (!target) return;
  const pda = extractTargetPda(target);
  if (!pda) {
    state.pdaReads[targetId] = { status: "error", reason: t("civilization.ruleLibrary.chain.noTargetPda") };
    renderRuleTargets();
    return;
  }
  state.pdaReads[targetId] = { status: "loading", pda };
  renderRuleTargets();
  try {
    const result = await readPdaAccountWithFallback(new PublicKey(pda));
    const account = result.value;
    if (!account) {
      state.pdaReads[targetId] = { status: "missing", pda };
      renderRuleTargets();
      return;
    }
    const data = new Uint8Array(account.data);
    state.pdaReads[targetId] = {
      status: "loaded",
      pda,
      owner: account.owner.toBase58(),
      lamports: account.lamports,
      bytes: data.length,
      slot: result.context.slot,
      dataHash: `sha256:${await sha256HexBytes(data)}`,
      decoded: decodeTargetPdaData(target, data),
    };
  } catch (error) {
    state.pdaReads[targetId] = {
      status: "error",
      pda,
      reason: error?.message || String(error),
    };
  }
  renderRuleTargets();
}

async function readPdaAccountWithFallback(publicKey) {
  const urls = Array.from(new Set([fallbackDevnetRpcUrl, getNicechunkRpcUrl()].filter(Boolean)));
  let lastError = null;
  for (const rpcUrl of urls) {
    try {
      const conn = new Connection(rpcUrl, {
        commitment: "confirmed",
        fetch: createNicechunkRpcFetch("civilization-rule-pda-read"),
      });
      return await withTimeout(
        conn.getAccountInfoAndContext(publicKey, "confirmed"),
        12_000,
        `RPC read timed out after 12s: ${new URL(rpcUrl).host}`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("RPC read failed.");
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function decodeTargetPdaData(target, data) {
  if (target?.id === "resource-drops") return decodeResourceDropTable(data);
  if (target?.id === "smelting-recipes") return decodeSmeltingRecipeTable(data);
  return {
    kind: t("civilization.ruleLibrary.pdaReader.rawAccount"),
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.decoder"), value: t("civilization.ruleLibrary.pdaReader.noDecoder") },
      { label: t("civilization.ruleLibrary.pdaReader.firstBytes"), value: toHex(data.slice(0, 32)) },
    ],
    rows: [],
  };
}

function decodeResourceDropTable(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  const version = data[8] ?? 0;
  const bump = data[9] ?? 0;
  const ruleCount = data[10] ?? 0;
  const expectedBytes = 16 + ruleCount * 23;
  const rows = [];
  for (let index = 0; index < Math.min(ruleCount, 8); index += 1) {
    const offset = 16 + index * 23;
    if (offset + 23 > data.length) break;
    rows.push({
      title: `${t("civilization.ruleLibrary.pdaReader.rule")} #${index + 1}`,
      fields: [
        { label: "source_block_id", value: view.getUint16(offset, true) },
        { label: "drop_block_id", value: view.getUint16(offset + 2, true) },
        { label: "chance_bps", value: view.getUint16(offset + 4, true) },
        { label: "altitude", value: `${view.getInt16(offset + 6, true)}..${view.getInt16(offset + 8, true)}` },
        { label: "depth", value: `${view.getInt16(offset + 10, true)}..${view.getInt16(offset + 12, true)}` },
        { label: "salt", value: data[offset + 14] },
        { label: "volume_mm3", value: `${view.getUint32(offset + 15, true)}..${view.getUint32(offset + 19, true)}` },
      ],
    });
  }
  return {
    kind: "ResourceDropTable",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: magic },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: version },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: bump },
      { label: t("civilization.ruleLibrary.pdaReader.ruleCount"), value: ruleCount },
      { label: t("civilization.ruleLibrary.pdaReader.expectedBytes"), value: expectedBytes },
      { label: t("civilization.ruleLibrary.pdaReader.validShape"), value: magic === "NCKDRP02" && version === 2 && expectedBytes === data.length ? "yes" : "no" },
    ],
    rows,
  };
}

function decodeSmeltingRecipeTable(data) {
  const view = dataView(data);
  const magic = ascii(data.slice(0, 8));
  const version = view.getUint16(8, true);
  const bump = data[10] ?? 0;
  const initialized = data[11] === 1;
  const tableId = readU64String(view, 12);
  const authority = data.length >= 52 ? new PublicKey(data.slice(20, 52)).toBase58() : "";
  const recipeCount = view.getUint16(52, true);
  const updatedSlot = readU64String(view, 62);
  const rows = [];
  for (let index = 0; index < RECIPE_TABLE_MAX_RECIPES; index += 1) {
    const offset = RECIPE_TABLE_HEADER_LEN + index * RECIPE_RECORD_LEN;
    if (offset + RECIPE_RECORD_LEN > data.length) break;
    const recipeId = readU64String(view, offset);
    if (recipeId === "0") continue;
    rows.push({
      title: `${t("civilization.ruleLibrary.pdaReader.recipe")} #${index + 1}`,
      fields: [
        { label: "recipe_id", value: recipeId },
        { label: "enabled", value: data[offset + 8] === 1 ? "yes" : "no" },
        { label: "min_heat_tier", value: data[offset + 9] },
        { label: "input_count", value: data[offset + 10] },
        { label: "output_count", value: data[offset + 11] },
        { label: "yield_bps", value: view.getUint16(offset + 12, true) },
        { label: "first_input", value: describeBackpackSlot(data, offset + 16) },
        { label: "first_output", value: describeBackpackSlot(data, offset + 16 + 8 * 80) },
        { label: "updated_slot", value: readU64String(view, offset + RECIPE_RECORD_LEN - 8) },
      ],
    });
  }
  return {
    kind: "SmeltingRecipeTable",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: magic },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: version },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: bump },
      { label: t("civilization.ruleLibrary.pdaReader.initialized"), value: initialized ? "yes" : "no" },
      { label: t("civilization.ruleLibrary.pdaReader.tableId"), value: tableId },
      { label: t("civilization.ruleLibrary.pdaReader.authority"), value: authority },
      { label: t("civilization.ruleLibrary.pdaReader.recipeCount"), value: recipeCount },
      { label: t("civilization.ruleLibrary.pdaReader.updatedSlot"), value: updatedSlot },
      { label: t("civilization.ruleLibrary.pdaReader.validShape"), value: magic === RECIPE_TABLE_MAGIC && version === 2 && initialized ? "yes" : "no" },
    ],
    rows,
  };
}

function decodeGlobalConfigAccount(data) {
  const view = dataView(data);
  return {
    kind: "GlobalConfig",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "sealed", value: data[11] === 1 ? "yes" : "no" },
      { label: "world_id", value: view.getUint16(76, true) },
      { label: "chunk_size", value: view.getUint16(259, true) },
      { label: "min_build_y", value: view.getInt16(263, true) },
      { label: "max_build_y", value: view.getInt16(265, true) },
      { label: "sea_level", value: view.getInt16(269, true) },
      { label: "created_at", value: readI64String(view, 285) },
    ],
    rows: [
      {
        title: "hashes",
        fields: [
          { label: "world_seed", value: toHex(data.slice(87, 119)) },
          { label: "terrain_hash", value: toHex(data.slice(119, 151)) },
          { label: "resource_hash", value: toHex(data.slice(151, 183)) },
          { label: "client_hash", value: toHex(data.slice(183, 215)) },
        ],
      },
    ],
  };
}

function decodeBackpackAccount(data) {
  const view = dataView(data);
  const itemCount = data[53] ?? 0;
  const rows = [];
  for (let index = 0; index < Math.min(itemCount, 8); index += 1) {
    const offset = 128 + index * 80;
    rows.push({
      title: `${t("civilization.ruleLibrary.pdaBrowser.slot")} #${index + 1}`,
      fields: [{ label: "slot", value: describeBackpackSlot(data, offset) }],
    });
  }
  return {
    kind: "Backpack",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "backpack_id", value: readU64String(view, 12) },
      { label: "owner", value: pubkeyAt(data, 20) },
      { label: "capacity", value: data[52] },
      { label: "item_count", value: itemCount },
      { label: t("civilization.ruleLibrary.pdaReader.updatedSlot"), value: readU64String(view, 74) },
    ],
    rows,
  };
}

function decodePlayerProfileAccount(data) {
  const view = dataView(data);
  const nameLength = view.getUint16(463, true);
  const nameBytes = data.slice(465, 465 + Math.min(nameLength, 300));
  return {
    kind: "PlayerProfile",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "owner", value: pubkeyAt(data, 12) },
      { label: "global_config", value: pubkeyAt(data, 44) },
      { label: "world_id", value: view.getUint16(76, true) },
      { label: "position", value: `${view.getInt32(78, true)},${view.getInt32(82, true)},${view.getInt32(86, true)}` },
      { label: "equipped_backpack", value: pubkeyAt(data, 393) },
      { label: "forging_xp", value: readU64String(view, 449) },
      { label: "name", value: new TextDecoder().decode(nameBytes) },
    ],
    rows: [],
  };
}

function decodePlayerSessionAccount(data) {
  const view = dataView(data);
  return {
    kind: "PlayerSession",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "owner", value: pubkeyAt(data, 12) },
      { label: "session_authority", value: pubkeyAt(data, 44) },
      { label: "player_profile", value: pubkeyAt(data, 76) },
      { label: "global_config", value: pubkeyAt(data, 108) },
      { label: "allowed_actions", value: view.getUint16(142, true) },
      { label: "expires_at", value: readI64String(view, 144) },
      { label: "action_count", value: view.getUint32(180, true) },
    ],
    rows: [],
  };
}

function decodePlayerProgressAccount(data) {
  const view = dataView(data);
  return {
    kind: "PlayerProgress",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "owner", value: pubkeyAt(data, 12) },
      { label: "global_config", value: pubkeyAt(data, 44) },
      { label: "precision_xp", value: readU64String(view, 76) },
      { label: "smelting_xp", value: readU64String(view, 108) },
      { label: "exploration_xp", value: readU64String(view, 116) },
      { label: t("civilization.ruleLibrary.pdaReader.updatedSlot"), value: readU64String(view, 92) },
    ],
    rows: [],
  };
}

function decodeCivilizationRuleBookAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationRuleBook",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: "status", value: data[11] },
      { label: "author", value: pubkeyAt(data, 12) },
      { label: "target_program", value: pubkeyAt(data, 172) },
      { label: "target_pda", value: pubkeyAt(data, 204) },
      { label: "total_power", value: readU64String(view, 236) },
      { label: "required_power", value: readU64String(view, 244) },
      { label: "threshold_bps", value: view.getUint16(252, true) },
      { label: "executed_slot", value: readU64String(view, 304) },
    ],
    rows: [{
      title: "hashes",
      fields: [
        { label: "rule_id_hash", value: `sha256:${toHex(data.slice(44, 76))}` },
        { label: "text_hash", value: `sha256:${toHex(data.slice(76, 108))}` },
        { label: "patch_hash", value: `sha256:${toHex(data.slice(108, 140))}` },
        { label: "snapshot_hash", value: `sha256:${toHex(data.slice(140, 172))}` },
      ],
    }],
  };
}

function decodeCivilizationSignatureAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationSignature",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: "side", value: data[11] },
      { label: "rule_book", value: pubkeyAt(data, 12) },
      { label: "signer", value: pubkeyAt(data, 44) },
      { label: "power", value: readU64String(view, 108) },
      { label: "signed_slot", value: readU64String(view, 116) },
      { label: "snapshot_hash", value: `sha256:${toHex(data.slice(76, 108))}` },
    ],
    rows: [],
  };
}

function decodeCivilizationTallyAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationTally",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: "threshold_met", value: data[11] === 1 ? "yes" : "no" },
      { label: "rule_book", value: pubkeyAt(data, 12) },
      { label: "yes_power", value: readU64String(view, 44) },
      { label: "no_power", value: readU64String(view, 52) },
      { label: "abstain_power", value: readU64String(view, 60) },
      { label: "challenge_power", value: readU64String(view, 68) },
      { label: "required_power", value: readU64String(view, 76) },
      { label: "finalized_slot", value: readU64String(view, 84) },
    ],
    rows: [],
  };
}

function decodeCivilizationReceiptAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationExecutionReceipt",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: "executed", value: data[11] === 1 ? "yes" : "no" },
      { label: "rule_book", value: pubkeyAt(data, 12) },
      { label: "executor", value: pubkeyAt(data, 44) },
      { label: "executed_slot", value: readU64String(view, 76) },
      { label: "executed_at", value: readI64String(view, 84) },
    ],
    rows: [],
  };
}

function decodeCivilizationPowerSnapshotAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationPowerSnapshot",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "trusted_authority", value: pubkeyAt(data, 11) },
      { label: "snapshot_hash", value: `sha256:${toHex(data.slice(43, 75))}` },
      { label: "total_active_power", value: readU64String(view, 75) },
      { label: "window_start_epoch", value: readU64String(view, 83) },
      { label: "window_end_epoch", value: readU64String(view, 91) },
      { label: "created_slot", value: readU64String(view, 99) },
      { label: "expires_at", value: readI64String(view, 107) },
      { label: "created_at", value: readI64String(view, 115) },
    ],
    rows: [],
  };
}

function decodeCivilizationCitizenPowerAccount(data) {
  const view = dataView(data);
  return {
    kind: "CivilizationCitizenPower",
    fields: [
      { label: t("civilization.ruleLibrary.pdaReader.magic"), value: ascii(data.slice(0, 8)) },
      { label: t("civilization.ruleLibrary.pdaReader.version"), value: view.getUint16(8, true) },
      { label: t("civilization.ruleLibrary.pdaReader.bump"), value: data[10] },
      { label: "power_snapshot", value: pubkeyAt(data, 11) },
      { label: "citizen", value: pubkeyAt(data, 43) },
      { label: "snapshot_hash", value: `sha256:${toHex(data.slice(75, 107))}` },
      { label: "power", value: readU64String(view, 107) },
      { label: "settled_slot", value: readU64String(view, 115) },
      { label: "settled_at", value: readI64String(view, 123) },
      { label: "expires_at", value: readI64String(view, 131) },
    ],
    rows: [],
  };
}

function describeBackpackSlot(data, offset) {
  if (offset + 80 > data.length) return "out_of_range";
  const view = dataView(data);
  const kind = data[offset] === 2 ? "item" : data[offset] === 1 ? "block" : `kind_${data[offset]}`;
  const quantity = view.getUint32(offset + 4, true);
  if (kind === "block") {
    return `block qty=${quantity} resource=(${view.getInt32(offset + 8, true)},${view.getInt16(offset + 12, true)},${view.getInt32(offset + 14, true)})`;
  }
  return `item qty=${quantity} category=${data[offset + 1]} code=${view.getUint16(offset + 18, true)} item_id=${readU64String(view, offset + 20)}`;
}

function buildResourceDropAddressLookupTablePlan({
  targetProgram,
  targetPdaKey,
  ruleBook,
  tallyPda,
  receiptPda,
}) {
  const entries = resourceDropLookupTableEntries({ targetProgram, targetPdaKey, ruleBook, tallyPda, receiptPda });
  return {
    required: true,
    reason: "The full 37-rule ResourceDropTable patch exceeds a legacy transaction budget, so submission creates and extends an Address Lookup Table before sending the v0 adapter transaction.",
    setup_transactions: [
      {
        name: "create_lookup_table",
        program_id: AddressLookupTableProgram.programId.toBase58(),
        authority: "payer",
        payer: "payer",
        address_derivation: "AddressLookupTableProgram.createLookupTable(authority=payer, payer=payer, recentSlot=current_confirmed_slot)",
      },
      {
        name: "extend_lookup_table",
        program_id: AddressLookupTableProgram.programId.toBase58(),
        address_count: entries.length,
        addresses: entries.map((entry) => ({ label: entry.label, pubkey: entry.pubkey.toBase58() })),
      },
    ],
    v0_message: {
      lookup_table_activation_gate: "wait until confirmed slot is greater than lookup table creation slot",
      compute_unit_price_micro_lamports: 20_000,
      compute_unit_limit: 400_000,
      adapter_instruction: "apply_civilization_resource_drop_receipt",
    },
  };
}

function resourceDropLookupTableEntries({
  targetProgram,
  targetPdaKey,
  ruleBook,
  tallyPda,
  receiptPda,
}) {
  const [adapterAuthorityPda] = deriveCivilizationAdapterAuthorityPda({ ruleBook, targetProgram });
  return [
    { label: "target_program", pubkey: targetProgram },
    { label: "resource_drop_table_pda", pubkey: targetPdaKey },
    { label: "global_config_pda", pubkey: deriveGlobalConfigPda()[0] },
    { label: "rule_book_pda", pubkey: ruleBook },
    { label: "rule_tally_pda", pubkey: tallyPda },
    { label: "execution_receipt_pda", pubkey: receiptPda },
    { label: "system_program", pubkey: SystemProgram.programId },
    { label: "civilization_program", pubkey: new PublicKey(civilizationProgramId) },
    { label: "adapter_authority_pda", pubkey: adapterAuthorityPda },
  ];
}

function targetUsesTargetAdapter(target) {
  return target?.id === "smelting-recipes" || target?.id === "resource-drops";
}

function targetAdapterBuilderName(targetId) {
  if (targetId === "smelting-recipes") return "createApplyCivilizationSmeltingRecipeInstruction";
  if (targetId === "resource-drops") return "createApplyCivilizationResourceDropRulesInstruction";
  return "target_adapter_required";
}

function executeInstructionNameForTarget(target) {
  if (target?.id === "smelting-recipes") return "apply_civilization_recipe_receipt";
  if (target?.id === "resource-drops") return "apply_civilization_resource_drop_receipt";
  return "execute_rule_receipt";
}

function serializeResourceDropRuleForProposal(rule) {
  return {
    sourceBlockId: rule.sourceBlockId,
    dropBlockId: rule.dropBlockId,
    chanceBps: rule.chanceBps,
    minAltitude: rule.minAltitude,
    maxAltitude: rule.maxAltitude,
    minDepth: rule.minDepth,
    maxDepth: rule.maxDepth,
    salt: rule.salt,
    minVolumeMm3: rule.minVolumeMm3,
    maxVolumeMm3: rule.maxVolumeMm3,
  };
}

function targetStatusCode(status) {
  if (status === "governable") return 1;
  if (status === "adapter") return 2;
  if (status === "readonly") return 3;
  if (status === "protected") return 4;
  return 0;
}

function riskLevelCode(risk) {
  if (risk === "medium") return 1;
  if (risk === "high") return 2;
  if (risk === "critical") return 3;
  return 0;
}

function sideCode(side) {
  if (side === "agree") return CIVILIZATION_SIDE_AGREE;
  if (side === "reject") return CIVILIZATION_SIDE_REJECT;
  if (side === "abstain") return CIVILIZATION_SIDE_ABSTAIN;
  if (side === "challenge") return CIVILIZATION_SIDE_CHALLENGE;
  return CIVILIZATION_SIDE_ABSTAIN;
}

function sideName(side) {
  if (side === CIVILIZATION_SIDE_AGREE) return "agree";
  if (side === CIVILIZATION_SIDE_REJECT) return "reject";
  if (side === CIVILIZATION_SIDE_ABSTAIN) return "abstain";
  if (side === CIVILIZATION_SIDE_CHALLENGE) return "challenge";
  return "unknown";
}

function loadDeployPackets() {
  try {
    const value = JSON.parse(localStorage.getItem(deployPacketStorageKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function verifyDeployPacketShape(packet) {
  const errors = [];
  if (packet?.kind !== "nicechunk.civilization.deploy_packet.v1") errors.push(t("civilization.ruleLibrary.history.errors.kind"));
  if (packet?.rule_book?.kind !== "nicechunk.civilization.rule_book.v1") errors.push(t("civilization.ruleLibrary.history.errors.ruleBook"));
  if (!String(packet?.rule_book?.text_hash || "").startsWith("sha256:")) errors.push(t("civilization.ruleLibrary.history.errors.textHash"));
  if (!String(packet?.rule_book?.patch_hash || "").startsWith("sha256:")) errors.push(t("civilization.ruleLibrary.history.errors.patchHash"));
  if (!String(packet?.rule_book?.snapshot_hash || "").startsWith("sha256:")) errors.push(t("civilization.ruleLibrary.history.errors.snapshotHash"));
  if (!String(packet?.rule_book?.target_ref_hash || "").startsWith("sha256:")) errors.push(t("civilization.ruleLibrary.history.errors.targetRefHash"));
  if (!packet?.rule_book?.target_refs?.target_program) errors.push(t("civilization.ruleLibrary.history.errors.targetProgram"));
  if (!packet?.rule_book?.target_refs?.target_pda) errors.push(t("civilization.ruleLibrary.history.errors.targetPda"));
  if (packet?.signature?.kind !== "nicechunk.civilization.rule_signature.v1") errors.push(t("civilization.ruleLibrary.history.errors.signature"));
  const signatureCollectionCheck = verifyDeploySignatureCollection(packet);
  if (packet?.signature_collection && !signatureCollectionCheck.ok) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollection", {
      reason: signatureCollectionCheck.errors.join("; "),
    }));
  }
  if (packet?.lineage) {
    const lineageCheck = verifyDeployLineage(packet);
    if (!lineageCheck.ok) {
      errors.push(t("civilization.ruleLibrary.history.errors.lineage", {
        reason: lineageCheck.errors.join("; "),
      }));
    }
  }
  if (!packet?.threshold_result) {
    errors.push(t("civilization.ruleLibrary.history.errors.threshold"));
  } else {
    const thresholdCheck = verifyDeployThresholdResult(packet);
    if (!thresholdCheck.ok) {
      errors.push(t("civilization.ruleLibrary.history.errors.thresholdResult", {
        fields: thresholdCheck.fields.join(", "),
      }));
    }
  }
  if (!packet?.execution_hint) {
    errors.push(t("civilization.ruleLibrary.history.errors.execution"));
  } else {
    const executionHintCheck = verifyDeployExecutionHint(packet);
    if (!executionHintCheck.ok) {
      errors.push(t("civilization.ruleLibrary.history.errors.executionHint", {
        fields: executionHintCheck.fields.join(", "),
      }));
    }
  }
  if (!String(packet?.rule_book?.rule_id_hash || "").startsWith("sha256:")) errors.push(t("civilization.ruleLibrary.history.errors.ruleIdHash"));
  try {
    const expectedMessage = buildSigningMessage(packet.rule_book);
    const signatureBytes = base64ToBytes(packet?.signature?.signature_base64);
    const signatureMatches = packet?.signature?.message === expectedMessage
      && verifyEd25519Signature({
        signer: packet?.signature?.signer,
        message: packet?.signature?.message,
        signatureBytes,
      });
    if (!signatureMatches) errors.push(t("civilization.ruleLibrary.history.errors.signatureProof"));
  } catch {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureProof"));
  }
  const expectedPdas = packet?.rule_book?.rule_id_hash
    ? safeDeriveDeploymentPdas({
      ruleIdHash: packet.rule_book.rule_id_hash,
      signer: packet?.signature?.signer,
      targetProgram: packet?.rule_book?.target_refs?.target_program || packet?.rule_book?.patch?.target_program,
      targetPdaAddress: packet?.rule_book?.target_refs?.target_pda || packet?.rule_book?.patch?.target_pda,
      snapshotHash: packet?.rule_book?.snapshot_hash,
    })
    : null;
  if (expectedPdas) {
    if (packet?.rule_book?.rule_book_pda && packet.rule_book.rule_book_pda !== expectedPdas.rule_book_pda) {
      errors.push(t("civilization.ruleLibrary.history.errors.ruleBookPda"));
    }
    if (packet?.signature?.rule_signature_pda && packet.signature.rule_signature_pda !== expectedPdas.rule_signature_pda) {
      errors.push(t("civilization.ruleLibrary.history.errors.signaturePda"));
    }
    if (packet?.signature?.citizen_power_pda && packet.signature.citizen_power_pda !== expectedPdas.citizen_power_pda) {
      errors.push(t("civilization.ruleLibrary.history.errors.citizenPowerPda"));
    }
    if (packet?.derived_pdas) {
      if (packet.derived_pdas.rule_book_pda !== expectedPdas.rule_book_pda) errors.push(t("civilization.ruleLibrary.history.errors.ruleBookPda"));
      if (packet.derived_pdas.rule_signature_pda !== expectedPdas.rule_signature_pda) errors.push(t("civilization.ruleLibrary.history.errors.signaturePda"));
      if (packet.derived_pdas.power_snapshot_pda !== expectedPdas.power_snapshot_pda) errors.push(t("civilization.ruleLibrary.history.errors.powerSnapshotPda"));
      if (packet.derived_pdas.citizen_power_pda !== expectedPdas.citizen_power_pda) errors.push(t("civilization.ruleLibrary.history.errors.citizenPowerPda"));
      if (packet.derived_pdas.rule_tally_pda !== expectedPdas.rule_tally_pda) errors.push(t("civilization.ruleLibrary.history.errors.tallyPda"));
      if (packet.derived_pdas.execution_receipt_pda !== expectedPdas.execution_receipt_pda) errors.push(t("civilization.ruleLibrary.history.errors.receiptPda"));
      if (expectedPdas.adapter_authority_pda && packet.derived_pdas.adapter_authority_pda !== expectedPdas.adapter_authority_pda) errors.push(t("civilization.ruleLibrary.history.errors.adapterAuthorityPda"));
    }
  }
  return { ok: errors.length === 0, errors };
}

function verifyDeployLineage(packet) {
  const lineage = packet?.lineage;
  if (!lineage) return { ok: true, errors: [] };
  const errors = [];
  if (lineage.kind !== "nicechunk.civilization.deploy_lineage.v1") {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageKind"));
  }
  const hop = Number(lineage.hop);
  if (!Number.isInteger(hop) || hop < 0) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageHop"));
  }
  if ((lineage.current_signer || "") !== (packet?.signature?.signer || "")) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageCurrentSigner"));
  }
  if ((lineage.current_signature_pda || "") !== (packet?.signature?.rule_signature_pda || "")) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageCurrentSignature"));
  }
  const currentHash = String(lineage.current_deploy_packet_hash || "");
  if (currentHash && !currentHash.startsWith("sha256:")) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageCurrentHash"));
  }
  if (hop > 0 && !String(lineage.previous_deploy_packet_hash || "").startsWith("sha256:")) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineagePreviousHash"));
  }
  for (const [field, value] of [
    ["previous_signer", lineage.previous_signer],
    ["previous_signature_pda", lineage.previous_signature_pda],
  ]) {
    if (value && !parsePublicKeyString(value)) {
      errors.push(t("civilization.ruleLibrary.history.errors.lineagePublicKey", { field }));
    }
  }
  const collection = packet?.signature_collection;
  if (collection) {
    const collectionPdas = Array.isArray(collection.rule_signature_pdas) ? collection.rule_signature_pdas.map(String).sort() : [];
    const lineagePdas = Array.isArray(lineage.preserved_signature_pdas) ? lineage.preserved_signature_pdas.map(String).sort() : [];
    if (Number(lineage.preserved_signature_count) !== Number(collection.signature_count)) {
      errors.push(t("civilization.ruleLibrary.history.errors.lineageCount"));
    }
    if (collectionPdas.length !== lineagePdas.length || collectionPdas.some((pda, index) => pda !== lineagePdas[index])) {
      errors.push(t("civilization.ruleLibrary.history.errors.lineageSignatureSet"));
    }
    const collectionHash = collection.signature_collection_hash || "";
    const lineageHash = lineage.preserved_signature_collection_hash || "";
    if (collectionHash && lineageHash && collectionHash !== lineageHash) {
      errors.push(t("civilization.ruleLibrary.history.errors.lineageSignatureCollectionHash"));
    }
  }
  return { ok: errors.length === 0, errors };
}

async function verifyDeploySignatureCollectionHash(packet) {
  const collection = packet?.signature_collection;
  if (!collection) return { ok: true, errors: [], warnings: [], expected: "" };
  const errors = [];
  const warnings = [];
  const declared = String(collection.signature_collection_hash || "");
  if (!declared) {
    warnings.push(t("civilization.ruleLibrary.history.errors.signatureCollectionHashMissing"));
    return { ok: true, errors, warnings, expected: "" };
  }
  if (!declared.startsWith("sha256:")) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionHash"));
    return { ok: false, errors, warnings, expected: "" };
  }
  const expected = await deploySignatureCollectionHash(collection.rule_signature_pdas || []);
  if (declared !== expected) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionHashMismatch"));
  }
  return { ok: errors.length === 0, errors, warnings, expected };
}

async function verifyDeployLineageHashBinding(packet) {
  const lineage = packet?.lineage;
  if (!lineage) return { ok: true, errors: [], warnings: [], expected: "" };
  const errors = [];
  const warnings = [];
  const collection = packet?.signature_collection;
  if (!collection) return { ok: true, errors, warnings, expected: "" };
  const expected = await deploySignatureCollectionHash(collection.rule_signature_pdas || []);
  const lineageHash = String(lineage.preserved_signature_collection_hash || "");
  if (!lineageHash) {
    warnings.push(t("civilization.ruleLibrary.history.errors.lineageSignatureCollectionHashMissing"));
  } else if (!lineageHash.startsWith("sha256:")) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageSignatureCollectionHash"));
  } else if (lineageHash !== expected) {
    errors.push(t("civilization.ruleLibrary.history.errors.lineageSignatureCollectionHash"));
  }
  return { ok: errors.length === 0, errors, warnings, expected };
}

async function verifyDeployPacketContentHashClaim(packet) {
  const claimed = String(packet?.lineage?.current_deploy_packet_hash || "");
  if (!claimed) return { ok: true, errors: [] };
  if (!claimed.startsWith("sha256:")) {
    return { ok: false, errors: [t("civilization.ruleLibrary.history.errors.lineageCurrentHash")] };
  }
  try {
    const actual = await deployPacketContentHash(packet);
    if (actual !== claimed) {
      return { ok: false, errors: [t("civilization.ruleLibrary.history.errors.lineageCurrentHashMismatch")] };
    }
  } catch {
    return { ok: false, errors: [t("civilization.ruleLibrary.history.errors.lineageCurrentHashMismatch")] };
  }
  return { ok: true, errors: [] };
}

async function buildLocalDeployPacketAudit(packet, { includeReadiness = false } = {}) {
  const audit = {
    kind: "nicechunk.civilization.local_deploy_packet_audit.v1",
    audited_at: new Date().toISOString(),
    shape_check: verifyDeployPacketShape(packet),
    rule_book_hash_binding: await verifyDeployRuleBookHashBinding(packet.rule_book),
    threshold_result_check: verifyDeployThresholdResult(packet),
    content_hash_claim: await verifyDeployPacketContentHashClaim(packet),
    signature_collection_hash_check: await verifyDeploySignatureCollectionHash(packet),
    deploy_lineage_hash_check: await verifyDeployLineageHashBinding(packet),
    old_value_preflight_check: inspectDeployOldValuePreflight(packet),
  };
  if (includeReadiness) audit.deployment_readiness = buildDeploymentReadiness();
  return audit;
}

async function verifyDeployRuleBookHashBinding(proposal) {
  const fields = [];
  const expected = {};
  try {
    if (!proposal || proposal.kind !== "nicechunk.civilization.rule_book.v1") {
      return { ok: false, fields: ["rule_book"], expected };
    }
    const patch = proposal.patch || {};
    const targetRefs = proposal.target_refs || {};
    const targetId = patch.target_id || targetRefs.target_id || "";
    const target = ruleTargets.find((item) => item.id === targetId);
    const targetPatch = await buildTargetPatchBinding({ proposed_value: patch.proposed_value }, target);
    expected.text_hash = `sha256:${await sha256Hex(stableJsonStringify(proposal.readable || {}))}`;
    expected.patch_hash = targetPatch.patchHash ?? `sha256:${await sha256Hex(stableJsonStringify(patch))}`;
    expected.snapshot_hash = `sha256:${await sha256Hex(stableJsonStringify(proposal.civilization_power_snapshot || {}))}`;
    expected.target_ref_hash = `sha256:${await sha256Hex(stableJsonStringify(targetRefs))}`;
    expected.rule_id_hash = `sha256:${await sha256Hex(`${expected.text_hash}:${expected.patch_hash}:${expected.snapshot_hash}:${expected.target_ref_hash}`)}`;
    expected.rule_id = `civ_rule_${expected.rule_id_hash.slice(7, 27)}`;
    for (const key of ["text_hash", "patch_hash", "snapshot_hash", "target_ref_hash", "rule_id_hash", "rule_id"]) {
      if (proposal[key] !== expected[key]) fields.push(key);
    }
  } catch {
    fields.push("rule_book_hash_binding");
  }
  return { ok: fields.length === 0, fields, expected };
}

function verifyDeployThresholdResult(packet) {
  const fields = [];
  try {
    const expected = buildThresholdResult(packet.rule_book, packet.signature);
    const actual = packet.threshold_result || {};
    for (const key of [
      "threshold_path",
      "threshold_bps",
      "total_active_power",
      "required_yes_power",
      "threshold_blocked",
      "blocked_reason",
      "projected_yes_power_after_this_signature",
      "projected_no_power_after_this_signature",
      "projected_passes_after_this_signature",
    ]) {
      if (!deployComparableEqual(actual[key], expected[key])) fields.push(key);
    }
  } catch {
    fields.push("threshold_result");
  }
  return { ok: fields.length === 0, fields };
}

function verifyDeployExecutionHint(packet) {
  const fields = [];
  const hint = packet?.execution_hint || {};
  const expected = packet?.derived_pdas || {};
  const actual = hint.pda_addresses || {};
  for (const key of [
    "rule_book_pda",
    "rule_signature_pda",
    "rule_tally_pda",
    "execution_receipt_pda",
    "adapter_authority_pda",
    "target_program",
    "target_pda",
  ]) {
    if (expected[key] && actual[key] !== expected[key]) fields.push(`pda_addresses.${key}`);
  }
  const ruleBook = packet?.rule_book || {};
  const targetStatus = ruleBook.target_refs?.target_status || ruleBook.readable?.target_status || "";
  const expectedAdapter = targetStatus === "governable"
    ? targetAdapterBuilderName(ruleBook.patch?.target_id)
    : "target_adapter_required";
  const expectedHints = {
    civilization_program_id: civilizationProgramId,
    sdk_module: "sdk/nicechunk-civilization.ts",
    publish_instruction: "createPublishCivilizationRuleInstruction",
    sign_instruction: "createSignCivilizationRuleInstruction",
    finalize_instruction: "createFinalizeCivilizationRuleInstruction",
    execute_receipt_instruction: "createExecuteCivilizationRuleReceiptInstruction",
    target_adapter_instruction: expectedAdapter,
  };
  for (const [key, value] of Object.entries(expectedHints)) {
    if (hint[key] !== value) fields.push(key);
  }
  const expectedSeeds = {
    rule_book_pda: ["rule-book", "rule_id_hash"],
    rule_signature_pda: ["rule-signature", "rule_book_pda", "signer"],
    power_snapshot_pda: ["power-snapshot", "snapshot_hash"],
    citizen_power_pda: ["citizen-power", "power_snapshot_pda", "signer"],
    rule_tally_pda: ["rule-tally", "rule_book_pda"],
    execution_receipt_pda: ["rule-execution", "rule_book_pda"],
    adapter_authority_pda: ["civilization-adapter", "rule_book_pda", "target_program"],
  };
  for (const [key, value] of Object.entries(expectedSeeds)) {
    if (!Array.isArray(hint.pda_seeds?.[key]) || stableJsonStringify(hint.pda_seeds[key]) !== stableJsonStringify(value)) {
      fields.push(`pda_seeds.${key}`);
    }
  }
  return { ok: fields.length === 0, fields };
}

function deployComparableEqual(actual, expected) {
  if (typeof expected === "number" && !Number.isFinite(expected)) {
    return actual === null || actual === String(expected) || !Number.isFinite(Number(actual));
  }
  return actual === expected;
}

function verifyDeploySignatureCollection(packet) {
  const collection = packet?.signature_collection;
  if (!collection) return { ok: true, errors: [], ruleSignaturePdas: [], additionalCount: 0 };
  const errors = [];
  if (collection.kind !== "nicechunk.civilization.signature_collection.v1") {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionKind"));
  }
  const ruleSignaturePdas = Array.isArray(collection.rule_signature_pdas) ? collection.rule_signature_pdas : [];
  if (!ruleSignaturePdas.length) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionEmpty"));
  }
  const validPdas = [];
  const unique = new Set();
  for (const value of ruleSignaturePdas) {
    const pda = parsePublicKeyString(value);
    if (!pda) {
      errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionPda", { value: String(value || "") }));
      continue;
    }
    const base58 = pda.toBase58();
    validPdas.push(base58);
    unique.add(base58);
  }
  if (validPdas.length !== unique.size) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionDuplicate"));
  }
  const packetCurrentPda = packet?.signature?.rule_signature_pda || "";
  const declaredCurrentPda = collection.current_signer_signature_pda || "";
  const currentPda = packetCurrentPda || declaredCurrentPda;
  if (declaredCurrentPda && !parsePublicKeyString(declaredCurrentPda)) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionCurrent"));
  }
  if (packetCurrentPda && declaredCurrentPda && packetCurrentPda !== declaredCurrentPda) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionCurrentMismatch"));
  }
  if (currentPda && validPdas.length && !unique.has(currentPda)) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionMissingCurrent"));
  }
  const additional = Array.isArray(collection.additional_signature_pdas) ? collection.additional_signature_pdas : [];
  const additionalValid = [];
  const additionalUnique = new Set();
  for (const value of additional) {
    const pda = parsePublicKeyString(value);
    if (!pda) {
      errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionPda", { value: String(value || "") }));
      continue;
    }
    const base58 = pda.toBase58();
    additionalValid.push(base58);
    additionalUnique.add(base58);
  }
  if (additionalValid.length !== additionalUnique.size) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionDuplicate"));
  }
  if (Number(collection.signature_count) !== unique.size) {
    errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionCount"));
  }
  if (currentPda && unique.size) {
    const expectedAdditional = Array.from(unique).filter((pda) => pda !== currentPda).sort();
    const declaredAdditional = Array.from(additionalUnique).sort();
    if (expectedAdditional.length !== declaredAdditional.length || expectedAdditional.some((pda, index) => pda !== declaredAdditional[index])) {
      errors.push(t("civilization.ruleLibrary.history.errors.signatureCollectionAdditional"));
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    ruleSignaturePdas: Array.from(unique),
    additionalCount: currentPda ? Array.from(unique).filter((pda) => pda !== currentPda).length : Math.max(0, unique.size - 1),
  };
}

function parsePublicKeyString(value) {
  try {
    return new PublicKey(String(value || ""));
  } catch {
    return null;
  }
}

function safeDeriveDeploymentPdas(input) {
  try {
    return deriveDeploymentPdas(input);
  } catch {
    return null;
  }
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isJsonText(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  return sha256HexBytes(bytes);
}

async function sha256HexBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function dataView(data) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readU64String(view, offset) {
  if (offset + 8 > view.byteLength) return "0";
  return view.getBigUint64(offset, true).toString();
}

function readI64String(view, offset) {
  if (offset + 8 > view.byteLength) return "0";
  return view.getBigInt64(offset, true).toString();
}

function pubkeyAt(data, offset) {
  if (offset + 32 > data.length) return "";
  return new PublicKey(data.slice(offset, offset + 32)).toBase58();
}

function ascii(data) {
  return new TextDecoder().decode(data).replace(/\0+$/g, "");
}

function toHex(data) {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stripSha256(value) {
  return String(value || "").replace(/^sha256:/i, "");
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function publicKeyToString(publicKey) {
  if (!publicKey) return "";
  if (typeof publicKey === "string") return publicKey;
  if (typeof publicKey.toString === "function") return publicKey.toString();
  return "";
}

function providerName(provider) {
  if (provider?.isPhantom) return "Phantom";
  if (provider?.isSolflare) return "Solflare";
  if (provider?.isBackpack) return "Backpack";
  return "Solana";
}

function shortAddress(address) {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function shortHash(hash) {
  if (!hash || hash.length < 22) return hash || "";
  const value = hash.startsWith("sha256:") ? hash.slice(7) : hash;
  return `sha256:${value.slice(0, 10)}...${value.slice(-8)}`;
}

function setFlowStatus(type, message) {
  if (!flowStatusTarget) return;
  flowStatusTarget.dataset.type = type;
  flowStatusTarget.textContent = message;
}

function setChainStatus(type, message) {
  if (!chainStatusTarget) return;
  chainStatusTarget.dataset.type = type;
  chainStatusTarget.textContent = message;
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
