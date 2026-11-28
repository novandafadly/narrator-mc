import { Queue } from "typescript-collections";
import { Message, Role, Screenplay, Talk, textsToScreenplay } from "./messages";
import { Viewer } from "@/features/vrmViewer/viewer";
import { Alert } from "@/features/alert/alert";

import { getEchoChatResponseStream } from "./echoChat";
import {
  getArbiusChatResponseStream,
} from "./arbiusChat";
import {
  getOpenAiChatResponseStream,
  getOpenAiVisionChatResponse,
} from "./openAiChat";
import {
  getLlamaCppChatResponseStream,
  getLlavaCppChatResponse,
} from "./llamaCppChat";
import { getWindowAiChatResponseStream } from "./windowAiChat";
import {
  getOllamaChatResponseStream,
  getOllamaVisionChatResponse,
} from "./ollamaChat";
import { getKoboldAiChatResponseStream } from "./koboldAiChat";
import { getReasoingEngineChatResponseStream } from "./reasoiningEngineChat";

import { rvc } from "@/features/rvc/rvc";
import { coquiLocal } from "@/features/coquiLocal/coquiLocal";
import { piper } from "@/features/piper/piper";
import { elevenlabs } from "@/features/elevenlabs/elevenlabs";
import { speecht5 } from "@/features/speecht5/speecht5";
import { openaiTTS } from "@/features/openaiTTS/openaiTTS";
import { localXTTSTTS } from "@/features/localXTTS/localXTTS";
import { kokoro } from "../kokoro/kokoro";
import { edgeTTS } from "@/features/edgeTTS/edgeTTS";
import { speakWithBrowserTTS, stopBrowserTTS } from "@/features/browserTTS/browserTTS";
import { VideoAvatarController } from "@/features/videoAvatar/videoAvatarController";
import { videoAvatarController } from "@/features/videoAvatar/videoAvatarContext";
import { stageSync } from "@/features/stageSync/stageSync";

import { AmicaLife } from "@/features/amicaLife/amicaLife";

import { config, updateConfig } from "@/utils/config";
import { cleanTalk } from "@/utils/cleanTalk";
import { processResponse } from "@/utils/processResponse";
import { wait } from "@/utils/wait";
import isDev from '@/utils/isDev';

import { isCharacterIdle, characterIdleTime, resetIdleTimer } from "@/utils/isIdle";
import { getOpenRouterChatResponseStream } from './openRouterChat';
import { handleUserInput } from '../externalAPI/externalAPI';
import { loadVRMAnimation } from '@/lib/VRMAnimation/loadVRMAnimation';

type Speak = {
  audioBuffer: ArrayBuffer | null;
  videoPromise?: Promise<Blob | null>;
  browserTtsText?: string;
  screenplay: Screenplay;
  streamIdx: number;
};

type TTSJob = {
  screenplay: Screenplay;
  streamIdx: number;
};

export class Chat {
  public initialized: boolean;
  private loopsStarted: boolean = false;

  public amicaLife?: AmicaLife;
  public viewer?: Viewer;
  public alert?: Alert;
  public videoAvatar: VideoAvatarController = videoAvatarController;
  private activeTtsControllers = new Set<AbortController>();

  public setChatLog?: (messageLog: Message[]) => void;
  public setUserMessage?: (message: string) => void;
  public setAssistantMessage?: (message: string) => void;
  public setShownMessage?: (role: Role) => void;
  public setChatProcessing?: (processing: boolean) => void;
  public setChatSpeaking?: (speaking: boolean) => void;
  public setThoughtMessage?: (message: string) => void;

  // the message from the user that is currently being processed
  // it can be reset
  public stream: ReadableStream<Uint8Array> | null;
  public streams: ReadableStream<Uint8Array>[];
  public reader: ReadableStreamDefaultReader<Uint8Array> | null;
  public readers: ReadableStreamDefaultReader<Uint8Array>[];

  // process these immediately as they come in and add to audioToPlay
  public ttsJobs: Queue<TTSJob>;

  // this should be read as soon as they exist
  // and then deleted from the queue
  public speakJobs: Queue<Speak>;

  private currentAssistantMessage: string;
  private currentUserMessage: string;
  private thoughtMessage: string;

  private lastAwake: number;

  public messageList: Message[];

  public currentStreamIdx: number;

  private eventSource: EventSource | null = null

  constructor() {
    this.initialized = false;

    this.stream = null;
    this.reader = null;
    this.streams = [];
    this.readers = [];

    this.ttsJobs = new Queue<TTSJob>();
    this.speakJobs = new Queue<Speak>();

    this.currentAssistantMessage = "";
    this.currentUserMessage = "";
    this.thoughtMessage = "";

    this.messageList = [];
    this.currentStreamIdx = 0;

    this.lastAwake = 0;
  }

  public initialize(
    amicaLife: AmicaLife,
    viewer: Viewer,
    alert: Alert,
    setChatLog: (messageLog: Message[]) => void,
    setUserMessage: (message: string) => void,
    setAssistantMessage: (message: string) => void,
    setThoughtMessage: (message: string) => void,
    setShownMessage: (role: Role) => void,
    setChatProcessing: (processing: boolean) => void,
    setChatSpeaking: (speaking: boolean) => void,
  ) {
    this.amicaLife = amicaLife;
    this.viewer = viewer;
    this.alert = alert;
    this.setChatLog = setChatLog;
    this.setUserMessage = setUserMessage;
    this.setAssistantMessage = setAssistantMessage;
    this.setShownMessage = setShownMessage;
    this.setThoughtMessage = setThoughtMessage;
    this.setChatProcessing = setChatProcessing;
    this.setChatSpeaking = setChatSpeaking;

    // these will run forever (guard so React re-init does not duplicate loops)
    if (!this.loopsStarted) {
      this.loopsStarted = true;
      this.processTtsJobs();
      this.processSpeakJobs();
    }

    this.updateAwake();
    this.initialized = true;

    this.initSSE();
  }

  public setMessageList(messages: Message[]) {
    this.messageList = messages;
    this.currentAssistantMessage = "";
    this.currentUserMessage = "";
    this.setChatLog!(this.messageList!);
    this.setAssistantMessage!(this.currentAssistantMessage);
    this.setUserMessage!(this.currentAssistantMessage);
    this.currentStreamIdx++;
  }

  public async handleRvc(audio: any) {
    const rvcModelName = config("rvc_model_name");
    const rvcIndexPath = config("rvc_index_path");
    const rvcF0upKey = parseInt(config("rvc_f0_upkey"));
    const rvcF0Method = config("rvc_f0_method");
    const rvcIndexRate = config("rvc_index_rate");
    const rvcFilterRadius = parseInt(config("rvc_filter_radius"));
    const rvcResampleSr = parseInt(config("rvc_resample_sr"));
    const rvcRmsMixRate = parseInt(config("rvc_rms_mix_rate"));
    const rvcProtect = parseInt(config("rvc_protect"));

    const voice = await rvc(
      audio,
      rvcModelName,
      rvcIndexPath,
      rvcF0upKey,
      rvcF0Method,
      rvcIndexRate,
      rvcFilterRadius,
      rvcResampleSr,
      rvcRmsMixRate,
      rvcProtect,
    );

    return voice.audio;
  }

  public idleTime(): number {
    return characterIdleTime(this.lastAwake);
  }

  public isAwake() {
    return !isCharacterIdle(this.lastAwake);
  }

  public updateAwake() {
    this.lastAwake = new Date().getTime();
    resetIdleTimer();
  }

  public async processTtsJobs() {
    while (true) {
      do {
        const ttsJob = this.ttsJobs.dequeue();
        if (!ttsJob) {
          break;
        }

        if (ttsJob.streamIdx !== this.currentStreamIdx) {
          console.log("skipping tts for streamIdx");
          continue;
        }

        // Photorealistic Video Avatar mode (Ditto TalkingHead / MuseTalk v1.5 + Edge TTS):
        // Dispatch each sentence to POST /speak in parallel and play sequentially in processSpeakJobs().
        if (this.videoAvatar.isActive() && config("tts_muted") !== "true") {
          const text = cleanTalk({ ...ttsJob.screenplay.talk }).message.trim();
          const videoPromise = text
            ? this.videoAvatar
                .fetchSpeakVideo(text, {
                  emotion: ttsJob.screenplay.expression,
                })
                .catch((err) => {
                console.error("Video Avatar /speak error:", err);
                this.alert?.error(
                  "Server Video Avatar gagal merespons",
                  `${err?.message || err}. Gunakan tombol "Pindah ke Mode 3D VRM (Cadangan)" jika perlu.`,
                );
                return null;
              })
            : Promise.resolve(null);

          this.speakJobs.enqueue({
            audioBuffer: null,
            videoPromise,
            screenplay: ttsJob.screenplay,
            streamIdx: ttsJob.streamIdx,
          });
          continue;
        }

        // 3D VRM fallback mode: Browser SpeechSynthesis directly
        if (config("tts_backend") === "browser_tts" && config("tts_muted") !== "true") {
          const text = cleanTalk({ ...ttsJob.screenplay.talk }).message.trim();
          this.speakJobs.enqueue({
            audioBuffer: null,
            browserTtsText: text || undefined,
            screenplay: ttsJob.screenplay,
            streamIdx: ttsJob.streamIdx,
          });
          continue;
        }

        const audioBuffer = await this.fetchAudio({ ...ttsJob.screenplay.talk });
        if (ttsJob.streamIdx !== this.currentStreamIdx) {
          continue;
        }
        // If edge_tts failed and returned null while not muted, degrade gracefully to browser speech
        const fallbackBrowserText =
          !audioBuffer &&
          config("tts_backend") === "edge_tts" &&
          config("tts_muted") !== "true"
            ? cleanTalk({ ...ttsJob.screenplay.talk }).message.trim()
            : undefined;

        this.speakJobs.enqueue({
          audioBuffer,
          browserTtsText: fallbackBrowserText || undefined,
          screenplay: ttsJob.screenplay,
          streamIdx: ttsJob.streamIdx,
        });
      } while (this.ttsJobs.size() > 0);
      await wait(50);
    }
  }

  public async processSpeakJobs() {
    while (true) {
      do {
        const speak = this.speakJobs.dequeue();
        if (!speak) {
          break;
        }
        if (speak.streamIdx !== this.currentStreamIdx) {
          console.log("skipping speak for streamIdx");
          continue;
        }

        let videoBlob: Blob | null = null;
        if (speak.videoPromise) {
          videoBlob = await speak.videoPromise;
          if (speak.streamIdx !== this.currentStreamIdx) {
            console.log("skipping video speak after interrupt");
            continue;
          }
        }

        if (typeof window !== "undefined" && (window as any).chatvrm_latency_tracker) {
          if ((window as any).chatvrm_latency_tracker.active) {
            const ms =
              +new Date() - (window as any).chatvrm_latency_tracker.start;
            console.log("performance_latency", ms);
            (window as any).chatvrm_latency_tracker.active = false;
          }
        }

        this.bubbleMessage("assistant", speak.screenplay.text);
        stageSync.broadcastSubtitle(speak.screenplay.text, true);

        if (videoBlob) {
          this.setChatSpeaking?.(true);
          stageSync.broadcastVideoPlay(videoBlob, speak.screenplay.text);
          await this.videoAvatar.playBlob(videoBlob);
          this.setChatSpeaking?.(false);
          this.isAwake() ? this.updateAwake() : null;
        } else if (speak.audioBuffer) {
          this.setChatSpeaking?.(true);
          stageSync.broadcastVrmSpeak(speak.audioBuffer, speak.screenplay);
          const muteLocal = config("stage_audio_on_projector") === "true";
          await this.viewer?.model?.speak(speak.audioBuffer, speak.screenplay, {
            muted: muteLocal,
          });
          this.setChatSpeaking?.(false);
          this.isAwake() ? this.updateAwake() : null;
        } else if (speak.browserTtsText) {
          this.setChatSpeaking?.(true);
          this.viewer?.model?.playEmotion(speak.screenplay.expression);
          stageSync.broadcastVrmEmotion(speak.screenplay.expression);
          await speakWithBrowserTTS(speak.browserTtsText, "id-ID");
          this.setChatSpeaking?.(false);
          this.isAwake() ? this.updateAwake() : null;
        }
      } while (this.speakJobs.size() > 0);
      await wait(50);
    }
  }

  public thoughtBubbleMessage(isThinking: boolean, thought: string) {
    // if not thinking, we should clear the thought bubble 
    if (!isThinking) {
      this.thoughtMessage = "";
      this.setThoughtMessage!("");
      return;
    }

    if (this.thoughtMessage !== "") {
      this.thoughtMessage += " ";
    }
    this.thoughtMessage += thought;
    this.setThoughtMessage!(this.thoughtMessage);
  }

  public bubbleMessage(role: Role, text: string) {
    // TODO: currentUser & Assistant message should be contain the message with emotion in it

    if (role === "user") {
      // add space if there is already a partial message
      if (this.currentUserMessage !== "") {
        this.currentUserMessage += " ";
      }
      this.currentUserMessage += text;
      this.setUserMessage!(this.currentUserMessage);
      this.setAssistantMessage!("");

      if (this.currentAssistantMessage !== "") {
        this.messageList!.push({
          role: "assistant",
          content: this.currentAssistantMessage,
        });

        this.currentAssistantMessage = "";
      }

      this.setChatLog!([
        ...this.messageList!,
        { role: "user", content: this.currentUserMessage },
      ]);
    }

    if (role === "assistant") {
      if (
        this.currentAssistantMessage != "" &&
        !this.isAwake() &&
        config("amica_life_enabled") === "true"
      ) {
        this.messageList!.push({
          role: "assistant",
          content: this.currentAssistantMessage,
        });

        this.currentAssistantMessage = text;
        this.setAssistantMessage!(this.currentAssistantMessage);
      } else if (config("chatbot_backend") === "moshi") {
        if (this.currentAssistantMessage !== "") {
          this.messageList!.push({
            role: "assistant",
            content: this.currentAssistantMessage,
          });
        }
        this.currentAssistantMessage = text;
        this.setAssistantMessage!(this.currentAssistantMessage);
        this.setUserMessage!("");

      } else {
        this.currentAssistantMessage += text;
        this.setUserMessage!("");
        this.setAssistantMessage!(this.currentAssistantMessage);
      }

      if (this.currentUserMessage !== "") {
        this.messageList!.push({
          role: "user",
          content: this.currentUserMessage,
        });

        this.currentUserMessage = "";
      }

      this.setChatLog!([
        ...this.messageList!,
        { role: "assistant", content: this.currentAssistantMessage },
      ]);
    }

    this.setShownMessage!(role);
  }

  public async interrupt() {
    this.currentStreamIdx++;
    try {
      if (this.reader) {
        console.debug("cancelling");
        if (!this.reader?.closed) {
          await this.reader?.cancel();
        }
        console.debug("finished cancelling");
      }
      for (const r of this.readers) {
        try {
          await r.cancel();
        } catch {
          // ignore already closed reader
        }
      }
      this.readers = [];
    } catch (e: any) {
      console.error(e.toString());
    }

    // Abort any in-flight TTS requests
    this.activeTtsControllers.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    });
    this.activeTtsControllers.clear();

    this.ttsJobs.clear();
    this.speakJobs.clear();

    // Stop active Video Avatar fetch & playback back to idle
    this.videoAvatar.stop();

    // Stop active 3D VRM audio & lip-sync immediately
    this.viewer?.model?.stopSpeaking();

    // Stop browser SpeechSynthesis if active
    stopBrowserTTS();

    // Notify /stage projector to stop immediately
    stageSync.broadcastStop();

    this.setChatSpeaking?.(false);
    this.setChatProcessing?.(false);
  }

  /**
   * Speaks pre-written MC segment text directly (bypassing the LLM) through either:
   * 1) Pre-recorded audio file (optional `audioUrl`) in 3D VRM mode for zero-latency offline playback, or
   * 2) Active avatar pipeline (Video Avatar `/speak` or 3D VRM TTS `edge_tts`).
   */
  public async speakDirect(
    scriptedText: string,
    options?: { audioUrl?: string },
  ) {
    const trimmed = scriptedText.trim();
    if (!trimmed) return;

    await this.interrupt();
    await wait(0);

    if (typeof window !== "undefined") {
      (window as any).chatvrm_latency_tracker = {
        start: +Date.now(),
        active: true,
      };
    }

    const streamIdx = this.currentStreamIdx;
    this.updateAwake();

    // If a pre-recorded audio file is available and Video Avatar isn't active, play it directly with VRM lip-sync
    if (options?.audioUrl && !this.videoAvatar.isActive() && config("tts_muted") !== "true") {
      try {
        const res = await fetch(options.audioUrl);
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.startsWith("audio/")) {
          const audioBuffer = await res.arrayBuffer();
          if (audioBuffer.byteLength > 0 && streamIdx === this.currentStreamIdx) {
            const [screenplay] = textsToScreenplay([trimmed]);
            this.speakJobs.enqueue({
              audioBuffer,
              screenplay,
              streamIdx,
            });
            return;
          }
        }
      } catch {
        // Fall through cleanly to TTS / Video Avatar synthesis
      }
    }

    // Split scripted text into sentences while preserving the leading [emotion] tag
    const tagMatch = trimmed.match(/^(\[[^\]]+\])\s*/);
    const leadingTag = tagMatch ? tagMatch[1] : "[happy]";
    const body = tagMatch ? trimmed.slice(tagMatch[0].length) : trimmed;
    const rawSentences = body
      .split(/(?<=[.!?。！？])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const taggedSentences = (rawSentences.length > 0 ? rawSentences : [body]).map(
      (s, idx) => (idx === 0 || !s.startsWith("[") ? `${leadingTag} ${s}` : s),
    );
    const screenplays = textsToScreenplay(taggedSentences);
    for (const screenplay of screenplays) {
      if (streamIdx !== this.currentStreamIdx) break;
      this.ttsJobs.enqueue({
        screenplay,
        streamIdx,
      });
    }
  }

  // this happens either from text or from voice / whisper completion
  public async receiveMessageFromUser(message: string, amicaLife: boolean) {
    if (message === null || message === "") {
      return;
    }

    console.time("performance_interrupting");
    console.debug("interrupting...");
    await this.interrupt();
    console.timeEnd("performance_interrupting");
    await wait(0);
    console.debug("wait complete");

    if (!amicaLife) {
      console.log("receiveMessageFromUser", message);

      // For external API
      await handleUserInput(message);

      this.amicaLife?.receiveMessageFromUser(message);

      if (!/\[.*?\]/.test(message)) {
        message = `[neutral] ${message}`;
      }

      this.updateAwake();
      this.bubbleMessage("user", message);
    }

    // make new stream
    const messages: Message[] = [
      { role: "system", content: config("system_prompt") },
      ...this.messageList!,
      { role: "user", content: amicaLife ? message : this.currentUserMessage },
    ];
    // console.debug('messages', messages);

    await this.makeAndHandleStream(messages);
  }

  public initSSE() {
    if (!isDev || config("external_api_enabled") !== "true") {
      return;
    }  
    // Close existing SSE connection if it exists
    this.closeSSE();

    this.eventSource = new EventSource('/api/amicaHandler');

    // Listen for incoming messages from the server
    this.eventSource.onmessage = async (event) => {
      try {
        // Parse the incoming JSON message
        const message = JSON.parse(event.data);

        console.log(message);

        // Destructure to get the message type and data
        const { type, data } = message;

        // Handle the message based on its type
        switch (type) {
          case 'normal':
            console.log('Normal message received:', data);
            const messages: Message[] = [
              { role: "system", content: config("system_prompt") },
              ...this.messageList!,
              { role: "user", content: data},
            ];
            let stream = await getEchoChatResponseStream(messages);
            this.streams.push(stream);
            this.handleChatResponseStream();
            break;
          
          case 'animation':
            console.log('Animation data received:', data);
            const animation = await loadVRMAnimation(`/animations/${data}`);
            if (!animation) {
              throw new Error("Loading animation failed");
            }
            this.viewer?.model?.playAnimation(animation,data);
            requestAnimationFrame(() => { this.viewer?.resetCameraLerp(); });
            break;

          case 'playback':
            console.log('Playback flag received:', data);
            this.viewer?.startRecording();
            // Automatically stop recording after 10 seconds
            setTimeout(() => {
              this.viewer?.stopRecording((videoBlob) => {
                // Log video blob to console
                console.log("Video recording finished", videoBlob);

                // Create a download link for the video file
                const url = URL.createObjectURL(videoBlob!);
                const a = document.createElement("a");
                a.href = url;
                a.download = "recording.webm"; // Set the file name for download
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Revoke the URL to free up memory
                URL.revokeObjectURL(url);
              });
            }, data); // Stop recording after 10 seconds
            break;

          case 'systemPrompt':
            console.log('System Prompt data received:', data);
            updateConfig("system_prompt",data);
            break;

          default:
            console.warn('Unknown message type:', type);
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };


    this.eventSource.addEventListener('end', () => {
      console.log('SSE session ended');
      this.eventSource?.close();
    });

    this.eventSource.onerror = (error) => {
      console.error('Error in SSE connection:', error);
      this.eventSource?.close();
      setTimeout(this.initSSE, 500);
    };
  }

  public closeSSE() {
    if (this.eventSource) {
        console.log("Closing existing SSE connection...");
        this.eventSource.close();
        this.eventSource = null;
    }
}

  public async makeAndHandleStream(messages: Message[]) {
    try {
      this.streams.push(await this.getChatResponseStream(messages));
    } catch (e: any) {
      const errMsg = e.toString();
      console.error(errMsg);
      this.alert?.error("Failed to get chat response", errMsg);
      return errMsg;
    }

    if (this.streams[this.streams.length - 1] == null) {
      const errMsg = "Error: Null stream encountered.";
      console.error(errMsg);
      this.alert?.error("Null stream encountered", errMsg);
      return errMsg;
    }

    return await this.handleChatResponseStream();
  }

  public async handleChatResponseStream() {
    if (this.streams.length === 0) {
      console.log("no stream!");
      return;
    }

    this.currentStreamIdx++;
    const streamIdx = this.currentStreamIdx;
    this.setChatProcessing!(true);

    console.time("chat stream processing");
    let reader = this.streams[this.streams.length - 1].getReader();
    this.readers.push(reader);
    let sentences = new Array<string>();

    let aiTextLog = "";
    let tag = "";
    let isThinking = false;
    let rolePlay = "";
    let receivedMessage = "";

    let firstTokenEncountered = false;
    let firstSentenceEncountered = false;
    console.time("performance_time_to_first_token");
    console.time("performance_time_to_first_sentence");

    try {
      while (true) {
        if (this.currentStreamIdx !== streamIdx) {
          console.log("wrong stream idx");
          break;
        }
        const { done, value } = await reader.read();
        if (!firstTokenEncountered) {
          console.timeEnd("performance_time_to_first_token");
          firstTokenEncountered = true;
        }
        if (done) break;

        receivedMessage += value;
        receivedMessage = receivedMessage.trimStart();

        const proc = processResponse({
          sentences,
          aiTextLog,
          receivedMessage,
          tag,
          isThinking,
          rolePlay,
          callback: (aiTalks: Screenplay[]): boolean => {
            // Generate & play audio for each sentence, display responses
            if (streamIdx !== this.currentStreamIdx) {
              console.log("wrong stream idx");
              return true; // should break
            }

            if (!isThinking) {
              this.ttsJobs.enqueue({
                screenplay: aiTalks[0],
                streamIdx: streamIdx,
              });
            } 

            // thought bubble
            this.thoughtBubbleMessage(isThinking, aiTalks[0].text);
            
            if (!firstSentenceEncountered) {
              console.timeEnd("performance_time_to_first_sentence");
              firstSentenceEncountered = true;
            }

            return false; // normal processing
          },
        });

        sentences = proc.sentences;
        aiTextLog = proc.aiTextLog;
        receivedMessage = proc.receivedMessage;
        tag = proc.tag;
        isThinking = proc.isThinking;
        rolePlay = proc.rolePlay;
        if (proc.shouldBreak) {
          break;
        }
      }
    } catch (e: any) {
      const errMsg = e.toString();
      this.bubbleMessage!("assistant", errMsg);
      console.error(errMsg);
    } finally {
      if (!reader.closed) {
        reader.releaseLock();
      }
      console.timeEnd("chat stream processing");
      if (streamIdx === this.currentStreamIdx) {
        this.setChatProcessing!(false);
      }
    }

    return aiTextLog;
  }

  async fetchAudio(talk: Talk): Promise<ArrayBuffer | null> {
    // TODO we should remove non-speakable characters
    // since this depends on the tts backend, we should do it
    // in their respective functions
    // this is just a simple solution for now
    talk = cleanTalk(talk);
    if (talk.message.trim() === "" || config("tts_muted") === "true") {
      return null;
    }

    const rvcEnabled = config("rvc_enabled") === "true";

    try {
      switch (config("tts_backend")) {
        case "none":
        case "browser_tts": {
          return null;
        }
        case "edge_tts": {
          const ctrl = new AbortController();
          this.activeTtsControllers.add(ctrl);
          try {
            const voice = await edgeTTS(talk.message, ctrl.signal);
            if (rvcEnabled) {
              return await this.handleRvc(voice.audio);
            }
            return voice.audio;
          } finally {
            this.activeTtsControllers.delete(ctrl);
          }
        }
        case "elevenlabs": {
          const voiceId = config("elevenlabs_voiceid");
          const voice = await elevenlabs(talk.message, voiceId, talk.style);
          if (rvcEnabled) {
            return await this.handleRvc(voice.audio);
          }
          return voice.audio;
        }
        case "speecht5": {
          const speakerEmbeddingUrl = config("speecht5_speaker_embedding_url");
          const voice = await speecht5(talk.message, speakerEmbeddingUrl);
          if (rvcEnabled) {
            return await this.handleRvc(voice.audio);
          }
          return voice.audio;
        }
        case "openai_tts": {
          const voice = await openaiTTS(talk.message);
          if (rvcEnabled) {
            return await this.handleRvc(voice.audio);
          }
          return voice.audio;
        }
        case "localXTTS": {
          const voice = await localXTTSTTS(talk.message);
          if (rvcEnabled) {
            return await this.handleRvc(voice.audio);
          }
          return voice.audio;
        }
        case "piper": {
          const voice = await piper(talk.message);
          if (rvcEnabled) {
            return await this.handleRvc(voice.audio);
          }
          return voice.audio;
        }
        case "coquiLocal": {
          const voice = await coquiLocal(talk.message);
          return voice.audio;
        }
        case "kokoro": {
          const voice = await kokoro(talk.message);
          return voice.audio;
        }
      }
    } catch (e: any) {
      console.error(e.toString());
      this.alert?.error("Failed to get TTS response", e.toString());
    }

    return null;
  }

  public async getChatResponseStream(messages: Message[]) {
    console.debug("getChatResponseStream", messages);
    const chatbotBackend = config("chatbot_backend");

    // Extract the system prompt and convo messages
    const systemPrompt = messages.find((msg) => msg.role === "system")!;
    const conversationMessages = messages.filter((msg) => msg.role !== "system");

    if (config("reasoning_engine_enabled") === "true") {
      return getReasoingEngineChatResponseStream(systemPrompt, conversationMessages)
    } 

    switch (chatbotBackend) {
      case "arbius_llm":
        return getArbiusChatResponseStream(messages);
      case "chatgpt":
        return getOpenAiChatResponseStream(messages);
      case "llamacpp":
        return getLlamaCppChatResponseStream(messages);
      case "windowai":
        return getWindowAiChatResponseStream(messages);
      case "ollama":
        return getOllamaChatResponseStream(messages);
      case "koboldai":
        return getKoboldAiChatResponseStream(messages);
      case 'openrouter':
        return getOpenRouterChatResponseStream(messages);
    }

    return getEchoChatResponseStream(messages);
  }

  public async getVisionResponse(imageData: string) {
    try {
      const visionBackend = config("vision_backend");

      console.debug("vision_backend", visionBackend);

      let res = "";
      if (visionBackend === "vision_llamacpp") {
        const messages: Message[] = [
          { role: "system", content: config("vision_system_prompt") },
          ...this.messageList!,
          {
            role: "user",
            content: "Describe the image as accurately as possible",
          },
        ];

        res = await getLlavaCppChatResponse(messages, imageData);
      } else if (visionBackend === "vision_ollama") {
        const messages: Message[] = [
          { role: "system", content: config("vision_system_prompt") },
          ...this.messageList!,
          {
            role: "user",
            content: "Describe the image as accurately as possible",
          },
        ];

        res = await getOllamaVisionChatResponse(messages, imageData);
      } else if (visionBackend === "vision_openai") {
        const messages: Message[] = [
          { role: "user", content: config("vision_system_prompt") },
          ...this.messageList! as any[],
          {
            role: "user",
            // @ts-ignore normally this is a string
            content: [
              {
                type: "text",
                text: "Describe the image as accurately as possible",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`,
                },
              },
            ],
          },
        ];

        res = await getOpenAiVisionChatResponse(messages);
      } else {
        console.warn("vision_backend not supported", visionBackend);
        return;
      }

      await this.makeAndHandleStream([
        { role: "system", content: config("system_prompt") },
        ...this.messageList!,
        {
          role: "user",
          content: `This is a picture I just took from my webcam (described between [[ and ]] ): [[${res}]] Please respond accordingly and as if it were just sent and as though you can see it.`,
        },
      ]);
    } catch (e: any) {
      console.error("getVisionResponse", e.toString());
      this.alert?.error("Failed to get vision response", e.toString());
    }
  }
}
