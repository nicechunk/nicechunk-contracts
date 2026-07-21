import "./style.css";
import "../src/site-header.css";
import { Buffer } from "buffer";
import { Connection, PublicKey } from "@solana/web3.js";
import { finishSiteLoading, setSiteLoadingProgress } from "../src/site-ui.js";
import { createNicechunkRpcFetch, getNicechunkRpcUrl } from "../src/rpcConfig.js";
import coreCargo from "../programs/nicechunk_core/Cargo.toml?raw";
import coreClusterConfig from "../programs/nicechunk_core/src/cluster_config.rs?raw";
import coreErrors from "../programs/nicechunk_core/src/errors.rs?raw";
import coreLib from "../programs/nicechunk_core/src/lib.rs?raw";
import coreState from "../programs/nicechunk_core/src/state.rs?raw";
import coreSdk from "../sdk/nicechunk-core.ts?raw";
import playerCargo from "../programs/nicechunk_player/Cargo.toml?raw";
import playerClusterConfig from "../programs/nicechunk_player/src/cluster_config.rs?raw";
import playerErrors from "../programs/nicechunk_player/src/errors.rs?raw";
import playerLib from "../programs/nicechunk_player/src/lib.rs?raw";
import playerState from "../programs/nicechunk_player/src/state.rs?raw";
import playerSdk from "../sdk/nicechunk-player.ts?raw";
import chunkCargo from "../programs/nicechunk_chunk/Cargo.toml?raw";
import chunkClusterConfig from "../programs/nicechunk_chunk/src/cluster_config.rs?raw";
import chunkErrors from "../programs/nicechunk_chunk/src/errors.rs?raw";
import chunkLib from "../programs/nicechunk_chunk/src/lib.rs?raw";
import chunkState from "../programs/nicechunk_chunk/src/state.rs?raw";
import chunkSdk from "../sdk/nicechunk-chunk.ts?raw";
import guardianCargo from "../programs/nicechunk_guardian/Cargo.toml?raw";
import guardianClusterConfig from "../programs/nicechunk_guardian/src/cluster_config.rs?raw";
import guardianErrors from "../programs/nicechunk_guardian/src/errors.rs?raw";
import guardianLib from "../programs/nicechunk_guardian/src/lib.rs?raw";
import guardianState from "../programs/nicechunk_guardian/src/state.rs?raw";
import guardianSdk from "../sdk/nicechunk-guardian.ts?raw";
import backpackCargo from "../programs/nicechunk_backpack/Cargo.toml?raw";
import backpackClusterConfig from "../programs/nicechunk_backpack/src/cluster_config.rs?raw";
import backpackErrors from "../programs/nicechunk_backpack/src/errors.rs?raw";
import backpackLib from "../programs/nicechunk_backpack/src/lib.rs?raw";
import backpackState from "../programs/nicechunk_backpack/src/state.rs?raw";
import backpackSdk from "../sdk/nicechunk-backpack.ts?raw";
import smeltingCargo from "../programs/nicechunk_smelting/Cargo.toml?raw";
import smeltingClusterConfig from "../programs/nicechunk_smelting/src/cluster_config.rs?raw";
import smeltingErrors from "../programs/nicechunk_smelting/src/errors.rs?raw";
import smeltingLib from "../programs/nicechunk_smelting/src/lib.rs?raw";
import smeltingState from "../programs/nicechunk_smelting/src/state.rs?raw";
import smeltingSdk from "../sdk/nicechunk-smelting.ts?raw";
import marketCargo from "../programs/nicechunk_market/Cargo.toml?raw";
import marketClusterConfig from "../programs/nicechunk_market/src/cluster_config.rs?raw";
import marketErrors from "../programs/nicechunk_market/src/errors.rs?raw";
import marketLib from "../programs/nicechunk_market/src/lib.rs?raw";
import marketState from "../programs/nicechunk_market/src/state.rs?raw";
import civilizationCargo from "../programs/nicechunk_civilization/Cargo.toml?raw";
import civilizationClusterConfig from "../programs/nicechunk_civilization/src/cluster_config.rs?raw";
import civilizationErrors from "../programs/nicechunk_civilization/src/errors.rs?raw";
import civilizationLib from "../programs/nicechunk_civilization/src/lib.rs?raw";
import civilizationState from "../programs/nicechunk_civilization/src/state.rs?raw";
import civilizationSdk from "../sdk/nicechunk-civilization.ts?raw";
import buildingCargo from "../programs/nicechunk_building/Cargo.toml?raw";
import buildingBuilding from "../programs/nicechunk_building/src/building.rs?raw";
import buildingClusterConfig from "../programs/nicechunk_building/src/cluster_config.rs?raw";
import buildingErrors from "../programs/nicechunk_building/src/errors.rs?raw";
import buildingLib from "../programs/nicechunk_building/src/lib.rs?raw";
import buildingState from "../programs/nicechunk_building/src/state.rs?raw";
import buildingSdk from "../sdk/nicechunk-building.ts?raw";

if (!globalThis.Buffer) globalThis.Buffer = Buffer;

const languageStorageKey = "nicechunk.language";
const buildVersion = typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : String(Date.now());
const solanaDevnetRpcUrl = "https://api.devnet.solana.com";
const plannedLanguages = [
  { code: "en", englishName: "English", nativeName: "English", enabled: true },
  { code: "es", englishName: "Spanish", nativeName: "Español", enabled: true },
  { code: "fr", englishName: "French", nativeName: "Français", enabled: true },
  { code: "de", englishName: "German", nativeName: "Deutsch", enabled: true },
  { code: "ja", englishName: "Japanese", nativeName: "Japanese", enabled: true },
  { code: "ru", englishName: "Russian", nativeName: "Русский", enabled: true },
  { code: "ko", englishName: "Korean", nativeName: "한국어", enabled: true },
  { code: "zh-Hant", englishName: "Traditional Chinese", nativeName: "Traditional Chinese", enabled: true },
  { code: "zh-Hans", englishName: "Simplified Chinese", nativeName: "Simplified Chinese", enabled: true },
];
const languageCodes = new Set(plannedLanguages.map((language) => language.code));
const dictionaryCache = new Map();
const sourceTrees = {
  core: [
    file("programs/nicechunk_core/Cargo.toml", "toml", coreCargo),
    file("programs/nicechunk_core/src/cluster_config.rs", "rust", coreClusterConfig),
    file("programs/nicechunk_core/src/errors.rs", "rust", coreErrors),
    file("programs/nicechunk_core/src/lib.rs", "rust", coreLib),
    file("programs/nicechunk_core/src/state.rs", "rust", coreState),
    file("sdk/nicechunk-core.ts", "typescript", coreSdk),
  ],
  player: [
    file("programs/nicechunk_player/Cargo.toml", "toml", playerCargo),
    file("programs/nicechunk_player/src/cluster_config.rs", "rust", playerClusterConfig),
    file("programs/nicechunk_player/src/errors.rs", "rust", playerErrors),
    file("programs/nicechunk_player/src/lib.rs", "rust", playerLib),
    file("programs/nicechunk_player/src/state.rs", "rust", playerState),
    file("sdk/nicechunk-player.ts", "typescript", playerSdk),
  ],
  chunk: [
    file("programs/nicechunk_chunk/Cargo.toml", "toml", chunkCargo),
    file("programs/nicechunk_chunk/src/cluster_config.rs", "rust", chunkClusterConfig),
    file("programs/nicechunk_chunk/src/errors.rs", "rust", chunkErrors),
    file("programs/nicechunk_chunk/src/lib.rs", "rust", chunkLib),
    file("programs/nicechunk_chunk/src/state.rs", "rust", chunkState),
    file("sdk/nicechunk-chunk.ts", "typescript", chunkSdk),
  ],
  guardian: [
    file("programs/nicechunk_guardian/Cargo.toml", "toml", guardianCargo),
    file("programs/nicechunk_guardian/src/cluster_config.rs", "rust", guardianClusterConfig),
    file("programs/nicechunk_guardian/src/errors.rs", "rust", guardianErrors),
    file("programs/nicechunk_guardian/src/lib.rs", "rust", guardianLib),
    file("programs/nicechunk_guardian/src/state.rs", "rust", guardianState),
    file("sdk/nicechunk-guardian.ts", "typescript", guardianSdk),
  ],
  backpack: [
    file("programs/nicechunk_backpack/Cargo.toml", "toml", backpackCargo),
    file("programs/nicechunk_backpack/src/cluster_config.rs", "rust", backpackClusterConfig),
    file("programs/nicechunk_backpack/src/errors.rs", "rust", backpackErrors),
    file("programs/nicechunk_backpack/src/lib.rs", "rust", backpackLib),
    file("programs/nicechunk_backpack/src/state.rs", "rust", backpackState),
    file("sdk/nicechunk-backpack.ts", "typescript", backpackSdk),
  ],
  smelting: [
    file("programs/nicechunk_smelting/Cargo.toml", "toml", smeltingCargo),
    file("programs/nicechunk_smelting/src/cluster_config.rs", "rust", smeltingClusterConfig),
    file("programs/nicechunk_smelting/src/errors.rs", "rust", smeltingErrors),
    file("programs/nicechunk_smelting/src/lib.rs", "rust", smeltingLib),
    file("programs/nicechunk_smelting/src/state.rs", "rust", smeltingState),
    file("sdk/nicechunk-smelting.ts", "typescript", smeltingSdk),
  ],
  market: [
    file("programs/nicechunk_market/Cargo.toml", "toml", marketCargo),
    file("programs/nicechunk_market/src/cluster_config.rs", "rust", marketClusterConfig),
    file("programs/nicechunk_market/src/errors.rs", "rust", marketErrors),
    file("programs/nicechunk_market/src/lib.rs", "rust", marketLib),
    file("programs/nicechunk_market/src/state.rs", "rust", marketState),
  ],
  civilization: [
    file("programs/nicechunk_civilization/Cargo.toml", "toml", civilizationCargo),
    file("programs/nicechunk_civilization/src/cluster_config.rs", "rust", civilizationClusterConfig),
    file("programs/nicechunk_civilization/src/errors.rs", "rust", civilizationErrors),
    file("programs/nicechunk_civilization/src/lib.rs", "rust", civilizationLib),
    file("programs/nicechunk_civilization/src/state.rs", "rust", civilizationState),
    file("sdk/nicechunk-civilization.ts", "typescript", civilizationSdk),
  ],
  building: [
    file("programs/nicechunk_building/Cargo.toml", "toml", buildingCargo),
    file("programs/nicechunk_building/src/building.rs", "rust", buildingBuilding),
    file("programs/nicechunk_building/src/cluster_config.rs", "rust", buildingClusterConfig),
    file("programs/nicechunk_building/src/errors.rs", "rust", buildingErrors),
    file("programs/nicechunk_building/src/lib.rs", "rust", buildingLib),
    file("programs/nicechunk_building/src/state.rs", "rust", buildingState),
    file("sdk/nicechunk-building.ts", "typescript", buildingSdk),
  ],
};

const pdaAccountTypes = [
  { id: "all", programKey: null, sizes: [], decoder: null },
  { id: "global-config", programKey: "core", sizes: [293], decoder: decodeGlobalConfigAccount },
  { id: "player-profile", programKey: "player", sizes: [773], decoder: decodePlayerProfileAccount },
  { id: "player-session", programKey: "player", sizes: [184], decoder: decodePlayerSessionAccount },
  { id: "chunk-broken", programKey: "chunk", sizes: [{ min: 16 }], decoder: decodeChunkBrokenAccount },
  { id: "resource-drop-table", programKey: "chunk", sizes: [{ min: 16 }], decoder: decodeResourceDropTableAccount },
  { id: "guardian-registry", programKey: "guardian", sizes: [160], decoder: decodeGuardianRegistryAccount },
  { id: "guardian-region", programKey: "guardian", sizes: [256, 288], decoder: decodeGuardianRegionAccount },
  { id: "backpack", programKey: "backpack", sizes: [8048], decoder: decodeBackpackAccount },
  { id: "recipe-table", programKey: "smelting", sizes: [9936], decoder: decodeRecipeTableAccount },
  { id: "market-listing", programKey: "market", sizes: [216], decoder: decodeMarketListingAccount },
  { id: "civilization-rule-book", programKey: "civilization", sizes: [320], decoder: decodeCivilizationRuleBookAccount },
  { id: "civilization-rule-signature", programKey: "civilization", sizes: [136], decoder: decodeCivilizationRuleSignatureAccount },
  { id: "civilization-rule-tally", programKey: "civilization", sizes: [128], decoder: decodeCivilizationRuleTallyOrPowerSnapshotOrReceiptAccount },
  { id: "civilization-execution-receipt", programKey: "civilization", sizes: [128], decoder: decodeCivilizationExecutionReceiptOrTallyOrSnapshotAccount },
  { id: "civilization-power-snapshot", programKey: "civilization", sizes: [128], decoder: decodeCivilizationPowerSnapshotOrTallyOrReceiptAccount },
  { id: "civilization-citizen-power", programKey: "civilization", sizes: [144], decoder: decodeCivilizationCitizenPowerAccount },
  { id: "build-site", programKey: "building", sizes: [136, 160], decoder: decodeBuildSiteAccount },
  { id: "building-manifest", programKey: "building", sizes: [160], decoder: decodeBuildingManifestAccount },
  { id: "building-shard", programKey: "building", sizes: [{ min: 64, max: 8256 }], decoder: decodeBuildingShardAccount },
  { id: "forged-items", programKey: null, sizes: [], decoder: null, virtual: true },
];

const programAccountTypeMap = new Map();
for (const type of pdaAccountTypes) {
  if (!type.programKey) continue;
  if (!programAccountTypeMap.has(type.programKey)) programAccountTypeMap.set(type.programKey, []);
  programAccountTypeMap.get(type.programKey).push(type.id);
}

const contractsNav = document.querySelector("#contractsNav");
const runtimeGrid = document.querySelector("#runtimeGrid");
const logicLegend = document.querySelector("#logicLegend");
const logicAtlas = document.querySelector("#logicAtlas");
const seedEvidenceLegend = document.querySelector("#seedEvidenceLegend");
const seedEvidenceAtlas = document.querySelector("#seedEvidenceAtlas");
const instructionSurfaceLegend = document.querySelector("#instructionSurfaceLegend");
const instructionSurfaceAtlas = document.querySelector("#instructionSurfaceAtlas");
const cpiAuthorityLegend = document.querySelector("#cpiAuthorityLegend");
const cpiAuthorityAtlas = document.querySelector("#cpiAuthorityAtlas");
const accountLifecycleLegend = document.querySelector("#accountLifecycleLegend");
const accountLifecycleAtlas = document.querySelector("#accountLifecycleAtlas");
const auditMatrix = document.querySelector("#auditMatrix");
const programDirectory = document.querySelector("#programDirectory");
const flowGrid = document.querySelector("#flowGrid");
const transparencyGrid = document.querySelector("#transparencyGrid");
const transparencyMap = document.querySelector("#transparencyMap");
const programDetails = document.querySelector("#programDetails");
const programIdsCode = document.querySelector("#programIdsCode");
const pdaCode = document.querySelector("#pdaCode");
const chainBrowserType = document.querySelector("#chainBrowserType");
const chainBrowserSearch = document.querySelector("#chainBrowserSearch");
const chainBrowserRefresh = document.querySelector("#chainBrowserRefresh");
const chainBrowserQuickLinks = document.querySelector("#chainBrowserQuickLinks");
const chainBrowserInfo = document.querySelector("#chainBrowserInfo");
const chainBrowserStatus = document.querySelector("#chainBrowserStatus");
const chainBrowserStats = document.querySelector("#chainBrowserStats");
const chainBrowserResults = document.querySelector("#chainBrowserResults");
const languagePicker = document.querySelector(".contracts-language");
const languageTrigger = document.querySelector(".contracts-language-trigger");
const languageCurrent = document.querySelector(".contracts-language-current");
const languageMenu = document.querySelector(".contracts-language-menu");
const sections = [...document.querySelectorAll("[data-contract-section]")];

let activeLanguage = normalizeLanguage(localStorage.getItem(languageStorageKey)) || "en";
let dictionary = {};
let fallbackDictionary = {};
const contractsConnections = new Map();
let chainBrowserRecords = [];
let runtimeConfig = null;
let logicResizeFrame = 0;

void initContractsPage();

window.addEventListener("resize", () => {
  window.cancelAnimationFrame(logicResizeFrame);
  logicResizeFrame = window.requestAnimationFrame(updateLogicLinks);
});

async function initContractsPage() {
  setSiteLoadingProgress(36);
  fallbackDictionary = await loadDictionary("en");
  dictionary = activeLanguage === "en" ? fallbackDictionary : await loadDictionary(activeLanguage);
  runtimeConfig = await loadRuntimeConfig();
  applyTranslations(document);
  renderNavigation();
  renderRuntimeState();
  renderLogicAtlas();
  renderSeedEvidence();
  renderInstructionSurface();
  renderCpiAuthority();
  renderAccountLifecycle();
  renderAuditMatrix();
  renderDirectory();
  renderFlow();
  renderTransparencyLedger();
  renderProgramDetails();
  renderCodeBlocks();
  renderChainBrowserControls();
  renderChainBrowserQuickLinks();
  renderChainBrowserInfo(chainBrowserType?.value || "all");
  setupChainBrowser();
  setupLanguageSwitcher();
  setupScrollLinks();
  setupSectionObserver();
  setSiteLoadingProgress(88);
  finishSiteLoading();
}

function applyTranslations(root) {
  const title = text("meta.title");
  if (title) document.title = title;
  root.querySelectorAll("[data-contracts-i18n]").forEach((element) => {
    const value = text(element.dataset.contractsI18n);
    if (value) element.textContent = value;
  });
  root.querySelectorAll("[data-contracts-i18n-aria-label]").forEach((element) => {
    const value = text(element.dataset.contractsI18nAriaLabel);
    if (value) element.setAttribute("aria-label", value);
  });
  root.querySelectorAll("[data-contracts-i18n-placeholder]").forEach((element) => {
    const value = text(element.dataset.contractsI18nPlaceholder);
    if (value) element.setAttribute("placeholder", value);
  });
  document.documentElement.lang = activeLanguage;
}

function text(path) {
  const value = path.split(".").reduce((current, part) => (current && Object.hasOwn(current, part) ? current[part] : undefined), dictionary);
  if (value !== undefined) return value;
  return path.split(".").reduce((current, part) => (current && Object.hasOwn(current, part) ? current[part] : undefined), fallbackDictionary) ?? "";
}

function file(path, language, code) {
  return { path, language, code };
}

function renderNavigation() {
  if (!contractsNav) return;
  contractsNav.replaceChildren(
    ...dictionary.navigation.map((item) => {
      const link = document.createElement("a");
      link.href = `#${item.id}`;
      link.dataset.contractsScroll = item.id;
      link.textContent = item.label;
      return link;
    }),
  );
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(`/mainnet.json?v=${encodeURIComponent(buildVersion)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function renderRuntimeState() {
  if (!runtimeGrid) return;
  const runtime = runtimeConfig;
  const configuredPrograms = runtime?.chain?.programs ?? {};
  const cluster = runtime?.chain?.cluster ?? dictionary.runtime.unavailable;
  const appVersion = runtime?.app?.version ?? dictionary.runtime.unavailable;
  const configEntries = Object.entries(configuredPrograms);
  const configuredValues = new Set(configEntries.map(([, id]) => id));
  const civilizationProgram = dictionary.programs.find((program) => program.codeKey === "civilization");
  const civilizationConfigured = civilizationProgram?.programId && configuredValues.has(civilizationProgram.programId);
  const aliasGroups = groupProgramIds(configEntries);
  const cards = [
    {
      label: dictionary.runtime.cards.config.label,
      title: dictionary.runtime.cards.config.title,
      body: formatText(dictionary.runtime.cards.config.body, { cluster, version: appVersion }),
      facts: [
        [dictionary.runtime.clusterLabel, cluster],
        [dictionary.runtime.versionLabel, appVersion],
        [dictionary.runtime.sourceLabel, "/mainnet.json"],
      ],
      state: "live",
    },
    {
      label: dictionary.runtime.cards.programs.label,
      title: dictionary.runtime.cards.programs.title,
      body: dictionary.runtime.cards.programs.body,
      facts: configEntries.map(([key, id]) => [key, id]),
      state: "live",
    },
    {
      label: dictionary.runtime.cards.alias.label,
      title: dictionary.runtime.cards.alias.title,
      body: dictionary.runtime.cards.alias.body,
      facts: aliasGroups.map((group) => [group.id, group.keys.join(" / ")]),
      state: "warn",
    },
    {
      label: dictionary.runtime.cards.civilization.label,
      title: dictionary.runtime.cards.civilization.title,
      body: civilizationConfigured ? dictionary.runtime.cards.civilization.bodyConfigured : dictionary.runtime.cards.civilization.bodyGated,
      facts: [
        [dictionary.runtime.programIdLabel, civilizationProgram?.programId ?? dictionary.runtime.unavailable],
        [dictionary.runtime.runtimeLabel, civilizationConfigured ? dictionary.runtime.configured : dictionary.runtime.notConfigured],
        [dictionary.runtime.powerAuthorityLabel, "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud"],
      ],
      state: civilizationConfigured ? "live" : "gated",
    },
  ];
  runtimeGrid.replaceChildren(...cards.map(createRuntimeCard));
}

function groupProgramIds(entries) {
  const groups = new Map();
  for (const [key, id] of entries) {
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(key);
  }
  return [...groups.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([id, keys]) => ({ id, keys }));
}

function createRuntimeCard(card) {
  const article = document.createElement("article");
  article.className = `runtime-card ${card.state || "live"}`;
  article.innerHTML = `
    <span></span>
    <strong></strong>
    <p></p>
    <dl></dl>
  `;
  article.querySelector("span").textContent = card.label;
  article.querySelector("strong").textContent = card.title;
  article.querySelector("p").textContent = card.body;
  article.querySelector("dl").replaceChildren(
    ...card.facts.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value || "-";
      return [dt, dd];
    }),
  );
  return article;
}

function renderLogicAtlas() {
  const logic = dictionary.logic ?? fallbackDictionary.logic;
  if (!logicAtlas || !logic) return;
  renderLogicLegend(logicLegend, logic.legend ?? []);
  logicAtlas.replaceChildren(...(logic.diagrams ?? []).map(createLogicDiagram));
  window.requestAnimationFrame(updateLogicLinks);
}

function renderSeedEvidence() {
  const evidence = dictionary.seedEvidence ?? fallbackDictionary.seedEvidence;
  if (!seedEvidenceAtlas || !evidence) return;
  renderLogicLegend(seedEvidenceLegend, evidence.legend ?? []);
  seedEvidenceAtlas.replaceChildren(...(evidence.diagrams ?? []).map(createLogicDiagram));
  window.requestAnimationFrame(updateLogicLinks);
}

function renderInstructionSurface() {
  const surface = dictionary.instructionSurface ?? fallbackDictionary.instructionSurface;
  if (!instructionSurfaceAtlas || !surface) return;
  renderLogicLegend(instructionSurfaceLegend, surface.legend ?? []);
  instructionSurfaceAtlas.replaceChildren(...(surface.diagrams ?? []).map(createLogicDiagram));
  window.requestAnimationFrame(updateLogicLinks);
}

function renderCpiAuthority() {
  const ledger = dictionary.cpiAuthority ?? fallbackDictionary.cpiAuthority;
  if (!cpiAuthorityAtlas || !ledger) return;
  renderLogicLegend(cpiAuthorityLegend, ledger.legend ?? []);
  cpiAuthorityAtlas.replaceChildren(...(ledger.diagrams ?? []).map(createLogicDiagram));
  window.requestAnimationFrame(updateLogicLinks);
}

function renderAccountLifecycle() {
  const lifecycle = dictionary.accountLifecycle ?? fallbackDictionary.accountLifecycle;
  if (!accountLifecycleAtlas || !lifecycle) return;
  renderLogicLegend(accountLifecycleLegend, lifecycle.legend ?? []);
  accountLifecycleAtlas.replaceChildren(...(lifecycle.diagrams ?? []).map(createLogicDiagram));
  window.requestAnimationFrame(updateLogicLinks);
}

function renderLogicLegend(target, legend) {
  if (!target) return;
  target.replaceChildren(
    ...legend.map((item) => {
      const badge = document.createElement("span");
      badge.className = `logic-legend-item ${item.kind || "pda"}`;
      badge.innerHTML = "<i></i><strong></strong>";
      badge.querySelector("strong").textContent = item.label;
      return badge;
    }),
  );
}

function createLogicDiagram(diagram) {
  const article = document.createElement("article");
  article.className = `logic-diagram ${diagram.emphasis || ""}`.trim();
  article.dataset.diagramId = diagram.id;
  article.innerHTML = `
    <div class="logic-diagram-head">
      <div>
        <span></span>
        <h3></h3>
        <p></p>
      </div>
    </div>
    <div class="logic-canvas" data-logic-canvas>
      <svg class="logic-links" aria-hidden="true"></svg>
      <div class="logic-lanes"></div>
    </div>
    <div class="logic-evidence"></div>
  `;
  article.querySelector(".logic-diagram-head span").textContent = diagram.kicker || "";
  article.querySelector("h3").textContent = diagram.title;
  article.querySelector(".logic-diagram-head p").textContent = diagram.body;
  article.querySelector(".logic-lanes").replaceChildren(...(diagram.lanes ?? []).map(createLogicLane));
  article.querySelector(".logic-evidence").replaceChildren(
    ...(diagram.evidence ?? []).map((item) => {
      const chip = document.createElement("span");
      chip.textContent = item;
      return chip;
    }),
  );
  article.logicLinks = diagram.links ?? [];
  return article;
}

function createLogicLane(lane) {
  const column = document.createElement("div");
  column.className = `logic-lane ${lane.kind || "pda"}`;
  column.innerHTML = `
    <div class="logic-lane-title"></div>
    <div class="logic-node-stack"></div>
  `;
  column.querySelector(".logic-lane-title").textContent = lane.label;
  column.querySelector(".logic-node-stack").replaceChildren(...(lane.nodes ?? []).map(createLogicNode));
  return column;
}

function createLogicNode(node) {
  const item = document.createElement("article");
  item.className = `logic-node ${node.kind || "pda"}`;
  item.dataset.nodeId = node.id;
  item.innerHTML = `
    <div class="logic-node-top">
      <strong></strong>
      <span></span>
    </div>
    <p></p>
    <em></em>
  `;
  item.querySelector("strong").textContent = node.label;
  item.querySelector("span").textContent = node.badge || "";
  item.querySelector("p").textContent = node.detail;
  item.querySelector("em").textContent = node.evidence || "";
  return item;
}

function updateLogicLinks() {
  document.querySelectorAll(".logic-diagram").forEach(drawLogicDiagramLinks);
}

function drawLogicDiagramLinks(diagram) {
  const canvas = diagram.querySelector("[data-logic-canvas]");
  const svg = diagram.querySelector(".logic-links");
  if (!canvas || !svg) return;
  const links = diagram.logicLinks ?? [];
  const canvasRect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(canvasRect.width));
  const height = Math.max(1, Math.round(canvasRect.height));
  const markerId = `logic-arrow-${diagram.dataset.diagramId || "default"}`;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren(createArrowMarker(markerId));
  for (const link of links) {
    const from = canvas.querySelector(`[data-node-id="${CSS.escape(link.from)}"]`);
    const to = canvas.querySelector(`[data-node-id="${CSS.escape(link.to)}"]`);
    if (!from || !to) continue;
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const start = {
      x: fromRect.left + fromRect.width / 2 - canvasRect.left,
      y: fromRect.top + fromRect.height / 2 - canvasRect.top,
    };
    const end = {
      x: toRect.left + toRect.width / 2 - canvasRect.left,
      y: toRect.top + toRect.height / 2 - canvasRect.top,
    };
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `logic-link-path ${link.kind || "write"}`);
    path.setAttribute("d", curvedPath(start, end));
    path.setAttribute("marker-end", `url(#${markerId})`);
    svg.append(path);
    if (link.label) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "logic-link-label");
      label.setAttribute("x", String((start.x + end.x) / 2));
      label.setAttribute("y", String((start.y + end.y) / 2 - 8));
      label.textContent = link.label;
      svg.append(label);
    }
  }
}

function createArrowMarker(markerId) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", markerId);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  marker.append(path);
  defs.append(marker);
  return defs;
}

function curvedPath(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const tension = Math.max(42, Math.min(180, Math.abs(dx) * 0.42));
  const c1 = { x: start.x + Math.sign(dx || 1) * tension, y: start.y + dy * 0.08 };
  const c2 = { x: end.x - Math.sign(dx || 1) * tension, y: end.y - dy * 0.08 };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function renderAuditMatrix() {
  const matrix = dictionary.auditMatrix ?? fallbackDictionary.auditMatrix;
  if (!auditMatrix || !matrix) return;
  auditMatrix.replaceChildren(...(matrix.rows ?? []).map((row) => createAuditMatrixCard(row, matrix.columns ?? {})));
}

function createAuditMatrixCard(row, columns) {
  const card = document.createElement("article");
  card.className = `audit-matrix-card ${row.state || "live"}`;
  card.innerHTML = `
    <div class="audit-matrix-head">
      <span></span>
      <strong></strong>
    </div>
    <p></p>
    <dl></dl>
  `;
  card.querySelector(".audit-matrix-head span").textContent = row.status || "";
  card.querySelector(".audit-matrix-head strong").textContent = row.surface || "";
  card.querySelector("p").textContent = row.intent || "";
  const facts = [
    [columns.authority, row.authority],
    [columns.evidence, row.evidence],
    [columns.live, row.live],
    [columns.boundary, row.boundary],
  ].filter(([, value]) => value);
  card.querySelector("dl").replaceChildren(
    ...facts.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label || "";
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  return card;
}

function renderDirectory() {
  if (!programDirectory) return;
  const header = document.createElement("div");
  header.className = "directory-row directory-head";
  for (const label of dictionary.directory.columns) {
    const cell = document.createElement("span");
    cell.textContent = label;
    header.append(cell);
  }
  programDirectory.replaceChildren(header, ...dictionary.programs.map(createDirectoryRow));
}

function createDirectoryRow(program) {
  const row = document.createElement("a");
  row.className = "directory-row";
  row.href = `#${program.id}`;
  row.dataset.contractsScroll = program.id;
  row.innerHTML = `
    <span class="program-name"></span>
    <span class="program-id"></span>
    <span></span>
    <span></span>
  `;
  row.children[0].textContent = program.name;
  row.children[1].textContent = program.programId;
  row.children[2].textContent = program.status;
  row.children[3].textContent = program.role;
  [...row.children].forEach((cell, index) => {
    cell.dataset.label = dictionary.directory.columns[index] ?? "";
  });
  return row;
}

function renderFlow() {
  if (!flowGrid) return;
  flowGrid.replaceChildren(
    ...dictionary.flow.steps.map((step) => {
      const card = document.createElement("article");
      card.className = "flow-card";
      card.innerHTML = `
        <span></span>
        <strong></strong>
        <p></p>
        <dl></dl>
      `;
      card.children[0].textContent = step.surface || step.domain || dictionary.flow.surfaceLabel;
      card.children[1].textContent = step.title;
      card.children[2].textContent = step.body;
      const facts = [
        [dictionary.flow.writesLabel, step.writes],
        [dictionary.flow.auditLabel, step.audit],
      ].filter(([, value]) => value);
      card.querySelector("dl").replaceChildren(
        ...facts.flatMap(([label, value]) => {
          const dt = document.createElement("dt");
          const dd = document.createElement("dd");
          dt.textContent = label;
          dd.textContent = value;
          return [dt, dd];
        }),
      );
      return card;
    }),
  );
}

function renderTransparencyLedger() {
  if (transparencyGrid) {
    transparencyGrid.replaceChildren(
      ...dictionary.transparency.cards.map((card) => {
        const panel = document.createElement("article");
        panel.className = "transparency-card";
        panel.innerHTML = `
          <span></span>
          <strong></strong>
          <p></p>
          <ul class="compact-list"></ul>
        `;
        panel.children[0].textContent = card.kicker;
        panel.children[1].textContent = card.title;
        panel.children[2].textContent = card.body;
        fillList(panel.querySelector("ul"), card.points);
        return panel;
      }),
    );
  }
  if (transparencyMap) {
    transparencyMap.replaceChildren(
      ...dictionary.transparency.map.map((row) => {
        const item = document.createElement("article");
        item.className = "transparency-map-row";
        item.innerHTML = `
          <strong></strong>
          <span></span>
          <p></p>
          <button type="button"></button>
        `;
        item.querySelector("strong").textContent = row.surface;
        item.querySelector("span").textContent = row.status;
        item.querySelector("p").textContent = row.audit;
        const button = item.querySelector("button");
        button.textContent = row.action;
        button.addEventListener("click", () => {
          if (chainBrowserType) chainBrowserType.value = row.typeId;
          document.getElementById("chain-pda-browser")?.scrollIntoView({ behavior: "smooth", block: "start" });
          void loadChainBrowserSelection();
        });
        return item;
      }),
    );
  }
}

function renderProgramDetails() {
  if (!programDetails) return;
  programDetails.replaceChildren(...dictionary.programs.map(createProgramPanel));
}

function createProgramPanel(program) {
  const panel = document.createElement("article");
  panel.className = "program-panel code-open";
  panel.id = program.id;

  const facts = [
    [dictionary.labels.programId, program.programId],
    [dictionary.labels.source, program.source],
    [dictionary.labels.sdk, program.sdk],
    [dictionary.labels.magic, program.magic],
    [dictionary.labels.accountSize, program.accountSize],
  ].filter(([, value]) => value);

  panel.innerHTML = `
    <div class="program-heading">
      <div>
        <p class="eyebrow"></p>
        <h3></h3>
      </div>
      <div class="program-heading-actions">
        <div class="program-view-tabs" role="tablist"></div>
        <button class="code-toggle" type="button" aria-expanded="true" hidden>
          <span aria-hidden="true">&lt;/&gt;</span>
          <strong></strong>
        </button>
        <span class="status-pill"></span>
      </div>
    </div>
    <p class="program-summary"></p>
    <div class="fact-grid"></div>
    <div class="program-columns">
      <div>
        <h4></h4>
        <ul class="compact-list instructions"></ul>
      </div>
      <div>
        <h4></h4>
        <ul class="compact-list seeds"></ul>
      </div>
      <div>
        <h4></h4>
        <ul class="compact-list storage"></ul>
      </div>
      <div>
        <h4></h4>
        <ul class="compact-list notes"></ul>
      </div>
    </div>
    <div class="program-view program-code-view" data-program-view-panel="code"></div>
    <div class="program-view program-pda-view" data-program-view-panel="pda" hidden></div>
    <div class="program-view program-live-view" data-program-view-panel="live" hidden></div>
  `;

  panel.querySelector(".eyebrow").textContent = program.kind;
  panel.querySelector("h3").textContent = program.name;
  panel.querySelector(".status-pill").textContent = program.status;
  const codeButton = panel.querySelector(".code-toggle");
  codeButton.querySelector("strong").textContent = dictionary.labels.viewCode;
  codeButton.setAttribute("aria-label", `${dictionary.labels.viewCode}: ${program.name}`);
  panel.querySelector(".program-summary").textContent = program.summary;
  panel.querySelector(".program-code-view").replaceChildren(createCodeExplorer(program));
  panel.querySelector(".program-pda-view").replaceChildren(createPdaStructureView(program));
  panel.querySelector(".program-live-view").replaceChildren(createProgramLiveView(program));
  renderProgramViewTabs(panel, program);

  const factGrid = panel.querySelector(".fact-grid");
  factGrid.replaceChildren(
    ...facts.map(([label, value]) => {
      const item = document.createElement("div");
      item.className = "fact-item";
      item.innerHTML = "<span></span><strong></strong>";
      item.children[0].textContent = label;
      item.children[1].textContent = value;
      return item;
    }),
  );

  fillList(panel.querySelector(".instructions"), program.instructions);
  fillList(panel.querySelector(".seeds"), program.pdaSeeds);
  fillList(panel.querySelector(".storage"), program.storage);
  fillList(panel.querySelector(".notes"), program.notes);
  const headings = panel.querySelectorAll("h4");
  headings[0].textContent = dictionary.labels.instructions;
  headings[1].textContent = dictionary.labels.pdaSeeds;
  headings[2].textContent = dictionary.labels.storage;
  headings[3].textContent = dictionary.labels.notes;

  return panel;
}

function renderProgramViewTabs(panel, program) {
  const tabs = panel.querySelector(".program-view-tabs");
  if (!tabs) return;
  const views = [
    { id: "code", label: dictionary.labels.viewCode, icon: "</>" },
    { id: "pda", label: dictionary.labels.viewPda, icon: "PDA" },
    { id: "live", label: dictionary.labels.viewLive, icon: "RPC" },
  ];
  tabs.replaceChildren(
    ...views.map((view, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "program-view-tab";
      button.dataset.programView = view.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(index === 0));
      button.innerHTML = "<span></span><strong></strong>";
      button.querySelector("span").textContent = view.icon;
      button.querySelector("strong").textContent = view.label;
      button.addEventListener("click", () => setProgramView(panel, program, view.id));
      return button;
    }),
  );
  setProgramView(panel, program, "code");
}

function setProgramView(panel, program, viewId) {
  panel.querySelectorAll("[data-program-view-panel]").forEach((view) => {
    view.hidden = view.dataset.programViewPanel !== viewId;
  });
  panel.querySelectorAll(".program-view-tab").forEach((button) => {
    const active = button.dataset.programView === viewId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  panel.classList.toggle("code-open", viewId === "code");
  if (viewId === "live") {
    const status = panel.querySelector("[data-program-live-status]");
    if (status && !status.dataset.touched) {
      status.textContent = dictionary.chainBrowser.programPrompt;
    }
  }
}

function createPdaStructureView(program) {
  const root = document.createElement("div");
  root.className = "pda-structure-grid";
  const schemas = program.pdaAccounts?.length ? program.pdaAccounts : createFallbackPdaSchemas(program);
  root.replaceChildren(...schemas.map(createPdaSchemaCard));
  return root;
}

function createFallbackPdaSchemas(program) {
  return program.pdaSeeds.map((seed, index) => ({
    name: seed.split(":")[0] || `${program.name} PDA ${index + 1}`,
    seeds: seed,
    size: program.accountSize || "-",
    purpose: program.storage[index] || program.summary,
    fields: program.storage.slice(0, 4),
  }));
}

function createPdaSchemaCard(schema) {
  const card = document.createElement("article");
  card.className = "pda-schema-card";
  card.innerHTML = `
    <div class="pda-schema-head">
      <strong></strong>
      <span></span>
    </div>
    <p></p>
    <dl></dl>
    <h4></h4>
    <ul class="compact-list"></ul>
  `;
  card.querySelector("strong").textContent = schema.name;
  card.querySelector(".pda-schema-head span").textContent = schema.size || "-";
  card.querySelector("p").textContent = schema.purpose || "";
  const facts = [
    [dictionary.labels.pdaSeeds, schema.seeds],
    [dictionary.labels.accountSize, schema.size],
    [dictionary.labels.magic, schema.magic],
  ].filter(([, value]) => value);
  const dl = card.querySelector("dl");
  dl.replaceChildren(
    ...facts.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  card.querySelector("h4").textContent = dictionary.labels.fields;
  fillList(card.querySelector("ul"), schema.fields?.length ? schema.fields : [schema.purpose || "-"]);
  return card;
}

function createProgramLiveView(program) {
  const root = document.createElement("div");
  root.className = "program-live-browser";
  root.innerHTML = `
    <div class="program-live-head">
      <div>
        <strong></strong>
        <p></p>
      </div>
      <div class="program-live-actions"></div>
    </div>
    <div class="chain-browser-status" data-program-live-status role="status" aria-live="polite"></div>
    <div class="chain-browser-results compact" data-program-live-results></div>
  `;
  root.querySelector("strong").textContent = dictionary.chainBrowser.programTitle;
  root.querySelector("p").textContent = dictionary.chainBrowser.programBody;
  const actions = root.querySelector(".program-live-actions");
  const types = programAccountTypeMap.get(program.codeKey) ?? [];
  actions.replaceChildren(
    ...types.map((typeId) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "program-live-action";
      button.textContent = typeLabel(typeId);
      button.addEventListener("click", () => loadProgramLiveAccounts(root, typeId));
      return button;
    }),
  );
  if (!types.length) {
    const empty = document.createElement("span");
    empty.className = "program-live-empty";
    empty.textContent = dictionary.chainBrowser.noKnownTypes;
    actions.append(empty);
  }
  return root;
}

async function loadProgramLiveAccounts(root, typeId) {
  const status = root.querySelector("[data-program-live-status]");
  const results = root.querySelector("[data-program-live-results]");
  status.dataset.touched = "true";
  setStatus(status, formatText(dictionary.chainBrowser.loadingType, { type: typeLabel(typeId) }));
  results.replaceChildren();
  try {
    const records = await scanAccountType(typeId);
    setStatus(status, formatText(dictionary.chainBrowser.loadedType, { count: records.length, type: typeLabel(typeId) }));
    results.replaceChildren(...records.slice(0, 12).map(createAccountCard));
    if (!records.length) results.append(createEmptyState(dictionary.chainBrowser.empty));
  } catch (error) {
    setStatus(status, formatText(dictionary.chainBrowser.error, { message: error.message }));
  }
}

function createCodeExplorer(program) {
  const sources = sourceTrees[program.codeKey] ?? [];
  const root = document.createElement("div");
  root.className = "code-explorer-grid";
  const selectedFile = { current: sources[0] };

  const tree = document.createElement("div");
  tree.className = "source-tree";
  const treeTitle = document.createElement("div");
  treeTitle.className = "source-tree-title";
  treeTitle.textContent = dictionary.labels.sourceTree;
  const treeList = document.createElement("div");
  treeList.className = "source-tree-list";
  tree.append(treeTitle, treeList);

  const viewer = document.createElement("div");
  viewer.className = "source-viewer";
  viewer.innerHTML = `
    <div class="source-viewer-head">
      <span class="source-path"></span>
      <button class="source-copy" type="button"></button>
    </div>
    <pre class="source-code"><code></code></pre>
  `;
  viewer.querySelector(".source-copy").textContent = dictionary.labels.copyCode;
  viewer.querySelector(".source-copy").addEventListener("click", async () => {
    if (!selectedFile.current) return;
    await navigator.clipboard?.writeText(selectedFile.current.code);
    const button = viewer.querySelector(".source-copy");
    button.textContent = dictionary.labels.copied;
    window.setTimeout(() => {
      button.textContent = dictionary.labels.copyCode;
    }, 1200);
  });

  const selectFile = (source) => {
    selectedFile.current = source;
    treeList.querySelectorAll(".source-file").forEach((button) => {
      button.classList.toggle("active", button.dataset.path === source.path);
    });
    viewer.querySelector(".source-path").textContent = source.path;
    const code = viewer.querySelector(".source-code code");
    code.className = `language-${source.language}`;
    code.textContent = source.code;
  };

  treeList.replaceChildren(...renderSourceTree(buildSourceTree(sources), selectFile, selectedFile));
  if (selectedFile.current) selectFile(selectedFile.current);
  root.append(tree, viewer);
  return root;
}

function buildSourceTree(sources) {
  const root = { dirs: new Map(), files: [] };
  for (const source of sources) {
    const parts = source.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ ...source, name: parts.at(-1) });
  }
  return root;
}

function renderSourceTree(node, selectFile, selectedFile, depth = 0) {
  const rows = [];
  for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = document.createElement("div");
    row.className = "source-dir";
    row.style.setProperty("--depth", String(depth));
    row.textContent = name;
    rows.push(row, ...renderSourceTree(child, selectFile, selectedFile, depth + 1));
  }
  for (const source of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-file";
    button.dataset.path = source.path;
    button.style.setProperty("--depth", String(depth));
    button.textContent = source.name;
    button.addEventListener("click", () => selectFile(source));
    if (!selectedFile.current) selectedFile.current = source;
    rows.push(button);
  }
  return rows;
}

function fillList(list, items) {
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }),
  );
}

function renderCodeBlocks() {
  const ids = Object.fromEntries(dictionary.programs.map((program) => [program.codeKey, program.programId]));
  if (programIdsCode) {
    programIdsCode.textContent = `export const nicechunkPrograms = ${JSON.stringify(ids, null, 2)};`;
  }
  if (pdaCode) {
    pdaCode.textContent = dictionary.developer.pdaCode;
  }
}

function renderChainBrowserControls() {
  if (!chainBrowserType) return;
  chainBrowserType.replaceChildren(
    ...pdaAccountTypes.map((type) => {
      const option = document.createElement("option");
      option.value = type.id;
      option.textContent = typeLabel(type.id);
      return option;
    }),
  );
}

function renderChainBrowserQuickLinks() {
  if (!chainBrowserQuickLinks) return;
  const quickTypes = dictionary.chainBrowser.quickTypes ?? ["player-profile", "backpack", "forged-items", "recipe-table", "guardian-region", "market-listing"];
  chainBrowserQuickLinks.replaceChildren(
    ...quickTypes.map((typeId) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chain-browser-quick-link";
      button.textContent = typeLabel(typeId);
      button.addEventListener("click", () => {
        if (chainBrowserType) chainBrowserType.value = typeId;
        void loadChainBrowserSelection();
      });
      return button;
    }),
  );
}

function renderChainBrowserInfo(typeId) {
  if (!chainBrowserInfo) return;
  const info = dictionary.chainBrowser.typeInfo?.[typeId] ?? dictionary.chainBrowser.typeInfo?.all;
  if (!info) {
    chainBrowserInfo.replaceChildren();
    return;
  }
  chainBrowserInfo.innerHTML = `
    <strong></strong>
    <p></p>
    <dl></dl>
  `;
  chainBrowserInfo.querySelector("strong").textContent = info.title;
  chainBrowserInfo.querySelector("p").textContent = info.body;
  const facts = [
    [dictionary.chainBrowser.visibleLabel, info.visible],
    [dictionary.chainBrowser.trustLabel, info.trust],
  ].filter(([, value]) => value);
  chainBrowserInfo.querySelector("dl").replaceChildren(
    ...facts.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

function setupChainBrowser() {
  chainBrowserRefresh?.addEventListener("click", () => {
    void loadChainBrowserSelection();
  });
  chainBrowserType?.addEventListener("change", () => {
    renderChainBrowserInfo(chainBrowserType.value || "all");
    void loadChainBrowserSelection();
  });
  chainBrowserSearch?.addEventListener("input", () => {
    renderChainBrowserRecords();
  });
  setStatus(chainBrowserStatus, dictionary.chainBrowser.ready);
}

async function loadChainBrowserSelection() {
  if (!chainBrowserType || !chainBrowserResults) return;
  const typeId = chainBrowserType.value || "all";
  setStatus(chainBrowserStatus, typeId === "all" ? dictionary.chainBrowser.loadingAll : formatText(dictionary.chainBrowser.loadingType, { type: typeLabel(typeId) }));
  chainBrowserStats?.replaceChildren();
  chainBrowserResults.replaceChildren();
  try {
    const records = typeId === "all" ? await scanAllAccountTypes() : await scanAccountType(typeId);
    chainBrowserRecords = records;
    renderChainBrowserRecords();
  } catch (error) {
    chainBrowserRecords = [];
    setStatus(chainBrowserStatus, formatText(dictionary.chainBrowser.error, { message: error.message }));
  }
}

function renderChainBrowserRecords() {
  if (!chainBrowserResults) return;
  const query = (chainBrowserSearch?.value || "").trim().toLowerCase();
  const records = query ? chainBrowserRecords.filter((record) => accountMatchesQuery(record, query)) : chainBrowserRecords;
  const grouped = groupRecordsByType(records);
  renderChainBrowserStats(grouped, records.length);
  chainBrowserResults.replaceChildren(...records.slice(0, 80).map(createAccountCard));
  if (!records.length) chainBrowserResults.append(createEmptyState(dictionary.chainBrowser.empty));
  if (query) {
    setStatus(chainBrowserStatus, formatText(dictionary.chainBrowser.filtered, { shown: records.length, total: chainBrowserRecords.length }));
  } else {
    setStatus(chainBrowserStatus, formatText(dictionary.chainBrowser.loaded, { count: chainBrowserRecords.length }));
  }
}

function accountMatchesQuery(record, query) {
  return [
    record.accountType,
    record.publicKey,
    record.programId,
    JSON.stringify(record.decoded ?? {}),
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

async function scanAllAccountTypes() {
  const results = [];
  for (const type of pdaAccountTypes.filter((item) => item.id !== "all")) {
    try {
      results.push(...await scanAccountType(type.id));
    } catch (error) {
      results.push({
        typeId: type.id,
        accountType: typeLabel(type.id),
        publicKey: dictionary.chainBrowser.scanFailed,
        programId: programIdForKey(type.programKey),
        decoded: { error: error.message },
        lamports: 0,
        dataLength: 0,
        executable: false,
      });
    }
  }
  return results;
}

async function scanAccountType(typeId) {
  const type = pdaAccountTypes.find((item) => item.id === typeId);
  if (!type || type.id === "all") return scanAllAccountTypes();
  if (type.id === "forged-items") return scanForgedItemAccounts();
  const programId = programIdForKey(type.programKey);
  if (!programId) throw new Error(`Missing program id for ${type.programKey}.`);
  if (type.id === "global-config") {
    const [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global-config")], programId);
    const account = await withRpcFallback((conn) => conn.getAccountInfo(globalConfig, "confirmed"), 15_000);
    return account ? [decodeAccountRecord(type, globalConfig, account, programId)].filter(Boolean) : [];
  }
  const accounts = await fetchProgramAccountsBySizes(programId, type.sizes);
  return accounts
    .map(({ pubkey, account }) => decodeAccountRecord(type, pubkey, account, programId))
    .filter(Boolean)
    .sort((a, b) => b.lamports - a.lamports);
}

async function scanForgedItemAccounts() {
  const backpackRecords = await scanAccountType("backpack");
  const forgedBackpacks = backpackRecords.flatMap((record) => {
    const slots = (record.decoded.sampleSlots ?? []).filter(isForgedBackpackSlot);
    if (!slots.length) return [];
    return [{
      ...record,
      typeId: "forged-items",
      accountType: typeLabel("forged-items"),
      decoded: {
        sourceAccountType: record.accountType,
        sourcePublicKey: record.publicKey,
        owner: record.decoded.owner,
        backpackId: record.decoded.backpackId,
        itemCount: record.decoded.itemCount,
        capacity: record.decoded.capacity,
        forgedSampleSlots: slots,
      },
    }];
  });
  return forgedBackpacks;
}

function isForgedBackpackSlot(slot) {
  return slot?.kind === "item" && (slot.itemCode === 8 || slot.itemId === "forged_item");
}

async function fetchProgramAccountsBySizes(programId, sizes) {
  if (!sizes?.length) {
    return withRpcFallback((conn) => conn.getProgramAccounts(programId, { commitment: "confirmed" }), 20_000);
  }
  const exactSizes = sizes.filter((size) => Number.isInteger(size));
  const rangeSizes = sizes.filter((size) => typeof size === "object");
  const exactResults = [];
  for (const size of exactSizes) {
    exactResults.push(...await withRpcFallback((conn) => conn.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [{ dataSize: size }],
    }), 20_000));
  }
  if (!rangeSizes.length) return dedupeProgramAccounts(exactResults);
  const all = await withRpcFallback((conn) => conn.getProgramAccounts(programId, { commitment: "confirmed" }), 20_000);
  return dedupeProgramAccounts([
    ...exactResults,
    ...all.filter(({ account }) => rangeSizes.some((range) => account.data.length >= (range.min ?? 0) && account.data.length <= (range.max ?? Number.MAX_SAFE_INTEGER))),
  ]);
}

function dedupeProgramAccounts(accounts) {
  const seen = new Set();
  const deduped = [];
  for (const record of accounts) {
    const key = record.pubkey.toBase58();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function decodeAccountRecord(type, pubkey, account, programId) {
  try {
    const decoded = type.decoder(account.data);
    if (!decoded) return null;
    return {
      typeId: type.id,
      accountType: typeLabel(type.id),
      publicKey: pubkey.toBase58(),
      programId: programId.toBase58(),
      decoded,
      lamports: account.lamports,
      dataLength: account.data.length,
      executable: account.executable,
    };
  } catch {
    return null;
  }
}

function renderChainBrowserStats(grouped, total) {
  if (!chainBrowserStats) return;
  const totalCard = document.createElement("article");
  totalCard.className = "chain-stat-card";
  totalCard.innerHTML = "<span></span><strong></strong>";
  totalCard.querySelector("span").textContent = dictionary.chainBrowser.total;
  totalCard.querySelector("strong").textContent = String(total);
  const cards = [totalCard];
  for (const [typeId, records] of grouped.entries()) {
    const card = document.createElement("article");
    card.className = "chain-stat-card";
    card.innerHTML = "<span></span><strong></strong>";
    card.querySelector("span").textContent = typeLabel(typeId);
    card.querySelector("strong").textContent = String(records.length);
    cards.push(card);
  }
  chainBrowserStats.replaceChildren(...cards);
}

function createAccountCard(record) {
  const card = document.createElement("article");
  card.className = "account-card";
  const summary = accountSummary(record);
  card.innerHTML = `
    <div class="account-card-head">
      <div>
        <span></span>
        <strong></strong>
      </div>
      <em></em>
    </div>
    <div class="account-card-actions">
      <button type="button" class="account-copy"></button>
    </div>
    <dl class="account-facts"></dl>
    <pre class="account-json"><code></code></pre>
  `;
  card.querySelector(".account-card-head span").textContent = record.accountType;
  card.querySelector(".account-card-head strong").textContent = record.publicKey;
  card.querySelector(".account-card-head em").textContent = `${record.dataLength} B`;
  const copyButton = card.querySelector(".account-copy");
  copyButton.textContent = dictionary.labels.copyAddress;
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(record.publicKey);
    copyButton.textContent = dictionary.labels.copied;
    window.setTimeout(() => {
      copyButton.textContent = dictionary.labels.copyAddress;
    }, 1200);
  });
  const facts = [
    [dictionary.chainBrowser.program, record.programId],
    [dictionary.chainBrowser.lamports, String(record.lamports)],
    ...summary,
  ];
  card.querySelector(".account-facts").replaceChildren(
    ...facts.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value ?? "-";
      return [dt, dd];
    }),
  );
  card.querySelector("code").textContent = JSON.stringify(record.decoded, null, 2);
  return card;
}

function accountSummary(record) {
  const data = record.decoded ?? {};
  const labels = dictionary.chainBrowser.summary;
  switch (record.typeId) {
    case "player-profile":
      return [[labels.owner, data.owner], [labels.position, formatPosition(data.position)], [labels.backpack, data.equippedBackpack]];
    case "player-session":
      return [[labels.owner, data.owner], [labels.authority, data.sessionAuthority], [labels.expiresAt, data.expiresAt]];
    case "backpack":
      return [[labels.owner, data.owner], [labels.items, `${data.itemCount}/${data.capacity}`], [labels.updatedSlot, data.updatedSlot]];
    case "recipe-table":
      return [[labels.authority, data.authority], [labels.recipes, String(data.recipeCount)], [labels.updatedSlot, data.updatedSlot]];
    case "market-listing":
      return [[labels.seller, data.seller], [labels.state, data.stateLabel], [labels.price, data.price]];
    case "forged-items":
      return [[labels.source, data.sourceAccountType], [labels.owner, data.owner], [labels.forgedItems, String(data.forgedSampleSlots?.length ?? data.itemId ?? data.itemCode ?? "-")]];
    case "civilization-rule-book":
      return [[labels.author, data.author], [labels.status, data.statusLabel], [labels.requiredPower, data.requiredPower]];
    case "civilization-rule-signature":
      return [[labels.signer, data.signer], [labels.side, data.sideLabel], [labels.power, data.snapshotPower]];
    case "civilization-rule-tally":
      return [[labels.ruleBook, data.ruleBook], [labels.thresholdMet, String(data.thresholdMet)], [labels.yesPower, data.yesPower]];
    case "civilization-execution-receipt":
      return [[labels.ruleBook, data.ruleBook], [labels.executor, data.executor], [labels.executed, String(data.executed)]];
    case "civilization-power-snapshot":
      return [[labels.authority, data.authority], [labels.totalPower, data.totalActivePower], [labels.expiresAt, data.expiresAt]];
    case "civilization-citizen-power":
      return [[labels.citizen, data.citizen], [labels.power, data.power], [labels.expiresAt, data.expiresAt]];
    case "guardian-region":
      return [[labels.owner, data.owner], [labels.endpoint, data.endpoint], [labels.proofs, String(data.proofCount)]];
    case "guardian-registry":
      return [[labels.active, String(data.activeCount)], [labels.total, String(data.totalRegistrations)], [labels.treasury, data.treasuryToken]];
    case "chunk-broken":
      return [[labels.minY, String(data.minY)], [labels.records, `${data.count}/${data.capacity}`], [labels.version, String(data.version)]];
    case "resource-drop-table":
      return [[labels.rules, String(data.ruleCount)], [labels.version, String(data.version)]];
    case "global-config":
      return [[labels.world, String(data.worldId)], [labels.seed, data.worldSeedHex], [labels.nckMint, data.nckMint]];
    default:
      return [];
  }
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "chain-empty-state";
  empty.textContent = message;
  return empty;
}

function groupRecordsByType(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.typeId)) grouped.set(record.typeId, []);
    grouped.get(record.typeId).push(record);
  }
  return grouped;
}

function getContractRpcUrls() {
  return [...new Set([getNicechunkRpcUrl(), solanaDevnetRpcUrl].filter(Boolean))];
}

function getContractsConnection(rpcUrl) {
  if (!contractsConnections.has(rpcUrl)) {
    contractsConnections.set(rpcUrl, new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createNicechunkRpcFetch("contracts-pda-browser"),
    }));
  }
  return contractsConnections.get(rpcUrl);
}

async function withRpcFallback(operation, timeoutMs) {
  const urls = getContractRpcUrls();
  const errors = [];
  for (const [index, rpcUrl] of urls.entries()) {
    const timeout = index === 0 && urls.length > 1 && rpcUrl.includes("onfinality.io") ? 5_000 : timeoutMs;
    try {
      return await withTimeout(operation(getContractsConnection(rpcUrl)), timeout, dictionary.chainBrowser.timeout);
    } catch (error) {
      errors.push(error);
    }
  }
  throw errors.at(-1) ?? new Error(dictionary.chainBrowser.timeout);
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message || "RPC request timed out.")), timeoutMs);
    }),
  ]);
}

function programIdForKey(programKey) {
  const program =
    dictionary.programs?.find((item) => item.codeKey === programKey)
    ?? fallbackDictionary.programs?.find((item) => item.codeKey === programKey);
  return program?.programId ? new PublicKey(program.programId) : null;
}

function typeLabel(typeId) {
  return dictionary.chainBrowser?.types?.[typeId] ?? fallbackDictionary.chainBrowser?.types?.[typeId] ?? typeId;
}

function setStatus(element, message) {
  if (element) element.textContent = message || "";
}

function formatText(template, replacements) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? "");
}

function formatPosition(position) {
  return position ? `${position.x}, ${position.y}, ${position.z}` : "-";
}

function setupLanguageSwitcher() {
  renderLanguageMenu();
  updateLanguagePicker();
  languageTrigger?.addEventListener("click", () => {
    setLanguageMenuOpen(!languagePicker?.classList.contains("open"));
  });
  document.addEventListener("click", (event) => {
    if (!languagePicker?.contains(event.target)) setLanguageMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setLanguageMenuOpen(false);
  });
}

function renderLanguageMenu() {
  if (!languageMenu) return;
  languageMenu.replaceChildren(
    ...plannedLanguages.map((language) => {
      const option = document.createElement("button");
      option.className = "docs-language-option contracts-language-option";
      option.type = "button";
      option.role = "option";
      option.dataset.contractsLanguage = language.code;
      option.disabled = !language.enabled;
      option.innerHTML = `
        <span class="docs-language-option-name"></span>
        <span class="docs-language-option-native"></span>
        <span class="docs-language-option-status"></span>
      `;
      option.querySelector(".docs-language-option-name").textContent = language.englishName;
      option.querySelector(".docs-language-option-native").textContent = `(${language.nativeName})`;
      option.querySelector(".docs-language-option-status").textContent = language.enabled ? "" : "Coming Soon";
      option.addEventListener("click", async () => {
        const nextLanguage = normalizeLanguage(option.dataset.contractsLanguage);
        if (!nextLanguage || nextLanguage === activeLanguage) {
          setLanguageMenuOpen(false);
          return;
        }
        activeLanguage = nextLanguage;
        dictionary = await loadDictionary(activeLanguage);
        localStorage.setItem(languageStorageKey, activeLanguage);
        applyTranslations(document);
        renderNavigation();
        renderRuntimeState();
        renderLogicAtlas();
        renderSeedEvidence();
        renderInstructionSurface();
        renderCpiAuthority();
        renderAccountLifecycle();
        renderAuditMatrix();
        renderDirectory();
        renderFlow();
        renderTransparencyLedger();
        renderProgramDetails();
        renderCodeBlocks();
        renderChainBrowserControls();
        renderChainBrowserQuickLinks();
        renderChainBrowserInfo(chainBrowserType?.value || "all");
        renderChainBrowserRecords();
        updateLanguagePicker();
        setLanguageMenuOpen(false);
      });
      return option;
    }),
  );
}

function updateLanguagePicker() {
  const active = plannedLanguages.find((language) => language.code === activeLanguage) ?? plannedLanguages[0];
  if (languageCurrent) languageCurrent.textContent = `${active.englishName} (${active.nativeName})`;
  languageMenu?.querySelectorAll(".contracts-language-option").forEach((option) => {
    const selected = option.dataset.contractsLanguage === activeLanguage;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-selected", String(selected));
  });
}

function setLanguageMenuOpen(open) {
  languagePicker?.classList.toggle("open", open);
  languageTrigger?.setAttribute("aria-expanded", String(open));
}

async function loadDictionary(language) {
  const normalized = normalizeLanguage(language);
  if (dictionaryCache.has(normalized)) return dictionaryCache.get(normalized);
  const response = await fetch(`/contracts/locales/${normalized}.json?v=${encodeURIComponent(buildVersion)}`, { cache: "no-store" });
  if (!response.ok) {
    if (normalized !== "en") return loadDictionary("en");
    return {};
  }
  const nextDictionary = await response.json();
  dictionaryCache.set(normalized, nextDictionary);
  if (normalized === "en") fallbackDictionary = nextDictionary;
  return nextDictionary;
}

function decodeGlobalConfigAccount(data) {
  assertMagic(data, "NCKCFG01", 293);
  return {
    magic: "NCKCFG01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    nckMint: readPubkey(data, 12),
    nckDecimals: data.readUInt8(44),
    nckGenesisSupply: data.readBigUInt64LE(45).toString(),
    developmentWallet: readPubkey(data, 53),
    worldId: data.readUInt16LE(85),
    worldSeedHex: Buffer.from(data.subarray(87, 119)).toString("hex"),
    terrainConfigHash: Buffer.from(data.subarray(119, 151)).toString("hex"),
    resourceRuleHash: Buffer.from(data.subarray(151, 183)).toString("hex"),
    clientWorldConfigHash: Buffer.from(data.subarray(183, 215)).toString("hex"),
    chunkSize: data.readUInt16LE(259),
    sectionHeight: data.readUInt16LE(261),
    minBuildY: data.readInt16LE(263),
    maxBuildY: data.readInt16LE(265),
    maxTerrainHeight: data.readInt16LE(267),
    seaLevel: data.readInt16LE(269),
    guardianRegionSizeChunks: data.readUInt16LE(271),
    guardianRealtimeRadiusChunks: data.readUInt16LE(273),
    mineCooldownSlots: data.readUInt16LE(275),
    genesisSlot: data.readBigUInt64LE(277).toString(),
    createdAt: data.readBigInt64LE(285).toString(),
  };
}

function decodePlayerProfileAccount(data) {
  if (data.length !== 773) throw new Error("Invalid PlayerProfile length.");
  assertMagic(data, "NCKPLY01");
  const nameLength = data.readUInt16LE(463);
  return {
    magic: "NCKPLY01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: readPubkey(data, 12),
    globalConfig: readPubkey(data, 44),
    worldId: data.readUInt16LE(76),
    position: {
      x: data.readInt32LE(78),
      y: data.readInt32LE(82),
      z: data.readInt32LE(86),
    },
    health: data.readUInt16LE(90),
    energy: data.readUInt16LE(92),
    stamina: data.readUInt16LE(94),
    equippedBackpack: readOptionalPubkey(data, 393),
    createdSlot: data.readBigUInt64LE(425).toString(),
    updatedSlot: data.readBigUInt64LE(433).toString(),
    forgingXp: data.readBigUInt64LE(449).toString(),
    forgedItemCount: data.readUInt32LE(457),
    bestForgedGrade: data.readUInt8(461),
    bestForgedItemLevel: data.readUInt8(462),
    playerName: nameLength > 0 && nameLength <= 300
      ? Buffer.from(data.subarray(465, 465 + nameLength)).toString("utf8")
      : "",
  };
}

function decodePlayerSessionAccount(data) {
  assertMagic(data, "NCKSES01", 184);
  return {
    magic: "NCKSES01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: readPubkey(data, 12),
    sessionAuthority: readPubkey(data, 44),
    playerProfile: readPubkey(data, 76),
    globalConfig: readPubkey(data, 108),
    worldId: data.readUInt16LE(140),
    allowedActions: data.readUInt16LE(142),
    expiresAt: data.readBigInt64LE(144).toString(),
    createdSlot: data.readBigUInt64LE(152).toString(),
    updatedSlot: data.readBigUInt64LE(160).toString(),
    createdAt: data.readBigInt64LE(168).toString(),
    maxActions: data.readUInt32LE(176),
    usedActions: data.readUInt32LE(180),
  };
}

function decodeChunkBrokenAccount(data) {
  if (data.length < 16 || data.subarray(0, 4).toString("utf8") !== "NCBK") throw new Error("Invalid ChunkBroken magic.");
  const count = data.readUInt16LE(6);
  const capacity = data.readUInt16LE(8);
  if (data.length !== 16 + capacity * 3) throw new Error("Invalid ChunkBroken length.");
  return {
    magic: "NCBK",
    version: data.readUInt8(4),
    bump: data.readUInt8(5),
    count,
    capacity,
    minY: data.readInt16LE(10),
    samplePackedRecords: Array.from({ length: Math.min(count, 12) }, (_, index) => Buffer.from(data.subarray(16 + index * 3, 19 + index * 3)).toString("hex")),
  };
}

function decodeResourceDropTableAccount(data) {
  if (data.length < 16) throw new Error("Invalid ResourceDropTable length.");
  assertMagic(data, "NCKDRP02");
  const ruleCount = data.readUInt8(10);
  if (!ruleCount || data.length !== 16 + ruleCount * 23) throw new Error("Invalid ResourceDropTable record length.");
  return {
    magic: "NCKDRP02",
    version: data.readUInt8(8),
    bump: data.readUInt8(9),
    ruleCount,
    rules: Array.from({ length: ruleCount }, (_, index) => {
      const offset = 16 + index * 23;
      return {
        sourceBlockId: data.readUInt16LE(offset),
        dropBlockId: data.readUInt16LE(offset + 2),
        chanceBps: data.readUInt16LE(offset + 4),
        minAltitude: data.readInt16LE(offset + 6),
        maxAltitude: data.readInt16LE(offset + 8),
        minDepth: data.readInt16LE(offset + 10),
        maxDepth: data.readInt16LE(offset + 12),
        salt: data.readUInt8(offset + 14),
        minVolumeMm3: data.readUInt32LE(offset + 15),
        maxVolumeMm3: data.readUInt32LE(offset + 19),
      };
    }),
  };
}

function decodeGuardianRegistryAccount(data) {
  assertMagic(data, "NCKGDR01", 160);
  return {
    magic: "NCKGDR01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    treasuryBump: data.readUInt8(11),
    globalConfig: readPubkey(data, 12),
    nckMint: readPubkey(data, 44),
    treasuryToken: readPubkey(data, 76),
    activeCount: data.readBigUInt64LE(108).toString(),
    totalRegistrations: data.readBigUInt64LE(116).toString(),
    genesisRegistered: data.readUInt8(124) === 1,
    regionSizeChunks: data.readUInt16LE(126),
    stakeAmount: data.readBigUInt64LE(128).toString(),
    slashAmount: data.readBigUInt64LE(136).toString(),
    createdSlot: data.readBigUInt64LE(144).toString(),
    createdAt: data.readBigInt64LE(152).toString(),
  };
}

function decodeGuardianRegionAccount(data) {
  if (data.length !== 256 && data.length !== 288) throw new Error("Invalid NCKGRG01 length.");
  assertMagic(data, "NCKGRG01");
  const hostLength = Math.min(data.readUInt8(132), 64);
  const host = new TextDecoder().decode(data.subarray(133, 133 + hostLength));
  const port = data.readUInt16LE(197);
  const useTls = data.readUInt8(199) === 1;
  return {
    magic: "NCKGRG01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    status: data.readUInt8(11),
    statusLabel: data.readUInt8(11) === 1 ? "active" : data.readUInt8(11) === 2 ? "removed" : "empty",
    regionX: data.readInt32LE(12),
    regionY: data.readInt32LE(16),
    minChunkX: data.readInt32LE(20),
    minChunkY: data.readInt32LE(24),
    maxChunkX: data.readInt32LE(28),
    maxChunkY: data.readInt32LE(32),
    owner: readPubkey(data, 36),
    operator: readPubkey(data, 68),
    globalConfig: readPubkey(data, 100),
    host,
    port,
    useTls,
    endpoint: `${useTls ? "https" : "http"}://${host}:${port}`,
    stakeAmount: data.readBigUInt64LE(200).toString(),
    totalSlashed: data.readBigUInt64LE(208).toString(),
    penaltyCount: data.readUInt32LE(216),
    registeredAt: data.readBigInt64LE(220).toString(),
    lastProofAt: data.readBigInt64LE(228).toString(),
    penaltyCursorAt: data.readBigInt64LE(236).toString(),
    proofCount: data.readBigUInt64LE(244).toString(),
    updatedSlot: data.readUInt32LE(252),
    blueprintHash: data.length === 288 ? data.subarray(256, 272).toString("hex") : null,
    blueprintRevision: data.length === 288 ? data.readBigUInt64LE(272).toString() : "0",
    blueprintRecordCount: data.length === 288 ? data.readUInt32LE(280) : 0,
    accountLength: data.length,
  };
}

function decodeBackpackAccount(data) {
  assertMagic(data, "NCKBPK01", 8048);
  const version = data.readUInt16LE(8);
  if (version !== 3) throw new Error("Invalid Backpack version.");
  const recordLength = 80;
  const capacity = data.readUInt8(52);
  const itemCount = data.readUInt8(53);
  const readableCount = Math.min(itemCount, capacity, 99);
  return {
    magic: "NCKBPK01",
    version,
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    backpackId: data.readBigUInt64LE(12).toString(),
    owner: readPubkey(data, 20),
    capacity,
    itemCount,
    state: data.readUInt8(54),
    flags: data.readUInt8(55),
    placed: { x: data.readInt32LE(56), y: data.readInt16LE(60), z: data.readInt32LE(62) },
    createdSlot: data.readBigUInt64LE(66).toString(),
    updatedSlot: data.readBigUInt64LE(74).toString(),
    createdAt: data.readBigInt64LE(82).toString(),
    sampleSlots: Array.from({ length: Math.min(readableCount, 10) }, (_, index) => decodeBackpackSlotSummary(data, 128 + index * recordLength, recordLength, index)),
  };
}

function decodeBackpackSlotSummary(data, offset, recordLength, index) {
  const kindCode = data.readUInt8(offset);
  return {
    index,
    kind: kindCode === 2 ? "item" : "block",
    category: data.readUInt8(offset + 1),
    quantity: data.readUInt32LE(offset + 4),
    resource: decodeBackpackResourceSummary(data, offset + 8),
    itemCode: data.readUInt16LE(offset + 18),
    itemId: data.readBigUInt64LE(offset + 20).toString(),
    itemPda: readOptionalPubkey(data, offset + 28),
    volumeMm3: data.readUInt32LE(offset + 60),
    durabilityCurrent: data.readUInt32LE(offset + 64),
    durabilityMax: data.readUInt32LE(offset + 68),
    grade: data.readUInt8(offset + 72),
    itemLevel: data.readUInt8(offset + 73),
    qualityBps: data.readUInt16LE(offset + 74),
    metadata: data.readUInt32LE(offset + 76),
  };
}

function decodeBackpackResourceSummary(data, offset) {
  const packedY = data.readInt16LE(offset + 4);
  return {
    worldX: data.readInt32LE(offset),
    worldY: packedY & 0x1ff,
    blockId: packedY >> 9,
    worldZ: data.readInt32LE(offset + 6),
  };
}

function decodeRecipeTableAccount(data) {
  assertMagic(data, "NCKSMR01", 9936);
  const recipeCount = data.readUInt16LE(52);
  return {
    magic: "NCKSMR01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    tableId: data.readBigUInt64LE(12).toString(),
    authority: readPubkey(data, 20),
    recipeCount,
    createdSlot: data.readBigUInt64LE(54).toString(),
    updatedSlot: data.readBigUInt64LE(62).toString(),
    createdAt: data.readBigInt64LE(70).toString(),
    sampleRecipes: Array.from({ length: 10 }, (_, index) => decodeRecipeRecordSummary(data, 96 + index * 984, index)).filter(Boolean).slice(0, 8),
  };
}

function decodeRecipeRecordSummary(data, offset, index) {
  const recipeId = data.readBigUInt64LE(offset);
  if (recipeId === 0n) return null;
  return {
    index,
    recipeId: recipeId.toString(),
    enabled: data.readUInt8(offset + 8) === 1,
    minHeatTier: data.readUInt8(offset + 9),
    inputCount: data.readUInt8(offset + 10),
    outputCount: data.readUInt8(offset + 11),
    updatedSlot: data.readBigUInt64LE(offset + 976).toString(),
  };
}

function decodeMarketListingAccount(data) {
  assertMagic(data, "NCKMKT01", 216);
  const currency = data.readUInt8(52) === 2 ? "SOL" : "NCK";
  const priceBaseUnits = data.readBigUInt64LE(54);
  const state = data.readUInt8(11);
  const sourceSlot = decodeBackpackSlotSummary(data, 62, 80, data.readUInt8(53));
  const sourceTypeCode = data.readUInt8(214);
  const source = sourceTypeCode === 2 ? "equipment" : "backpack";
  return {
    magic: "NCKMKT01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state,
    stateLabel: state === 1 ? "active" : state === 2 ? "canceled" : state === 3 ? "sold" : "unknown",
    seller: readPubkey(data, 12),
    listingId: data.readBigUInt64LE(44).toString(),
    categoryCode: sourceSlot.category,
    currency,
    source,
    sourceTypeCode,
    sourceIndex: data.readUInt8(53),
    quantity: sourceSlot.quantity,
    priceBaseUnits: priceBaseUnits.toString(),
    price: formatMarketBaseUnits(priceBaseUnits, currency),
    sourceSlot,
    sourceRecord: sourceSlot.resource,
    createdSlot: data.readBigUInt64LE(142).toString(),
    updatedSlot: data.readBigUInt64LE(150).toString(),
    createdAt: data.readBigInt64LE(158).toString(),
    buyer: readOptionalPubkey(data, 166),
    soldSlot: data.readBigUInt64LE(198).toString(),
    soldAt: data.readBigInt64LE(206).toString(),
  };
}

function decodeCivilizationRuleBookAccount(data) {
  assertMagic(data, "NCKCVR01", 320);
  const status = data.readUInt8(11);
  const targetStatus = data.readUInt8(254);
  return {
    magic: "NCKCVR01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    status,
    statusLabel: civilizationRuleStatusLabel(status),
    author: readPubkey(data, 12),
    ruleIdHash: readHashHex(data, 44),
    textHash: readHashHex(data, 76),
    patchHash: readHashHex(data, 108),
    snapshotHash: readHashHex(data, 140),
    targetProgram: readPubkey(data, 172),
    targetPda: readPubkey(data, 204),
    totalActivePower: data.readBigUInt64LE(236).toString(),
    requiredPower: data.readBigUInt64LE(244).toString(),
    thresholdBps: data.readUInt16LE(252),
    targetStatus,
    targetStatusLabel: civilizationTargetStatusLabel(targetStatus),
    riskLevel: data.readUInt8(255),
    yesPower: data.readBigUInt64LE(256).toString(),
    noPower: data.readBigUInt64LE(264).toString(),
    abstainPower: data.readBigUInt64LE(272).toString(),
    challengePower: data.readBigUInt64LE(280).toString(),
    createdSlot: data.readBigUInt64LE(288).toString(),
    finalizedSlot: data.readBigUInt64LE(296).toString(),
    executedSlot: data.readBigUInt64LE(304).toString(),
    createdAt: data.readBigInt64LE(312).toString(),
  };
}

function decodeCivilizationRuleSignatureAccount(data) {
  assertMagic(data, "NCKCVS01", 136);
  const side = data.readUInt8(11);
  return {
    magic: "NCKCVS01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    side,
    sideLabel: civilizationSideLabel(side),
    ruleBook: readPubkey(data, 12),
    signer: readPubkey(data, 44),
    snapshotHash: readHashHex(data, 76),
    snapshotPower: data.readBigUInt64LE(108).toString(),
    signedSlot: data.readBigUInt64LE(116).toString(),
    signedAt: data.readBigInt64LE(124).toString(),
  };
}

function decodeCivilizationRuleTallyOrPowerSnapshotOrReceiptAccount(data) {
  assertMagic(data, "NCKCVT01", 128);
  return {
    magic: "NCKCVT01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    thresholdMet: data.readUInt8(11) === 1,
    ruleBook: readPubkey(data, 12),
    yesPower: data.readBigUInt64LE(44).toString(),
    noPower: data.readBigUInt64LE(52).toString(),
    abstainPower: data.readBigUInt64LE(60).toString(),
    challengePower: data.readBigUInt64LE(68).toString(),
    requiredPower: data.readBigUInt64LE(76).toString(),
    finalizedSlot: data.readBigUInt64LE(84).toString(),
    finalizedAt: data.readBigInt64LE(92).toString(),
  };
}

function decodeCivilizationExecutionReceiptOrTallyOrSnapshotAccount(data) {
  assertMagic(data, "NCKCVE01", 128);
  return {
    magic: "NCKCVE01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    executed: data.readUInt8(11) === 1,
    ruleBook: readPubkey(data, 12),
    executor: readPubkey(data, 44),
    executedSlot: data.readBigUInt64LE(76).toString(),
    executedAt: data.readBigInt64LE(84).toString(),
  };
}

function decodeCivilizationPowerSnapshotOrTallyOrReceiptAccount(data) {
  assertMagic(data, "NCKCVP01", 128);
  return {
    magic: "NCKCVP01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    authority: readPubkey(data, 11),
    snapshotHash: readHashHex(data, 43),
    totalActivePower: data.readBigUInt64LE(75).toString(),
    windowStartEpoch: data.readBigUInt64LE(83).toString(),
    windowEndEpoch: data.readBigUInt64LE(91).toString(),
    createdSlot: data.readBigUInt64LE(99).toString(),
    expiresAt: data.readBigInt64LE(107).toString(),
    createdAt: data.readBigInt64LE(115).toString(),
  };
}

function decodeCivilizationCitizenPowerAccount(data) {
  assertMagic(data, "NCKCVC01", 144);
  return {
    magic: "NCKCVC01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    powerSnapshot: readPubkey(data, 11),
    citizen: readPubkey(data, 43),
    snapshotHash: readHashHex(data, 75),
    power: data.readBigUInt64LE(107).toString(),
    settledSlot: data.readBigUInt64LE(115).toString(),
    settledAt: data.readBigInt64LE(123).toString(),
    expiresAt: data.readBigInt64LE(131).toString(),
  };
}

function decodeBuildSiteAccount(data) {
  assertMagic(data, "NCKSITE1");
  const version = data.readUInt8(8);
  const status = data.readUInt8(10);
  if (data.length !== 136 && data.length !== 160) throw new Error("Invalid BuildSite length.");
  if (version !== 1 && version !== 2) throw new Error("Invalid BuildSite version.");
  if (version === 1 && data.length !== 136) throw new Error("Invalid legacy BuildSite length.");
  if (version === 2 && data.length !== 160) throw new Error("Invalid BuildSite v2 length.");
  return {
    magic: "NCKSITE1",
    version,
    status,
    statusLabel: buildSiteStatusLabel(status),
    bump: data.readUInt8(9),
    owner: readPubkey(data, 16),
    globalConfig: readPubkey(data, 48),
    foundationId: data.readBigUInt64LE(80).toString(),
    minX: data.readInt32LE(88),
    minZ: data.readInt32LE(92),
    surfaceY: data.readInt16LE(96),
    width: data.readUInt32LE(100),
    depth: data.readUInt32LE(104),
    createdSlot: data.readBigUInt64LE(108).toString(),
    activeRevision: data.readUInt32LE(116),
    pendingRevision: data.readUInt32LE(120),
    updatedSlot: data.readBigUInt64LE(124).toString(),
    registeredChunks: data.length === 160 ? data.readBigUInt64LE(132).toString() : "0",
    totalChunks: data.length === 160 ? data.readBigUInt64LE(140).toString() : "0",
    stagedWidth: data.length === 160 ? data.readUInt32LE(148) : 0,
    stagedDepth: data.length === 160 ? data.readUInt32LE(152) : 0,
    accountLength: data.length,
  };
}

function decodeBuildingManifestAccount(data) {
  assertMagic(data, "NCKBLD02", 160);
  const status = data.readUInt8(10);
  return {
    magic: "NCKBLD02",
    version: data.readUInt8(8),
    status,
    statusLabel: buildingStatusLabel(status),
    bump: data.readUInt8(9),
    quarterTurns: data.readUInt8(11),
    shardCount: data.readUInt8(12),
    uploadedBitmap: data.readUInt16LE(14),
    owner: readPubkey(data, 16),
    globalConfig: readPubkey(data, 48),
    foundationId: data.readBigUInt64LE(80).toString(),
    revision: data.readUInt32LE(88),
    payloadLen: data.readUInt32LE(92),
    expectedHash: readHashHex(data, 96),
    sizeX: data.readUInt16LE(128),
    sizeY: data.readUInt16LE(130),
    sizeZ: data.readUInt16LE(132),
    createdSlot: data.readBigUInt64LE(136).toString(),
    updatedSlot: data.readBigUInt64LE(144).toString(),
    offsetX: data.readInt32LE(152),
    offsetZ: data.readInt32LE(156),
  };
}

function decodeBuildingShardAccount(data) {
  assertMagic(data, "NCKBDT01");
  if (data.length < 64) throw new Error("Invalid BuildingShard length.");
  const payloadLen = data.readUInt16LE(12);
  const uploadedLen = data.readUInt16LE(14);
  if (data.length !== 64 + payloadLen) throw new Error("Invalid BuildingShard payload length.");
  return {
    magic: "NCKBDT01",
    version: data.readUInt8(8),
    bump: data.readUInt8(9),
    shardIndex: data.readUInt8(10),
    payloadLen,
    uploadedLen,
    uploadedPercent: payloadLen ? Math.round((uploadedLen / payloadLen) * 100) : 0,
    globalConfig: readPubkey(data, 16),
    foundationId: data.readBigUInt64LE(48).toString(),
    revision: data.readUInt32LE(56),
    payloadHash: Buffer.from(data.subarray(64)).toString("hex").slice(0, 32),
  };
}

function buildSiteStatusLabel(status) {
  return status === 0 ? "indexing" : status === 1 ? "active" : status === 2 ? "edit indexing" : status === 3 ? "edit cleaning" : "unknown";
}

function buildingStatusLabel(status) {
  return status === 0 ? "uploading" : status === 1 ? "active" : "unknown";
}

function civilizationRuleStatusLabel(status) {
  return status === 1 ? "published" : status === 2 ? "finalized" : status === 3 ? "executed" : "unknown";
}

function civilizationTargetStatusLabel(status) {
  return status === 1 ? "governable" : status === 2 ? "adapter pending" : status === 3 ? "readonly" : status === 4 ? "protected" : "unknown";
}

function civilizationSideLabel(side) {
  return side === 1 ? "agree" : side === 2 ? "reject" : side === 3 ? "abstain" : side === 4 ? "challenge" : "unknown";
}

function assertMagic(data, magic, expectedLength = null) {
  if (expectedLength !== null && data.length !== expectedLength) throw new Error(`Invalid ${magic} length.`);
  if (data.subarray(0, magic.length).toString("utf8") !== magic) throw new Error(`Invalid ${magic} magic.`);
}

function readPubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function readOptionalPubkey(data, offset) {
  const bytes = data.subarray(offset, offset + 32);
  return bytes.some((byte) => byte !== 0) ? new PublicKey(bytes).toBase58() : null;
}

function readHashHex(data, offset) {
  return Buffer.from(data.subarray(offset, offset + 32)).toString("hex");
}

function formatMarketBaseUnits(amount, currency) {
  const decimals = currency === "SOL" ? 9n : 6n;
  const divisor = 10n ** decimals;
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const trimmed = fraction.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return `${whole.toString()}${trimmed ? `.${trimmed}` : ""} ${currency}`;
}

function setupScrollLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-contracts-scroll]");
    if (!link) return;
    const id = link.dataset.contractsScroll;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  });
}

function setupSectionObserver() {
  if (!contractsNav || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      contractsNav.querySelectorAll("a").forEach((link) => {
        link.classList.toggle("active", link.hash === `#${visible.target.id}`);
      });
    },
    { rootMargin: "-22% 0px -62% 0px", threshold: [0.08, 0.18, 0.32] },
  );
  sections.forEach((section) => observer.observe(section));
}

function normalizeLanguage(language) {
  if (!language) return "en";
  if (language === "zh" || language === "zh-CN" || language === "zh-Hans") return "zh-Hans";
  if (language === "zh-TW" || language === "zh-HK" || language === "zh-MO") return "zh-Hant";
  if (languageCodes.has(language)) return language;
  const base = language.split("-")[0];
  return languageCodes.has(base) ? base : "en";
}
