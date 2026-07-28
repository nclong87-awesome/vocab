import { TTSConfig, LLMConfig } from "../types";

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: 'browser',
  speed: 1.0,
  pitch: 1.0,
  model: 'gemini-3.1-flash-tts-preview',
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

let currentAudioElement: HTMLAudioElement | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;

export function stopSpeech(): void {
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

export async function speakText(
  text: string,
  ttsConfig: TTSConfig = DEFAULT_TTS_CONFIG,
  llmConfig?: LLMConfig,
  customLang?: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  stopSpeech();

  if (!text || !text.trim()) return;

  // Browser Native Speech Synthesis (Default or Fallback)
  const speakWithBrowser = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      if (onEnd) onEnd();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();
    } catch {}

    const triggerSpeech = () => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        activeUtterance = utterance;

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
          if (onStart) onStart();
        };

        utterance.onend = () => {
          if (activeUtterance === utterance) {
            activeUtterance = null;
          }
          if (onEnd) onEnd();
        };

        utterance.onerror = (err) => {
          console.warn("Browser SpeechSynthesis error:", err);
          if (activeUtterance === utterance) {
            activeUtterance = null;
          }
          if (onEnd) onEnd();
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("SpeechSynthesis execution error:", err);
        activeUtterance = null;
        if (onEnd) onEnd();
      }
    };

    setTimeout(triggerSpeech, 80);
  };

  const isIframe = typeof window !== "undefined" && window.self !== window.top;
  const activeEngine = (ttsConfig?.engine === 'browser' && isIframe) ? 'gemini' : (ttsConfig?.engine || 'browser');

  if (activeEngine === 'browser') {
    speakWithBrowser();
    return;
  }

  // Check cache for AI TTS
  const cacheKey = `${activeEngine}:${ttsConfig?.model}:${ttsConfig?.voice}:${text}`;
  let cachedDataUrl = ttsAudioCache.get(cacheKey);

  if (cachedDataUrl) {
    cachedDataUrl = wrapPcmBase64ToWavDataUrl(cachedDataUrl);
    try {
      if (onStart) onStart();
      const audio = new Audio(cachedDataUrl);
      currentAudioElement = audio;
      audio.playbackRate = ttsConfig?.speed ?? 1.0;

      audio.onended = () => {
        currentAudioElement = null;
        if (onEnd) onEnd();
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
    if (onStart) onStart();

    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        engine: activeEngine,
        model: ttsConfig?.model || 'gemini-3.1-flash-tts-preview',
        voice: ttsConfig?.voice || 'Puck',
        apiKey: ttsConfig?.apiKey,
        customEndpoint: ttsConfig?.customEndpoint,
        llmConfig
      })
    });

    if (!response.ok) {
      console.warn(`AI TTS server returned status ${response.status}, falling back to browser speech synthesis`);
      speakWithBrowser();
      return;
    }

    const data = await response.json();
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

    audio.onended = () => {
      currentAudioElement = null;
      if (onEnd) onEnd();
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
