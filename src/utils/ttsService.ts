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
let activeUtterance: SpeechSynthesisUtterance | null = null;
let currentSpeechToken: number = 0;

export function stopSpeech(): void {
  currentSpeechToken++;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch {}
    currentAudioElement = null;
  }
  activeUtterance = null;
}

const ttsAudioCache = new Map<string, string>();

// Helper to wrap base64 PCM into WAV if client receives raw PCM data
function wrapPcmBase64ToWavDataUrl(dataUrl: string): string {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  if (!dataUrl.includes("l16") && !dataUrl.includes("pcm") && !dataUrl.includes("raw")) return dataUrl;

  try {
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return dataUrl;

    const base64Str = dataUrl.substring(commaIdx + 1);
    const rawBinary = atob(base64Str);
    const pcmLen = rawBinary.length;

    const rateMatch = dataUrl.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    const wavBuf = new Uint8Array(44 + pcmLen);
    const view = new DataView(wavBuf.buffer);

    // RIFF
    wavBuf[0] = 0x52; wavBuf[1] = 0x49; wavBuf[2] = 0x46; wavBuf[3] = 0x46;
    view.setUint32(4, 36 + pcmLen, true);
    // WAVE
    wavBuf[8] = 0x57; wavBuf[9] = 0x41; wavBuf[10] = 0x56; wavBuf[11] = 0x45;
    // fmt 
    wavBuf[12] = 0x66; wavBuf[13] = 0x6d; wavBuf[14] = 0x74; wavBuf[15] = 0x20;
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    // data
    wavBuf[36] = 0x64; wavBuf[37] = 0x61; wavBuf[38] = 0x74; wavBuf[39] = 0x61;
    view.setUint32(40, pcmLen, true);

    for (let i = 0; i < pcmLen; i++) {
      wavBuf[44 + i] = rawBinary.charCodeAt(i);
    }

    let binaryString = "";
    const chunkSize = 8192;
    for (let i = 0; i < wavBuf.length; i += chunkSize) {
      binaryString += String.fromCharCode.apply(null, Array.from(wavBuf.subarray(i, i + chunkSize)));
    }
    return `data:audio/wav;base64,${btoa(binaryString)}`;
  } catch (err) {
    console.warn("Client pcmToWav error:", err);
    return dataUrl;
  }
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
  llmConfig?: LLMConfig,
  customLang?: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  stopSpeech();
  const myToken = currentSpeechToken;

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

  // Browser Native Speech Synthesis (Default or Fallback)
  const speakWithBrowser = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      safeOnEnd();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();
    } catch {}

    if (myToken !== currentSpeechToken) return;
    try {
      const utterance = new SpeechSynthesisUtterance(normalizedText);
      activeUtterance = utterance;
      (window as any)._activeUtteranceRef = utterance; // Prevent garbage collection bug in Chromium browsers

      utterance.rate = ttsConfig.speed ?? 1.0;
      utterance.pitch = ttsConfig.pitch ?? 1.0;
      if (customLang) {
        utterance.lang = customLang;
      }

      const voices = window.speechSynthesis.getVoices();
      if (ttsConfig.voiceURI && voices.length > 0) {
        const selectedVoice = voices.find(v => v.voiceURI === ttsConfig.voiceURI);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }

      if (!utterance.voice && customLang && voices.length > 0) {
        const langPrefix = customLang.split('-')[0].toLowerCase();
        const matchingVoice = voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix));
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      utterance.onstart = () => {
        safeOnStart();
      };

      utterance.onend = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        (window as any)._activeUtteranceRef = null;
        safeOnEnd();
      };

      utterance.onerror = (err) => {
        console.warn("Browser SpeechSynthesis error:", err);
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        (window as any)._activeUtteranceRef = null;
        safeOnEnd();
      };

      // Ensure UI reflects active speaking even if some browsers delay `onstart`.
      safeOnStart();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("SpeechSynthesis execution error:", err);
      activeUtterance = null;
      (window as any)._activeUtteranceRef = null;
      safeOnEnd();
    }
  };

  const activeEngine = ttsConfig?.engine || 'browser';

  if (activeEngine === 'browser') {
    speakWithBrowser();
    return;
  }

  // Check cache for AI TTS
  const cacheKey = `${activeEngine}:${ttsConfig?.model}:${ttsConfig?.voice}:${normalizedText}`;
  let cachedDataUrl = ttsAudioCache.get(cacheKey);

  if (cachedDataUrl) {
    cachedDataUrl = wrapPcmBase64ToWavDataUrl(cachedDataUrl);
    try {
      const audio = new Audio(cachedDataUrl);
      currentAudioElement = audio;
      audio.playbackRate = ttsConfig?.speed ?? 1.0;

      audio.onplay = () => {
        safeOnStart();
      };

      audio.onended = () => {
        currentAudioElement = null;
        safeOnEnd();
      };

      audio.onerror = (e) => {
        console.warn("Cached audio playback error, falling back to browser speech:", e);
        currentAudioElement = null;
        speakWithBrowser();
      };

      await audio.play();
      return;
    } catch (err) {
      console.warn("Cached audio play exception, falling back to browser speech:", err);
      currentAudioElement = null;
      speakWithBrowser();
      return;
    }
  }

  // AI TTS Model generation via server proxy
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: normalizedText,
        engine: activeEngine,
        model: ttsConfig?.model || 'gemini-3.6-flash',
        voice: ttsConfig?.voice || 'Puck',
        apiKey: ttsConfig?.apiKey,
        customEndpoint: ttsConfig?.customEndpoint,
        llmConfig
      })
    });

    if (myToken !== currentSpeechToken) return;

    if (!response.ok) {
      console.warn(`AI TTS server returned status ${response.status}, falling back to browser speech synthesis`);
      speakWithBrowser();
      return;
    }

    const data = await response.json();
    if (myToken !== currentSpeechToken) return;
    
    if (!data.audioDataUrl) {
      console.warn("No audio data returned, falling back to browser speech");
      speakWithBrowser();
      return;
    }

    const playableDataUrl = wrapPcmBase64ToWavDataUrl(data.audioDataUrl);

    // Cache generated audio data URL
    ttsAudioCache.set(cacheKey, playableDataUrl);

    const audio = new Audio(playableDataUrl);
    currentAudioElement = audio;
    audio.playbackRate = ttsConfig.speed ?? 1.0;

    audio.onplay = () => {
      safeOnStart();
    };

    audio.onended = () => {
      currentAudioElement = null;
      safeOnEnd();
    };

    audio.onerror = (e) => {
      console.warn("Audio playback error, falling back to browser speech:", e);
      currentAudioElement = null;
      speakWithBrowser();
    };

    try {
      await audio.play();
    } catch (playErr) {
      console.warn("audio.play() blocked/failed, falling back to browser speech:", playErr);
      currentAudioElement = null;
      speakWithBrowser();
    }
  } catch (err) {
    console.warn("AI TTS request exception, falling back to browser speech:", err);
    speakWithBrowser();
  }
}
