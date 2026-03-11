"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSystemPrompt, CATEGORY_NAMES } from "@/lib/ai.config";
import { validateExtraction, type ValidationResult } from "@/lib/extraction-validation";

interface ExtractionReviewProps {
  requirementId: string;
  requirementType: string;   // DB enum value e.g. "RESTOCK"
  userId: string;
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

type ViewState = "extraction" | "chat" | "fuzzy-match" | "success";

// ── Fuzzy match types ──────────────────────────────────────────
interface LabelSuggestion { brand_name: string; brand_id: string; supply_tl_id: string | null; supply_tl_name: string | null }
interface ProductSuggestion { product_name: string; product_id: string; brand_id: string; brand_name: string; bijnis_buyer_id: string | null; bijnis_buyer_name: string | null }

interface FuzzyMatchState {
  labelQuery: string | null;
  labelExact: LabelSuggestion | null;
  labelSuggestions: LabelSuggestion[];
  products: Array<{
    original: string;
    exact: ProductSuggestion | null;
    suggestions: ProductSuggestion[];
  }>;
}

export default function ExtractionReview({
  requirementId,
  requirementType,
  userId,
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
  const [typeCorrectionMsg, setTypeCorrectionMsg] = useState<string | null>(null);
  const dismissTypeCorrection = useCallback(() => setTypeCorrectionMsg(null), []);
  useEffect(() => {
    if (!typeCorrectionMsg) return;
    const t = setTimeout(dismissTypeCorrection, 4000);
    return () => clearTimeout(t);
  }, [typeCorrectionMsg, dismissTypeCorrection]);

  // ── Chat state ─────────────────────────────────────────────
  const [view, setView]                     = useState<ViewState>("extraction");
  const [chatMessages, setChatMessages]     = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]           = useState("");
  const [isFilling, setIsFilling]           = useState(false);
  const [fillError, setFillError]           = useState<string | null>(null);
  const [pendingValidation, setPendingValidation] = useState<ValidationResult | null>(null);

  // ── Category correction state ──────────────────────────────
  const [categoryCheckDone, setCategoryCheckDone]           = useState(false);
  const [categorySuggestions, setCategorySuggestions]       = useState<string[]>([]);
  const [isFetchingCategorySuggestions, setIsFetchingCategorySuggestions] = useState(false);

  // ── Fuzzy match state ──────────────────────────────────────
  const [fuzzyState, setFuzzyState]           = useState<FuzzyMatchState | null>(null);
  const [selectedLabel, setSelectedLabel]     = useState<{ name: string; id: string; supply_tl_id: string | null } | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, { name: string; id: string; brand_id: string | null; brand_name: string | null; bijnis_buyer_id: string | null }>>({});
  const [isFuzzyChecking, setIsFuzzyChecking] = useState(false);
  const [fuzzyError, setFuzzyError]           = useState<string | null>(null);
  // Editable "as typed" text for brand and products
  const [editingLabel, setEditingLabel]               = useState(false);
  const [editedLabelText, setEditedLabelText]         = useState("");
  const [editingProducts, setEditingProducts]         = useState<Record<string, boolean>>({});
  const [editedProductTexts, setEditedProductTexts]   = useState<Record<string, string>>({});
  // Extraction snapshot to save after fuzzy confirm
  const pendingExtractionRef = useRef<Record<string, unknown> | null>(null);

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
      setCategoryCheckDone(false);
      setCategorySuggestions([]);
    } catch {
      setRerunError("Network error — please try again");
    } finally {
      setIsRerunning(false);
    }
  }

  // ── Save to DB ─────────────────────────────────────────────
  async function saveRequirement(
    finalExtraction: Record<string, unknown>,
    bijnis_buyer_id?: string | null,
    supply_tl_id?: string | null,
  ): Promise<boolean> {
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
          userId,
          label_name:        finalExtraction.label_name    ?? null,
          label_id:          finalExtraction.label_id      ?? null,
          category_name:     finalExtraction.category_name ?? null,
          expiry_date:       finalExtraction.expiry_date   ?? null,
          qty_required:      finalExtraction.qty_required  ?? null,
          remarks:           finalExtraction.remarks        ?? null,
          products,
          bijnis_buyer_id:   bijnis_buyer_id ?? null,
          supply_tl_id:      supply_tl_id    ?? null,
          extracted_data:    finalExtraction,
          model_used:        currentModel ?? "unknown",
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setSaveError(json.error ?? "Save failed");
        return false;
      }

      const correctedType: string | undefined = json.data?.corrected_type;
      if (correctedType && correctedType !== requirementType) {
        const labels: Record<string, string> = { RESTOCK: "Restock", NEW_VARIETY: "New Variety", NEW_LABEL: "New Label" };
        setTypeCorrectionMsg(
          `Requirement type changed from ${labels[requirementType] ?? requirementType} to ${labels[correctedType] ?? correctedType}`
        );
      }

      return true;
    } catch {
      setSaveError("Network error — could not save");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  // ── Fuzzy match helpers ────────────────────────────────────
  function buildMergedExtraction(
    base: Record<string, unknown>,
    selLabel: { name: string; id: string } | null,
    selProducts: Record<string, { name: string; id: string; brand_id: string | null; brand_name: string | null }>
  ): Record<string, unknown> {
    const merged = { ...base };
    if (selLabel) {
      merged.label_name = selLabel.name;
      merged.label_id   = selLabel.id || null;
    }
    if (Array.isArray(merged.products)) {
      merged.products = (merged.products as Record<string, unknown>[]).map((p) => {
        const origName = String(p.product_name ?? "");
        const sel = selProducts[origName];
        if (sel) return { ...p, product_name: sel.name, product_id: sel.id || null };
        return p;
      });
    }

    // Derive label_id and label_name from matched product brand info (product match wins over label match).
    // Only apply if every resolved product that has a brand_id shares the same one.
    const resolvedProducts = Object.values(selProducts).filter((s) => Boolean(s.brand_id));

    if (resolvedProducts.length > 0) {
      const allSameBrandId = resolvedProducts.every((s) => s.brand_id === resolvedProducts[0].brand_id);
      if (allSameBrandId) {
        merged.label_id   = resolvedProducts[0].brand_id;
        merged.label_name = resolvedProducts[0].brand_name ?? merged.label_name;
      }
      // If they differ, leave label_id/label_name as whatever the label fuzzy match set (or original).
    }

    return merged;
  }

  async function runFuzzyMatchCheck(finalExtraction: Record<string, unknown>) {
    setIsFuzzyChecking(true);
    setFuzzyError(null);

    const label_name =
      typeof finalExtraction.label_name === "string" && finalExtraction.label_name.trim()
        ? finalExtraction.label_name.trim()
        : undefined;

    const product_names: string[] = Array.isArray(finalExtraction.products)
      ? (finalExtraction.products as Record<string, unknown>[])
          .map((p) => String(p.product_name ?? "").trim())
          .filter(Boolean)
      : [];

    // For NEW_VARIETY there's no label_name — only check products
    if (!label_name && product_names.length === 0) {
      setIsFuzzyChecking(false);
      const ok = await saveRequirement(finalExtraction);
      if (ok) { setView("success"); onSaved(); }
      return;
    }

    try {
      const res = await fetch("/api/brand-product/fuzzy-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label_name, product_names }),
      });
      const json = await res.json();

      if (!res.ok) {
        // Fuzzy check failed — save as-is rather than blocking the user
        setIsFuzzyChecking(false);
        const ok = await saveRequirement(finalExtraction);
        if (ok) { setView("success"); onSaved(); }
        return;
      }

      // Check if anything needs user input
      const labelNeedsInput =
        json.label && !json.label.exact && json.label.suggestions.length > 0;
      const productsNeedInput =
        (json.products as ProductResult[]).some(
          (p: ProductResult) => !p.exact && p.suggestions.length > 0
        );

      if (!labelNeedsInput && !productsNeedInput) {
        // All exact or no suggestions — auto-apply exact matches and save
        const autoLabel = json.label?.exact
          ? { name: json.label.exact.brand_name, id: json.label.exact.brand_id, supply_tl_id: json.label.exact.supply_tl_id ?? null }
          : null;
        const autoProducts: Record<string, { name: string; id: string; brand_id: string | null; brand_name: string | null; bijnis_buyer_id: string | null }> = {};
        for (const p of (json.products as ProductResult[])) {
          if (p.exact) {
            autoProducts[p.original] = { name: p.exact.product_name, id: p.exact.product_id, brand_id: p.exact.brand_id, brand_name: p.exact.brand_name, bijnis_buyer_id: p.exact.bijnis_buyer_id ?? null };
          }
        }
        const merged = buildMergedExtraction(finalExtraction, autoLabel, autoProducts);
        const autoBuyerId = Object.values(autoProducts).find((s) => s.bijnis_buyer_id)?.bijnis_buyer_id ?? null;
        setIsFuzzyChecking(false);
        const ok = await saveRequirement(merged, autoBuyerId, autoLabel?.supply_tl_id ?? null);
        if (ok) { setView("success"); onSaved(); }
        return;
      }

      // Pre-select exact matches where found
      const preLabel = json.label?.exact
        ? { name: json.label.exact.brand_name, id: json.label.exact.brand_id, supply_tl_id: json.label.exact.supply_tl_id ?? null }
        : null;
      const preProducts: Record<string, { name: string; id: string; brand_id: string | null; brand_name: string | null; bijnis_buyer_id: string | null }> = {};
      for (const p of (json.products as ProductResult[])) {
        if (p.exact) {
          preProducts[p.original] = { name: p.exact.product_name, id: p.exact.product_id, brand_id: p.exact.brand_id, brand_name: p.exact.brand_name, bijnis_buyer_id: p.exact.bijnis_buyer_id ?? null };
        }
      }

      pendingExtractionRef.current = finalExtraction;
      setFuzzyState({
        labelQuery: label_name ?? null,
        labelExact: json.label?.exact ?? null,
        labelSuggestions: json.label?.suggestions ?? [],
        products: json.products,
      });
      setSelectedLabel(preLabel);
      setSelectedProducts(preProducts);
      setEditingLabel(false);
      setEditedLabelText("");
      setEditingProducts({});
      setEditedProductTexts({});
      setIsFuzzyChecking(false);
      setView("fuzzy-match");
    } catch {
      setIsFuzzyChecking(false);
      // Network error — save as-is
      const ok = await saveRequirement(finalExtraction);
      if (ok) { setView("success"); onSaved(); }
    }
  }

  interface ProductResult {
    original: string;
    exact: ProductSuggestion | null;
    suggestions: ProductSuggestion[];
  }

  async function handleFuzzyConfirm() {
    if (!pendingExtractionRef.current) return;
    const merged = buildMergedExtraction(
      pendingExtractionRef.current,
      selectedLabel,
      selectedProducts
    );
    setExtraction(merged);
    const buyerId = Object.values(selectedProducts).find((s) => s.bijnis_buyer_id)?.bijnis_buyer_id ?? null;
    const ok = await saveRequirement(merged, buyerId, selectedLabel?.supply_tl_id ?? null);
    if (ok) { setView("success"); onSaved(); }
  }

  async function handleFuzzySkip() {
    if (!pendingExtractionRef.current) return;
    const ok = await saveRequirement(pendingExtractionRef.current);
    if (ok) { setView("success"); onSaved(); }
  }

  // ── Done button clicked ────────────────────────────────────
  async function handleDone() {
    if (!extraction) return;

    // ── Category confidence check ────────────────────────────
    // Trigger if category_name is null OR confidence < 0.7, and not yet confirmed.
    if (!categoryCheckDone) {
      const conf = extraction.confidence as Record<string, number> | null | undefined;
      const categoryConfidence = conf?.category_name ?? (extraction.category_name ? 1 : 0);
      const needsCategoryCheck = categoryConfidence < 0.9 || !extraction.category_name;

      if (needsCategoryCheck) {
        setIsFetchingCategorySuggestions(true);
        setCategorySuggestions([]);
        let suggestions: string[] = [];
        try {
          const res = await fetch("/api/ai/fill-missing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requirementType,
              currentExtraction: extraction,
              missingKeys: ["category_name"],
              userMessage: "",
              requestType: "category_suggestions",
            }),
          });
          const json = await res.json();
          if (res.ok && Array.isArray(json.data?.category_suggestions)) {
            suggestions = json.data.category_suggestions;
          }
        } catch {
          // ignore — show empty suggestions, user can still type
        } finally {
          setIsFetchingCategorySuggestions(false);
        }

        setCategorySuggestions(suggestions);
        const currentCat = extraction.category_name ? String(extraction.category_name) : null;
        const openingMsg = currentCat
          ? `I'm not confident about the category I detected: **${currentCat}** (${Math.round(categoryConfidence * 100)}% confidence).\n\nPlease confirm or select the correct one:`
          : `I couldn't determine the category from the images/notes.\n\nPlease select the correct category:`;
        setChatMessages([{ role: "assistant", text: openingMsg }]);
        setView("chat");
        return;
      }
    }

    // ── Normal validation ────────────────────────────────────
    const validation = validateExtraction(extraction, requirementType);

    if (validation.valid) {
      await runFuzzyMatchCheck(extraction);
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
    if (!userText || isFilling || !extraction) return;

    setChatInput("");
    setFillError(null);
    setChatMessages((prev) => [...prev, { role: "user", text: userText }]);
    setIsFilling(true);

    // ── Category correction phase ────────────────────────────
    if (!categoryCheckDone) {
      // Try exact match against CATEGORY_NAMES first (case-insensitive)
      const matched = CATEGORY_NAMES.find(
        (c) => c.toLowerCase() === userText.toLowerCase()
      );

      if (matched) {
        // Exact match — accept and continue
        const updated = { ...extraction, category_name: matched };
        setExtraction(updated);
        setCategoryCheckDone(true);
        setCategorySuggestions([]);

        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", text: `Got it! Category set to **${matched}**.` },
        ]);
        setIsFilling(false);

        // Now run normal validation for remaining missing fields
        const validation = validateExtraction(updated, requirementType);
        if (validation.valid) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", text: "All details look good. Checking against catalog..." },
          ]);
          await runFuzzyMatchCheck(updated);
        } else {
          setPendingValidation(validation);
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", text: buildAskMessage(validation.missingFields) },
          ]);
        }
        return;
      }

      // No exact match — ask AI to resolve against the list
      try {
        const res = await fetch("/api/ai/fill-missing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirementType,
            currentExtraction: extraction,
            missingKeys: ["category_name"],
            userMessage: userText,
            requestType: "fill",
          }),
        });

        const json = await res.json();

        if (!res.ok) {
          setFillError(json.error ?? "AI could not process your reply");
          setIsFilling(false);
          return;
        }

        const updated: Record<string, unknown> = json.data.updated_extraction;
        const resolvedCategory = updated.category_name ? String(updated.category_name) : null;

        // Verify AI resolved to a valid category
        const validResolved = resolvedCategory
          ? CATEGORY_NAMES.find((c) => c.toLowerCase() === resolvedCategory.toLowerCase())
          : null;

        if (validResolved) {
          const finalUpdated = { ...updated, category_name: validResolved };
          setExtraction(finalUpdated);
          setCategoryCheckDone(true);
          setCategorySuggestions([]);

          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", text: `Got it! Category set to **${validResolved}**.` },
          ]);
          setIsFilling(false);

          const validation = validateExtraction(finalUpdated, requirementType);
          if (validation.valid) {
            setChatMessages((prev) => [
              ...prev,
              { role: "assistant", text: "All details look good. Checking against catalog..." },
            ]);
            await runFuzzyMatchCheck(finalUpdated);
          } else {
            setPendingValidation(validation);
            setChatMessages((prev) => [
              ...prev,
              { role: "assistant", text: buildAskMessage(validation.missingFields) },
            ]);
          }
        } else {
          // Still couldn't resolve — fetch new suggestions and ask again
          let newSuggestions: string[] = [];
          try {
            const sugRes = await fetch("/api/ai/fill-missing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requirementType,
                currentExtraction: updated,
                missingKeys: ["category_name"],
                userMessage: "",
                requestType: "category_suggestions",
              }),
            });
            const sugJson = await sugRes.json();
            if (sugRes.ok && Array.isArray(sugJson.data?.category_suggestions)) {
              newSuggestions = sugJson.data.category_suggestions;
            }
          } catch { /* ignore */ }

          setCategorySuggestions(newSuggestions);
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", text: `I couldn't match that to a known category. Please select from the options below:` },
          ]);
          setIsFilling(false);
        }
      } catch {
        setFillError("Network error — please try again");
        setIsFilling(false);
      }
      return;
    }

    // ── Normal fill-missing phase ────────────────────────────
    if (!pendingValidation) {
      setIsFilling(false);
      return;
    }

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
          { role: "assistant", text: "Got it! All details are now complete. Checking against catalog..." },
        ]);
        setIsFilling(false);

        await runFuzzyMatchCheck(updated);
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

  // ── Category pill selected ─────────────────────────────────
  async function handleCategoryPillSelect(cat: string) {
    if (isFilling || !extraction) return;
    setChatMessages((prev) => [...prev, { role: "user", text: cat }]);
    setIsFilling(true);

    const updated = { ...extraction, category_name: cat };
    setExtraction(updated);
    setCategoryCheckDone(true);
    setCategorySuggestions([]);

    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", text: `Got it! Category set to **${cat}**.` },
    ]);

    const validation = validateExtraction(updated, requirementType);
    if (validation.valid) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: "All details look good. Checking against catalog..." },
      ]);
      setIsFilling(false);
      await runFuzzyMatchCheck(updated);
    } else {
      setPendingValidation(validation);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: buildAskMessage(validation.missingFields) },
      ]);
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
            {typeCorrectionMsg && (
              <div className="w-full flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
                </svg>
                <span>{typeCorrectionMsg}</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="mt-2 w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm py-3 rounded-2xl transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {/* ── FUZZY MATCH VIEW ──────────────────────────────────── */}
        {view === "fuzzy-match" && fuzzyState && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Confirm Details</h2>
                <p className="text-xs text-gray-400 mt-0.5">Select the closest match or keep as typed</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 px-4 py-4 overflow-y-auto flex-1">

              {/* Label / Brand section */}
              {fuzzyState.labelQuery && fuzzyState.labelSuggestions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Brand Name
                  </p>
                  <p className="text-xs text-gray-500">
                    You entered: <span className="font-medium text-gray-700">{fuzzyState.labelQuery}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {fuzzyState.labelSuggestions.map((s) => {
                      const isSelected = selectedLabel?.name === s.brand_name && selectedLabel?.id === s.brand_id;
                      return (
                        <button
                          key={`${s.brand_name}::${s.brand_id}`}
                          onClick={() =>
                            setSelectedLabel(
                              isSelected ? null : { name: s.brand_name, id: s.brand_id, supply_tl_id: s.supply_tl_id ?? null }
                            )
                          }
                          className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                            isSelected
                              ? "bg-green-600 border-green-600 text-white"
                              : "bg-green-50 border-green-200 text-green-800 hover:bg-green-100"
                          }`}
                        >
                          {s.brand_name}
                        </button>
                      );
                    })}
                    {/* User's original input – editable pill */}
                    {(() => {
                      const displayText = editedLabelText || fuzzyState.labelQuery!;
                      const isSelected =
                        selectedLabel?.name === displayText &&
                        selectedLabel?.id === "";

                      if (editingLabel) {
                        return (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={editedLabelText || fuzzyState.labelQuery!}
                              onChange={(e) => setEditedLabelText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const val = (editedLabelText || fuzzyState.labelQuery!).trim();
                                  if (val) {
                                    setSelectedLabel({ name: val, id: "", supply_tl_id: null });
                                    setEditingLabel(false);
                                  }
                                }
                              }}
                              className="text-sm px-3 py-1.5 rounded-full border border-gray-400 bg-white text-gray-900 font-medium outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-400 w-48"
                            />
                            <button
                              onClick={() => {
                                const val = (editedLabelText || fuzzyState.labelQuery!).trim();
                                if (val) {
                                  setSelectedLabel({ name: val, id: "", supply_tl_id: null });
                                  setEditingLabel(false);
                                }
                              }}
                              className="text-xs px-2 py-1 rounded-full bg-gray-700 text-white font-medium"
                            >
                              Done
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              setSelectedLabel(
                                isSelected ? null : { name: displayText, id: "", supply_tl_id: null }
                              )
                            }
                            className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                              isSelected
                                ? "bg-gray-700 border-gray-700 text-white"
                                : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {displayText} (as typed)
                          </button>
                          <button
                            onClick={() => {
                              if (!editedLabelText) setEditedLabelText(fuzzyState.labelQuery!);
                              setEditingLabel(true);
                            }}
                            className="text-gray-400 hover:text-gray-600 p-1"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                            </svg>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Products sections */}
              {fuzzyState.products
                .filter((p) => !p.exact && p.suggestions.length > 0)
                .map((p) => {
                  const sel = selectedProducts[p.original];
                  return (
                    <div key={p.original} className="flex flex-col gap-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Product
                      </p>
                      <p className="text-xs text-gray-500">
                        You entered: <span className="font-medium text-gray-700">{p.original}</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {p.suggestions.map((s) => {
                          const isSelected =
                            sel?.name === s.product_name && sel?.id === s.product_id;
                          return (
                            <button
                              key={`${s.product_name}::${s.product_id}`}
                              onClick={() => {
                                setSelectedProducts((prev) => {
                                  if (isSelected) {
                                    const next = { ...prev };
                                    delete next[p.original];
                                    return next;
                                  }
                                  return { ...prev, [p.original]: { name: s.product_name, id: s.product_id, brand_id: s.brand_id, brand_name: s.brand_name, bijnis_buyer_id: s.bijnis_buyer_id ?? null } };
                                });
                              }}
                              className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                                isSelected
                                  ? "bg-green-600 border-green-600 text-white"
                                  : "bg-green-50 border-green-200 text-green-800 hover:bg-green-100"
                              }`}
                            >
                              {s.product_name}
                            </button>
                          );
                        })}
                        {/* User's original input – editable pill */}
                        {(() => {
                          const displayText = editedProductTexts[p.original] || p.original;
                          const isSelected = sel?.name === displayText && sel?.id === "";
                          const isEditing = editingProducts[p.original];

                          if (isEditing) {
                            return (
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  value={editedProductTexts[p.original] || p.original}
                                  onChange={(e) =>
                                    setEditedProductTexts((prev) => ({
                                      ...prev,
                                      [p.original]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = (editedProductTexts[p.original] || p.original).trim();
                                      if (val) {
                                        setSelectedProducts((prev) => ({
                                          ...prev,
                                          [p.original]: { name: val, id: "", brand_id: null, brand_name: null, bijnis_buyer_id: null },
                                        }));
                                        setEditingProducts((prev) => ({ ...prev, [p.original]: false }));
                                      }
                                    }
                                  }}
                                  className="text-sm px-3 py-1.5 rounded-full border border-gray-400 bg-white text-gray-900 font-medium outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-400 w-48"
                                />
                                <button
                                  onClick={() => {
                                    const val = (editedProductTexts[p.original] || p.original).trim();
                                    if (val) {
                                      setSelectedProducts((prev) => ({
                                        ...prev,
                                        [p.original]: { name: val, id: "", brand_id: null, brand_name: null, bijnis_buyer_id: null },
                                      }));
                                      setEditingProducts((prev) => ({ ...prev, [p.original]: false }));
                                    }
                                  }}
                                  className="text-xs px-2 py-1 rounded-full bg-gray-700 text-white font-medium"
                                >
                                  Done
                                </button>
                              </div>
                            );
                          }

                          return (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setSelectedProducts((prev) => {
                                    if (isSelected) {
                                      const next = { ...prev };
                                      delete next[p.original];
                                      return next;
                                    }
                                    return { ...prev, [p.original]: { name: displayText, id: "", brand_id: null, brand_name: null, bijnis_buyer_id: null } };
                                  });
                                }}
                                className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                                  isSelected
                                    ? "bg-gray-700 border-gray-700 text-white"
                                    : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                {displayText} (as typed)
                              </button>
                              <button
                                onClick={() => {
                                  if (!editedProductTexts[p.original])
                                    setEditedProductTexts((prev) => ({ ...prev, [p.original]: p.original }));
                                  setEditingProducts((prev) => ({ ...prev, [p.original]: true }));
                                }}
                                className="text-gray-400 hover:text-gray-600 p-1"
                                title="Edit"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                  <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                </svg>
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}

              {saveError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}
              {fuzzyError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-red-600">{fuzzyError}</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-4 py-4 border-t border-gray-100 flex-shrink-0">
              <button
                type="button"
                onClick={handleFuzzySkip}
                disabled={isSaving}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-semibold text-sm py-3 rounded-2xl transition-colors disabled:opacity-50"
              >
                Save as typed
              </button>
              <button
                type="button"
                onClick={handleFuzzyConfirm}
                disabled={isSaving}
                className="flex-1 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm py-3 rounded-2xl transition-colors disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </>
        )}

        {/* ── CHAT VIEW ─────────────────────────────────────────── */}
        {view === "chat" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {!categoryCheckDone ? "Confirm Category" : "Missing Details"}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Reply in any language</p>
              </div>
              <button
                onClick={() => setView("extraction")}
                className="text-xs text-green-600 font-semibold px-2 py-1"
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
                        ? "bg-green-600 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {/* Category suggestion pills — shown during category correction phase */}
              {!categoryCheckDone && !isFilling && (
                isFetchingCategorySuggestions ? (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                ) : categorySuggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {categorySuggestions.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => handleCategoryPillSelect(cat)}
                        disabled={isFilling}
                        className="text-sm px-3 py-1.5 rounded-full border font-medium transition-colors bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100 active:bg-blue-200 disabled:opacity-50"
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                ) : null
              )}

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
                  const isMobile = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
                  if (e.key === "Enter" && !e.shiftKey && !isMobile) { e.preventDefault(); handleChatSend(); }
                }}
                placeholder={!categoryCheckDone ? "Or type a category name..." : "Type your reply..."}
                disabled={isFilling}
                rows={1}
                className="flex-1 bg-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 resize-none max-h-32 overflow-y-auto"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                onClick={handleChatSend}
                disabled={isFilling || !chatInput.trim()}
                className="w-11 h-11 rounded-full bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:bg-green-300 flex items-center justify-center flex-shrink-0 transition-colors self-end"
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
                  className="flex items-center gap-1.5 text-xs font-semibold text-green-600"
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
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
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
                disabled={!extraction || isSaving || isRerunning || isFuzzyChecking}
                className="flex-1 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm py-3 rounded-2xl transition-colors disabled:opacity-50"
              >
                {isFuzzyChecking ? "Checking..." : isSaving ? "Saving..." : "Done"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
