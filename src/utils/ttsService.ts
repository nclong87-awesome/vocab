import { TTSConfig, LLMConfig } from "../types";

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: 'browser',
  speed: 1.0,
  pitch: 1.0,
  model: 'gemini-2.5-flash',
  voice: 'Puck',
  autoPlayAudioInQuiz: true
};

let currentAudioElement: HTMLAudioElement | null = null;

export function stopSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement.currentTime = 0;
    currentAudioElement = null;
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

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = ttsConfig.speed ?? 1.0;
    utterance.pitch = ttsConfig.pitch ?? 1.0;
    if (customLang) {
      utterance.lang = customLang;
    }

    if (ttsConfig.voiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = voices.find(v => v.voiceURI === ttsConfig.voiceURI);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    }

    utterance.onstart = () => {
      if (onStart) onStart();
    };

    utterance.onend = () => {
      if (onEnd) onEnd();
    };

    utterance.onerror = (err) => {
      console.warn("Browser SpeechSynthesis error:", err);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  };

  // If engine is 'browser', speak immediately
  if (!ttsConfig || ttsConfig.engine === 'browser') {
    speakWithBrowser();
    return;
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
        engine: ttsConfig.engine,
        model: ttsConfig.model,
        voice: ttsConfig.voice,
        apiKey: ttsConfig.apiKey,
        customEndpoint: ttsConfig.customEndpoint,
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

    const audio = new Audio(data.audioDataUrl);
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

    await audio.play();
  } catch (err) {
    console.warn("AI TTS request exception, falling back to browser speech:", err);
    speakWithBrowser();
  }
}
