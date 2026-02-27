"use client";

import { useEffect, useRef, useState } from "react";
import { getSystemPrompt } from "@/lib/ai.config";
import { validateExtraction, type ValidationResult } from "@/lib/extraction-validation";

interface ExtractionReviewProps {
  requirementId: string;
  requirementType: string;   // DB enum value e.g. "RESTOCK"
  notes: string;
  storagePaths: string[];
  initialExtraction: Record<string, unknown> | null;
  modelUsed: string | null;
  initialAiError: string | null;
  onClose: () => void;
  onSaved: () => void;       // called after successful Done → triggers list refresh
}

type ChatMessage =
  | { role: "assistant"; text: string }
  | { role: "user"; text: string };

type ViewState = "extraction" | "chat" | "success";

export default function ExtractionReview({
  requirementId,
  requirementType,
  notes,
  storagePaths,
  initialExtraction,
  modelUsed,
  initialAiError,
  onClose,
  onSaved,
}: ExtractionReviewProps) {
  // ── Extraction / re-run state ──────────────────────────────
  const [systemPrompt, setSystemPrompt]     = useState(() => getSystemPrompt(requirementType));
  const [extraction, setExtraction]         = useState(initialExtraction);
  const [currentModel, setCurrentModel]     = useState(modelUsed);
  const [isRerunning, setIsRerunning]       = useState(false);
  const [rerunError, setRerunError]         = useState<string | null>(initialAiError);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // ── Done / save state ──────────────────────────────────────
  const [isSaving, setIsSaving]             = useState(false);
  const [saveError, setSaveError]           = useState<string | null>(null);

  // ── Chat state ─────────────────────────────────────────────
  const [view, setView]                     = useState<ViewState>("extraction");
  const [chatMessages, setChatMessages]     = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]           = useState("");
  const [isFilling, setIsFilling]           = useState(false);
  const [fillError, setFillError]           = useState<string | null>(null);
  const [pendingValidation, setPendingValidation] = useState<ValidationResult | null>(null);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Re-run extraction ──────────────────────────────────────
  async function handleRerun() {
    setIsRerunning(true);
    setRerunError(null);

    try {
      const res = await fetch("/api/ai/re-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirementId, requirementType, notes, systemPrompt, storagePaths }),
      });

      const json = await res.json();

      if (!res.ok) {
        setRerunError(json.error ?? "Re-extraction failed");
        return;
      }

      setExtraction(json.data.extracted_data);
      setCurrentModel(json.data.model_used);
    } catch {
      setRerunError("Network error — please try again");
    } finally {
      setIsRerunning(false);
    }
  }

  // ── Save to DB ─────────────────────────────────────────────
  async function saveRequirement(finalExtraction: Record<string, unknown>): Promise<boolean> {
    setIsSaving(true);
    setSaveError(null);

    const products = Array.isArray(finalExtraction.products)
      ? (finalExtraction.products as Record<string, unknown>[]).map((p) => ({
          product_name: String(p.product_name ?? ""),
          product_id:   p.product_id != null ? String(p.product_id) : null,
          notes:        p.notes      != null ? String(p.notes)      : null,
        }))
      : [];

    try {
      const res = await fetch(`/api/requirements/${requirementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label_name:     finalExtraction.label_name    ?? null,
          category_name:  finalExtraction.category_name ?? null,
          expiry_date:    finalExtraction.expiry_date   ?? null,
          qty_required:   finalExtraction.qty_required  ?? null,
          remarks:        finalExtraction.remarks        ?? null,
          products,
          extracted_data: finalExtraction,
          model_used:     currentModel ?? "unknown",
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setSaveError(json.error ?? "Save failed");
        return false;
      }

      return true;
    } catch {
      setSaveError("Network error — could not save");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  // ── Done button clicked ────────────────────────────────────
  async function handleDone() {
    if (!extraction) return;

    const validation = validateExtraction(extraction, requirementType);

    if (validation.valid) {
      const ok = await saveRequirement(extraction);
      if (ok) {
        onSaved();
        onClose();
      }
      return;
    }

    // Missing fields — open chat
    setPendingValidation(validation);
    setChatMessages([{ role: "assistant", text: buildAskMessage(validation.missingFields) }]);
    setView("chat");
  }

  // ── Chat: user sends a message ─────────────────────────────
  async function handleChatSend() {
    const userText = chatInput.trim();
    if (!userText || isFilling || !pendingValidation || !extraction) return;

    setChatInput("");
    setFillError(null);
    setChatMessages((prev) => [...prev, { role: "user", text: userText }]);
    setIsFilling(true);

    try {
      const res = await fetch("/api/ai/fill-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementType,
          currentExtraction: extraction,
          missingKeys: pendingValidation.missingKeys,
          userMessage: userText,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setFillError(json.error ?? "AI could not process your reply");
        setIsFilling(false);
        return;
      }

      const updated: Record<string, unknown> = json.data.updated_extraction;
      setExtraction(updated);

      const newValidation = validateExtraction(updated, requirementType);
      setPendingValidation(newValidation);

      if (newValidation.valid) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Got it! All details are now complete. Saving your requirement..." },
        ]);
        setIsFilling(false);

        const ok = await saveRequirement(updated);
        if (ok) {
          setView("success");
          onSaved();
        } else {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", text: "There was an error saving. Please try again." },
          ]);
        }
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", text: buildAskMessage(newValidation.missingFields) },
        ]);
        setIsFilling(false);
      }
    } catch {
      setFillError("Network error — please try again");
      setIsFilling(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function buildAskMessage(missingFields: string[]): string {
    if (missingFields.length === 1) {
      return `I still need one more detail to complete this requirement:\n\n• ${missingFields[0]}\n\nCould you please provide that?`;
    }
    return `I still need a few more details:\n\n${missingFields.map((f) => `• ${f}`).join("\n")}\n\nCould you please provide these?`;
  }

  // ── Render extraction fields ───────────────────────────────
  function renderExtraction(data: Record<string, unknown>) {
    const skip = new Set(["confidence", "extraction_notes"]);
    const topFields = Object.entries(data).filter(([k]) => !skip.has(k));

    return (
      <div className="flex flex-col gap-3">
        {topFields.map(([key, value]) => {
          if (key === "products" && Array.isArray(value)) {
            return (
              <div key={key}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Products</p>
                <div className="flex flex-col gap-2">
                  {value.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">None identified</p>
                  ) : (
                    (value as Record<string, unknown>[]).map((p, i) => {
                      const pName  = p.product_name != null ? String(p.product_name) : "—";
                      const pId    = p.product_id   != null ? String(p.product_id)   : null;
                      const pNotes = p.notes         != null ? String(p.notes)         : null;
                      return (
                        <div key={i} className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                          <p className="text-sm font-medium text-gray-800">{pName}</p>
                          {pId    && <p className="text-xs text-gray-500">ID: {pId}</p>}
                          {pNotes && <p className="text-xs text-gray-500 mt-0.5">{pNotes}</p>}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          }

          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const isEmpty = value === null || value === undefined;

          return (
            <div key={key} className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm">
                {isEmpty
                  ? <span className="text-gray-400 italic">Not found</span>
                  : <span className="text-gray-800">{String(value)}</span>}
              </p>
            </div>
          );
        })}

        {data.confidence != null && typeof data.confidence === "object" && (() => {
          const conf = data.confidence as Record<string, number>;
          return (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Confidence</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(conf).map(([field, score]) => (
                  <span
                    key={field}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      score >= 0.8 ? "bg-green-100 text-green-700"
                        : score >= 0.5 ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {field}: {Math.round(score * 100)}%
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {data.extraction_notes != null && (() => {
          const note = String(data.extraction_notes);
          return (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Model Notes</p>
              <p className="text-xs text-amber-800">{note}</p>
            </div>
          );
        })()}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — only dismissable on extraction view */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={view === "extraction" ? onClose : undefined}
      />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[92dvh]">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* ── SUCCESS VIEW ──────────────────────────────────────── */}
        {view === "success" && (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 flex-1">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-900 text-center">All details submitted!</p>
            <p className="text-sm text-gray-500 text-center">
              Your requirement has been saved and is now open for processing.
            </p>
            <button
              onClick={onClose}
              className="mt-2 w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm py-3 rounded-2xl transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {/* ── CHAT VIEW ─────────────────────────────────────────── */}
        {view === "chat" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Missing Details</h2>
                <p className="text-xs text-gray-400 mt-0.5">Reply in any language</p>
              </div>
              <button
                onClick={() => setView("extraction")}
                className="text-xs text-blue-600 font-semibold px-2 py-1"
              >
                ← Back
              </button>
            </div>

            <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto flex-1">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {isFilling && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              {fillError && (
                <p className="text-xs text-red-500 text-center">{fillError}</p>
              )}

              <div ref={chatBottomRef} />
            </div>

            <div className="flex gap-2 px-4 py-4 border-t border-gray-100 flex-shrink-0">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
                }}
                placeholder="Type your reply... (Shift+Enter for new line)"
                disabled={isFilling}
                rows={1}
                className="flex-1 bg-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none max-h-32 overflow-y-auto"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                onClick={handleChatSend}
                disabled={isFilling || !chatInput.trim()}
                className="w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 flex items-center justify-center flex-shrink-0 transition-colors self-end"
                aria-label="Send"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── EXTRACTION VIEW ───────────────────────────────────── */}
        {view === "extraction" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">AI Extraction</h2>
                {currentModel && (
                  <p className="text-xs text-gray-400 mt-0.5">Model: {currentModel}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto flex-1">

              {extraction ? (
                renderExtraction(extraction)
              ) : (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex flex-col gap-1">
                  <p className="text-sm text-red-700 font-medium">Extraction failed</p>
                  {rerunError
                    ? <p className="text-xs text-red-600 font-mono break-all">{rerunError}</p>
                    : <p className="text-xs text-red-500">Edit the system prompt or check your API key, then re-run.</p>}
                </div>
              )}

              {extraction && rerunError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-red-600 font-mono break-all">{rerunError}</p>
                </div>
              )}

              {saveError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}

              {/* System prompt editor */}
              <div className="border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPromptEditor((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`w-3.5 h-3.5 transition-transform ${showPromptEditor ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  {showPromptEditor ? "Hide" : "Edit"} System Prompt
                </button>

                {showPromptEditor && (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={10}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => setSystemPrompt(getSystemPrompt(requirementType))}
                      className="self-end text-xs text-gray-400 underline"
                    >
                      Reset to default
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 px-4 py-4 border-t border-gray-100 flex-shrink-0">
              <button
                type="button"
                onClick={handleRerun}
                disabled={isRerunning || isSaving}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-semibold text-sm py-3 rounded-2xl transition-colors disabled:opacity-50"
              >
                {isRerunning ? "Running..." : "Re-run"}
              </button>
              <button
                type="button"
                onClick={handleDone}
                disabled={!extraction || isSaving || isRerunning}
                className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm py-3 rounded-2xl transition-colors disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Done"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
