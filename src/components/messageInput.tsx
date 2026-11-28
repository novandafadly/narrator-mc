import * as ort from "onnxruntime-web"
ort.env.wasm.wasmPaths = '/_next/static/chunks/'

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useMicVAD } from "@ricky0123/vad-react"
import { IconButton } from "./iconButton";
import { QuickSegmentsBar } from "./quickSegmentsBar";
import { useTranscriber } from "@/hooks/useTranscriber";
import { cleanTranscript, cleanFromPunctuation, cleanFromWakeWord } from "@/utils/stringProcessing";
import { hasOnScreenKeyboard } from "@/utils/hasOnScreenKeyboard";
import { AlertContext } from "@/features/alert/alertContext";
import { ChatContext } from "@/features/chat/chatContext";
import { openaiWhisper } from "@/features/openaiWhisper/openaiWhisper";
import { whispercpp } from "@/features/whispercpp/whispercpp";
import { config } from "@/utils/config";
import { WaveFile } from "wavefile";
import { AmicaLifeContext } from "@/features/amicaLife/amicaLifeContext";
import { AudioControlsContext } from "@/features/moshi/components/audioControlsContext";

type BrowserSpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as BrowserSpeechRecognitionCtor | null;
}

function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable
  );
}

export default function MessageInput({
  userMessage,
  setUserMessage,
  isChatProcessing,
  isChatSpeaking = false,
  onChangeUserMessage,
}: {
  userMessage: string;
  setUserMessage: (message: string) => void;
  isChatProcessing: boolean;
  isChatSpeaking?: boolean;
  onChangeUserMessage: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}) {
  const transcriber = useTranscriber();
  const inputRef = useRef<HTMLInputElement>(null);
  const [whisperOpenAIOutput, setWhisperOpenAIOutput] = useState<any | null>(null);
  const [whisperCppOutput, setWhisperCppOutput] = useState<any | null>(null);
  const { chat: bot } = useContext(ChatContext);
  const { alert } = useContext(AlertContext);
  const { amicaLife } = useContext(AmicaLifeContext);
  const { audioControls: moshi } = useContext(AudioControlsContext);
  const [moshiMuted, setMoshiMuted] = useState(moshi.isMuted());

  // Web Speech API (lang = "id-ID") state
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const speechTranscriptRef = useRef<string>("");
  const speechSentRef = useRef<boolean>(false);
  const pttActiveRef = useRef<boolean>(false);
  const [isBrowserListening, setIsBrowserListening] = useState(false);

  const sttBackend = config("stt_backend");
  const useBrowserSpeech = sttBackend === "none" || sttBackend === "browser_speech";
  const speechRecognitionSupported = Boolean(getSpeechRecognitionCtor());

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechStart: () => {
      console.debug('vad', 'on_speech_start');
      console.time('performance_speech');
      // Immediately interrupt Nara when MC/audience starts speaking
      bot.interrupt();
    },
    onSpeechEnd: (audio: Float32Array) => {
      console.debug('vad', 'on_speech_end');
      console.timeEnd('performance_speech');
      console.time('performance_transcribe');
      (window as any).chatvrm_latency_tracker = {
        start: +Date.now(),
        active: true,
      };

      try {
        switch (config("stt_backend")) {
          case 'whisper_browser': {
            console.debug('whisper_browser attempt');
            const audioCtx = new AudioContext();
            const buffer = audioCtx.createBuffer(1, audio.length, 16000);
            buffer.copyToChannel(audio, 0, 0);
            transcriber.start(buffer);
            break;
          }
          case 'whisper_openai': {
            console.debug('whisper_openai attempt');
            const wav = new WaveFile();
            wav.fromScratch(1, 16000, '32f', audio);
            const file = new File([wav.toBuffer()], "input.wav", { type: "audio/wav" });

            let prompt;

            (async () => {
              try {
                const transcript = await openaiWhisper(file, prompt);
                setWhisperOpenAIOutput(transcript);
              } catch (e: any) {
                console.error('whisper_openai error', e);
                alert.error('whisper_openai error', e.toString());
              }
            })();
            break;
          }
          case 'whispercpp': {
            console.debug('whispercpp attempt');
            const wav = new WaveFile();
            wav.fromScratch(1, 16000, '32f', audio);
            wav.toBitDepth('16');
            const file = new File([wav.toBuffer()], "input.wav", { type: "audio/wav" });

            let prompt;

            (async () => {
              try {
                const transcript = await whispercpp(file, prompt);
                setWhisperCppOutput(transcript);
              } catch (e: any) {
                console.error('whispercpp error', e);
                alert.error('whispercpp error', e.toString());
              }
            })();
            break;
          }
        }
      } catch (e: any) {
        console.error('stt_backend error', e);
        alert.error('STT backend error', e.toString());
      }
    },
  });

  if (vad.errored) {
    console.error('vad error', vad.errored);
  }

  const handleTranscriptionResult = useCallback((preprocessed: string) => {
    const cleanText = cleanTranscript(preprocessed);
    const wakeWordEnabled = config("wake_word_enabled") === 'true';
    const textStartsWithWakeWord = wakeWordEnabled && cleanFromPunctuation(cleanText).startsWith(cleanFromPunctuation(config("wake_word")));
    const text = wakeWordEnabled && textStartsWithWakeWord ? cleanFromWakeWord(cleanText, config("wake_word")) : cleanText;

    if (wakeWordEnabled) {
      if (textStartsWithWakeWord) {
        if (config("amica_life_enabled") === "true") {
          amicaLife.pause();
        }
        bot.updateAwake();
      } else {
        if (config("amica_life_enabled") === "true" && amicaLife.triggerMessage !== true && !bot.isAwake()) {
          bot.updateAwake();
        }
      }
    } else {
      if (config("amica_life_enabled") === "true") {
        amicaLife.pause();
        bot.updateAwake();
      }
    }

    if (text === "") {
      return;
    }

    if (config("autosend_from_mic") === 'true') {
      if (!wakeWordEnabled || bot.isAwake()) {
        setUserMessage("");
        bot.receiveMessageFromUser(text, false);
      }
    } else {
      setUserMessage(text);
    }
    try {
      console.timeEnd('performance_transcribe');
    } catch {
      // timer may not have been started in Web Speech API path
    }
  }, [amicaLife, bot, setUserMessage]);

  const stopBrowserSpeech = useCallback((abortWithoutSend: boolean = false) => {
    const rec = recognitionRef.current;
    if (!rec) {
      setIsBrowserListening(false);
      return;
    }
    if (abortWithoutSend) {
      speechSentRef.current = true;
      speechTranscriptRef.current = "";
      try {
        rec.abort();
      } catch {
        // ignore
      }
    } else {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    setIsBrowserListening(false);
  }, []);

  const startBrowserSpeech = useCallback(() => {
    const SpeechRecCtor = getSpeechRecognitionCtor();
    if (!SpeechRecCtor) {
      alert.error(
        "Mikrofon Browser Tidak Didukung",
        "Browser ini belum mendukung Web Speech API. Gunakan Chrome/Edge atau aktifkan STT Groq Whisper (/stt).",
      );
      return;
    }

    // Stop any previous recognition cleanly
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    // Immediately interrupt Nara so speaker audio never leaks into mic
    bot.interrupt();

    const recognition = new SpeechRecCtor();
    recognition.lang = "id-ID";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    speechTranscriptRef.current = "";
    speechSentRef.current = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsBrowserListening(true);
    };

    recognition.onspeechstart = () => {
      bot.interrupt();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript || "";
        if (res.isFinal) {
          finalChunk += transcript + " ";
        } else {
          interimChunk += transcript;
        }
      }

      const combined = (finalChunk + interimChunk).trim();
      speechTranscriptRef.current = combined;
      setUserMessage(combined);

      if (finalChunk.trim() && !interimChunk.trim() && !speechSentRef.current) {
        speechSentRef.current = true;
        (window as any).chatvrm_latency_tracker = {
          start: +Date.now(),
          active: true,
        };
        const toSend = finalChunk.trim();
        speechTranscriptRef.current = "";
        handleTranscriptionResult(toSend);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsBrowserListening(false);
      const code = event.error;
      if (code === "no-speech" || code === "aborted") {
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        alert.error(
          "Izin Mikrofon Ditolak",
          "Izinkan akses mikrofon di browser (pastikan halaman dibuka lewat HTTPS atau localhost).",
        );
      } else {
        alert.error("Kesalahan Mikrofon", `Web Speech API error: ${code}`);
      }
    };

    recognition.onend = () => {
      setIsBrowserListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      const pending = speechTranscriptRef.current.trim();
      if (pending && !speechSentRef.current) {
        speechSentRef.current = true;
        speechTranscriptRef.current = "";
        (window as any).chatvrm_latency_tracker = {
          start: +Date.now(),
          active: true,
        };
        handleTranscriptionResult(pending);
      }
    };

    try {
      recognition.start();
    } catch (err: any) {
      setIsBrowserListening(false);
      alert.error("Gagal Memulai Mikrofon", err?.message || String(err));
    }
  }, [alert, bot, handleTranscriptionResult, setUserMessage]);

  const toggleMicrophone = useCallback(() => {
    if (useBrowserSpeech) {
      if (isBrowserListening) {
        stopBrowserSpeech(false);
      } else {
        startBrowserSpeech();
      }
      return;
    }
    vad.toggle();
  }, [isBrowserListening, startBrowserSpeech, stopBrowserSpeech, useBrowserSpeech, vad]);

  const handleStopAll = useCallback(() => {
    stopBrowserSpeech(true);
    if (vad.listening) {
      vad.pause();
    }
    bot.interrupt();
  }, [bot, stopBrowserSpeech, vad]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Operator keyboard shortcuts:
  // - Escape: instant emergency Stop
  // - Hold Space (outside inputs): Push-to-Talk
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleStopAll();
        return;
      }
      if (
        e.code === "Space" &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !isEditableElement(e.target) &&
        config("chatbot_backend") !== "moshi"
      ) {
        e.preventDefault();
        pttActiveRef.current = true;
        if (useBrowserSpeech) {
          if (!isBrowserListening) startBrowserSpeech();
        } else if (!vad.listening && !vad.loading && !vad.errored) {
          bot.interrupt();
          vad.start();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && pttActiveRef.current) {
        e.preventDefault();
        pttActiveRef.current = false;
        if (useBrowserSpeech) {
          stopBrowserSpeech(false);
        } else if (vad.listening) {
          vad.pause();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    bot,
    handleStopAll,
    isBrowserListening,
    startBrowserSpeech,
    stopBrowserSpeech,
    useBrowserSpeech,
    vad,
  ]);

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    onChangeUserMessage(event);

    if (config("amica_life_enabled") === "true") {
      amicaLife.pause();
      bot.updateAwake();
    }
  }

  // for whisper_browser
  useEffect(() => {
    if (transcriber.output && !transcriber.isBusy) {
      const output = transcriber.output?.text;
      handleTranscriptionResult(output);
    }
  }, [transcriber, handleTranscriptionResult]);

  // for whisper_openai
  useEffect(() => {
    if (whisperOpenAIOutput) {
      const output = whisperOpenAIOutput?.text;
      handleTranscriptionResult(output);
    }
  }, [whisperOpenAIOutput, handleTranscriptionResult]);

  // for whispercpp
  useEffect(() => {
    if (whisperCppOutput) {
      const output = whisperCppOutput?.text;
      handleTranscriptionResult(output);
    }
  }, [whisperCppOutput, handleTranscriptionResult]);

  function clickedSendButton() {
    if (!userMessage.trim()) return;
    (window as any).chatvrm_latency_tracker = {
      start: +Date.now(),
      active: true,
    };
    bot.receiveMessageFromUser(userMessage, false);
    if (!vad.listening && !isBrowserListening) {
      if (!hasOnScreenKeyboard()) {
        inputRef.current?.focus();
      }
    }
    setUserMessage("");
  }

  const isListening = useBrowserSpeech ? isBrowserListening : vad.listening;
  const isSpeakingOrBusy = isChatProcessing || isChatSpeaking;
  const micDisabled = useBrowserSpeech
    ? !speechRecognitionSupported
    : vad.loading || Boolean(vad.errored);

  return (
    <div className="fixed bottom-2 z-20 w-full px-2">
      <div className="mx-auto max-w-4xl">
        {/* Ready-to-play MC segments bar (Opening / Ice-Breaker / Transisi / Closing) */}
        <QuickSegmentsBar />

        <div className="p-2 backdrop-blur-lg bg-slate-900/45 border border-white/15 rounded-xl shadow-xl">
          <div className="grid grid-flow-col grid-cols-[min-content_1fr_min-content_min-content] gap-2 items-center">
            <div className="flex items-center">
              {config("chatbot_backend") === "moshi" ? (
                <IconButton
                  iconName={!moshiMuted ? "24/PauseAlt" : "24/Microphone"}
                  className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled"
                  isProcessing={moshiMuted && moshi.getRecorder() != null}
                  disabled={!moshi.getRecorder()}
                  onClick={() => {
                    moshi.toggleMute();
                    setMoshiMuted(!moshiMuted);
                  }}
                />
              ) : (
                <IconButton
                  iconName={isListening ? "24/PauseAlt" : "24/Microphone"}
                  className={clsx(
                    isListening
                      ? "bg-red-600 hover:bg-red-500 active:bg-red-700 animate-pulse"
                      : "bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled",
                  )}
                  isProcessing={!useBrowserSpeech && vad.userSpeaking}
                  disabled={micDisabled}
                  onClick={toggleMicrophone}
                  title={
                    useBrowserSpeech
                      ? "Mikrofon Web Speech API (id-ID) — atau tahan tombol Spasi (Push-to-Talk)"
                      : `Mikrofon STT (${sttBackend}) — atau tahan tombol Spasi`
                  }
                />
              )}
            </div>

            <input
              type="text"
              ref={inputRef}
              placeholder={
                config("chatbot_backend") === "moshi"
                  ? "Disabled in moshi chatbot"
                  : isListening
                    ? "Mendengarkan Bahasa Indonesia (id-ID)..."
                    : "Tulis pesan untuk Nara, atau tekan Mic / tahan Spasi..."
              }
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (hasOnScreenKeyboard()) {
                    inputRef.current?.blur();
                  }

                  if (userMessage.trim() === "") {
                    return false;
                  }

                  clickedSendButton();
                }
              }}
              disabled={config("chatbot_backend") === "moshi"}
              className="disabled block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-sky-500 sm:text-sm sm:leading-6"
              value={userMessage}
              autoComplete="off"
            />

            {/* Clear emergency Stop button */}
            <button
              type="button"
              onClick={handleStopAll}
              title="Hentikan suara Nara segera (shortcut: Esc)"
              className={clsx(
                "rounded-full px-3 py-2 text-xs font-bold text-white shadow transition whitespace-nowrap",
                isSpeakingOrBusy
                  ? "bg-red-600 hover:bg-red-500 active:bg-red-700 ring-2 ring-red-300/60"
                  : "bg-slate-700/80 hover:bg-red-600/90 text-slate-100",
              )}
            >
              ■ Stop
            </button>

            <div className="flex items-center">
              <IconButton
                iconName="24/Send"
                className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled"
                isProcessing={isChatProcessing || transcriber.isBusy}
                disabled={
                  isChatProcessing ||
                  !userMessage.trim() ||
                  transcriber.isModelLoading ||
                  config("chatbot_backend") === "moshi"
                }
                onClick={clickedSendButton}
              />
            </div>
          </div>

          <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-slate-300">
            <span>
              STT: {useBrowserSpeech ? "Web Speech (id-ID)" : sttBackend}
              {isListening ? " · ● Merekam..." : ""}
            </span>
            <span>Tahan Spasi: Push-to-Talk · Esc: Stop suara</span>
          </div>
        </div>
      </div>
    </div>
  );
}
