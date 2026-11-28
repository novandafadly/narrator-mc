import { describe, expect, test } from "@jest/globals";
import {
  buildSsml,
  escapeXml,
  generateSecMsGec,
  buildEdgeTtsWsUrl,
} from "../src/features/edgeTTS/edgeTtsProtocol";

describe("Edge TTS protocol helpers (id-ID-GadisNeural)", () => {
  test("escapeXml escapes XML special characters safely", () => {
    expect(escapeXml(`A & B < "C" > 'D'`)).toBe(
      "A &amp; B &lt; &quot;C&quot; &gt; &apos;D&apos;",
    );
  });

  test("buildSsml builds valid Indonesian SSML and sanitizes invalid voice/rate", () => {
    const ssml = buildSsml("Halo Bapak & Ibu!", "id-ID-GadisNeural");
    expect(ssml).toContain("xml:lang='id-ID'");
    expect(ssml).toContain("voice name='id-ID-GadisNeural'");
    expect(ssml).toContain("Halo Bapak &amp; Ibu!");

    const fallback = buildSsml("Tes", "bad<voice>", "invalid", "bad");
    expect(fallback).toContain("voice name='id-ID-GadisNeural'");
    expect(fallback).toContain("rate='+0%'");
    expect(fallback).toContain("pitch='+0Hz'");
  });

  test("generateSecMsGec returns deterministic 64-char uppercase hex within 5-min window", () => {
    const baseMs = 1_700_000_100_000;
    const t1 = generateSecMsGec(baseMs);
    const t2 = generateSecMsGec(baseMs + 30_000);
    expect(t1).toMatch(/^[0-9A-F]{64}$/);
    expect(t1).toBe(t2);

    const url = buildEdgeTtsWsUrl("abc123", baseMs);
    expect(url).toContain("TrustedClientToken=");
    expect(url).toContain("ConnectionId=abc123");
    expect(url).toContain(`Sec-MS-GEC=${t1}`);
  });
});
