import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const buildVersion = `${pkg.version}-${new Date()
  .toISOString()
  .replace(/\D/g, "")
  .slice(0, 14)}`;

const pageInputs = Object.fromEntries(
  Object.entries({
    home: "index.html",
    login: "login/index.html",
    roadmap: "roadmap/index.html",
    fairness: "fairness/index.html",
    player_set: "player_set/index.html",
    player_creat: "player_creat/index.html",
    world_rule: "world_rule/index.html",
    resource_rule: "resource_rule/index.html",
    ncm: "ncm/index.html",
    ncfm: "ncfm/index.html",
    ncm_dna: "ncm_dna/index.html",
    fourier_pickaxe: "fourier-pickaxe/index.html",
    fourier_voxel: "fourier-voxel/index.html",
    elements: "elements/index.html",
    mining: "mining/index.html",
    seed: "seed/index.html",
    chip: "chip/index.html",
    texturearray: "texturearray/index.html",
    guardian: "guardian/index.html",
    contracts: "contracts/index.html",
    civilization: "civilization/index.html",
    civilization_rules: "civilization/rules.html",
    civilization_value: "civilization/value.html",
    trust: "trust/index.html",
    whitepaper: "whitepaper/index.html",
    proof_of_frontier: "proof-of-frontier/index.html",
  })
    .map(([name, path]) => [name, resolve(__dirname, path)])
    .filter(([, path]) => existsSync(path)),
);

function appendAssetVersion() {
  return {
    name: "append-asset-version",
    transformIndexHtml(html) {
      const versionedHtml = html.replaceAll("__NICECHUNK_BUILD_VERSION__", buildVersion).replace(
        /(src|href)="([^"]+\.(?:js|css))"/g,
        (_match, attr, url) => `${attr}="${url}?v=${buildVersion}"`,
      );
      return versionedHtml.replace(
        /(<link\s+rel="modulepreload"[^>]+href="[^"]+)\?v=[^"]+"/g,
        "$1\"",
      );
    },
  };
}

function serveClassicPlayLoaders() {
  const files = new Map([
    ["/play/play-loader.js", resolve(__dirname, "play/play-loader.js")],
    ["/play/play-onboarding-loader.js", resolve(__dirname, "play/play-onboarding-loader.js")],
  ]);
  return {
    name: "serve-classic-play-loaders",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        const file = files.get(pathname);
        if (!file) return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [serveClassicPlayLoaders(), appendAssetVersion()],
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  resolve: {
    alias: {
      buffer: resolve(__dirname, "node_modules/buffer/index.js"),
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
      binaryInterval: 3000,
      ignored: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/target/**",
        "**/coverage/**",
      ],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: pageInputs,
      output: {
        entryFileNames(chunkInfo) {
          return chunkInfo.name === "nicechunkChain"
            ? "assets/nicechunkChain.js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames(chunkInfo) {
          return chunkInfo.name === "nicechunkChain"
            ? "assets/nicechunkChain.js"
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
});
