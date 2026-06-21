import "./style.css";
import "../src/site-header.css";
import { finishSiteLoading, setSiteLoadingProgress } from "../src/site-ui.js";
import enDictionary from "./locales/en.json";
import esDictionary from "./locales/es.json";
import frDictionary from "./locales/fr.json";
import deDictionary from "./locales/de.json";
import jaDictionary from "./locales/ja.json";
import ruDictionary from "./locales/ru.json";
import koDictionary from "./locales/ko.json";
import zhHantDictionary from "./locales/zh-Hant.json";
import zhHansDictionary from "./locales/zh-Hans.json";
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
import marketCargo from "../programs/nicechunk_market/Cargo.toml?raw";
import marketClusterConfig from "../programs/nicechunk_market/src/cluster_config.rs?raw";
import marketErrors from "../programs/nicechunk_market/src/errors.rs?raw";
import marketLib from "../programs/nicechunk_market/src/lib.rs?raw";
import marketState from "../programs/nicechunk_market/src/state.rs?raw";

const languageStorageKey = "nicechunk.language";
const dictionaries = {
  en: enDictionary,
  es: esDictionary,
  fr: frDictionary,
  de: deDictionary,
  ja: jaDictionary,
  ru: ruDictionary,
  ko: koDictionary,
  "zh-Hant": zhHantDictionary,
  "zh-Hans": zhHansDictionary,
};
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
  market: [
    file("programs/nicechunk_market/Cargo.toml", "toml", marketCargo),
    file("programs/nicechunk_market/src/cluster_config.rs", "rust", marketClusterConfig),
    file("programs/nicechunk_market/src/errors.rs", "rust", marketErrors),
    file("programs/nicechunk_market/src/lib.rs", "rust", marketLib),
    file("programs/nicechunk_market/src/state.rs", "rust", marketState),
  ],
};

const contractsNav = document.querySelector("#contractsNav");
const programDirectory = document.querySelector("#programDirectory");
const flowGrid = document.querySelector("#flowGrid");
const programDetails = document.querySelector("#programDetails");
const programIdsCode = document.querySelector("#programIdsCode");
const pdaCode = document.querySelector("#pdaCode");
const languagePicker = document.querySelector(".contracts-language");
const languageTrigger = document.querySelector(".contracts-language-trigger");
const languageCurrent = document.querySelector(".contracts-language-current");
const languageMenu = document.querySelector(".contracts-language-menu");
const sections = [...document.querySelectorAll("[data-contract-section]")];

let activeLanguage = normalizeLanguage(localStorage.getItem(languageStorageKey)) || "en";
let dictionary = dictionaries[activeLanguage] || dictionaries.en;

initContractsPage();

function initContractsPage() {
  setSiteLoadingProgress(36);
  applyTranslations(document);
  renderNavigation();
  renderDirectory();
  renderFlow();
  renderProgramDetails();
  renderCodeBlocks();
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
  document.documentElement.lang = activeLanguage;
}

function text(path) {
  const value = path.split(".").reduce((current, part) => (current && Object.hasOwn(current, part) ? current[part] : undefined), dictionary);
  if (value !== undefined) return value;
  return path.split(".").reduce((current, part) => (current && Object.hasOwn(current, part) ? current[part] : undefined), dictionaries.en) ?? "";
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
        <button class="code-toggle" type="button" aria-expanded="true">
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
    <div class="code-explorer"></div>
  `;

  panel.querySelector(".eyebrow").textContent = program.kind;
  panel.querySelector("h3").textContent = program.name;
  panel.querySelector(".status-pill").textContent = program.status;
  const codeButton = panel.querySelector(".code-toggle");
  codeButton.querySelector("strong").textContent = dictionary.labels.viewCode;
  codeButton.setAttribute("aria-label", `${dictionary.labels.viewCode}: ${program.name}`);
  panel.querySelector(".program-summary").textContent = program.summary;
  const codeExplorer = panel.querySelector(".code-explorer");
  codeExplorer.replaceChildren(createCodeExplorer(program));
  codeExplorer.dataset.ready = "true";
  codeButton.addEventListener("click", () => {
    const explorer = panel.querySelector(".code-explorer");
    const isOpen = !explorer.hidden;
    explorer.hidden = isOpen;
    codeButton.setAttribute("aria-expanded", String(!isOpen));
    panel.classList.toggle("code-open", !isOpen);
    if (!isOpen && !explorer.dataset.ready) {
      explorer.replaceChildren(createCodeExplorer(program));
      explorer.dataset.ready = "true";
    }
  });

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
      option.addEventListener("click", () => {
        const nextLanguage = normalizeLanguage(option.dataset.contractsLanguage);
        if (!nextLanguage || nextLanguage === activeLanguage) {
          setLanguageMenuOpen(false);
          return;
        }
        activeLanguage = nextLanguage;
        dictionary = dictionaries[activeLanguage] || dictionaries.en;
        localStorage.setItem(languageStorageKey, activeLanguage);
        applyTranslations(document);
        renderNavigation();
        renderDirectory();
        renderFlow();
        renderProgramDetails();
        renderCodeBlocks();
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
  return dictionaries[language] ? language : "en";
}
