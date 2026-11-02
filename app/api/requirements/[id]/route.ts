// GET  /api/requirements/[id]  — fetch single requirement with products
// PATCH /api/requirements/[id] — AI-fill update, status DRAFT → OPEN

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [{ data, error }, { data: statusLogs, error: statusLogsError }, { data: mappedProducts, error: mappedError }] = await Promise.all([
    supabaseAdmin
      .from("requirements")
      .select(`
        id, type, status,
        label_name, label_id, is_generic, parent_requirement_id,
        category_id, category_name,
        expiry_date, notes, remarks, qty_required, expected_price,
        attachments, comment_log,
        created_at, updated_at,
        assigned_to_user_id, assigned_date,
        created_by, products_suggested_count,
        requirement_products ( id, product_id, product_name, notes )
      `)
      .eq("id", id)
      .single(),
    supabaseAdmin
      .from("status_update_log")
      .select("id, change_type, old_value, new_value, changed_by, changed_at")
      .eq("requirement_id", id)
      .order("changed_at", { ascending: true }),
    supabaseAdmin
      .from("mapped_products")
      .select("id, productid, brandid, productname, variantid, landingprice, image_url, article_code, colorname, availablestock, stock_blocking_live_on, createdby, createdat, updatedat")
      .eq("requirementid", id)
      .order("updatedat", { ascending: false }),
  ]);

  if (mappedError) {
    console.error("Failed to fetch mapped_products:", mappedError.message);
  } else if (data && mappedProducts) {
    (data as Record<string, unknown>).mapped_products = mappedProducts;
  }

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  if (statusLogsError) {
    console.error("Failed to fetch status_update_log:", statusLogsError.message);
  }

  // Resolve user names for all user IDs referenced in status logs
  let statusUpdates: StatusUpdateEntry[] = [];
  if (statusLogs && statusLogs.length > 0) {
    // Collect all unique user IDs: changed_by + new_value for ASSIGNMENT_CHANGE rows
    const userIdSet = new Set<number>();
    for (const row of statusLogs) {
      if (row.changed_by) userIdSet.add(row.changed_by);
      if (row.change_type === "ASSIGNMENT_CHANGE" && row.new_value) {
        const n = Number(row.new_value);
        if (!isNaN(n)) userIdSet.add(n);
      }
    }

    const userIds = Array.from(userIdSet);
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, name")
      .in("id", userIds);

    const nameMap: Record<number, string> = {};
    for (const u of users ?? []) nameMap[u.id] = u.name;

    statusUpdates = statusLogs.map((row) => {
      const changedByName = row.changed_by ? (nameMap[row.changed_by] ?? `User ${row.changed_by}`) : "System";
      let message: string;
      if (row.change_type === "STATUS_CHANGE") {
        const from = row.old_value ?? "—";
        const to   = row.new_value;
        message = `${changedByName} changed status: ${from} → ${to}`;
      } else if (row.change_type === "ASSIGNMENT_CHANGE") {
        const assigneeId   = Number(row.new_value);
        const assigneeName = !isNaN(assigneeId) ? (nameMap[assigneeId] ?? `User ${assigneeId}`) : row.new_value;
        message = `${changedByName} assigned this to ${assigneeName}`;
      } else {
        message = `${changedByName} updated: ${row.old_value ?? "—"} → ${row.new_value}`;
      }
      return {
        id:          row.id,
        change_type: row.change_type,
        message,
        changed_at:  row.changed_at,
      };
    });
  }

  return NextResponse.json({ data, status_updates: statusUpdates });
}

interface StatusUpdateEntry {
  id:          string;
  change_type: string;
  message:     string;
  changed_at:  string;
}

interface Product {
  product_name: string;
  product_id?: string | null;
  notes?: string | null;
}

type RequirementType = "RESTOCK" | "NEW_VARIETY" | "NEW_LABEL";

interface PatchBody {
  userId?: string | null;           // who triggered the save
  type?: RequirementType | null;    // user-selected type (may be corrected server-side)
  label_name?: string | null;
  label_id?: string | null;
  is_generic?: boolean;
  category_name?: string | null;
  expiry_date?: string | null;
  qty_required?: string | number | null;
  expected_price?: number | null;
  remarks?: string | null;
  products?: Product[];
  bijnis_buyer_id?: string | null;  // from fuzzy-match product result
  supply_tl_id?: string | null;     // from fuzzy-match brand result
  extracted_data?: Record<string, unknown> | null;  // full AI JSON to save (optional for manual RESTOCK)
  model_used?: string | null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeQuantity(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// ── Requirement type correction rule ──────────────────────────
// RESTOCK is never auto-corrected (user explicitly selected it).
// For NEW_LABEL / NEW_VARIETY:
//   label_id found → NEW_VARIETY
//   neither found → NEW_LABEL
function resolveType(
  currentType: RequirementType,
  label_id: string | null | undefined,
  isGeneric: boolean,
): RequirementType {
  if (currentType === "RESTOCK") return "RESTOCK";
  if (isGeneric) return "NEW_VARIETY";
  if (label_id) return "NEW_VARIETY";
  return "NEW_LABEL";
}

// ── Rule engine: resolve assigned_to_user_id before saving ────
// Priority:
//   1. product_id match → bijnis_buyer_id
//   2. label_id match   → supply_tl_id
//   3. category fallback → category_buyer_defaults lookup
//   4. null
async function resolveAssignee(
  products: Product[] | undefined,
  label_id: string | null | undefined,
  bijnis_buyer_id: string | null | undefined,
  supply_tl_id: string | null | undefined,
  category_name: string | null | undefined,
  isGeneric: boolean,
): Promise<number | null> {
  if (isGeneric) {
    if (!category_name) return null;
    const { data } = await supabaseAdmin
      .from("category_buyer_defaults")
      .select("user_id")
      .eq("category_name", category_name)
      .single();
    return data?.user_id ? Number(data.user_id) : null;
  }

  const hasProductId = products?.some((p) => p.product_id);
  if (hasProductId && bijnis_buyer_id && !Number.isNaN(Number(bijnis_buyer_id))) {
    return Number(bijnis_buyer_id);
  }
  if (label_id && supply_tl_id && !Number.isNaN(Number(supply_tl_id))) {
    return Number(supply_tl_id);
  }
  // Category fallback: check category_buyer_defaults
  if (category_name) {
    const { data } = await supabaseAdmin
      .from("category_buyer_defaults")
      .select("user_id")
      .eq("category_name", category_name)
      .single();
    if (data?.user_id) return Number(data.user_id);
  }
  return null;
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

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("requirements")
    .select("type, is_generic, label_name, label_id, category_name, expiry_date, qty_required, expected_price")
    .eq("id", requirementId)
    .single();

  if (existingError || !existing) {
    const status = existingError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: existingError?.message ?? "Requirement not found" }, { status });
  }

  const { userId, label_name, label_id, category_name, expiry_date, qty_required, expected_price, remarks, products, bijnis_buyer_id, supply_tl_id, extracted_data, model_used } = body;
  const requestedType = existing.type as RequirementType;
  const isGeneric = existing.is_generic ?? false;

  if (!(["RESTOCK", "NEW_LABEL", "NEW_VARIETY"] as string[]).includes(requestedType)) {
    return NextResponse.json({ error: "Invalid requirement type" }, { status: 400 });
  }
  if (body.type != null && body.type !== requestedType) {
    return NextResponse.json({ error: "Requirement type does not match the saved draft" }, { status: 400 });
  }
  if (body.is_generic != null && body.is_generic !== isGeneric) {
    return NextResponse.json({ error: "Generic flag does not match the saved draft" }, { status: 400 });
  }
  if (isGeneric && requestedType !== "NEW_VARIETY") {
    return NextResponse.json(
      { error: "Generic requirements are only supported for NEW_VARIETY" },
      { status: 400 }
    );
  }

  const effectiveLabelName = label_name !== undefined ? label_name : existing.label_name;
  const effectiveCategoryName = category_name !== undefined ? category_name : existing.category_name;
  const effectiveExpiryDate = expiry_date !== undefined ? expiry_date : existing.expiry_date;
  const normalizedQtyRequired = normalizeQuantity(qty_required);
  const effectiveQtyRequired = normalizedQtyRequired !== undefined ? normalizedQtyRequired : existing.qty_required;
  const effectiveExpectedPrice = expected_price !== undefined ? expected_price : existing.expected_price;

  if (requestedType !== "RESTOCK") {
    const missingFields: string[] = [];
    if (!isGeneric && !hasText(effectiveLabelName)) missingFields.push("label_name");
    if (!hasText(effectiveCategoryName)) missingFields.push("category_name");
    if (!effectiveExpiryDate) missingFields.push("expiry_date");
    if (!hasText(effectiveQtyRequired)) missingFields.push("qty_required");
    if (effectiveExpectedPrice == null || !Number.isFinite(Number(effectiveExpectedPrice)) || Number(effectiveExpectedPrice) <= 0) {
      missingFields.push("expected_price");
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing or invalid required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // ── 1. Resolve assignee via rule engine ────────────────────
  const assigneeId = await resolveAssignee(products, label_id, bijnis_buyer_id, supply_tl_id, effectiveCategoryName, isGeneric);

  // ── 2. Correct requirement type based on catalog matches ───
  const correctedType = resolveType(requestedType, label_id, isGeneric);

  // ── 3. Update requirements row ─────────────────────────────
  const updatePayload: Record<string, unknown> = {
    type:       correctedType,
    status:     "OPEN",
    updated_by: userId ? parseInt(userId, 10) : null,
    is_generic: isGeneric,
  };
  if (label_name    !== undefined) updatePayload.label_name    = label_name    || null;
  if (label_id      !== undefined || isGeneric) updatePayload.label_id = isGeneric ? null : (label_id || null);
  if (category_name !== undefined) updatePayload.category_name = category_name || null;
  if (expiry_date   !== undefined) updatePayload.expiry_date   = expiry_date   || null;
  if (normalizedQtyRequired !== undefined) updatePayload.qty_required = normalizedQtyRequired;
  if (expected_price !== undefined) updatePayload.expected_price = expected_price ?? null;
  if (remarks        !== undefined) updatePayload.remarks        = remarks        || null;

  updatePayload.assigned_to_user_id = assigneeId;
  if (assigneeId !== null) updatePayload.assigned_date = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update(updatePayload)
    .eq("id", requirementId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── 3. Replace products ────────────────────────────────────
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

  // ── 4. Save ai_extractions (only if AI was used) ───────────
  if (extracted_data && model_used) {
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
  }

  // Notify newly assigned user
  if (assigneeId !== null) {
    (async () => {
      try {
        await sendPushNotification(assigneeId, {
          title: "New requirement assigned to you",
          body: `${correctedType.replace("_", " ")} · ${label_name ?? category_name ?? "New requirement"}`,
          url: `/requirements/${requirementId}?userId=${assigneeId}`,
        });
      } catch {
        // Notification failure must not affect the API response
      }
    })();
  }

  return NextResponse.json({ data: { id: requirementId, status: "OPEN", corrected_type: correctedType } });
}
