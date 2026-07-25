"use client";

import { useRef, useState } from "react";

interface UseSpeechRecognitionOptions {
  onFinalResult: (transcript: string) => void;
  onInterimResult?: (transcript: string) => void;
}

// Thin wrapper around the Web Speech API for push-to-talk voice input.
// `continuous: false` means recognition naturally ends after a pause in
// speech, which we use as the "end of turn" signal rather than requiring
// an explicit stop action.
export function useSpeechRecognition({ onFinalResult, onInterimResult }: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const isSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function start() {
    if (!isSupported || isListening) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (final.trim()) onFinalResult(final.trim());
      else if (interim.trim()) onInterimResult?.(interim.trim());
    };

    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone access denied." : "Voice input error — please try again.");
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    setError(null);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
  }

  return { isSupported, isListening, error, start, stop };
}
