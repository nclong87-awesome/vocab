import { useState, useRef, useCallback, useEffect } from "react";
import { getLanguageCode } from "../utils/ttsService";

interface UseSpeechToTextOptions {
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  language?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
}

/**
 * Removes immediate adjacent identical duplicate words or repeated phrase stutter
 * e.g. "Xin Xin chào" -> "Xin chào", "hello hello hello" -> "hello"
 */
export function removeImmediateWordDuplications(text: string): string {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return text.trim();

  const cleanedWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    const prev = cleanedWords[cleanedWords.length - 1];

    if (prev && current.toLowerCase() === prev.toLowerCase()) {
      continue;
    }
    cleanedWords.push(current);
  }

  return cleanedWords.join(" ");
}

/**
 * Merges speech recognition result pieces (final and interim),
 * intelligently resolving Android/Chrome overlapping utterances and duplication.
 */
export function mergeSpeechResults(results: any): string {
  if (!results || results.length === 0) return "";

  const pieces: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const text = (res?.[0]?.transcript || "").trim();
    if (text) {
      pieces.push(text);
    }
  }

  if (pieces.length === 0) return "";

  let combined = "";

  for (const piece of pieces) {
    if (!combined) {
      combined = piece;
      continue;
    }

    const lowerCombined = combined.toLowerCase().trim();
    const lowerPiece = piece.toLowerCase().trim();

    // 1. If the new piece already contains the combined text from the beginning
    // e.g. combined = "Xin", piece = "Xin chào" -> combined becomes "Xin chào"
    if (lowerPiece.startsWith(lowerCombined)) {
      combined = piece;
      continue;
    }

    // 2. If the current combined already ends with the new piece or contains it completely
    // e.g. combined = "Xin chào", piece = "chào" or "Xin chào"
    if (lowerCombined.endsWith(lowerPiece) || lowerCombined === lowerPiece) {
      continue;
    }

    // 3. If combined starts with piece
    if (lowerCombined.startsWith(lowerPiece)) {
      continue;
    }

    // 4. Overlap resolution by word tokens (e.g. combined="Xin chào", piece="chào bạn" -> "Xin chào bạn")
    const combWords = combined.split(/\s+/);
    const pieceWords = piece.split(/\s+/);

    let maxOverlap = 0;
    const maxCheck = Math.min(combWords.length, pieceWords.length);
    for (let len = maxCheck; len >= 1; len--) {
      const endOfComb = combWords.slice(-len).map(w => w.toLowerCase()).join(" ");
      const startOfPiece = pieceWords.slice(0, len).map(w => w.toLowerCase()).join(" ");
      if (endOfComb === startOfPiece) {
        maxOverlap = len;
        break;
      }
    }

    if (maxOverlap > 0) {
      const remainder = pieceWords.slice(maxOverlap).join(" ");
      if (remainder) {
        combined = `${combined} ${remainder}`;
      }
    } else {
      // 5. Character-level overlap check for attached words
      let charOverlap = 0;
      const minCharLen = Math.min(combined.length, piece.length);
      for (let clen = minCharLen; clen >= 2; clen--) {
        if (combined.slice(-clen).toLowerCase() === piece.slice(0, clen).toLowerCase()) {
          charOverlap = clen;
          break;
        }
      }

      if (charOverlap > 0) {
        combined = combined + piece.slice(charOverlap);
      } else {
        combined = `${combined} ${piece}`;
      }
    }
  }

  // 6. Final pass: sanitize any duplicate words
  return removeImmediateWordDuplications(combined);
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isExplicitStopRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
    }
  }, []);

  const stopListening = useCallback(() => {
    isExplicitStopRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Failed to stop speech recognition:", e);
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    (langOverride?: string) => {
      if (typeof window === "undefined") return;

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        optionsRef.current.onError?.("Speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari.");
        return;
      }

      // Stop any existing session
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }

      isExplicitStopRef.current = false;

      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;

        const { language, nativeLanguage, targetLanguage } = optionsRef.current;
        const effectiveLang = langOverride || language || nativeLanguage || targetLanguage || "en-US";
        const langCode = effectiveLang.includes("-") ? effectiveLang : getLanguageCode(effectiveLang);
        recognition.lang = langCode;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          const combined = mergeSpeechResults(event.results);
          if (combined && optionsRef.current.onTranscript) {
            const isFinal = event.results?.[event.results.length - 1]?.isFinal ?? false;
            optionsRef.current.onTranscript(combined, isFinal);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
          setIsListening(false);

          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            optionsRef.current.onError?.("Microphone permission was denied. Please allow microphone access in your browser to use voice input.");
          } else if (event.error === "audio-capture") {
            optionsRef.current.onError?.("No microphone found. Please connect a microphone and try again.");
          } else if (event.error === "network") {
            optionsRef.current.onError?.("Network error occurred during speech recognition. Please check your connection.");
          } else if (event.error !== "no-speech" && event.error !== "aborted") {
            optionsRef.current.onError?.(`Voice input error: ${event.error}`);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
          recognitionRef.current = null;
        };

        // This prompts microphone permission in the browser ONLY upon this explicit user click
        recognition.start();
      } catch (err: any) {
        console.error("Failed to start speech recognition:", err);
        setIsListening(false);
        optionsRef.current.onError?.(err?.message || "Failed to start speech recognition.");
      }
    },
    []
  );

  const toggleListening = useCallback(
    (langOverride?: string) => {
      if (isListening) {
        stopListening();
      } else {
        startListening(langOverride);
      }
    },
    [isListening, startListening, stopListening]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
    toggleListening,
  };
}

