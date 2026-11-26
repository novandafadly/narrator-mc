import { describe, expect, test } from "@jest/globals";
import { hedgedStart } from "../src/features/chat/hedge";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// kandidat yang selesai setelah ms, atau gagal; menghormati abort
function candidate(name: string, ms: number, opts: { fail?: boolean; log?: string[] } = {}) {
  return (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      opts.log?.push(`start:${name}`);
      const t = setTimeout(() => {
        if (opts.fail) reject(new Error(`${name} failed`));
        else resolve(name);
      }, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        opts.log?.push(`abort:${name}`);
        reject(new Error("aborted"));
      });
    });
}

describe("hedgedStart", () => {
  test("kandidat pertama cepat menang, kandidat kedua tidak pernah dijalankan", async () => {
    const log: string[] = [];
    const r = await hedgedStart([candidate("A", 10, { log }), candidate("B", 10, { log })], 200);
    expect(r).toEqual({ value: "A", index: 0 });
    await sleep(300);
    expect(log).toEqual(["start:A"]);
  });

  test("kandidat pertama gagal: kandidat kedua langsung jalan tanpa menunggu delay", async () => {
    const t0 = Date.now();
    const r = await hedgedStart([candidate("A", 5, { fail: true }), candidate("B", 20)], 5000);
    expect(r.value).toBe("B");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("kandidat pertama lambat: kandidat kedua jalan setelah delay, menang, dan yang pertama dibatalkan", async () => {
    const log: string[] = [];
    const r = await hedgedStart([candidate("A", 1000, { log }), candidate("B", 20, { log })], 100);
    expect(r).toEqual({ value: "B", index: 1 });
    expect(log).toEqual(["start:A", "start:B", "abort:A"]);
  });

  test("keduanya gagal: ditolak dengan pesan gabungan", async () => {
    await expect(
      hedgedStart([candidate("A", 5, { fail: true }), candidate("B", 5, { fail: true })], 1000),
    ).rejects.toThrow("A failed | B failed");
  });

  test("kandidat kedua yang dimulai belakangan menang jika selesai lebih dulu", async () => {
    const r = await hedgedStart([candidate("A", 80), candidate("B", 10)], 30);
    expect(r.index).toBe(1);
  });

  test("tanpa kandidat: ditolak", async () => {
    await expect(hedgedStart([], 10)).rejects.toThrow("no starters");
  });
});
