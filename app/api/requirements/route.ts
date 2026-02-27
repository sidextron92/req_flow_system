import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import { toDBType } from "@/lib/requirement-type.map";
import { runExtraction } from "@/lib/ai.service";

// GET /api/requirements?userId=123
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("requirements")
    .select(`
      id, type, status, label_name, label_id,
      category_id, category_name, expiry_date,
      remarks, attachments, created_at, updated_at,
      assigned_to_user_id, assigned_date,
      requirement_products ( id, product_id, product_name, notes )
    `)
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// POST /api/requirements
// multipart/form-data with fields + image files
export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const userId      = formData.get("userId") as string;
  const typeRaw     = formData.get("type") as string;   // UI value e.g. "New Label"
  const labelName   = formData.get("labelName") as string | null;
  const labelId     = formData.get("labelId") as string | null;
  const categoryId  = formData.get("categoryId") as string | null;
  const categoryName = formData.get("categoryName") as string | null;
  const expiryDate  = formData.get("expiryDate") as string | null;
  const remarks     = formData.get("remarks") as string | null;
  const notes       = formData.get("notes") as string | null;

  // Products — sent as JSON string
  const productsRaw = formData.get("products") as string | null;
  const products: { product_id?: string; product_name: string; notes?: string }[] =
    productsRaw ? JSON.parse(productsRaw) : [];

  if (!userId || !typeRaw) {
    return NextResponse.json({ error: "userId and type are required" }, { status: 400 });
  }

  // Map UI type → DB enum
  const type = toDBType(typeRaw);

  // ── Upload images to Supabase Storage ──────────────────────
  const imageFiles = formData.getAll("images") as File[];
  const attachments: { url: string; file_name: string; storage_path: string }[] = [];
  // Keep base64 in memory for AI — we encode after upload to avoid reading twice
  const imagePayloads: { base64: string; mimeType: string }[] = [];

  for (const file of imageFiles) {
    const ext = file.name.split(".").pop();
    const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: `Image upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    attachments.push({ url: urlData.publicUrl, file_name: file.name, storage_path: storagePath });
    imagePayloads.push({ base64: buffer.toString("base64"), mimeType: file.type });
  }

  // ── Insert requirement ─────────────────────────────────────
  const { data: req_, error: reqError } = await supabaseAdmin
    .from("requirements")
    .insert({
      type,
      label_name:    labelName    || null,
      label_id:      labelId      || null,
      category_id:   categoryId   || null,
      category_name: categoryName || null,
      expiry_date:   expiryDate   || null,
      remarks:       remarks      || null,
      attachments,
      created_by:    parseInt(userId, 10),
    })
    .select("id")
    .single();

  if (reqError) {
    return NextResponse.json({ error: reqError.message }, { status: 500 });
  }

  const requirementId = req_.id;

  // ── Insert products (Restock supports multiple) ────────────
  if (products.length > 0) {
    const rows = products.map((p) => ({
      requirement_id: requirementId,
      product_id:     p.product_id || null,
      product_name:   p.product_name,
      notes:          p.notes || null,
    }));

    const { error: prodError } = await supabaseAdmin
      .from("requirement_products")
      .insert(rows);

    if (prodError) {
      return NextResponse.json({ error: prodError.message }, { status: 500 });
    }
  }

  // ── Log initial DRAFT status ───────────────────────────────
  await supabaseAdmin.from("status_update_log").insert({
    requirement_id: requirementId,
    changed_by:     parseInt(userId, 10),
    change_type:    "STATUS_CHANGE",
    old_value:      null,
    new_value:      "DRAFT",
  });

  // ── Run AI extraction ──────────────────────────────────────
  let extractedData: Record<string, unknown> | null = null;
  let modelUsed: string | null = null;
  let aiError: string | null = null;

  try {
    const extraction = await runExtraction({
      requirementType: type,
      notes: notes ?? "",
      images: imagePayloads,
    });

    extractedData = extraction.extracted_data;
    modelUsed = extraction.model_used;

    // Persist extraction
    await supabaseAdmin.from("ai_extractions").insert({
      requirement_id: requirementId,
      extracted_data: extractedData,
      model_used:     modelUsed,
    });
  } catch (err) {
    // AI failure is non-fatal — requirement is already saved
    aiError = err instanceof Error ? err.message : String(err);
    console.error("AI extraction failed:", aiError);
  }

  return NextResponse.json(
    {
      data: {
        id:             requirementId,
        extracted_data: extractedData,
        model_used:     modelUsed,
        ai_error:       aiError,
        // Pass back storage paths so UI can send them for re-extraction
        storage_paths:  attachments.map((a) => a.storage_path),
      },
    },
    { status: 201 }
  );
}
