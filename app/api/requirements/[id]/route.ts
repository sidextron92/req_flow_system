// GET  /api/requirements/[id]  — fetch single requirement with products
// PATCH /api/requirements/[id] — AI-fill update, status DRAFT → OPEN

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("requirements")
    .select(`
      id, type, status,
      label_name, label_id,
      category_id, category_name,
      expiry_date, remarks, qty_required,
      attachments, comment_log,
      created_at, updated_at,
      assigned_to_user_id, assigned_date,
      created_by,
      requirement_products ( id, product_id, product_name, notes )
    `)
    .eq("id", id)
    .single();

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ data });
}

interface Product {
  product_name: string;
  product_id?: string | null;
  notes?: string | null;
}

interface PatchBody {
  label_name?: string | null;
  category_name?: string | null;
  expiry_date?: string | null;
  qty_required?: string | null;
  remarks?: string | null;
  products?: Product[];
  extracted_data: Record<string, unknown>;  // full AI JSON to save
  model_used: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { label_name, category_name, expiry_date, qty_required, remarks, products, extracted_data, model_used } = body;

  // ── 1. Update requirements row ─────────────────────────────
  const updatePayload: Record<string, unknown> = { status: "OPEN" };
  if (label_name    !== undefined) updatePayload.label_name    = label_name    || null;
  if (category_name !== undefined) updatePayload.category_name = category_name || null;
  if (expiry_date   !== undefined) updatePayload.expiry_date   = expiry_date   || null;
  if (qty_required  !== undefined) updatePayload.qty_required  = qty_required  || null;
  if (remarks       !== undefined) updatePayload.remarks       = remarks       || null;

  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update(updatePayload)
    .eq("id", requirementId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── 2. Replace products ────────────────────────────────────
  if (Array.isArray(products) && products.length > 0) {
    // Delete existing products for this requirement, then re-insert
    const { error: deleteError } = await supabaseAdmin
      .from("requirement_products")
      .delete()
      .eq("requirement_id", requirementId);

    if (deleteError) {
      console.error("Failed to delete old products:", deleteError.message);
    }

    const rows = products.map((p) => ({
      requirement_id: requirementId,
      product_id:     p.product_id  ?? null,
      product_name:   p.product_name,
      notes:          p.notes       ?? null,
    }));

    const { error: insertError } = await supabaseAdmin
      .from("requirement_products")
      .insert(rows);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  // ── 3. Save ai_extractions ─────────────────────────────────
  const { error: aiError } = await supabaseAdmin
    .from("ai_extractions")
    .insert({
      requirement_id: requirementId,
      extracted_data,
      model_used,
    });

  if (aiError) {
    console.error("Failed to save ai_extractions:", aiError.message);
    // Non-fatal — requirement is already updated
  }

  return NextResponse.json({ data: { id: requirementId, status: "OPEN" } });
}
