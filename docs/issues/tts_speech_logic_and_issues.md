# Answer Feedback TTS Speech Logic & Known Issues Report

## 1. Executive Summary
This document provides the complete logic, implementation details, and analysis of potential failure modes for generating and playing TTS (Text-To-Speech) answer feedback in the Quiz view (e.g., `"Incorrect! Correct answer: \"Gambit\""`).

---

## 2. Current Implementation Logic

### A. Feedback Text Generation (`src/components/QuizView.tsx`)
When a user submits or verifies an answer in a quiz:

```typescript
// 1. Text definition when evaluating answer in QuizView.tsx:
const feedbackAudioMessage = isCorrect
  ? "Correct!"
  : `Incorrect! Correct answer: "${currentQuestion.correctAnswer}"`;

// 2. Triggering Speech:
if (autoPlayAudio) {
  speakText(feedbackAudioMessage, "en-US", "feedback");
}

// 3. User can also manually trigger replay via button:
<button onClick={() => speakText(feedbackTextToSpeak, "en-US", "feedback")}>
  Replay Feedback
</button>
```

### B. Client-Side Speech Dispatcher (`src/components/QuizView.tsx`)
```typescript
const speakText = (text: string, customLang?: string, audioId?: string) => {
  const id = audioId || "default";
  const langCode = customLang || getLanguageCode(targetLanguage);

  setSpeakingId(id);

  speakTextService(
    text,
    ttsConfig,
    llmConfig,
    langCode,
    () => {
      // onStart callback
    },
    () => {
      // onEnd callback - clears active audio ID
      setSpeakingId((prev) => (prev === id ? null : prev));
    }
  );
};
```

### C. Text Normalization Pipeline (`src/utils/ttsService.ts`)
Before text is sent to the browser `SpeechSynthesisUtterance` or backend AI TTS engine (`/api/tts`), it passes through `normalizeTextForTTS()`:

```typescript
export function normalizeTextForTTS(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // 1. Control chars & zero-width spaces
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F]/g, " ");

  // 2. Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, " ");

  // 3. Strip Emojis & non-speech symbols (e.g. ★, ☆, ●, ✔, ✕)
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, "");
  cleaned = cleaned.replace(/[★☆●•►▪✦✧✔✕✖✓✗➔→←⇒▲▼♦♠♣♥]/g, " ");

  // 4. Markdown stripping
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");

  // 5. Fill-in-the-blank normalization
  cleaned = cleaned.replace(/_{2,}/g, " blank ");

  // 6. Quotes & punctuation cleanup
  cleaned = cleaned.replace(/["“”«»„‟]/g, ""); // Removes double quotes so "Gambit" becomes Gambit
  cleaned = cleaned.replace(/['‘’]/g, "'");

  // 7. Whitespace collapse
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned || text.trim();
}
```

Result for `Incorrect! Correct answer: "Gambit"`:
`"Incorrect! Correct answer: Gambit"`

### D. Audio Engine Routing (`src/utils/ttsService.ts`)
1. **Engine Selection**:
   - If `ttsConfig.engine === 'web'` or no API key exists for AI TTS, it uses Native Web Speech API (`window.speechSynthesis`).
   - If `ttsConfig.engine === 'gemini'` or `elevenlabs` or `openai`, it sends POST to `/api/tts`.

2. **Web Speech API Flow**:
   - Cancels ongoing speech with `window.speechSynthesis.cancel()`.
   - Creates `utterance = new SpeechSynthesisUtterance(normalizedText)`.
   - Sets `utterance.lang = customLang` (`"en-US"`).
   - Stores reference on `(window as any)._activeUtteranceRef = utterance` (to prevent Chromium garbage collection bugs).
   - Calls `window.speechSynthesis.speak(utterance)`.

3. **Server-Side API Flow (`/server.ts`)**:
   - POST `/api/tts` receives `{ text, engine, model, voice, apiKey, llmConfig }`.
   - Generates PCM/WAV audio stream or Base64 data URI using Google Gemini 2.0 / 3.1 Flash Speech / ElevenLabs / OpenAI.
   - Client caches audio base64 in `ttsAudioCache` map and plays via `HTMLAudioElement`.

---

## 3. Unresolved Technical Issues / Potential Failure Modes

### Issue 1: Browser Autoplay Policy Blocking
- **Symptom**: Auto-play feedback on answer selection produces no sound.
- **Cause**: Modern web browsers (Chrome, Safari, Firefox) strictly block audio playback (`speechSynthesis.speak()` or `Audio.play()`) if initiated outside a direct, synchronous user gesture stack.
- **Detail**: When `autoPlayAudio` triggers in `handleAnswer`, if state updates (such as React state batching) defer `speakText()` into a microtask or event loop tick, browsers reject audio output without throwing an error.

### Issue 2: Immediate Cancellation from Rapid Re-renders or Voice Switches
- **Symptom**: Audio starts for 10ms and immediately stops or cuts off.
- **Cause**: `stopSpeech()` is called inside `speakText()` to stop previous sounds:
  ```typescript
  export function stopSpeech(): void {
    currentSpeechToken++; // invalidates previous async callbacks
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioElement) {
      activeAudioElement.pause();
    }
  }
  ```
- **Detail**: If `speakText()` is invoked multiple times in quick succession (e.g. reading option hover/click + answer feedback triggering simultaneously), the second call cancels the first call before it finishes playing.

### Issue 3: Web Speech Voice Loading Async Delays
- **Symptom**: `window.speechSynthesis.getVoices()` returns empty array `[]` on initial page load in Chrome.
- **Cause**: Speech voices load asynchronously in browser runtimes. If `speakText()` tries to match an `"en-US"` voice before `voiceschanged` event fires, Chrome falls back to system default or silent state.

### Issue 4: Chromium Garbage Collection Bug
- **Symptom**: Long sentences stop halfway through speech without triggering `onend`.
- **Cause**: V8 JavaScript engine garbage-collects `SpeechSynthesisUtterance` instances if not pinned globally.
- **Current Mitigation**: Pinned to `(window as any)._activeUtteranceRef = utterance`, but edge cases exist when multiple utterances are queued.

### Issue 5: Server API Key Configuration for AI Engines
- **Symptom**: Server returns 400 or 500 when engine is set to `gemini` / `openai` / `elevenlabs`.
- **Cause**: Missing `GEMINI_API_KEY` or missing third-party credentials in environment variables, or missing fallback to Web Speech API when server request fails.

---

## 4. Key Code Files
- `src/utils/ttsService.ts`: Core TTS client dispatcher, normalization, and Web Speech wrapper.
- `src/components/QuizView.tsx`: Quiz question state and feedback speech invoker.
- `server.ts`: Backend `/api/tts` endpoint for Gemini/OpenAI/ElevenLabs TTS generation.
