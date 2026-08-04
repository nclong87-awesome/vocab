import { TTSConfig, LLMConfig } from "../types";

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: 'browser',
  speed: 1.0,
  pitch: 1.0,
  model: 'gemini-3.6-flash',
  voice: 'Puck',
  autoPlayAudioInQuiz: true
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
    english: "en-US"
  };
  return map[name] || "en-US";
}

export function getVoicesForLanguage(langNameOrCode: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  if (!voices || voices.length === 0) return [];
  const bcp47 = langNameOrCode.includes('-') ? langNameOrCode : getLanguageCode(langNameOrCode);
  const langPrefix = bcp47.split('-')[0].toLowerCase();
  return voices.filter(v => {
    const vLang = (v.lang || "").toLowerCase().replace('_', '-');
    return vLang.startsWith(langPrefix) || vLang.includes(langPrefix);
  });
}

export function isVoiceInstalledForLanguage(langNameOrCode: string, voices: SpeechSynthesisVoice[]): boolean {
  return getVoicesForLanguage(langNameOrCode, voices).length > 0;
}

let currentAudioElement: HTMLAudioElement | null = null;

function getAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!currentAudioElement) {
    currentAudioElement = new Audio();
  }
  return currentAudioElement;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;
let currentSpeechToken: number = 0;

export function stopSpeech(): void {
  currentSpeechToken++;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
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

let isAudioUnlocked = false;

export function unlockAudioElement(): void {
  if (isAudioUnlocked) return;
  if (typeof window === "undefined") return;

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

// Helper to normalize text for speech synthesis (TTS) to avoid strange characters or prompt noise
export function normalizeTextForTTS(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove zero-width spaces, soft hyphens, non-breaking spaces & control characters
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F]/g, " ");

  // 2. Strip HTML tags (e.g. <b>, <br/>, <span class="...">)
  cleaned = cleaned.replace(/<[^>]*>/g, " ");

  // 3. Strip Emojis & decorative non-speech symbols (e.g. ★, ☆, ●, •, ►, ▪, ✦, ✧, ✔, ✕, ✖)
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, "");
  cleaned = cleaned.replace(/[★☆●•►▪✦✧✔✕✖✓✗➔→←⇒▲▼♦♠♣♥]/g, " ");

  // 4. Handle Markdown syntax
  // Markdown links: [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Markdown images: ![alt](url) -> ""
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
  // Remove bold, italic, strikethrough, inline code (keep text inside): **text**, *text*, __text__, _text_, ~~text~~, `text`
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/~~([^~]+)~~/g, "$1");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  // Heading marks, blockquotes, list markers at start of line
  cleaned = cleaned.replace(/^[#>\-\*\+\s]+/gm, " ");

  // 5. Handle bracketed IPA phonetics if present alongside regular text (e.g., /bɔ̃ʒuʁ/)
  if (/[a-zA-Z0-9]/.test(cleaned.replace(/\/[^/]+\//g, ""))) {
    cleaned = cleaned.replace(/\/[^/]{2,30}\//g, " ");
  }

  // 6. Normalize fill-in-the-blanks / placeholders so speech engines don't read "underscore underscore"
  // Handles [___], (___), [...], (...), ________, -----, ......
  cleaned = cleaned.replace(/\[\s*_{1,}\s*\]/g, " blank ");
  cleaned = cleaned.replace(/\(\s*_{1,}\s*\)/g, " blank ");
  cleaned = cleaned.replace(/\[\s*\.{3,}\s*\]/g, " blank ");
  cleaned = cleaned.replace(/\(\s*\.{3,}\s*\)/g, " blank ");
  cleaned = cleaned.replace(/_{2,}/g, " blank ");
  cleaned = cleaned.replace(/-{3,}/g, " blank ");
  cleaned = cleaned.replace(/\.{4,}/g, " blank ");

  // 7. Streamline common prompt prefixes for speech clarity
  cleaned = cleaned.replace(/^(Fill in the blank for the sentence|Complete the sentence|Fill in the blank):\s*/i, "Complete sentence: ");
  cleaned = cleaned.replace(/^(Which word matches the following definition|Which word matches the definition):\s*/i, "Definition: ");
  cleaned = cleaned.replace(/^(Question|Q):\s*/i, "");

  // 8. Clean redundant or strange quotes
  cleaned = cleaned.replace(/["“”«»„‟]/g, "");
  cleaned = cleaned.replace(/['‘’]/g, "'"); // Normalize curly apostrophes

  // 9. Remove non-speech punctuation/symbols like ~, ^, |, \, @, #, $, %, *, +, =, <, >
  cleaned = cleaned.replace(/[~^|\\@#$%*+=<>]/g, " ");

  // 10. Clean up multiple punctuation and line breaks
  cleaned = cleaned.replace(/[\r\n]+/g, ". ");
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/\?\s*\?/g, "?");
  cleaned = cleaned.replace(/!\s*!/g, "!");
  cleaned = cleaned.replace(/\.\s*\./g, ".");

  // 11. Normalize spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Fallback safety check: if everything was stripped, return basic sanitized original text
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
  stopSpeech();
  const myToken = currentSpeechToken;

  // Ensure Mobile HTMLAudioElement is fully unlocked if we are using an AI/Server engine
  const activeEngine = ttsConfig?.engine || 'browser';
  if (activeEngine !== 'browser') {
    unlockAudioElement();
  }

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

  // Direct HTML5 Audio stream for AI models or server-side TTS
  const playAudioStream = async (): Promise<boolean> => {
    const audio = getAudioElement();
    if (!audio) return false;

    try {
      const bcp47 = customLang 
        ? (customLang.includes('-') ? customLang : getLanguageCode(customLang))
        : "en-US";
      const cleanLang = bcp47.split('-')[0].toLowerCase();

      const queryKey = ttsConfig?.apiKey || '';
      const streamUrl = `/api/tts/stream?text=${encodeURIComponent(normalizedText)}&lang=${encodeURIComponent(cleanLang)}&engine=${encodeURIComponent(activeEngine)}&model=${encodeURIComponent(ttsConfig?.model || '')}&voice=${encodeURIComponent(ttsConfig?.voice || '')}&apiKey=${encodeURIComponent(queryKey)}&t=${Date.now()}`;

      const res = await fetch(streamUrl);
      if (myToken !== currentSpeechToken) return true;
      if (!res.ok) return false;

      const blob = await res.blob();
      if (myToken !== currentSpeechToken) return true;
      if (!blob || blob.size < 100) return false;

      const objectUrl = URL.createObjectURL(blob);
      audio.pause();
      audio.src = objectUrl;
      audio.playbackRate = ttsConfig?.speed ?? 1.0;

      audio.onplay = () => {
        if (myToken === currentSpeechToken) safeOnStart();
      };
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        if (myToken === currentSpeechToken) safeOnEnd();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (myToken !== currentSpeechToken) return;
        speakWithBrowser();
      };

      const p = audio.play();
      if (p !== undefined) {
        p.catch(() => {
          URL.revokeObjectURL(objectUrl);
          if (myToken !== currentSpeechToken) return;
          speakWithBrowser();
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  const speakWithBrowser = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      safeOnEnd();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {}

    if (myToken !== currentSpeechToken) return;

    try {
      const utterance = new SpeechSynthesisUtterance(normalizedText);
      activeUtterance = utterance;
      (window as any)._activeUtteranceRef = utterance;

      utterance.rate = ttsConfig.speed ?? 1.0;
      utterance.pitch = ttsConfig.pitch ?? 1.0;

      const bcp47Lang = customLang 
        ? (customLang.includes('-') ? customLang : getLanguageCode(customLang))
        : "en-US";
      utterance.lang = bcp47Lang;

      const voices = window.speechSynthesis.getVoices();
      if (ttsConfig.voiceURI && voices.length > 0) {
        const selectedVoice = voices.find(v => v.voiceURI === ttsConfig.voiceURI);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }

      if (!utterance.voice && bcp47Lang && voices.length > 0) {
        const langPrefix = bcp47Lang.split('-')[0].toLowerCase();
        const matchingVoice = voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix));
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      utterance.onstart = () => {
        if (myToken === currentSpeechToken) safeOnStart();
      };

      utterance.onend = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        (window as any)._activeUtteranceRef = null;
        if (myToken === currentSpeechToken) safeOnEnd();
      };

      utterance.onerror = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        (window as any)._activeUtteranceRef = null;
        if (myToken === currentSpeechToken) safeOnEnd();
      };

      safeOnStart();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("SpeechSynthesis execution error:", err);
      activeUtterance = null;
      (window as any)._activeUtteranceRef = null;
      safeOnEnd();
    }
  };

  // Route based on requested TTS engine
  if (activeEngine === 'browser') {
    speakWithBrowser();
    return;
  }

  playAudioStream().then((streamPlayed) => {
    if (!streamPlayed && myToken === currentSpeechToken) {
      speakWithBrowser();
    }
  });
}
