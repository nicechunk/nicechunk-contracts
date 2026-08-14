import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "mocha";

import {
  createRegisterGuardianInstruction,
  createUpdateGuardianEndpointInstruction,
  decodeGuardianRegion,
  GUARDIAN_REGION_LEN,
  GUARDIAN_STATUS_ACTIVE,
  NICECHUNK_GUARDIAN_PROGRAM_ID,
} from "../sdk/nicechunk-guardian.ts";

describe("nicechunk guardian V1 SDK", () => {
  const owner = PublicKey.unique();
  const operator = PublicKey.unique();
  const ownerNckToken = PublicKey.unique();
  const treasuryNckToken = PublicKey.unique();

  it("uses the final Guardian program and owner-authorized registration ABI", () => {
    assert.equal(NICECHUNK_GUARDIAN_PROGRAM_ID.toBase58(), "6frJyJSirfEwsztsxijcJLe29LSaceET1wanXSFwPQyE");
    const instruction = createRegisterGuardianInstruction({
      payer: owner,
      owner,
      ownerNckToken,
      treasuryNckToken,
      operator,
      regionX: 0,
      regionY: 0,
      host: "guardian.example.com",
      port: 443,
      useTls: true,
      isGenesis: true,
    });

    assert.equal(instruction.data.readUInt8(0), 1);
    assert.equal(instruction.keys.length, 11);
    assert.equal(instruction.keys[0].pubkey.toBase58(), owner.toBase58());
    assert.equal(instruction.keys[0].isSigner, true);
    assert.equal(instruction.keys[1].pubkey.toBase58(), owner.toBase58());
    assert.equal(instruction.keys[1].isSigner, true);
    assert.equal(instruction.keys[2].pubkey.toBase58(), ownerNckToken.toBase58());
  });

  it("builds only the owner endpoint mutation and rejects invalid hosts", () => {
    const endpoint = createUpdateGuardianEndpointInstruction({
      owner,
      regionX: 0,
      regionY: 0,
      host: "guardian.example.com",
      port: 443,
      useTls: true,
    });
    assert.equal(endpoint.keys[0].pubkey.toBase58(), owner.toBase58());
    assert.equal(endpoint.keys[0].isSigner, true);
    assert.equal(endpoint.data.readUInt8(0), 5);
    assert.throws(() => createUpdateGuardianEndpointInstruction({
      owner,
      regionX: 0,
      regionY: 0,
      host: "https://guardian.example.com",
      port: 443,
      useTls: true,
    }), /must not include a URL scheme or path/);
  });

  it("decodes only the 256-byte V1 region layout", () => {
    const bytes = guardianRegionBytes({ owner, operator });
    const decoded = decodeGuardianRegion(bytes);
    assert.equal(decoded.version, 1);
    assert.equal(decoded.status, GUARDIAN_STATUS_ACTIVE);
    assert.equal(decoded.owner.toBase58(), owner.toBase58());
    assert.equal(decoded.operator.toBase58(), operator.toBase58());
    assert.equal(decoded.host, "guardian.example.com");
    assert.throws(() => decodeGuardianRegion(bytes.subarray(0, 255)), /expected 256/);
    bytes.write("BADMAGIC", 0, "utf8");
    assert.throws(() => decodeGuardianRegion(bytes), /Invalid GuardianRegion/);
  });
});

function guardianRegionBytes({ owner, operator }: { owner: PublicKey; operator: PublicKey }): Buffer {
  const data = Buffer.alloc(GUARDIAN_REGION_LEN);
  data.write("NCKGRG01", 0, "utf8");
  data.writeUInt16LE(1, 8);
  data.writeUInt8(254, 10);
  data.writeUInt8(GUARDIAN_STATUS_ACTIVE, 11);
  data.writeInt32LE(0, 12);
  data.writeInt32LE(0, 16);
  data.writeInt32LE(0, 20);
  data.writeInt32LE(0, 24);
  data.writeInt32LE(99, 28);
  data.writeInt32LE(99, 32);
  owner.toBuffer().copy(data, 36);
  operator.toBuffer().copy(data, 68);
  PublicKey.unique().toBuffer().copy(data, 100);
  const host = Buffer.from("guardian.example.com", "utf8");
  data.writeUInt8(host.length, 132);
  host.copy(data, 133);
  data.writeUInt16LE(443, 197);
  data.writeUInt8(1, 199);
  data.writeBigUInt64LE(100_000_000_000n, 200);
  data.writeBigUInt64LE(1n, 244);
  return data;
}
