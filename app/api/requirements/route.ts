import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import { toDBType } from "@/lib/requirement-type.map";

const AUDIO_BUCKET = "reqflow_audio";

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
      remarks, attachments, comment_log, created_at, updated_at,
      assigned_to_user_id, assigned_date,
      assignee:users!requirements_assigned_to_user_id_fkey ( name ),
      requirement_products ( id, product_id, product_name, notes )
    `)
    .eq("created_by", userId)
    .neq("status", "DRAFT")
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

  // Products — sent as JSON string
  const productsRaw = formData.get("products") as string | null;
  const products: { product_id?: string; product_name: string; notes?: string }[] =
    productsRaw ? JSON.parse(productsRaw) : [];

  if (!userId || !typeRaw) {
    return NextResponse.json({ error: "userId and type are required" }, { status: 400 });
  }

  // Map UI type → DB enum
  const type = toDBType(typeRaw);

  // ── Upload images to Supabase Storage (parallel) ───────────
  const imageFiles = formData.getAll("images") as File[];
  const attachments: { url: string; file_name: string; storage_path: string }[] = [];

  const imageUploadResults = await Promise.all(
    imageFiles.map(async (file) => {
      const ext = file.name.split(".").pop();
      const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType: file.type, upsert: false });

      if (uploadError) return { error: uploadError.message };

      const { data: urlData } = supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      return { attachment: { url: urlData.publicUrl, file_name: file.name, storage_path: storagePath } };
    })
  );

  for (const result of imageUploadResults) {
    if ("error" in result) {
      return NextResponse.json({ error: `Image upload failed: ${result.error}` }, { status: 500 });
    }
    attachments.push(result.attachment);
  }

  // ── Upload voice note + transcribe ─────────────────────────
  const voiceNoteFile = formData.get("voiceNote") as File | null;
  let voiceStoragePath: string | null = null;
  let voicePublicUrl: string | null = null;

  if (voiceNoteFile && voiceNoteFile.size > 0) {
    const ext = voiceNoteFile.name.split(".").pop() ?? "webm";
    voiceStoragePath = `${userId}/voice/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await voiceNoteFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: voiceUploadError } = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .upload(voiceStoragePath, buffer, { contentType: voiceNoteFile.type, upsert: false });

    if (voiceUploadError) {
      return NextResponse.json({ error: `Voice note upload failed: ${voiceUploadError.message}` }, { status: 500 });
    }

    const { data: voiceUrlData } = supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .getPublicUrl(voiceStoragePath);

    voicePublicUrl = voiceUrlData.publicUrl;

    // Add to attachments so it's visible alongside images
    attachments.push({
      url: voicePublicUrl,
      file_name: voiceNoteFile.name,
      storage_path: `audio:${voiceStoragePath}`,   // prefix so re-extract knows which bucket
    });

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
      updated_by:    parseInt(userId, 10),
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

  return NextResponse.json(
    {
      data: {
        id:            requirementId,
        // Image paths are plain strings; voice path is prefixed with "audio:"
        storage_paths: attachments.map((a) => a.storage_path),
      },
    },
    { status: 201 }
  );
}
