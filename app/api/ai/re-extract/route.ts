// POST /api/ai/re-extract
// Re-runs AI extraction with a (possibly edited) system prompt.
// Called from the ExtractionReview UI when the user hits "Re-run".

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runExtraction } from "@/lib/ai.service";

interface ReExtractBody {
  requirementId: string;
  requirementType: string;   // DB enum value
  notes: string;
  systemPrompt: string;
  // Base64-encoded images already stored — we re-fetch URLs from DB
  // and re-encode them here. Client sends stored attachment storage_paths.
  storagePaths: string[];
}

export async function POST(req: NextRequest) {
  let body: ReExtractBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requirementId, requirementType, notes, systemPrompt, storagePaths } = body;

  if (!requirementId || !requirementType) {
    return NextResponse.json({ error: "requirementId and requirementType are required" }, { status: 400 });
  }

  // ── Re-download images from Supabase Storage as base64 ──────
  const images: { base64: string; mimeType: string }[] = [];

  for (const storagePath of storagePaths ?? []) {
    const { data, error } = await supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET ?? "reqflow_images")
      .download(storagePath);

    if (error || !data) {
      console.warn(`Could not download ${storagePath}:`, error?.message);
      continue;
    }

    const arrayBuffer = await data.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = data.type || "image/jpeg";
    images.push({ base64, mimeType });
  }

  // ── Run extraction ───────────────────────────────────────────
  let extraction;
  try {
    extraction = await runExtraction({
      requirementType,
      notes: notes ?? "",
      images,
      systemPrompt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── Persist new extraction to ai_extractions ─────────────────
  const { error: insertError } = await supabaseAdmin
    .from("ai_extractions")
    .insert({
      requirement_id: requirementId,
      extracted_data: extraction.extracted_data,
      model_used: extraction.model_used,
    });

  if (insertError) {
    console.error("Failed to save re-extraction:", insertError.message);
    // Non-fatal — still return the result to the UI
  }

  return NextResponse.json({
    data: {
      extracted_data: extraction.extracted_data,
      model_used: extraction.model_used,
    },
  });
}
