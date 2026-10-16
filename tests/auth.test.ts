import { describe, expect, it } from "vitest";
import { hashPin, signToken, timingSafeEqual, verifyPin, verifyToken, newSecret } from "../src/worker/lib/auth";

describe("PIN hashing", () => {
  it("hashes in the documented format and verifies", async () => {
    const stored = await hashPin("123456");
    expect(stored).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPin("123456", stored)).toBe(true);
    expect(await verifyPin("654321", stored)).toBe(false);
  });

  it("uses a random salt", async () => {
    expect(await hashPin("123456", 1000)).not.toBe(await hashPin("123456", 1000));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPin("123456", "garbage")).toBe(false);
    expect(await verifyPin("123456", "pbkdf2$abc$x$y")).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and verifies", async () => {
    const secret = newSecret();
    const token = await signToken(secret);
    expect(await verifyToken(token, secret)).toBe(true);
  });

  it("rejects a different secret, tampering and expiry", async () => {
    const secret = newSecret();
    const token = await signToken(secret, 60);
    expect(await verifyToken(token, newSecret())).toBe(false);
    const [exp, nonce, sig] = token.split(".");
    expect(await verifyToken(`${Number(exp) + 1000}.${nonce}.${sig}`, secret)).toBe(false);
    expect(await verifyToken(token, secret, Date.now() + 61_000)).toBe(false);
    expect(await verifyToken("a.b", secret)).toBe(false);
  });

  it("timingSafeEqual compares bytes", () => {
    const e = new TextEncoder();
    expect(timingSafeEqual(e.encode("abc"), e.encode("abc"))).toBe(true);
    expect(timingSafeEqual(e.encode("abc"), e.encode("abd"))).toBe(false);
    expect(timingSafeEqual(e.encode("abc"), e.encode("abcd"))).toBe(false);
  });
});
