import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "mocha";

import {
  BUILD_SITE_LEN,
  BUILD_SITE_MAGIC,
  BUILD_SITE_STATUS_ACTIVE,
  BUILD_SITE_STATUS_EDIT_INDEXING,
  BUILD_SITE_VERSION,
  BUILDING_MANIFEST_LEN,
  BUILDING_MANIFEST_MAGIC,
  BUILDING_MANIFEST_VERSION,
  BUILDING_STATUS_ACTIVE,
  createPublishGuardianBlueprintInstruction,
  decodeBuildingManifest,
  decodeBuildSite,
  decodeLegacyBuildSite,
  deriveBuildingManifestPda,
  deriveBuildSitePda,
  deriveGuardianBlueprintAuthorityPda,
  GUARDIAN_BLUEPRINT_PUBLISHER_WALLET,
  GUARDIAN_TREASURY_WALLET,
  NICECHUNK_BUILDING_PROGRAM_ID,
} from "../sdk/nicechunk-building.ts";

describe("nicechunk building SDK", () => {
  it("derives Building Program PDAs independently from Chunk", () => {
    const globalConfig = new PublicKey("4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM");
    const [site] = deriveBuildSitePda({ globalConfig, foundationId: 42n });
    const [manifest] = deriveBuildingManifestPda({ globalConfig, foundationId: 42n, revision: 3 });

    assert.notEqual(site.toBase58(), manifest.toBase58());
    assert.equal(NICECHUNK_BUILDING_PROGRAM_ID.toBase58(), "39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");
  });

  it("routes Guardian blueprint writes through the Building Program PDA", () => {
    const instruction = createPublishGuardianBlueprintInstruction({
      publisher: GUARDIAN_BLUEPRINT_PUBLISHER_WALLET,
      regionX: -2,
      regionY: 3,
      blueprintHash: "25232284e49cf2cb4201bb072e27626c",
      blueprintRevision: 7n,
      blueprintRecordCount: 4,
    });
    const globalConfig = instruction.keys[3].pubkey;
    const [authority] = deriveGuardianBlueprintAuthorityPda({ globalConfig });

    assert.equal(instruction.programId.toBase58(), NICECHUNK_BUILDING_PROGRAM_ID.toBase58());
    assert.equal(instruction.data.readUInt8(0), 8);
    assert.equal(instruction.data.readInt32LE(1), -2);
    assert.equal(instruction.data.readInt32LE(5), 3);
    assert.equal(instruction.keys.length, 5);
    assert.equal(instruction.keys[0].pubkey.toBase58(), GUARDIAN_BLUEPRINT_PUBLISHER_WALLET.toBase58());
    assert.equal(instruction.keys[0].isSigner, true);
    assert.equal(instruction.keys[1].pubkey.toBase58(), authority.toBase58());
    assert.equal(instruction.keys[1].isSigner, false);
    assert.equal(GUARDIAN_TREASURY_WALLET.toBase58(), "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud");
  });

  it("decodes active and resumable resize BuildSite V2 state", () => {
    const active = buildSiteBytes({ status: BUILD_SITE_STATUS_ACTIVE, registered: 1n, total: 1n });
    const activeSite = decodeBuildSite(active);
    assert.equal(activeSite.foundationId, 42n);
    assert.equal(activeSite.width, 2);
    assert.equal(activeSite.depth, 2);
    assert.equal(activeSite.updatedSlot, 12n);

    const editing = buildSiteBytes({
      status: BUILD_SITE_STATUS_EDIT_INDEXING,
      registered: 2n,
      total: 6n,
      stagedWidth: 33,
      stagedDepth: 17,
    });
    const editSite = decodeBuildSite(editing);
    assert.equal(editSite.status, BUILD_SITE_STATUS_EDIT_INDEXING);
    assert.equal(editSite.registeredChunks, 2n);
    assert.equal(editSite.totalChunks, 6n);
    assert.equal(editSite.stagedWidth, 33);
    assert.equal(editSite.stagedDepth, 17);
  });

  it("decodes the deployed 136-byte legacy BuildSite for migration", () => {
    const legacy = Buffer.alloc(136);
    legacy.write(BUILD_SITE_MAGIC, 0, "utf8");
    legacy.writeUInt8(1, 8);
    legacy.writeUInt8(BUILD_SITE_STATUS_ACTIVE, 10);
    PublicKey.unique().toBuffer().copy(legacy, 16);
    PublicKey.unique().toBuffer().copy(legacy, 48);
    legacy.writeBigUInt64LE(12_065_219_072_965_175_186n, 80);
    legacy.writeInt32LE(748, 88);
    legacy.writeInt32LE(781, 92);
    legacy.writeInt16LE(136, 96);
    legacy.writeUInt32LE(12, 100);
    legacy.writeUInt32LE(8, 104);
    legacy.writeBigUInt64LE(475_380_541n, 108);
    legacy.writeBigUInt64LE(475_380_541n, 124);

    const site = decodeLegacyBuildSite(legacy);

    assert.equal(site.foundationId, 12_065_219_072_965_175_186n);
    assert.equal(site.minX, 748);
    assert.equal(site.minZ, 781);
    assert.equal(site.surfaceY, 136);
    assert.equal(site.width, 12);
    assert.equal(site.depth, 8);
  });

  it("decodes backward-compatible and shifted building placements", () => {
    const data = buildingManifestBytes();
    const centered = decodeBuildingManifest(data);
    assert.equal(centered.offsetX, 0);
    assert.equal(centered.offsetZ, 0);

    data.writeInt32LE(-2, 152);
    data.writeInt32LE(3, 156);
    const shifted = decodeBuildingManifest(data);
    assert.equal(shifted.offsetX, -2);
    assert.equal(shifted.offsetZ, 3);
  });
});

function buildingManifestBytes(): Buffer {
  const data = Buffer.alloc(BUILDING_MANIFEST_LEN);
  data.write(BUILDING_MANIFEST_MAGIC, 0, "utf8");
  data.writeUInt8(BUILDING_MANIFEST_VERSION, 8);
  data.writeUInt8(1, 9);
  data.writeUInt8(BUILDING_STATUS_ACTIVE, 10);
  data.writeUInt8(1, 11);
  data.writeUInt8(1, 12);
  data.writeUInt16LE(1, 14);
  PublicKey.unique().toBuffer().copy(data, 16);
  PublicKey.unique().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(42n, 80);
  data.writeUInt32LE(3, 88);
  data.writeUInt32LE(13, 92);
  data.fill(5, 96, 128);
  data.writeUInt16LE(4, 128);
  data.writeUInt16LE(5, 130);
  data.writeUInt16LE(6, 132);
  data.writeBigUInt64LE(11n, 136);
  data.writeBigUInt64LE(12n, 144);
  return data;
}

function buildSiteBytes({
  status,
  registered,
  total,
  stagedWidth = 0,
  stagedDepth = 0,
}: {
  status: number;
  registered: bigint;
  total: bigint;
  stagedWidth?: number;
  stagedDepth?: number;
}): Buffer {
  const data = Buffer.alloc(BUILD_SITE_LEN);
  data.write(BUILD_SITE_MAGIC, 0, "utf8");
  data.writeUInt8(BUILD_SITE_VERSION, 8);
  data.writeUInt8(1, 9);
  data.writeUInt8(status, 10);
  PublicKey.unique().toBuffer().copy(data, 16);
  PublicKey.unique().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(42n, 80);
  data.writeInt32LE(0, 88);
  data.writeInt32LE(0, 92);
  data.writeInt16LE(10, 96);
  data.writeUInt32LE(2, 100);
  data.writeUInt32LE(2, 104);
  data.writeBigUInt64LE(11n, 108);
  data.writeUInt32LE(0, 116);
  data.writeUInt32LE(0, 120);
  data.writeBigUInt64LE(12n, 124);
  data.writeBigUInt64LE(registered, 132);
  data.writeBigUInt64LE(total, 140);
  data.writeUInt32LE(stagedWidth, 148);
  data.writeUInt32LE(stagedDepth, 152);
  return data;
}
