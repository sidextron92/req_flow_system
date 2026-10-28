// POST /api/requirements/[id]/extract
// Runs initial AI extraction after requirement files are saved.
// Split from POST /api/requirements to avoid Vercel free-plan 10s timeout.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runExtraction } from "@/lib/ai.service";

const EXTRACTION_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface ExtractBody {
  requirementType: string;
  notes: string;
  storagePaths: string[];
  isGeneric?: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: ExtractBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requirementType, notes, storagePaths, isGeneric = false } = body;

  if (!requirementId || !requirementType) {
    return NextResponse.json(
      { error: "requirementId and requirementType are required" },
      { status: 400 }
    );
  }

  if (isGeneric && requirementType !== "NEW_VARIETY") {
    return NextResponse.json(
      { error: "Generic requirements are only supported for NEW_VARIETY" },
      { status: 400 }
    );
  }

  // Download image files from Supabase Storage as base64.
  // Audio paths (prefixed "audio:") are skipped — the client-side
  // transcription already appended the transcript to `notes` before submit.
  const images: { base64: string; mimeType: string }[] = [];
  let unsupportedImageFound = false;
  const imageBucket = process.env.SUPABASE_BUCKET ?? "reqflow_images";

  await Promise.all(
    (storagePaths ?? [])
      .filter((p) => !p.startsWith("audio:"))
      .map(async (storagePath) => {
        const { data, error } = await supabaseAdmin.storage
          .from(imageBucket)
          .download(storagePath);

        if (error || !data) {
          console.warn(`Could not download ${storagePath}:`, error?.message);
          return;
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        const mimeType = data.type || "image/jpeg";
        if (!EXTRACTION_IMAGE_TYPES.has(mimeType)) {
          unsupportedImageFound = true;
          return;
        }
        images.push({
          base64: buffer.toString("base64"),
          mimeType,
        });
      })
  );

  if (unsupportedImageFound) {
    return NextResponse.json({
      data: {
        extracted_data: null,
        model_used: null,
        ai_error: "Unsupported image format. Please upload JPEG, PNG, GIF, or WEBP files.",
      },
    });
  }

  let extractedData: Record<string, unknown> | null = null;
  let modelUsed: string | null = null;
  let aiError: string | null = null;

  try {
    const extraction = await runExtraction({
      requirementType,
      notes: notes ?? "",
      images,
      isGeneric,
    });

    extractedData = extraction.extracted_data;
    modelUsed = extraction.model_used;

    await supabaseAdmin.from("ai_extractions").insert({
      requirement_id: requirementId,
      extracted_data: extractedData,
      model_used: modelUsed,
    });
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    console.error("AI extraction failed:", aiError);
  }

  return NextResponse.json({
    data: {
      extracted_data: extractedData,
      model_used: modelUsed,
      ai_error: aiError,
    },
  });
}
