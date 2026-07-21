import {
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  BUILDING_MANIFEST_LEN,
  createPublishGuardianBlueprintInstruction,
  decodeBuildSite,
  decodeLegacyBuildSite,
  deriveBuildingManifestPda,
  deriveBuildSitePda,
  GUARDIAN_BLUEPRINT_PUBLISHER_WALLET,
} from "../sdk/nicechunk-building.ts";
import {
  decodeGuardianRegion,
  deriveGuardianRegionPda,
  GUARDIAN_STATUS_ACTIVE,
  GUARDIAN_TREASURY_WALLET,
} from "../sdk/nicechunk-guardian.ts";
import { deriveGlobalConfigPda } from "../sdk/nicechunk-core.ts";
import {
  buildingProgramId,
  chunkProgramId,
  connection,
  coreProgramId,
  guardianProgramId,
  readPayerKeypair,
} from "./core-script-utils.ts";

const BUILDING_MANIFEST_HEADER_LEN = 48;
const BUILDING_RECORD_LEN = 56;
const BUILDING_RECORDS_PER_RPC = 100;
const BUILDING_MANIFEST_MAGIC = "NCKBLD02";
const GUARDIAN_MANIFEST_V2_MAGIC = "NCKBRG02";
const GUARDIAN_MANIFEST_V3_MAGIC = "NCKBRG03";
const BUILD_SITE_STATUS_ACTIVE = 1;
const BUILDING_STATUS_ACTIVE = 1;
const GUARDIAN_REGION_SIZE_CHUNKS = 100;
const DEFAULT_CHUNK_SIZE = 16;
const DEFAULT_INTERVAL_MS = 1_500;

const conn = connection();
const publisher = readPayerKeypair();
const verifyOnly = process.env.GUARDIAN_VERIFY_ONLY === "1";
const selectedCoreProgramId = coreProgramId();
const selectedGuardianProgramId = guardianProgramId();
const selectedBuildingProgramId = buildingProgramId();
const selectedChunkProgramId = chunkProgramId();
if (!verifyOnly
  && !publisher.publicKey.equals(GUARDIAN_TREASURY_WALLET)
  && !publisher.publicKey.equals(GUARDIAN_BLUEPRINT_PUBLISHER_WALLET)) {
  throw new Error(`Guardian blueprint sync requires governance or blueprint publisher authority`);
}
const chunkSize = readChunkSize(process.env.GUARDIAN_CHUNK_SIZE);
const endpoint = requireEndpoint(process.env.GUARDIAN_BUILDINGS_URL);
const watch = process.env.GUARDIAN_WATCH === "1";
const intervalMs = readInterval(process.env.GUARDIAN_SYNC_INTERVAL_MS);
const [globalConfig] = deriveGlobalConfigPda(selectedCoreProgramId);
let knownManifestHash = "";
let lastReportedHash = "";

do {
  try {
    const result = await syncOnce();
    if (!watch || result.status !== "unchanged" || result.blueprintHash !== lastReportedHash) {
      console.log(JSON.stringify(result, bigintJsonReplacer));
    }
    lastReportedHash = result.blueprintHash;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[Guardian Blueprint Sync] ${reason}`);
    if (!watch) throw error;
  }
  if (watch) await sleep(intervalMs);
} while (watch);

async function syncOnce() {
  const manifest = await fetchManifest(endpoint, knownManifestHash);
  if (!manifest) return { status: "unchanged", blueprintHash: knownManifestHash };
  const [region] = deriveGuardianRegionPda({
    globalConfig,
    regionX: manifest.regionX,
    regionY: manifest.regionY,
    programId: selectedGuardianProgramId,
  });
  const account = await conn.getAccountInfo(region, "confirmed");
  if (!account) throw new Error(`GuardianRegion does not exist: ${region.toBase58()}`);
  if (!account.owner.equals(selectedGuardianProgramId)) throw new Error("GuardianRegion has an invalid owner");
  const guardian = decodeGuardianRegion(account.data, region);
  if (guardian.status !== GUARDIAN_STATUS_ACTIVE) throw new Error("GuardianRegion is not active");
  if (guardian.regionX !== manifest.regionX || guardian.regionY !== manifest.regionY) {
    throw new Error("Guardian manifest region does not match GuardianRegion");
  }
  await verifyManifestRecords(manifest);

  if (verifyOnly) {
    knownManifestHash = manifest.hash;
    return {
      status: "verified",
      region: region.toBase58(),
      regionX: manifest.regionX,
      regionY: manifest.regionY,
      guardianOwner: guardian.owner.toBase58(),
      onChainBlueprintHash: guardian.blueprintHash,
      blueprintHash: manifest.hash,
      revision: manifest.revision,
      recordCount: manifest.recordCount,
    };
  }

  if (guardian.blueprintHash === manifest.hash && guardian.owner.equals(GUARDIAN_TREASURY_WALLET)) {
    knownManifestHash = manifest.hash;
    return {
      status: "unchanged",
      region: region.toBase58(),
      regionX: manifest.regionX,
      regionY: manifest.regionY,
      blueprintHash: manifest.hash,
      revision: manifest.revision,
      recordCount: manifest.recordCount,
    };
  }

  const instruction = createPublishGuardianBlueprintInstruction({
    publisher: publisher.publicKey,
    regionX: manifest.regionX,
    regionY: manifest.regionY,
    blueprintHash: manifest.hash,
    blueprintRevision: manifest.revision,
    blueprintRecordCount: manifest.recordCount,
    buildingProgramId: selectedBuildingProgramId,
    guardianProgramId: selectedGuardianProgramId,
    coreProgramId: selectedCoreProgramId,
  });
  const signature = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(instruction),
    [publisher],
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  knownManifestHash = manifest.hash;
  return {
    status: guardian.blueprintHash ? "updated" : "migrated-and-updated",
    signature,
    region: region.toBase58(),
    regionX: manifest.regionX,
    regionY: manifest.regionY,
    blueprintHash: manifest.hash,
    revision: manifest.revision,
    recordCount: manifest.recordCount,
  };
}

async function fetchManifest(url: URL, knownHash: string): Promise<BuildingManifest | null> {
  const headers: Record<string, string> = {};
  if (knownHash) headers["If-None-Match"] = `"${knownHash}"`;
  const response = await fetch(url, { cache: "no-store", headers });
  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`Guardian manifest HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const magic = data.length >= 8 ? data.subarray(0, 8).toString("utf8") : "";
  const version = data.length >= 10 ? data.readUInt16LE(8) : 0;
  if (data.length < BUILDING_MANIFEST_HEADER_LEN
    || !((magic === GUARDIAN_MANIFEST_V2_MAGIC && version === 2)
      || (magic === GUARDIAN_MANIFEST_V3_MAGIC && version === 3))
    || data.readUInt16LE(10) !== BUILDING_RECORD_LEN) {
    throw new Error("Invalid Guardian building manifest header");
  }
  const recordCount = data.readUInt32LE(28);
  const expectedLength = BUILDING_MANIFEST_HEADER_LEN + recordCount * BUILDING_RECORD_LEN;
  if (!Number.isSafeInteger(expectedLength) || data.length !== expectedLength) {
    throw new Error("Invalid Guardian building manifest length");
  }
  return {
    regionX: data.readInt32LE(12),
    regionY: data.readInt32LE(16),
    revision: data.readBigUInt64LE(20),
    recordCount,
    hash: requireManifestHash(data, recordCount, version),
    records: decodeManifestRecords(data, recordCount),
  };
}

async function verifyManifestRecords(manifest: BuildingManifest): Promise<void> {
  const sitePdas = manifest.records.flatMap((record) => [
    deriveBuildSitePda({
      globalConfig,
      foundationId: record.foundationId,
      programId: selectedBuildingProgramId,
    })[0],
    deriveBuildSitePda({
      globalConfig,
      foundationId: record.foundationId,
      programId: selectedChunkProgramId,
    })[0],
  ]);
  const siteAccounts = await getMultipleAccountsInfoBatched(sitePdas);
  const activeRecords: Array<{ record: BuildingRecord; owner: PublicKey }> = [];

  for (let index = 0; index < manifest.records.length; index += 1) {
    const record = manifest.records[index];
    const currentAccount = siteAccounts[index * 2];
    const legacyAccount = siteAccounts[index * 2 + 1];
    const current = currentAccount?.owner.equals(selectedBuildingProgramId)
      ? decodeBuildSite(currentAccount.data)
      : null;
    const legacy = !current && record.updatedSlot === 0n && legacyAccount?.owner.equals(selectedChunkProgramId)
      ? decodeLegacyBuildSite(legacyAccount.data)
      : null;
    const site = current ?? legacy;
    if (!site) {
      throw new Error(`Guardian foundation ${record.foundationId} has no authoritative BuildSite PDA`);
    }
    if (site.status !== BUILD_SITE_STATUS_ACTIVE
      || !site.globalConfig.equals(globalConfig)
      || site.foundationId !== record.foundationId
      || site.minX !== record.minX
      || site.minZ !== record.minZ
      || site.surfaceY !== record.surfaceY
      || site.width !== record.width
      || site.depth !== record.depth
      || site.activeRevision !== record.activeRevision
      || record.updatedSlot !== 0n && site.updatedSlot !== record.updatedSlot) {
      throw new Error(`Guardian foundation ${record.foundationId} does not match its BuildSite PDA`);
    }
    if (record.activeRevision > 0) activeRecords.push({ record, owner: site.owner });
  }

  const buildingPdas = activeRecords.map(({ record }) => deriveBuildingManifestPda({
    globalConfig,
    foundationId: record.foundationId,
    revision: record.activeRevision,
    programId: selectedBuildingProgramId,
  })[0]);
  const buildingAccounts = await getMultipleAccountsInfoBatched(buildingPdas);
  for (let index = 0; index < activeRecords.length; index += 1) {
    const { record, owner } = activeRecords[index];
    const account = buildingAccounts[index];
    if (!account || !account.owner.equals(selectedBuildingProgramId)) {
      throw new Error(`Guardian building ${record.foundationId}@${record.activeRevision} has no manifest PDA`);
    }
    verifyActiveBuildingManifest(account.data, record, owner);
  }
}

async function getMultipleAccountsInfoBatched(publicKeys: PublicKey[]) {
  const accounts = [];
  for (let offset = 0; offset < publicKeys.length; offset += BUILDING_RECORDS_PER_RPC) {
    const batch = publicKeys.slice(offset, offset + BUILDING_RECORDS_PER_RPC);
    accounts.push(...await conn.getMultipleAccountsInfo(batch, "confirmed"));
  }
  return accounts;
}

function verifyActiveBuildingManifest(
  dataValue: Buffer | Uint8Array,
  record: BuildingRecord,
  owner: PublicKey,
): void {
  const data = Buffer.from(dataValue);
  if (data.length !== BUILDING_MANIFEST_LEN
    || data.subarray(0, 8).toString("utf8") !== BUILDING_MANIFEST_MAGIC
    || data.readUInt8(8) !== 2
    || data.readUInt8(10) !== BUILDING_STATUS_ACTIVE
    || !new PublicKey(data.subarray(16, 48)).equals(owner)
    || !new PublicKey(data.subarray(48, 80)).equals(globalConfig)
    || data.readBigUInt64LE(80) !== record.foundationId
    || data.readUInt32LE(88) !== record.activeRevision
    || data.subarray(96, 112).toString("hex") !== record.contentHash) {
    throw new Error(`Guardian building ${record.foundationId}@${record.activeRevision} does not match its manifest PDA`);
  }
}

function decodeManifestRecords(data: Buffer, recordCount: number): BuildingRecord[] {
  const records: BuildingRecord[] = [];
  let previousFoundationId = 0n;
  const regionSpan = GUARDIAN_REGION_SIZE_CHUNKS * chunkSize;
  const regionMinX = data.readInt32LE(12) * regionSpan;
  const regionMinZ = data.readInt32LE(16) * regionSpan;
  const regionMaxX = regionMinX + regionSpan - 1;
  const regionMaxZ = regionMinZ + regionSpan - 1;
  for (let index = 0; index < recordCount; index += 1) {
    const offset = BUILDING_MANIFEST_HEADER_LEN + index * BUILDING_RECORD_LEN;
    const foundationId = data.readBigUInt64LE(offset);
    const minX = data.readInt32LE(offset + 8);
    const minZ = data.readInt32LE(offset + 12);
    const surfaceY = data.readInt16LE(offset + 16);
    const flags = data.readUInt16LE(offset + 18);
    const width = data.readUInt32LE(offset + 20);
    const depth = data.readUInt32LE(offset + 24);
    const activeRevision = data.readUInt32LE(offset + 28);
    const contentHash = data.subarray(offset + 32, offset + 48).toString("hex");
    const updatedSlot = data.readBigUInt64LE(offset + 48);
    const maxX = minX + width - 1;
    const maxZ = minZ + depth - 1;
    if (foundationId === 0n || foundationId <= previousFoundationId || flags !== 1
      || width < 2 || depth < 2 || maxX > 0x7fffffff || maxZ > 0x7fffffff
      || minX > regionMaxX || maxX < regionMinX || minZ > regionMaxZ || maxZ < regionMinZ
      || (activeRevision === 0) !== /^0+$/.test(contentHash)) {
      throw new Error(`Invalid Guardian building record at index ${index}`);
    }
    records.push({ foundationId, minX, minZ, surfaceY, flags, width, depth, activeRevision, contentHash, updatedSlot });
    previousFoundationId = foundationId;
  }
  return records;
}

function requireManifestHash(data: Buffer, recordCount: number, version: number): string {
  if (version === 3) {
    const computed = createHash("sha256")
      .update(data.subarray(BUILDING_MANIFEST_HEADER_LEN))
      .digest()
      .subarray(0, 16);
    const hash = data.subarray(32, 48).toString("hex");
    if (computed.toString("hex") !== hash) throw new Error("Guardian building manifest hash mismatch");
    return hash;
  }
  let left = 14_695_981_039_346_656_037n;
  let right = 7_809_847_782_465_536_322n;
  const prime = 1_099_511_628_211n;
  for (let index = 0; index < recordCount; index += 1) {
    const offset = BUILDING_MANIFEST_HEADER_LEN + index * BUILDING_RECORD_LEN;
    for (const byte of data.subarray(offset, offset + BUILDING_RECORD_LEN)) {
      left = BigInt.asUintN(64, (left ^ BigInt(byte)) * prime);
      right = BigInt.asUintN(64, (right ^ BigInt(byte)) * prime);
    }
    right = BigInt.asUintN(
      64,
      right ^ (left + 0x9e3779b97f4a7c15n + (right << 6n) + (right >> 2n)),
    );
  }
  const computed = Buffer.alloc(16);
  computed.writeBigUInt64LE(left, 0);
  computed.writeBigUInt64LE(right, 8);
  const hash = data.subarray(32, 48).toString("hex");
  if (computed.toString("hex") !== hash) throw new Error("Guardian building manifest hash mismatch");
  return hash;
}

function requireEndpoint(value: string | undefined): URL {
  if (!value) throw new Error("GUARDIAN_BUILDINGS_URL is required");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GUARDIAN_BUILDINGS_URL must use http or https");
  }
  return url;
}

function readInterval(value: string | undefined): number {
  const interval = Number(value ?? DEFAULT_INTERVAL_MS);
  if (!Number.isInteger(interval) || interval < 500 || interval > 60_000) {
    throw new Error("GUARDIAN_SYNC_INTERVAL_MS must be between 500 and 60000");
  }
  return interval;
}

function readChunkSize(value: string | undefined): number {
  const size = Number(value ?? DEFAULT_CHUNK_SIZE);
  if (!Number.isInteger(size) || size <= 0 || size > 1024) {
    throw new Error("GUARDIAN_CHUNK_SIZE must be between 1 and 1024");
  }
  return size;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

interface BuildingManifest {
  regionX: number;
  regionY: number;
  revision: bigint;
  recordCount: number;
  hash: string;
  records: BuildingRecord[];
}

interface BuildingRecord {
  foundationId: bigint;
  minX: number;
  minZ: number;
  surfaceY: number;
  flags: number;
  width: number;
  depth: number;
  activeRevision: number;
  contentHash: string;
  updatedSlot: bigint;
}
