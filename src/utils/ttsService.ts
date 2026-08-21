import { TTSConfig, LLMConfig } from "../types";

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: "browser",
  speed: 1.0,
  pitch: 1.0,
  model: "gemini-3.6-flash",
  voice: "",
  autoPlayAudioInChat: true,
  autoPlayAudioInQuiz: true,
  autoPlayAudioOnWordAdded: true,
};

export function getLanguageCode(langName?: string): string {
  if (!langName) return "en-US";
  const name = langName.toLowerCase().trim();
  const map: Record<string, string> = {
    spanish: "es-ES",
    french: "fr-FR",
    german: "de-DE",
    italian: "it-IT",
    portuguese: "pt-PT",
    japanese: "ja-JP",
    korean: "ko-KR",
    chinese: "zh-CN",
    mandarin: "zh-CN",
    vietnamese: "vi-VN",
    russian: "ru-RU",
    arabic: "ar-SA",
    dutch: "nl-NL",
    hindi: "hi-IN",
    turkish: "tr-TR",
    polish: "pl-PL",
    swedish: "sv-SE",
    norwegian: "no-NO",
    danish: "da-DK",
    finnish: "fi-FI",
    greek: "el-GR",
    hebrew: "he-IL",
    thai: "th-TH",
    indonesian: "id-ID",
    tagalog: "tl-PH",
    english: "en-US",
  };
  return map[name] || "en-US";
}

export function getVoicesForLanguage(langNameOrCode: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  if (!voices || voices.length === 0) return [];
  const bcp47 = langNameOrCode.includes("-") ? langNameOrCode : getLanguageCode(langNameOrCode);
  const langPrefix = bcp47.split("-")[0].toLowerCase();
  return voices.filter((v) => {
    const vLang = (v.lang || "").toLowerCase().replace("_", "-");
    return vLang.startsWith(langPrefix) || vLang.includes(langPrefix);
  });
}

export function isVoiceInstalledForLanguage(langNameOrCode: string, voices: SpeechSynthesisVoice[]): boolean {
  return getVoicesForLanguage(langNameOrCode, voices).length > 0;
}

/**
 * Mobile engines (notably Android Chrome bridging to Google TTS) behave very
 * differently from desktop: cold-start latency before audio is high, `onstart`
 * is often late or never fired, and `speechSynthesis.cancel()` right after
 * `speak()` can permanently break the engine binding for the page session.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|IEMobile|Mobile|Silk|Kindle|BlackBerry|Opera Mini/i.test(ua);
}

/**
 * Resolves the system voice list. `getVoices()` returns `[]` for the first
 * moments after load, and Android Chrome frequently never dispatches
 * `voiceschanged`, so poll in addition to listening for the event.
 */
export function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const synth = window.speechSynthesis;
  const immediate = synth.getVoices();
  if (immediate.length > 0) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();

    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      window.clearInterval(intervalId);
      try {
        synth.removeEventListener("voiceschanged", onVoicesChanged);
      } catch {}
      resolve(voices);
    };

    const onVoicesChanged = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) finish(voices);
    };

    const intervalId = window.setInterval(() => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        finish(voices);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        finish([]);
      }
    }, 100);

    // Use addEventListener so we don't clobber an existing `onvoiceschanged` handler.
    try {
      synth.addEventListener("voiceschanged", onVoicesChanged);
    } catch {}
  });
}

let currentAudioElement: HTMLAudioElement | null = null;

function getAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!currentAudioElement) {
    currentAudioElement = new Audio();
  }
  return currentAudioElement;
}

let sharedAudioContext: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      sharedAudioContext = new AudioCtx();
    }
  }
  if (sharedAudioContext && sharedAudioContext.state === "suspended") {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;
let currentSpeechToken = 0;

function stopSpeechInternal(options?: { bumpToken?: boolean; forceCancel?: boolean }): void {
  const bumpToken = options?.bumpToken ?? true;
  const forceCancel = options?.forceCancel ?? true;

  if (bumpToken) {
    currentSpeechToken++;
  }

  // Stop Web Audio playback if any.
  if (currentSourceNode) {
    try {
      currentSourceNode.stop();
      currentSourceNode.disconnect();
    } catch {}
    currentSourceNode = null;
  }

  // Stop browser SpeechSynthesis.
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      const shouldCancel = forceCancel || window.speechSynthesis.speaking || window.speechSynthesis.pending || !!activeUtterance;
      if (shouldCancel) {
        window.speechSynthesis.cancel();
      }
    } catch {}
  }

  // Stop HTMLAudio fallback (kept for compatibility with existing cleanup behavior).
  const audio = getAudioElement();
  if (audio) {
    try {
      audio.pause();
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      audio.currentTime = 0;
    } catch {}
  }

  activeUtterance = null;
}

export function stopSpeech(): void {
  stopSpeechInternal({ bumpToken: true, forceCancel: true });
}

let isAudioUnlocked = false;

export function unlockAudioElement(): void {
  if (isAudioUnlocked) return;
  if (typeof window === "undefined") return;

  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume().then(() => {
          isAudioUnlocked = true;
        }).catch(() => {});
      } else {
        isAudioUnlocked = true;
      }
    }
  } catch {}

  try {
    const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAAAAAA==");
    const p = silent.play();
    if (p !== undefined) {
      p.then(() => {
        isAudioUnlocked = true;
      }).catch(() => {});
    } else {
      isAudioUnlocked = true;
    }
  } catch {}
}

// Helper to normalize text for speech synthesis (TTS) to avoid strange characters or prompt noise.
export function normalizeTextForTTS(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove zero-width spaces, soft hyphens, non-breaking spaces & control characters.
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F]/g, " ");

  // 2. Strip HTML tags (e.g. <b>, <br/>, <span class="...">).
  cleaned = cleaned.replace(/<[^>]*>/g, " ");

  // 3. Strip emojis & decorative non-speech symbols.
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, "");
  cleaned = cleaned.replace(/[★☆●•►▪✦✧✔✕✖✓✗➔→←⇒▲▼♦♠♣♥]/g, " ");

  // 4. Handle Markdown syntax.
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/~~([^~]+)~~/g, "$1");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/^[#>\-\*\+\s]+/gm, " ");

  // 5. Remove IPA blocks if they appear with normal text.
  if (/[a-zA-Z0-9]/.test(cleaned.replace(/\/[^/]+\//g, ""))) {
    cleaned = cleaned.replace(/\/[^/]{2,30}\//g, " ");
  }

  // 6. Normalize blanks/placeholders.
  cleaned = cleaned.replace(/\[\s*_{1,}\s*\]/g, " blank ");
  cleaned = cleaned.replace(/\(\s*_{1,}\s*\)/g, " blank ");
  cleaned = cleaned.replace(/\[\s*\.{3,}\s*\]/g, " blank ");
  cleaned = cleaned.replace(/\(\s*\.{3,}\s*\)/g, " blank ");
  cleaned = cleaned.replace(/_{2,}/g, " blank ");
  cleaned = cleaned.replace(/-{3,}/g, " blank ");
  cleaned = cleaned.replace(/\.{4,}/g, " blank ");

  // 7. Streamline common prompt prefixes.
  cleaned = cleaned.replace(/^(Fill in the blank for the sentence|Complete the sentence|Fill in the blank):\s*/i, "Complete sentence: ");
  cleaned = cleaned.replace(/^(Which word matches the following definition|Which word matches the definition):\s*/i, "Definition: ");
  cleaned = cleaned.replace(/^(Question|Q):\s*/i, "");

  // 8. Clean quotes.
  cleaned = cleaned.replace(/["“”«»„‟]/g, "");
  cleaned = cleaned.replace(/['‘’]/g, "'");

  // 9. Remove non-speech punctuation/symbols.
  cleaned = cleaned.replace(/[~^|\\@#$%*+=<>]/g, " ");

  // 10. Clean duplicate punctuation/line breaks.
  cleaned = cleaned.replace(/[\r\n]+/g, ". ");
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/\?\s*\?/g, "?");
  cleaned = cleaned.replace(/!\s*!/g, "!");
  cleaned = cleaned.replace(/\.\s*\./g, ".");

  // 11. Normalize spaces.
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return text.replace(/[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F]/g, " ").replace(/<[^>]*>/g, " ").trim();
  }

  return cleaned;
}

export async function speakText(
  text: string,
  ttsConfig: TTSConfig = DEFAULT_TTS_CONFIG,
  _llmConfig?: LLMConfig,
  customLang?: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  const shouldCancelOnStart =
    !!currentSourceNode ||
    !!activeUtterance ||
    (typeof window !== "undefined" && !!window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending));

  stopSpeechInternal({ bumpToken: false, forceCancel: shouldCancelOnStart });
  currentSpeechToken++;
  const myToken = currentSpeechToken;

  unlockAudioElement();

  const normalizedText = normalizeTextForTTS(text);
  if (!normalizedText || !normalizedText.trim()) {
    if (onEnd) onEnd();
    return;
  }

  let hasStarted = false;
  const safeOnStart = () => {
    if (!hasStarted) {
      hasStarted = true;
      if (onStart) onStart();
    }
  };

  let hasEnded = false;
  const safeOnEnd = () => {
    if (!hasEnded) {
      hasEnded = true;
      if (onEnd) onEnd();
    }
  };

  const safeRate = (() => {
    const n = Number(ttsConfig.speed);
    if (!Number.isFinite(n)) return 1.0;
    return Math.min(10, Math.max(0.1, n));
  })();

  const safePitch = (() => {
    const n = Number(ttsConfig.pitch);
    if (!Number.isFinite(n)) return 1.0;
    return Math.min(2, Math.max(0, n));
  })();

  const speakWithBrowser = async () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      safeOnEnd();
      return;
    }

    const synth = window.speechSynthesis;
    const isMobile = isMobileBrowser();

    try {
      if (synth.paused) {
        synth.resume();
      }
    } catch {}

    if (myToken !== currentSpeechToken) return;

    let recoveryTimerId: number | null = null;
    let hasEndedOrErrored = false;
    let didStart = false;

    const clearRecoveryTimers = () => {
      if (recoveryTimerId !== null) {
        window.clearTimeout(recoveryTimerId);
        recoveryTimerId = null;
      }
    };

    try {
      // Voices are populated asynchronously; awaiting avoids the empty-list path
      // that previously forced `lang = ""` (rejected by Android's TTS bridge).
      const voices = await waitForVoices(isMobile ? 3000 : 1500);
      if (myToken !== currentSpeechToken) return;

      // Fallback only: never overrides an already-resolved voice, and never
      // crosses languages. `localService` is false for nearly every Android
      // voice, so it is a soft preference rather than a requirement.
      const pickFallbackVoice = (allVoices: SpeechSynthesisVoice[], preferredLang?: string): SpeechSynthesisVoice | undefined => {
        const langPrefix = (preferredLang || "").split("-")[0].toLowerCase();
        if (!langPrefix) return undefined;
        const normalizeLang = (v: SpeechSynthesisVoice) => (v.lang || "").toLowerCase().replace("_", "-");
        const sameLang = allVoices.filter((v) => normalizeLang(v).startsWith(langPrefix));

        return sameLang.find((v) => !!v.localService) || sameLang[0];
      };

      const bindUtteranceLifecycle = (targetUtterance: SpeechSynthesisUtterance) => {
        targetUtterance.onstart = () => {
          didStart = true;
          clearRecoveryTimers();
          if (myToken === currentSpeechToken) safeOnStart();
        };

        targetUtterance.onend = () => {
          hasEndedOrErrored = true;
          clearRecoveryTimers();
          if (activeUtterance === targetUtterance) {
            activeUtterance = null;
          }
          (window as any)._activeUtteranceRef = null;
          if (myToken === currentSpeechToken) safeOnEnd();
        };

        targetUtterance.onerror = () => {
          hasEndedOrErrored = true;
          clearRecoveryTimers();
          if (activeUtterance === targetUtterance) {
            activeUtterance = null;
          }
          (window as any)._activeUtteranceRef = null;
          if (myToken === currentSpeechToken) safeOnEnd();
        };
      };

      const utterance = new SpeechSynthesisUtterance(normalizedText);
      activeUtterance = utterance;
      (window as any)._activeUtteranceRef = utterance;

      utterance.rate = safeRate;
      utterance.pitch = safePitch;
      utterance.volume = 1;

      const bcp47Lang = customLang
        ? (customLang.includes("-") ? customLang : getLanguageCode(customLang))
        : "en-US";
      utterance.lang = bcp47Lang;

      if (ttsConfig.voiceURI && voices.length > 0) {
        const selectedVoice = voices.find((v) => v.voiceURI === ttsConfig.voiceURI);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang || utterance.lang;
        }
      }

      if (!utterance.voice && ttsConfig.voice && voices.length > 0) {
        const preferredName = ttsConfig.voice.toLowerCase().trim();
        const selectedByName = voices.find((v) => v.name.toLowerCase() === preferredName)
          || voices.find((v) => v.name.toLowerCase().includes(preferredName));
        if (selectedByName) {
          utterance.voice = selectedByName;
          utterance.lang = selectedByName.lang || utterance.lang;
        }
      }

      if (!utterance.voice && bcp47Lang && voices.length > 0) {
        const langPrefix = bcp47Lang.split("-")[0].toLowerCase();
        const matchingVoice = voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(langPrefix));
        if (matchingVoice) {
          utterance.voice = matchingVoice;
          utterance.lang = matchingVoice.lang || utterance.lang;
        }
      }

      // Prefer a same-language local voice only when nothing more specific was resolved.
      if (!utterance.voice) {
        const fallbackVoice = pickFallbackVoice(voices, utterance.lang || bcp47Lang);
        if (fallbackVoice) {
          utterance.voice = fallbackVoice;
          utterance.lang = fallbackVoice.lang || utterance.lang;
        }
      }

      // Last resort: let the engine choose using the language tag alone. Never
      // assign an unrelated voice, and never assign an empty `lang` — Android
      // rejects "" as an invalid BCP-47 tag and drops the utterance silently.
      if (!utterance.lang) {
        utterance.lang = bcp47Lang || "en-US";
      }

      bindUtteranceLifecycle(utterance);
      if (myToken !== currentSpeechToken) return;

      // Watchdog. This only releases the caller's "speaking" state; it must never
      // call cancel()/pause()/resume() as recovery. On Android those calls break
      // the engine binding for the rest of the page session, and cold-start
      // latency there routinely exceeds a second, so an aggressive retry turns a
      // healthy-but-slow request into permanent silence.
      const watchdogMs = isMobile ? 5000 : 2500;
      recoveryTimerId = window.setTimeout(() => {
        if (myToken !== currentSpeechToken || hasEndedOrErrored) return;
        if (didStart) return;

        // Some Android engine versions never fire `onstart` even while speaking.
        // If the queue reports activity, assume it is playing and report started.
        let engineBusy = false;
        try {
          engineBusy = synth.speaking || synth.pending;
        } catch {}

        if (engineBusy) {
          safeOnStart();
          return;
        }

        // Nothing was queued and nothing started: release the UI so the user can retry.
        hasEndedOrErrored = true;
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        (window as any)._activeUtteranceRef = null;
        safeOnEnd();
      }, watchdogMs);

      if (myToken !== currentSpeechToken || hasEndedOrErrored) return;
      try {
        if (synth.paused) {
          synth.resume();
        }
      } catch {}
      synth.speak(utterance);
    } catch {
      clearRecoveryTimers();
      activeUtterance = null;
      (window as any)._activeUtteranceRef = null;
      safeOnEnd();
    }
  };

  await speakWithBrowser();
}
