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
};

const pdaAccountTypes = [
  { id: "all", programKey: null, sizes: [], decoder: null },
  { id: "global-config", programKey: "core", sizes: [293], decoder: decodeGlobalConfigAccount },
  { id: "player-profile", programKey: "player", sizes: [449, 417], decoder: decodePlayerProfileAccount },
  { id: "player-session", programKey: "player", sizes: [184], decoder: decodePlayerSessionAccount },
  { id: "chunk-broken", programKey: "chunk", sizes: [{ min: 16 }], decoder: decodeChunkBrokenAccount },
  { id: "resource-drop-table", programKey: "chunk", sizes: [{ min: 16 }], decoder: decodeResourceDropTableAccount },
  { id: "guardian-registry", programKey: "guardian", sizes: [160], decoder: decodeGuardianRegistryAccount },
  { id: "guardian-region", programKey: "guardian", sizes: [256], decoder: decodeGuardianRegionAccount },
  { id: "backpack", programKey: "backpack", sizes: [6464, 1118], decoder: decodeBackpackAccount },
  { id: "recipe-table", programKey: "smelting", sizes: [9552], decoder: decodeRecipeTableAccount },
  { id: "market-listing", programKey: "market", sizes: [216], decoder: decodeMarketListingAccount },
  { id: "market-asset", programKey: "market", sizes: [256], decoder: decodeMarketAssetAccount },
  { id: "forged-items", programKey: null, sizes: [], decoder: null, virtual: true },
];

const programAccountTypeMap = new Map();
for (const type of pdaAccountTypes) {
  if (!type.programKey) continue;
  if (!programAccountTypeMap.has(type.programKey)) programAccountTypeMap.set(type.programKey, []);
  programAccountTypeMap.get(type.programKey).push(type.id);
}

const contractsNav = document.querySelector("#contractsNav");
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

void initContractsPage();

async function initContractsPage() {
  setSiteLoadingProgress(36);
  dictionary = await loadDictionary(activeLanguage);
  applyTranslations(document);
  renderNavigation();
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
    ...dictionary.flow.steps.map((step, index) => {
      const card = document.createElement("article");
      card.className = "flow-card";
      card.innerHTML = `
        <span></span>
        <strong></strong>
        <p></p>
      `;
      card.children[0].textContent = String(index + 1).padStart(2, "0");
      card.children[1].textContent = step.title;
      card.children[2].textContent = step.body;
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
  const [assetRecords, backpackRecords] = await Promise.all([
    scanAccountType("market-asset"),
    scanAccountType("backpack"),
  ]);
  const forgedAssets = assetRecords.filter((record) => isForgedAsset(record.decoded)).map((record) => ({
    ...record,
    typeId: "forged-items",
    accountType: typeLabel("forged-items"),
    decoded: {
      sourceAccountType: record.accountType,
      sourcePublicKey: record.publicKey,
      ...record.decoded,
    },
  }));
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
  return [...forgedAssets, ...forgedBackpacks];
}

function isForgedAsset(decoded) {
  return decoded?.itemCode === 8 || decoded?.itemId === "forged_item";
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
    case "market-asset":
      return [[labels.owner, data.owner], [labels.state, data.stateLabel], [labels.item, data.itemId || String(data.itemCode)]];
    case "forged-items":
      return [[labels.source, data.sourceAccountType], [labels.owner, data.owner], [labels.forgedItems, String(data.forgedSampleSlots?.length ?? data.itemId ?? data.itemCode ?? "-")]];
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
  if (data.length !== 449 && data.length !== 417) throw new Error("Invalid PlayerProfile length.");
  assertMagic(data, "NCKPLY01");
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
    equippedBackpack: data.length === 449 ? readOptionalPubkey(data, 393) : null,
    createdSlot: data.readBigUInt64LE(data.length === 449 ? 425 : 393).toString(),
    updatedSlot: data.readBigUInt64LE(data.length === 449 ? 433 : 401).toString(),
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
  assertMagic(data, "NCKDRP01");
  const ruleCount = data.readUInt8(10);
  if (!ruleCount || data.length !== 16 + ruleCount * 15) throw new Error("Invalid ResourceDropTable record length.");
  return {
    magic: "NCKDRP01",
    version: data.readUInt8(8),
    bump: data.readUInt8(9),
    ruleCount,
    rules: Array.from({ length: ruleCount }, (_, index) => {
      const offset = 16 + index * 15;
      return {
        sourceBlockId: data.readUInt16LE(offset),
        dropBlockId: data.readUInt16LE(offset + 2),
        chanceBps: data.readUInt16LE(offset + 4),
        minAltitude: data.readInt16LE(offset + 6),
        maxAltitude: data.readInt16LE(offset + 8),
        minDepth: data.readInt16LE(offset + 10),
        maxDepth: data.readInt16LE(offset + 12),
        salt: data.readUInt8(offset + 14),
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
  assertMagic(data, "NCKGRG01", 256);
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
  };
}

function decodeBackpackAccount(data) {
  if (data.length !== 6464 && data.length !== 1118) throw new Error("Invalid Backpack length.");
  assertMagic(data, "NCKBPK01");
  const version = data.readUInt16LE(8);
  const recordLength = version === 1 ? 10 : 64;
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
  if (recordLength === 10) {
    return { index, kind: "block", resource: decodeBackpackResourceSummary(data, offset) };
  }
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
  };
}

function decodeBackpackResourceSummary(data, offset) {
  const packedY = data.readInt16LE(offset + 4);
  return {
    worldX: data.readInt32LE(offset),
    worldY: packedY >> 9,
    blockId: packedY & 0x1ff,
    worldZ: data.readInt32LE(offset + 6),
  };
}

function decodeRecipeTableAccount(data) {
  assertMagic(data, "NCKSMR01", 9552);
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
    sampleRecipes: Array.from({ length: 12 }, (_, index) => decodeRecipeRecordSummary(data, 96 + index * 788, index)).filter(Boolean).slice(0, 8),
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
    updatedSlot: data.readBigUInt64LE(offset + 780).toString(),
  };
}

function decodeMarketListingAccount(data) {
  assertMagic(data, "NCKMKT01", 216);
  const currency = data.readUInt8(53) === 2 ? "SOL" : "NCK";
  const priceBaseUnits = data.readBigUInt64LE(61);
  const state = data.readUInt8(11);
  return {
    magic: "NCKMKT01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state,
    stateLabel: state === 1 ? "active" : state === 2 ? "canceled" : state === 3 ? "sold" : "unknown",
    seller: readPubkey(data, 12),
    listingId: data.readBigUInt64LE(44).toString(),
    categoryCode: data.readUInt8(52),
    currency,
    sourceKind: data.readUInt8(54) === 2 ? "asset" : "backpack",
    sourceIndex: data.readUInt16LE(55),
    quantity: data.readUInt32LE(57),
    priceBaseUnits: priceBaseUnits.toString(),
    price: formatMarketBaseUnits(priceBaseUnits, currency),
    itemHash: Buffer.from(data.subarray(69, 101)).toString("hex"),
    sourceInventory: readPubkey(data, 101),
    sourceRecord: { worldX: data.readInt32LE(133), worldY: data.readInt16LE(137), worldZ: data.readInt32LE(139) },
    createdSlot: data.readBigUInt64LE(143).toString(),
    updatedSlot: data.readBigUInt64LE(151).toString(),
    createdAt: data.readBigInt64LE(159).toString(),
    buyer: readOptionalPubkey(data, 167),
    soldSlot: data.readBigUInt64LE(199).toString(),
    soldAt: data.readBigInt64LE(207).toString(),
  };
}

function decodeMarketAssetAccount(data) {
  assertMagic(data, "NCKAST01", 256);
  const state = data.readUInt8(11);
  const itemCode = data.readUInt16LE(145);
  const payloadLength = Math.min(data.readUInt16LE(155), 96);
  return {
    magic: "NCKAST01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state,
    stateLabel: state === 1 ? "active" : state === 2 ? "listed" : "unknown",
    owner: readPubkey(data, 12),
    assetId: data.readBigUInt64LE(44).toString(),
    categoryCode: data.readUInt8(52),
    quantity: data.readUInt32LE(53),
    itemHash: Buffer.from(data.subarray(57, 89)).toString("hex"),
    listing: readOptionalPubkey(data, 89),
    createdSlot: data.readBigUInt64LE(121).toString(),
    updatedSlot: data.readBigUInt64LE(129).toString(),
    createdAt: data.readBigInt64LE(137).toString(),
    itemCode,
    itemId: marketAssetItemId(itemCode, data.subarray(157, 157 + payloadLength)),
    stackCount: data.readUInt32LE(147),
    durability: data.readUInt32LE(151),
    payloadLength,
    payloadHex: Buffer.from(data.subarray(157, 157 + payloadLength)).toString("hex"),
  };
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

function formatMarketBaseUnits(amount, currency) {
  const decimals = currency === "SOL" ? 9n : 6n;
  const divisor = 10n ** decimals;
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const trimmed = fraction.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return `${whole.toString()}${trimmed ? `.${trimmed}` : ""} ${currency}`;
}

function marketAssetItemId(itemCode, payload) {
  const known = new Map([
    [1, "iron_pickaxe"],
    [2, "dirt"],
    [3, "stone"],
    [4, "sand"],
    [5, "trunk"],
    [6, "leaves"],
    [7, "red_flower"],
    [8, "forged_item"],
    [9, "backpack_resource"],
  ]);
  if (known.has(itemCode)) return known.get(itemCode);
  if (itemCode !== 65535) return null;
  return new TextDecoder().decode(payload).replace(/\0+$/, "") || null;
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
