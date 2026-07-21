import { PublicKey } from "@solana/web3.js";
import assert from "node:assert/strict";
import { describe, it } from "mocha";

import {
  createRegisterGuardianInstruction,
  createUpdateGuardianEndpointInstruction,
  createUpdateGuardianOperatorInstruction,
  decodeGuardianRegion,
  EMPTY_GUARDIAN_BLUEPRINT_HASH,
  GUARDIAN_GOVERNANCE_WALLET,
  GUARDIAN_REGION_LEN,
  GUARDIAN_STATUS_ACTIVE,
  NICECHUNK_GUARDIAN_PROGRAM_ID,
} from "../sdk/nicechunk-guardian.ts";

describe("nicechunk guardian V2 SDK", () => {
  const operator = PublicKey.unique();
  const operatorNckToken = PublicKey.unique();
  const treasuryNckToken = PublicKey.unique();

  it("uses the independently governed Guardian V2 program", () => {
    assert.equal(NICECHUNK_GUARDIAN_PROGRAM_ID.toBase58(), "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK");
    assert.equal(GUARDIAN_GOVERNANCE_WALLET.toBase58(), "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud");
  });

  it("requires independent governance authorization for genesis registration", () => {
    assert.throws(() => createRegisterGuardianInstruction({
      payer: GUARDIAN_GOVERNANCE_WALLET,
      operator,
      operatorNckToken,
      treasuryNckToken,
      regionX: 0,
      regionY: 0,
      host: "guardian.example.com",
      port: 443,
      useTls: true,
      isGenesis: true,
    }), /governance authority/);

    const instruction = createRegisterGuardianInstruction({
      payer: GUARDIAN_GOVERNANCE_WALLET,
      operator,
      operatorNckToken,
      treasuryNckToken,
      regionX: 0,
      regionY: 0,
      host: "guardian.example.com",
      port: 443,
      useTls: true,
      isGenesis: true,
      genesisAuthority: GUARDIAN_GOVERNANCE_WALLET,
    });

    assert.equal(instruction.keys.length, 12);
    assert.deepEqual(
      instruction.keys.filter(({ isSigner }) => isSigner).map(({ pubkey }) => pubkey.toBase58()),
      [GUARDIAN_GOVERNANCE_WALLET, operator, GUARDIAN_GOVERNANCE_WALLET].map((key) => key.toBase58()),
    );
    assert.equal(instruction.keys.at(-1)?.pubkey.toBase58(), GUARDIAN_GOVERNANCE_WALLET.toBase58());
  });

  it("exposes only the operator endpoint mutation path", () => {
    const endpoint = createUpdateGuardianEndpointInstruction({
      authority: operator,
      regionX: 0,
      regionY: 0,
      host: "guardian.example.com",
      port: 443,
      useTls: true,
    });
    assert.equal(endpoint.keys[0].pubkey.toBase58(), operator.toBase58());
    assert.equal(endpoint.keys[0].isSigner, true);
    assert.throws(() => createUpdateGuardianEndpointInstruction({
      authority: operator,
      regionX: 0,
      regionY: 0,
      host: "https://guardian.example.com",
      port: 443,
      useTls: true,
    }), /without a URL scheme/);

    const replacement = PublicKey.unique();
    const recovery = createUpdateGuardianOperatorInstruction({
      treasury: GUARDIAN_GOVERNANCE_WALLET,
      newOperator: replacement,
      regionX: 0,
      regionY: 0,
    });
    assert.equal(recovery.keys[0].pubkey.toBase58(), GUARDIAN_GOVERNANCE_WALLET.toBase58());
    assert.equal(recovery.keys[0].isSigner, true);
    assert.equal(recovery.data.readUInt8(0), 8);
  });

  it("decodes only the 288-byte V2 region layout", () => {
    const bytes = guardianRegionBytes({ operator });
    const decoded = decodeGuardianRegion(bytes);
    assert.equal(decoded.version, 2);
    assert.equal(decoded.status, GUARDIAN_STATUS_ACTIVE);
    assert.equal(decoded.operator.toBase58(), operator.toBase58());
    assert.equal(decoded.host, "guardian.example.com");
    assert.equal(decoded.blueprintHash, EMPTY_GUARDIAN_BLUEPRINT_HASH);
    assert.throws(() => decodeGuardianRegion(bytes.subarray(0, 256)), /expected 288/);
    PublicKey.unique().toBuffer().copy(bytes, 36);
    assert.throws(() => decodeGuardianRegion(bytes), /Invalid GuardianRegion/);
  });
});

function guardianRegionBytes({ operator }: { operator: PublicKey }): Buffer {
  const data = Buffer.alloc(GUARDIAN_REGION_LEN);
  data.write("NCKGRG01", 0, "utf8");
  data.writeUInt16LE(2, 8);
  data.writeUInt8(254, 10);
  data.writeUInt8(GUARDIAN_STATUS_ACTIVE, 11);
  data.writeInt32LE(0, 12);
  data.writeInt32LE(0, 16);
  data.writeInt32LE(0, 20);
  data.writeInt32LE(0, 24);
  data.writeInt32LE(99, 28);
  data.writeInt32LE(99, 32);
  GUARDIAN_GOVERNANCE_WALLET.toBuffer().copy(data, 36);
  operator.toBuffer().copy(data, 68);
  PublicKey.unique().toBuffer().copy(data, 100);
  const host = Buffer.from("guardian.example.com", "utf8");
  data.writeUInt8(host.length, 132);
  host.copy(data, 133);
  data.writeUInt16LE(443, 197);
  data.writeUInt8(1, 199);
  data.writeBigUInt64LE(100_000_000_000n, 200);
  data.writeBigUInt64LE(1n, 244);
  Buffer.from(EMPTY_GUARDIAN_BLUEPRINT_HASH, "hex").copy(data, 256);
  data.writeBigUInt64LE(1n, 272);
  data.writeUInt32LE(1, 280);
  return data;
}
