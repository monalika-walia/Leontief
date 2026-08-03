import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { linkChallenge, sep53Digest, verifySep53 } from "./sep53.js";

// Verbatim from SEP-0053 § Test cases (read 2026-08-02). If a dependency ever
// changes what gets hashed or signed, these fail before anything ships.
const SEED = "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW";
const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const VECTORS: { name: string; message: Buffer; base64: string; hex: string }[] = [
  {
    name: "ASCII",
    message: Buffer.from("Hello, World!", "utf8"),
    base64:
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
    hex: "7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04",
  },
  {
    name: "Japanese",
    message: Buffer.from("こんにちは、世界！", "utf8"),
    base64:
      "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==",
    hex: "083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604",
  },
  {
    name: "binary",
    message: Buffer.from("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=", "base64"),
    base64:
      "VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==",
    hex: "540d7eee179f370bf634a49c1fa9fe4a58e3d7990b0207be336c04edfcc539ff8bd0c31bb2c0359b07c9651cb2ae104e4504657b5d17d43c69c7e50e23811b0d",
  },
];

describe("SEP-53 spec vectors", () => {
  const kp = Keypair.fromSecret(SEED);
  it("the spec's seed derives the spec's address", () => {
    expect(kp.publicKey()).toBe(ADDRESS);
  });

  for (const v of VECTORS) {
    it(`${v.name}: our digest reproduces the published signature`, () => {
      expect(kp.sign(sep53Digest(v.message)).toString("base64")).toBe(v.base64);
    });
    it(`${v.name}: verifies from base64 and from hex`, () => {
      const msg = v.message.toString("utf8");
      // The binary vector is not valid UTF-8 text; check it through the digest.
      if (v.name === "binary") {
        expect(
          Keypair.fromPublicKey(ADDRESS).verify(
            sep53Digest(v.message),
            Buffer.from(v.base64, "base64"),
          ),
        ).toBe(true);
        return;
      }
      expect(verifySep53(ADDRESS, msg, v.base64)).toBe(true);
      expect(verifySep53(ADDRESS, msg, v.hex)).toBe(true);
    });
  }
});

describe("verifySep53 rejects", () => {
  const kp = Keypair.fromSecret(SEED);
  const msg = "Hello, World!";
  const good = kp.sign(sep53Digest(msg)).toString("base64");

  it("a signature over the raw message (no SEP-53 prefix/hash)", () => {
    const raw = kp.sign(Buffer.from(msg, "utf8")).toString("base64");
    expect(verifySep53(ADDRESS, msg, raw)).toBe(false);
  });
  it("a valid signature replayed onto a different message", () => {
    expect(verifySep53(ADDRESS, "Goodbye, World!", good)).toBe(false);
  });
  it("a valid signature claimed for a different address", () => {
    expect(verifySep53(Keypair.random().publicKey(), msg, good)).toBe(false);
  });
  it("malformed input instead of throwing", () => {
    expect(verifySep53(ADDRESS, msg, "not-base64!!")).toBe(false);
    expect(verifySep53(ADDRESS, msg, "")).toBe(false);
    expect(verifySep53("not-an-address", msg, good)).toBe(false);
    expect(verifySep53(ADDRESS, msg, Buffer.alloc(63).toString("base64"))).toBe(false);
  });
});

describe("linkChallenge", () => {
  it("is derived only from code + address, so the client picks no text", () => {
    const c = linkChallenge("ABCD1234", ADDRESS);
    expect(c).toContain("code: ABCD1234");
    expect(c).toContain(`address: ${ADDRESS}`);
    expect(c).toContain("authorizes nothing");
    expect(linkChallenge("ABCD1234", ADDRESS)).toBe(c); // deterministic
  });
  it("differs per code and per address — no cross-binding replay", () => {
    expect(linkChallenge("AAAA1111", ADDRESS)).not.toBe(linkChallenge("BBBB2222", ADDRESS));
    expect(linkChallenge("AAAA1111", ADDRESS)).not.toBe(
      linkChallenge("AAAA1111", Keypair.random().publicKey()),
    );
  });
});
