import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { readZipEntries } from "./zip.ts";

/** Build a minimal single-entry zip by hand (local header + central dir + EOCD). */
function buildZip(name: string, data: Buffer, method: 0 | 8): Buffer {
  const payload = method === 8 ? deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(0, 14); // crc (unchecked by the reader)
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const localRecord = Buffer.concat([local, nameBuf, payload]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt32LE(0, 42); // local header offset
  const centralRecord = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

describe("readZipEntries", () => {
  const xml = Buffer.from("<trademark-applications-daily>".repeat(50) + "<case-file/>", "utf8");

  it("reads a deflated entry", () => {
    const entries = readZipEntries(buildZip("apc260904.xml", xml, 8));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("apc260904.xml");
    expect(entries[0]!.method).toBe(8);
    expect(entries[0]!.read().equals(xml)).toBe(true);
    // Cached: second read returns the same buffer.
    expect(entries[0]!.read()).toBe(entries[0]!.read());
  });

  it("reads a stored entry", () => {
    const entries = readZipEntries(buildZip("plain.xml", xml, 0));
    expect(entries[0]!.read().toString("utf8")).toBe(xml.toString("utf8"));
  });

  it("rejects non-zip input", () => {
    expect(() => readZipEntries(Buffer.from("not a zip at all, honestly"))).toThrow(
      /end-of-central/,
    );
  });
});
