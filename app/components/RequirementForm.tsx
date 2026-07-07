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
  url: string;
  mimeType: string;
  durationSec: number;
}

interface ExtractionState {
  requirementId: string;
  requirementType: string;
  storagePaths: string[];
  extractedData: Record<string, unknown> | null;
  modelUsed: string | null;
  aiError: string | null;
}

interface BrandResult {
  brand_name: string;
  brand_id: string;
  supply_tl_id: string | null;
  supply_tl_name: string | null;
}

interface ProductResult {
  product_id: string;
  product_name: string;
  category_name: string | null;
  image: string | null;
  article_code: string | null;
  bijnis_buyer_id: string | null;
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
  const typeRef = useRef(type);
  useEffect(() => { typeRef.current = type; }, [type]);

  // ── Shared state ────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);

  // ── Non-Restock state ───────────────────────────────────────
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [notes, setNotes] = useState("");

  // ── Restock state ───────────────────────────────────────────
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<BrandResult | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<ProductResult[]>([]);
  const [remarks, setRemarks] = useState("");
  const [showBrandSheet, setShowBrandSheet] = useState(false);
  const [showProductSheet, setShowProductSheet] = useState(false);

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

  async function compressImage(file: File): Promise<File> {
    const MAX_BYTES = 800 * 1024;
    const MAX_DIM = 1000;
    if (file.size <= MAX_BYTES) return file;

    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width >= height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM; }
          else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file),
          "image/jpeg",
          0.75,
        );
      };
      img.src = objectUrl;
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const compressed = await Promise.all(files.map(compressImage));
    const newImages = compressed.map((file, i) => ({
      id: `${files[i].name}-${Date.now()}`,
      url: URL.createObjectURL(file),
      name: files[i].name,
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
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const url = URL.createObjectURL(blob);
        const duration = recordingSecondsRef.current;
        setVoiceNote({ blob, url, mimeType: finalMime, durationSec: duration });
        setIsRecording(false);
        cleanupStream();

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
              if (typeRef.current === "Restock") {
                setRemarks((prev) => prev ? `${prev}\n\n${json.transcript}` : json.transcript);
              } else {
                setNotes((prev) => prev ? `${prev}\n\n${json.transcript}` : json.transcript);
              }
            }
          })
          .catch(() => {
            // Transcription failure is non-fatal
          })
          .finally(() => setIsTranscribing(false));
      };

      recorder.start();
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
    setExpiryDate("");
    setSelectedBrand(null);
    setSelectedProducts([]);
    setRemarks("");
    setShowBrandSheet(false);
    setShowProductSheet(false);
    setSubmitError(null);
    setIsExtracting(false);
  }

  // ── Submit handler ──────────────────────────────────────────
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    if (type === "Restock") {
      await handleRestockSubmit();
      return;
    }

    await handleAIExtractionSubmit();
  }

  async function handleRestockSubmit() {
    if (!expiryDate) {
      setSubmitError("Please select an expected delivery date.");
      return;
    }
    if (!selectedBrand) {
      setSubmitError("Please select a label name.");
      return;
    }
    if (selectedProducts.length === 0) {
      setSubmitError("Please select at least one product for restock.");
      return;
    }

    setIsSubmitting(true);
    let requirementId: string;

    try {
      const formData = new FormData();
      formData.append("userId", String(userId));
      formData.append("type", "Restock");
      formData.append("expiryDate", expiryDate);
      formData.append("labelName", selectedBrand.brand_name);
      formData.append("labelId", selectedBrand.brand_id);

      const categoryName = selectedProducts[0]?.category_name ?? "";
      formData.append("categoryName", categoryName);
      formData.append("remarks", remarks);

      const productsPayload = selectedProducts.map((p) => ({
        product_id: p.product_id,
        product_name: p.product_name,
      }));
      formData.append("products", JSON.stringify(productsPayload));

      // Send first image of each product so server can attach them to the requirement
      const productImages: Record<string, string> = {};
      for (const p of selectedProducts) {
        const firstImg = p.image?.split(",")[0]?.trim();
        if (firstImg) productImages[p.product_id] = firstImg;
      }
      if (Object.keys(productImages).length > 0) {
        formData.append("productImages", JSON.stringify(productImages));
      }

      if (voiceNote) {
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

      requirementId = json.data.id;

      // Finalize: run assignment and set OPEN
      const bijnisBuyerId = selectedProducts.find((p) => p.bijnis_buyer_id)?.bijnis_buyer_id ?? null;

      const patchRes = await fetch(`/api/requirements/${requirementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(userId),
          type: "RESTOCK",
          label_name: selectedBrand.brand_name,
          label_id: selectedBrand.brand_id,
          category_name: categoryName || null,
          expiry_date: expiryDate,
          remarks: remarks || null,
          products: productsPayload,
          bijnis_buyer_id: bijnisBuyerId,
          supply_tl_id: selectedBrand.supply_tl_id ?? null,
        }),
      });

      if (!patchRes.ok) {
        const patchJson = await patchRes.json().catch(() => ({}));
        setSubmitError(patchJson.error ?? "Failed to finalize requirement.");
        return;
      }

      onSubmitSuccess();
      resetAll();
      onClose();
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAIExtractionSubmit() {
    setIsSubmitting(true);
    let requirementId: string;
    let storagePaths: string[];

    try {
      const formData = new FormData();
      formData.append("userId", String(userId));
      formData.append("type", type);
      formData.append("notes", notes);

      for (const img of images) {
        formData.append("images", img.file);
      }

      if (voiceNote) {
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

      requirementId = json.data.id;
      storagePaths  = json.data.storage_paths ?? [];
      onSubmitSuccess();
    } catch {
      setSubmitError("Network error — please try again.");
      return;
    } finally {
      setIsSubmitting(false);
    }

    // ── Step 2: Run AI extraction ──────────────────────────────
    setIsExtracting(true);
    try {
      const res = await fetch(`/api/requirements/${requirementId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementType: toDBType(type),
          notes,
          storagePaths,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setExtraction({
          requirementId,
          requirementType: toDBType(type),
          storagePaths,
          extractedData:   null,
          modelUsed:       null,
          aiError:         json.error ?? "Extraction failed",
        });
        return;
      }

      const { extracted_data, model_used, ai_error } = json.data;
      setExtraction({
        requirementId,
        requirementType: toDBType(type),
        storagePaths,
        extractedData:   extracted_data,
        modelUsed:       model_used,
        aiError:         ai_error ?? null,
      });
    } catch {
      setExtraction({
        requirementId,
        requirementType: toDBType(type),
        storagePaths,
        extractedData:   null,
        modelUsed:       null,
        aiError:         "Network error during extraction",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  function handleExtractionClose() {
    setExtraction(null);
    resetAll();
    onClose();
  }

  const isRestock = type === "Restock";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-20"
        onClick={extraction || isSubmitting || isExtracting ? undefined : () => { stopRecording(); onClose(); }}
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
            disabled={isSubmitting || isExtracting}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-4 py-5 overflow-y-auto flex-1">

          {/* Requirement Type — Pill Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-700">
              Requirement Type
            </label>
            <div className="flex gap-2">
              {REQUIREMENT_TYPES.map((t) => {
                const isSelected = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(isSelected ? "" : t)}
                    disabled={isSubmitting}
                    className={`flex-1 text-sm font-medium px-3 py-3 rounded-xl border transition-colors disabled:opacity-60 ${
                      isSelected
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-700 border-gray-200 hover:border-green-400 hover:text-green-600"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RESTOCK FIELDS ───────────────────────────────── */}
          {isRestock && (
            <>
              {/* Expected Delivery Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Expected Delivery Date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  required={isRestock}
                  disabled={isSubmitting}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
                />
              </div>

              {/* Select Label Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Label Name
                </label>
                {selectedBrand ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <span className="text-sm font-medium text-green-800">{selectedBrand.brand_name}</span>
                    <button
                      type="button"
                      onClick={() => { setSelectedBrand(null); setSelectedProducts([]); }}
                      className="text-green-600 hover:text-green-800 text-xs font-semibold"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBrandSheet(true)}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-green-400 hover:text-green-500 transition-colors disabled:opacity-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Select Label Name
                  </button>
                )}
              </div>

              {/* Select Products for Restock */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Products for Restock
                </label>
                {selectedProducts.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-1">
                    {selectedProducts.map((p) => (
                      <span key={p.product_id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full">
                        {p.product_name}
                        <button
                          type="button"
                          onClick={() => setSelectedProducts((prev) => prev.filter((x) => x.product_id !== p.product_id))}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowProductSheet(true)}
                  disabled={isSubmitting || !selectedBrand}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  {selectedBrand ? "Select Products" : "Select a label first"}
                </button>
              </div>

              {/* Remarks */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Remarks
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any remarks or context..."
                  rows={3}
                  disabled={isSubmitting}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none disabled:opacity-60"
                />
              </div>
            </>
          )}

          {/* ── NON-RESTOCK FIELDS ───────────────────────────── */}
          {!isRestock && type !== "" && (
            <>
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
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                />
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
                <p className="text-xs text-gray-500">
                  {type === "New Label" || type === "New Variety"
                    ? "Mention brand name, quantity needed, delivery deadline and appx price"
                    : "Make sure to mention Quantity, Deadline and Price information"}
                </p>
              </div>
            </>
          )}

          {/* Voice Note */}
          {micSupported && type !== "" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700">
                Voice Note
              </label>

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

              {isRecording && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
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

          {/* Error */}
          {submitError && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || isExtracting || isRecording || isTranscribing || !type}
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-base py-4 rounded-2xl transition-colors shadow-sm mt-1 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {(isSubmitting || isExtracting) ? (
              <>
                <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {isSubmitting ? "Saving..." : "Extracting..."}
              </>
            ) : (
              "Submit Requirement"
            )}
          </button>
        </form>
      </div>

      {/* Brand Search Bottom Sheet */}
      {showBrandSheet && (
        <BrandSearchSheet
          onClose={() => setShowBrandSheet(false)}
          onSelect={(brand) => { setSelectedBrand(brand); setShowBrandSheet(false); }}
        />
      )}

      {/* Product Selection Bottom Sheet */}
      {showProductSheet && selectedBrand && (
        <ProductSelectionSheet
          brandId={selectedBrand.brand_id}
          initialSelected={selectedProducts}
          onClose={() => setShowProductSheet(false)}
          onSave={(products) => { setSelectedProducts(products); setShowProductSheet(false); }}
        />
      )}

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

// ── Brand Search Bottom Sheet ─────────────────────────────────

function BrandSearchSheet({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (brand: BrandResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrandResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch("/api/brand-product/fuzzy-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label_name: query.trim(), limit: 10 }),
      });
      const json = await res.json();
      const suggestions: BrandResult[] = json.label?.suggestions ?? [];
      const exact: BrandResult | null = json.label?.exact ?? null;
      setResults(exact ? [exact, ...suggestions] : suggestions);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl w-full max-w-md mx-auto flex flex-col max-h-[80dvh] shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Select Label</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search brand name..."
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {searched && results.length === 0 && !loading && (
            <p className="text-sm text-gray-500 text-center py-8">No brands found. Try a different search.</p>
          )}
          <div className="flex flex-col gap-2">
            {results.map((brand) => (
              <button
                key={brand.brand_id}
                onClick={() => onSelect(brand)}
                className="w-full text-left bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-200 rounded-xl px-4 py-3 transition-colors"
              >
                <p className="text-sm font-semibold text-gray-900">{brand.brand_name}</p>
                {brand.supply_tl_name && (
                  <p className="text-xs text-gray-500 mt-0.5">TL: {brand.supply_tl_name}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Product Selection Bottom Sheet ────────────────────────────

function ProductSelectionSheet({
  brandId,
  initialSelected,
  onClose,
  onSave,
}: {
  brandId: string;
  initialSelected: ProductResult[];
  onClose: () => void;
  onSave: (products: ProductResult[]) => void;
}) {
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMap, setSelectedMap] = useState<Map<string, ProductResult>>(() => {
    const m = new Map<string, ProductResult>();
    for (const p of initialSelected) m.set(p.product_id, p);
    return m;
  });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/brands/${encodeURIComponent(brandId)}/products`);
        const json = await res.json();
        setProducts(json.data ?? []);
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [brandId]);

  const filtered = products.filter((p) =>
    p.product_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.article_code && p.article_code.toLowerCase().includes(search.toLowerCase()))
  );

  function toggleProduct(p: ProductResult) {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(p.product_id)) {
        next.delete(p.product_id);
      } else {
        next.set(p.product_id, p);
      }
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl w-full max-w-md mx-auto flex flex-col max-h-[85dvh] shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Select Products</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 py-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-gray-100 rounded-2xl animate-pulse aspect-[3/4]" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No products found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 py-2">
              {filtered.map((p) => {
                const isSelected = selectedMap.has(p.product_id);
                return (
                  <button
                    key={p.product_id}
                    type="button"
                    onClick={() => toggleProduct(p)}
                    className={`relative bg-white border rounded-2xl p-2.5 flex flex-col gap-2 text-left transition-all ${
                      isSelected
                        ? "border-green-500 ring-2 ring-green-200 shadow-sm"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 ${
                      isSelected ? "bg-green-500 border-green-500" : "bg-white border-gray-300"
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Image */}
                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-100">
                      {p.image ? (
                        <img
                          src={p.image.split(",")[0]?.trim() ?? p.image}
                          alt={p.product_name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No image</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2">{p.product_name}</p>
                      {p.article_code && (
                        <p className="text-[10px] text-gray-500">Code: {p.article_code}</p>
                      )}
                      {p.category_name && (
                        <p className="text-[10px] text-gray-400">{p.category_name}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-4 py-3 border-t border-gray-100 bg-white">
          <button
            onClick={() => onSave(Array.from(selectedMap.values()))}
            disabled={selectedMap.size === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold text-base py-3.5 rounded-2xl transition-colors shadow-sm disabled:cursor-not-allowed"
          >
            Save {selectedMap.size > 0 ? `(${selectedMap.size} selected)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
