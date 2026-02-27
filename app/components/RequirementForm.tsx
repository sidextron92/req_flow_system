"use client";

import { useEffect, useRef, useState } from "react";
import { toDBType } from "@/lib/requirement-type.map";
import ExtractionReview from "./ExtractionReview";

// Minimal interface for the Web Speech API (covers standard + webkit prefix)
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
}
interface ISpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: { isFinal: boolean; 0: { transcript: string } }[];
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
}

const REQUIREMENT_TYPES = ["Restock", "New Label", "New Variety"] as const;

interface RequirementFormProps {
  isOpen: boolean;
  userId: number;
  onClose: () => void;
  onSubmitSuccess: () => void;
}

interface UploadedImage {
  id: string;
  url: string;
  name: string;
  file: File;
}

interface ExtractionState {
  requirementId: string;
  requirementType: string;   // DB enum
  storagePaths: string[];
  extractedData: Record<string, unknown> | null;
  modelUsed: string | null;
  aiError: string | null;
}

export default function RequirementForm({
  isOpen,
  userId,
  onClose,
  onSubmitSuccess,
}: RequirementFormProps) {
  const [type, setType] = useState<string>("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);

  // ── Voice note state ───────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check speech recognition support client-side
  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognition());
  }, []);

  if (!isOpen) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newImages = files.map((file) => ({
      id: `${file.name}-${Date.now()}`,
      url: URL.createObjectURL(file),
      name: file.name,
      file,
    }));
    setImages((prev) => [...prev, ...newImages]);
    e.target.value = "";
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }

  // ── Voice recording ────────────────────────────────────────
  function startRecording() {
    const SR = getSpeechRecognition();
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setNotes((prev) => (prev ? `${prev} ${final}`.trim() : final.trim()));
      }
      setInterimText(interim);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      setInterimText("");
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimText("");
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
    setInterimText("");
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
    setInterimText("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("userId", String(userId));
      formData.append("type", type);           // UI value — route maps to DB enum
      formData.append("notes", notes);

      for (const img of images) {
        formData.append("images", img.file);
      }

      const res = await fetch("/api/requirements", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setSubmitError(json.error ?? "Submission failed. Please try again.");
        return;
      }

      const { id, extracted_data, model_used, storage_paths, ai_error } = json.data;

      // Signal parent to refresh list
      onSubmitSuccess();

      // Show ExtractionReview — keep form open underneath
      // ai_error is passed so the modal can display it instead of the generic message
      setExtraction({
        requirementId:   id,
        requirementType: toDBType(type),
        storagePaths:    storage_paths ?? [],
        extractedData:   extracted_data,
        modelUsed:       model_used,
        aiError:         ai_error ?? null,
      });
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleExtractionClose() {
    setExtraction(null);
    // Reset form
    setType("");
    setImages([]);
    setNotes("");
    stopRecording();
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-20"
        onClick={extraction ? undefined : () => { stopRecording(); onClose(); }}
      />

      {/* Bottom Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-30 max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Requirement</h2>
          <button
            onClick={() => { stopRecording(); onClose(); }}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full"
            aria-label="Close"
            disabled={isSubmitting}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-4 py-5 overflow-y-auto flex-1">
          {/* Requirement Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700">
              Requirement Type
            </label>
            <div className="relative">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                required
                disabled={isSubmitting}
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
              >
                <option value="" disabled>Select a type...</option>
                {REQUIREMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Upload Images */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700">
              Upload Images
            </label>

            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-1">
                {images.map((img) => (
                  <div key={img.id} className="relative w-20 h-20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-20 h-20 object-cover rounded-xl border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      disabled={isSubmitting}
                      className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs disabled:opacity-50"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Images
            </button>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Notes
              </label>
              {speechSupported && (
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isSubmitting}
                  aria-label={isRecording ? "Stop recording" : "Record voice note"}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
                    isRecording
                      ? "bg-red-100 text-red-600 hover:bg-red-200"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {isRecording ? (
                    <>
                      {/* Pulsing red dot */}
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                      </span>
                      Stop
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
                        <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
                      </svg>
                      Voice
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes or context..."
              rows={4}
              disabled={isSubmitting}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-60"
            />
            {/* Interim transcript */}
            {isRecording && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <span className="relative flex h-2 w-2 mt-1 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                </span>
                <p className="text-xs text-red-700 leading-snug">
                  {interimText || "Listening…"}
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {submitError && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-base py-4 rounded-2xl transition-colors shadow-sm mt-1 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Saving &amp; Extracting...
              </>
            ) : (
              "Submit Requirement"
            )}
          </button>
        </form>
      </div>

      {/* ExtractionReview overlays on top once submission is done */}
      {extraction && (
        <ExtractionReview
          requirementId={extraction.requirementId}
          requirementType={extraction.requirementType}
          notes={notes}
          storagePaths={extraction.storagePaths}
          initialExtraction={extraction.extractedData}
          modelUsed={extraction.modelUsed}
          initialAiError={extraction.aiError}
          onClose={handleExtractionClose}
          onSaved={onSubmitSuccess}
        />
      )}
    </>
  );
}
