// POST /api/upload/chat
// Uploads a single file to the reqflow_attachments Supabase bucket.
//
// Body: multipart/form-data — { file: File, userId: string }
// Response: { url: string }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const CHAT_BUCKET     = "reqflow_attachments";
const MAX_FILE_SIZE   = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES   = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file   = formData.get("file")   as File   | null;
  const userId = formData.get("userId") as string | null;

  if (!file || !userId) {
    return NextResponse.json({ error: "file and userId are required" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  // Sanitize original filename so it survives in the storage path and can be shown in UI
  const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${Date.now()}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer      = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .getPublicUrl(storagePath);

  return NextResponse.json({ url: publicUrl }, { status: 200 });
}
