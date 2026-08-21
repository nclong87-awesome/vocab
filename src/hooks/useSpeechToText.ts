import { useState, useRef, useCallback, useEffect } from "react";
import { getLanguageCode } from "../utils/ttsService";

interface UseSpeechToTextOptions {
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  targetLanguage?: string;
  nativeLanguage?: string;
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}) {
  const { onTranscript, onError, targetLanguage } = options;
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isExplicitStopRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        onError?.("Speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari.");
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

        const langCode = langOverride || (targetLanguage ? getLanguageCode(targetLanguage) : "en-US");
        recognition.lang = langCode;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          let final = "";

          for (let i = 0; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
              final += res[0].transcript;
            } else {
              interim += res[0].transcript;
            }
          }

          const combined = (final + (interim ? " " + interim : "")).trim();
          if (combined && onTranscript) {
            onTranscript(combined, !interim);
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Speech recognition error:", event.error);
          setIsListening(false);

          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            onError?.("Microphone permission was denied. Please allow microphone access in your browser to use voice input.");
          } else if (event.error === "audio-capture") {
            onError?.("No microphone found. Please connect a microphone and try again.");
          } else if (event.error === "network") {
            onError?.("Network error occurred during speech recognition. Please check your connection.");
          } else if (event.error !== "no-speech" && event.error !== "aborted") {
            onError?.(`Voice input error: ${event.error}`);
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
        onError?.(err?.message || "Failed to start speech recognition.");
      }
    },
    [targetLanguage, onTranscript, onError]
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
