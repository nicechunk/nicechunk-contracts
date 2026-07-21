import {
  PublicKey,
  TransactionInstruction,
  type PublicKeyInitData,
} from "@solana/web3.js";
import { Buffer } from "node:buffer";
import {
  deriveGlobalConfigPda,
  NICECHUNK_CORE_PROGRAM_ID,
} from "./nicechunk-core.ts";

export const NICECHUNK_BUILDING_PROGRAM_ID = new PublicKey(
  "39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx",
);
export const NICECHUNK_GUARDIAN_PROGRAM_ID = new PublicKey(
  "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK",
);
export const GUARDIAN_TREASURY_WALLET = new PublicKey(
  "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud",
);
export const GUARDIAN_BLUEPRINT_PUBLISHER_WALLET = new PublicKey(
  "2nRdri2u7VeQtHP7y6WsFq51vWDcXBuHBB5UahZJ9K4p",
);
export const GUARDIAN_BLUEPRINT_AUTHORITY_SEED = "guardian-blueprint";
export const GUARDIAN_REGION_SEED = "guardian-region";
export const BUILD_SITE_SEED = "build-site-v1";
export const BUILD_SITE_MAGIC = "NCKSITE1";
export const LEGACY_BUILD_SITE_VERSION = 1;
export const LEGACY_BUILD_SITE_LEN = 136;
export const BUILD_SITE_VERSION = 2;
export const BUILD_SITE_LEN = 160;
export const BUILD_SITE_STATUS_INDEXING = 0;
export const BUILD_SITE_STATUS_ACTIVE = 1;
export const BUILD_SITE_STATUS_EDIT_INDEXING = 2;
export const BUILD_SITE_STATUS_EDIT_CLEANING = 3;
export const BUILDING_MANIFEST_SEED = "building-v2";
export const BUILDING_MANIFEST_MAGIC = "NCKBLD02";
export const BUILDING_MANIFEST_VERSION = 2;
export const BUILDING_MANIFEST_LEN = 160;
export const BUILDING_STATUS_UPLOADING = 0;
export const BUILDING_STATUS_ACTIVE = 1;

const VALID_BUILD_SITE_STATUSES = new Set([
  BUILD_SITE_STATUS_INDEXING,
  BUILD_SITE_STATUS_ACTIVE,
  BUILD_SITE_STATUS_EDIT_INDEXING,
  BUILD_SITE_STATUS_EDIT_CLEANING,
]);

export interface DeriveBuildSitePdaInput {
  globalConfig: PublicKeyInitData;
  foundationId: bigint | number | string;
  programId?: PublicKeyInitData;
}

export interface DeriveBuildingManifestPdaInput extends DeriveBuildSitePdaInput {
  revision: number;
}

export interface DecodedBuildSite {
  version: number;
  status: number;
  bump: number;
  owner: PublicKey;
  globalConfig: PublicKey;
  foundationId: bigint;
  minX: number;
  minZ: number;
  surfaceY: number;
  width: number;
  depth: number;
  activeRevision: number;
  pendingRevision: number;
  createdSlot: bigint;
  updatedSlot: bigint;
  registeredChunks: bigint;
  totalChunks: bigint;
  stagedWidth: number;
  stagedDepth: number;
}

export interface DecodedBuildingManifest {
  version: number;
  status: number;
  bump: number;
  quarterTurns: number;
  shardCount: number;
  uploadedBitmap: number;
  owner: PublicKey;
  globalConfig: PublicKey;
  foundationId: bigint;
  revision: number;
  payloadLen: number;
  expectedHash: Uint8Array;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  createdSlot: bigint;
  updatedSlot: bigint;
  offsetX: number;
  offsetZ: number;
}

export function deriveBuildSitePda({
  globalConfig,
  foundationId,
  programId = NICECHUNK_BUILDING_PROGRAM_ID,
}: DeriveBuildSitePdaInput): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(BUILD_SITE_SEED),
      new PublicKey(globalConfig).toBuffer(),
      u64Buffer(foundationId, "foundationId"),
    ],
    new PublicKey(programId),
  );
}

export function deriveBuildingManifestPda({
  globalConfig,
  foundationId,
  revision,
  programId = NICECHUNK_BUILDING_PROGRAM_ID,
}: DeriveBuildingManifestPdaInput): [PublicKey, number] {
  if (!Number.isInteger(revision) || revision <= 0 || revision > 0xffff_ffff) {
    throw new Error("revision must be a positive u32");
  }
  const revisionBytes = Buffer.alloc(4);
  revisionBytes.writeUInt32LE(revision);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(BUILDING_MANIFEST_SEED),
      new PublicKey(globalConfig).toBuffer(),
      u64Buffer(foundationId, "foundationId"),
      revisionBytes,
    ],
    new PublicKey(programId),
  );
}

export function deriveGuardianBlueprintAuthorityPda({
  globalConfig,
  programId = NICECHUNK_BUILDING_PROGRAM_ID,
}: {
  globalConfig: PublicKeyInitData;
  programId?: PublicKeyInitData;
}): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(GUARDIAN_BLUEPRINT_AUTHORITY_SEED),
      new PublicKey(globalConfig).toBuffer(),
    ],
    new PublicKey(programId),
  );
}

export function createPublishGuardianBlueprintInstruction({
  publisher,
  regionX,
  regionY,
  blueprintHash,
  blueprintRevision,
  blueprintRecordCount,
  buildingProgramId = NICECHUNK_BUILDING_PROGRAM_ID,
  guardianProgramId = NICECHUNK_GUARDIAN_PROGRAM_ID,
  coreProgramId = NICECHUNK_CORE_PROGRAM_ID,
}: {
  publisher: PublicKey;
  regionX: number;
  regionY: number;
  blueprintHash: string | Uint8Array;
  blueprintRevision: bigint | number | string;
  blueprintRecordCount: number;
  buildingProgramId?: PublicKey;
  guardianProgramId?: PublicKey;
  coreProgramId?: PublicKey;
}): TransactionInstruction {
  assertI32(regionX, "regionX");
  assertI32(regionY, "regionY");
  const revision = BigInt(blueprintRevision);
  if (revision < 0n || revision > 0xffff_ffff_ffff_ffffn) {
    throw new Error("Guardian blueprint revision must fit in a uint64");
  }
  if (!Number.isInteger(blueprintRecordCount)
    || blueprintRecordCount < 0
    || blueprintRecordCount > 0xffff_ffff) {
    throw new Error("Guardian blueprint record count must fit in a uint32");
  }

  const [globalConfig] = deriveGlobalConfigPda(coreProgramId);
  const [blueprintAuthority] = deriveGuardianBlueprintAuthorityPda({
    globalConfig,
    programId: buildingProgramId,
  });
  const regionXBytes = i32Buffer(regionX);
  const regionYBytes = i32Buffer(regionY);
  const [guardianRegion] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(GUARDIAN_REGION_SEED),
      globalConfig.toBuffer(),
      regionXBytes,
      regionYBytes,
    ],
    guardianProgramId,
  );
  const data = Buffer.alloc(37);
  data.writeUInt8(8, 0);
  regionXBytes.copy(data, 1);
  regionYBytes.copy(data, 5);
  guardianBlueprintHashBytes(blueprintHash).copy(data, 9);
  data.writeBigUInt64LE(revision, 25);
  data.writeUInt32LE(blueprintRecordCount, 33);
  return new TransactionInstruction({
    programId: buildingProgramId,
    keys: [
      { pubkey: publisher, isSigner: true, isWritable: false },
      { pubkey: blueprintAuthority, isSigner: false, isWritable: false },
      { pubkey: guardianRegion, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
      { pubkey: guardianProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function decodeBuildSite(dataValue: Buffer | Uint8Array): DecodedBuildSite {
  const data = Buffer.from(dataValue);
  if (data.length !== BUILD_SITE_LEN
    || data.subarray(0, 8).toString("utf8") !== BUILD_SITE_MAGIC
    || data.readUInt8(8) !== BUILD_SITE_VERSION
    || !VALID_BUILD_SITE_STATUSES.has(data.readUInt8(10))) {
    throw new Error("Invalid Building Program BuildSite account");
  }
  const status = data.readUInt8(10);
  const foundationId = data.readBigUInt64LE(80);
  const minX = data.readInt32LE(88);
  const minZ = data.readInt32LE(92);
  const surfaceY = data.readInt16LE(96);
  const width = data.readUInt32LE(100);
  const depth = data.readUInt32LE(104);
  const activeRevision = data.readUInt32LE(116);
  const pendingRevision = data.readUInt32LE(120);
  const registeredChunks = data.readBigUInt64LE(132);
  const totalChunks = data.readBigUInt64LE(140);
  const stagedWidth = data.readUInt32LE(148);
  const stagedDepth = data.readUInt32LE(152);
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  if (foundationId === 0n
    || width < 2
    || depth < 2
    || maxX < -0x8000_0000
    || maxX > 0x7fff_ffff
    || maxZ < -0x8000_0000
    || maxZ > 0x7fff_ffff
    || registeredChunks > totalChunks
    || (pendingRevision !== 0 && pendingRevision !== activeRevision + 1)
    || (status === BUILD_SITE_STATUS_ACTIVE && (registeredChunks !== totalChunks || stagedWidth !== 0 || stagedDepth !== 0))
    || (status !== BUILD_SITE_STATUS_ACTIVE && registeredChunks === totalChunks)
    || (status >= BUILD_SITE_STATUS_EDIT_INDEXING && (stagedWidth < 2 || stagedDepth < 2))) {
    throw new Error("Invalid Building Program BuildSite state");
  }
  return {
    version: BUILD_SITE_VERSION,
    status,
    bump: data.readUInt8(9),
    owner: new PublicKey(data.subarray(16, 48)),
    globalConfig: new PublicKey(data.subarray(48, 80)),
    foundationId,
    minX,
    minZ,
    surfaceY,
    width,
    depth,
    activeRevision,
    pendingRevision,
    createdSlot: data.readBigUInt64LE(108),
    updatedSlot: data.readBigUInt64LE(124),
    registeredChunks,
    totalChunks,
    stagedWidth,
    stagedDepth,
  };
}

export function decodeLegacyBuildSite(dataValue: Buffer | Uint8Array): DecodedBuildSite {
  const data = Buffer.from(dataValue);
  if (data.length !== LEGACY_BUILD_SITE_LEN
    || data.subarray(0, 8).toString("utf8") !== BUILD_SITE_MAGIC
    || data.readUInt8(8) !== LEGACY_BUILD_SITE_VERSION
    || data.readUInt8(10) !== BUILD_SITE_STATUS_ACTIVE) {
    throw new Error("Invalid legacy Chunk Program BuildSite account");
  }
  const foundationId = data.readBigUInt64LE(80);
  const minX = data.readInt32LE(88);
  const minZ = data.readInt32LE(92);
  const surfaceY = data.readInt16LE(96);
  const width = data.readUInt32LE(100);
  const depth = data.readUInt32LE(104);
  const activeRevision = data.readUInt32LE(116);
  const pendingRevision = data.readUInt32LE(120);
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  if (foundationId === 0n
    || width < 2
    || depth < 2
    || maxX < -0x8000_0000
    || maxX > 0x7fff_ffff
    || maxZ < -0x8000_0000
    || maxZ > 0x7fff_ffff
    || activeRevision !== 0
    || pendingRevision !== 0) {
    throw new Error("Legacy BuildSite is not eligible for direct migration");
  }
  return {
    version: LEGACY_BUILD_SITE_VERSION,
    status: BUILD_SITE_STATUS_ACTIVE,
    bump: data.readUInt8(9),
    owner: new PublicKey(data.subarray(16, 48)),
    globalConfig: new PublicKey(data.subarray(48, 80)),
    foundationId,
    minX,
    minZ,
    surfaceY,
    width,
    depth,
    activeRevision,
    pendingRevision,
    createdSlot: data.readBigUInt64LE(108),
    updatedSlot: data.readBigUInt64LE(124),
    registeredChunks: 0n,
    totalChunks: 0n,
    stagedWidth: 0,
    stagedDepth: 0,
  };
}

export function decodeBuildingManifest(dataValue: Buffer | Uint8Array): DecodedBuildingManifest {
  const data = Buffer.from(dataValue);
  if (data.length !== BUILDING_MANIFEST_LEN
    || data.subarray(0, 8).toString("utf8") !== BUILDING_MANIFEST_MAGIC
    || data.readUInt8(8) !== BUILDING_MANIFEST_VERSION) {
    throw new Error("Invalid Building Program BuildingManifest account");
  }
  const status = data.readUInt8(10);
  const quarterTurns = data.readUInt8(11);
  const shardCount = data.readUInt8(12);
  const uploadedBitmap = data.readUInt16LE(14);
  const foundationId = data.readBigUInt64LE(80);
  const revision = data.readUInt32LE(88);
  const payloadLen = data.readUInt32LE(92);
  const sizeX = data.readUInt16LE(128);
  const sizeY = data.readUInt16LE(130);
  const sizeZ = data.readUInt16LE(132);
  const expectedShardCount = Math.ceil(payloadLen / 8_192);
  const completeBitmap = (1 << expectedShardCount) - 1;
  const hasDimensions = sizeX > 0 && sizeY > 0 && sizeZ > 0;
  if (status > BUILDING_STATUS_ACTIVE
    || quarterTurns > 3
    || payloadLen < 1
    || payloadLen > 65_535
    || shardCount !== expectedShardCount
    || (uploadedBitmap & ~completeBitmap) !== 0
    || foundationId === 0n
    || revision === 0
    || sizeX > 256
    || sizeY > 256
    || sizeZ > 256
    || (status === BUILDING_STATUS_UPLOADING && hasDimensions)
    || (status === BUILDING_STATUS_ACTIVE && !hasDimensions)) {
    throw new Error("Invalid Building Program BuildingManifest state");
  }
  return {
    version: BUILDING_MANIFEST_VERSION,
    status,
    bump: data.readUInt8(9),
    quarterTurns,
    shardCount,
    uploadedBitmap,
    owner: new PublicKey(data.subarray(16, 48)),
    globalConfig: new PublicKey(data.subarray(48, 80)),
    foundationId,
    revision,
    payloadLen,
    expectedHash: data.subarray(96, 128),
    sizeX,
    sizeY,
    sizeZ,
    createdSlot: data.readBigUInt64LE(136),
    updatedSlot: data.readBigUInt64LE(144),
    offsetX: data.readInt32LE(152),
    offsetZ: data.readInt32LE(156),
  };
}

function u64Buffer(value: bigint | number | string, name: string): Buffer {
  const normalized = BigInt(value);
  if (normalized <= 0n || normalized > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${name} must be a positive u64`);
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(normalized);
  return bytes;
}

function guardianBlueprintHashBytes(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 16) throw new Error("Guardian blueprint hash must be 16 bytes");
    return Buffer.from(value);
  }
  const hex = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Guardian blueprint hash must be 16-byte hex");
  return Buffer.from(hex, "hex");
}

function assertI32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error(`${name} must fit in a signed int32`);
  }
}

function i32Buffer(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
}
