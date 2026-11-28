/**
 * Zero-network browser Web Speech Synthesis fallback (lang = "id-ID").
 * Used when `tts_backend === "browser_tts"` or as an emergency fallback if server TTS fails.
 */
export function speakWithBrowserTTS(
  text: string,
  lang: string = "id-ID",
): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.speechSynthesis === "undefined" ||
      !text.trim()
    ) {
      resolve();
      return;
    }

    try {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.lang = lang;
      utterance.rate = 1.02;

      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /gadis/i.test(v.name)) ||
        voices.find((v) => v.lang.toLowerCase().startsWith("id"));
      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    } catch {
      resolve();
    }
  });
}

export function stopBrowserTTS(): void {
  if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}
