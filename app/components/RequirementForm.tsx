"use client";

import { useEffect, useRef, useState } from "react";
import { toDBType } from "@/lib/requirement-type.map";
import ExtractionReview from "./ExtractionReview";

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

interface VoiceNote {
  blob: Blob;
  url: string;      // object URL for local playback
  mimeType: string;
  durationSec: number;
}

interface ExtractionState {
  requirementId: string;
  requirementType: string;   // DB enum
  storagePaths: string[];
  extractedData: Record<string, unknown> | null;
  modelUsed: string | null;
  aiError: string | null;
}

// Pick the best supported audio MIME type for MediaRecorder
function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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

  // ── Voice note state ────────────────────────────────────────
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micSupported, setMicSupported] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingSecondsRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Check mic support client-side
  useEffect(() => {
    if (typeof window !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
      setMicSupported(true);
    }
  }, []);

  // Clean up object URLs and streams on unmount / close
  useEffect(() => {
    return () => {
      cleanupStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

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

  // ── Voice recording ─────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || mimeType || "audio/webm";
        // All chunks are now guaranteed flushed — requestData() was called before stop()
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const url = URL.createObjectURL(blob);
        const duration = recordingSecondsRef.current;
        setVoiceNote({ blob, url, mimeType: finalMime, durationSec: duration });
        setIsRecording(false);
        cleanupStream();

        // Transcribe and append to notes
        setIsTranscribing(true);
        const ext = finalMime.includes("mp4") ? "mp4"
          : finalMime.includes("ogg") ? "ogg"
          : "webm";
        const audioFile = new File([blob], `voice-note.${ext}`, { type: finalMime });
        const fd = new FormData();
        fd.append("audio", audioFile);
        fetch("/api/transcribe", { method: "POST", body: fd })
          .then((res) => res.json())
          .then((json) => {
            if (json.transcript) {
              setNotes((prev) =>
                prev ? `${prev}\n\n${json.transcript}` : json.transcript
              );
            }
          })
          .catch(() => {
            // Transcription failure is non-fatal — user can still type notes manually
          })
          .finally(() => setIsTranscribing(false));
      };

      recorder.start(); // no timeslice — all data flushed in one chunk on stop
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;

      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          recordingSecondsRef.current = s + 1;
          return s + 1;
        });
      }, 1000);
    } catch {
      setSubmitError("Microphone access denied. Please allow mic permissions and try again.");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  function deleteVoiceNote() {
    if (voiceNote) URL.revokeObjectURL(voiceNote.url);
    setVoiceNote(null);
    setRecordingSeconds(0);
  }

  function resetAll() {
    deleteVoiceNote();
    stopRecording();
    setType("");
    setImages([]);
    setNotes("");
    setSubmitError(null);
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("userId", String(userId));
      formData.append("type", type);
      formData.append("notes", notes);

      for (const img of images) {
        formData.append("images", img.file);
      }

      if (voiceNote) {
        // Derive a sensible file extension from MIME type
        const ext = voiceNote.mimeType.includes("mp4") ? "mp4"
          : voiceNote.mimeType.includes("ogg") ? "ogg"
          : "webm";
        const voiceFile = new File([voiceNote.blob], `voice-note.${ext}`, { type: voiceNote.mimeType });
        formData.append("voiceNote", voiceFile);
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

      onSubmitSuccess();

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
    resetAll();
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
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
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

            {/* Camera input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
            {/* Gallery input */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-green-400 hover:text-green-500 transition-colors disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Camera
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-green-400 hover:text-green-500 transition-colors disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Gallery
              </button>
            </div>
          </div>

          {/* Voice Note */}
          {micSupported && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700">
                Voice Note
              </label>

              {/* No recording in progress, no voice note saved yet */}
              {!isRecording && !voiceNote && (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-purple-400 hover:text-purple-500 transition-colors disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
                    <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
                  </svg>
                  Record Voice Note
                </button>
              )}

              {/* Recording in progress */}
              {isRecording && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {/* Pulsing dot */}
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
                  </span>
                  <span className="text-sm text-red-700 font-medium flex-1">
                    Recording… {formatDuration(recordingSeconds)}
                  </span>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                    Stop
                  </button>
                </div>
              )}

              {/* Recorded voice note — playback + delete */}
              {voiceNote && !isRecording && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-purple-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
                      <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm text-purple-700 font-medium flex-1">
                      Voice note — {formatDuration(voiceNote.durationSec)}
                    </span>
                    <button
                      type="button"
                      onClick={deleteVoiceNote}
                      disabled={isSubmitting}
                      aria-label="Delete voice note"
                      className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="3 6 5 6 21 6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14H6L5 6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v6M14 11v6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                  {/* Native audio player for playback */}
                  <audio
                    src={voiceNote.url}
                    controls
                    className="w-full h-8"
                    style={{ accentColor: "#7c3aed" }}
                  />
                  {isTranscribing ? (
                    <p className="text-xs text-purple-500 flex items-center gap-1.5">
                      <svg className="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Transcribing…
                    </p>
                  ) : (
                    <p className="text-xs text-purple-400">
                      Not happy? Delete and record again.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes or context..."
              rows={4}
              disabled={isSubmitting}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none disabled:opacity-60"
            />
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
            disabled={isSubmitting || isRecording || isTranscribing}
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-base py-4 rounded-2xl transition-colors shadow-sm mt-1 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          userId={String(userId)}
          initialExtraction={extraction.extractedData}
          modelUsed={extraction.modelUsed}
          onClose={handleExtractionClose}
          onSaved={onSubmitSuccess}
        />
      )}
    </>
  );
}
