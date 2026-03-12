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

  const [{ data, error }, { data: statusLogs, error: statusLogsError }] = await Promise.all([
    supabaseAdmin
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
      .single(),
    supabaseAdmin
      .from("status_update_log")
      .select("id, change_type, old_value, new_value, changed_by, changed_at")
      .eq("requirement_id", id)
      .order("changed_at", { ascending: true }),
  ]);

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
  category_name?: string | null;
  expiry_date?: string | null;
  qty_required?: string | null;
  remarks?: string | null;
  products?: Product[];
  bijnis_buyer_id?: string | null;  // from fuzzy-match product result
  supply_tl_id?: string | null;     // from fuzzy-match brand result
  extracted_data: Record<string, unknown>;  // full AI JSON to save
  model_used: string;
}

// ── Requirement type correction rule ──────────────────────────
// product_id found → RESTOCK
// label_id found (no product_id) → NEW_VARIETY
// neither found → NEW_LABEL
function resolveType(
  products: Product[] | undefined,
  label_id: string | null | undefined,
): RequirementType {
  const hasProductId = products?.some((p) => p.product_id);
  if (hasProductId) return "RESTOCK";
  if (label_id) return "NEW_VARIETY";
  return "NEW_LABEL";
}

// ── Rule engine: resolve assigned_to_user_id before saving ────
// bijnis_buyer_id and supply_tl_id are sourced from the fuzzy-search step
// and forwarded in the PATCH payload — no additional DB query needed.
// Priority: product_id match → label_id (brand_id) match → null
function resolveAssignee(
  products: Product[] | undefined,
  label_id: string | null | undefined,
  bijnis_buyer_id: string | null | undefined,
  supply_tl_id: string | null | undefined,
): number | null {
  const hasProductId = products?.some((p) => p.product_id);
  if (hasProductId && bijnis_buyer_id && !Number.isNaN(Number(bijnis_buyer_id))) {
    return Number(bijnis_buyer_id);
  }
  if (label_id && supply_tl_id && !Number.isNaN(Number(supply_tl_id))) {
    return Number(supply_tl_id);
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

  const { userId, label_name, label_id, category_name, expiry_date, qty_required, remarks, products, bijnis_buyer_id, supply_tl_id, extracted_data, model_used } = body;

  // ── 1. Resolve assignee via rule engine ────────────────────
  const assigneeId = resolveAssignee(products, label_id, bijnis_buyer_id, supply_tl_id);

  // ── 2. Correct requirement type based on catalog matches ───
  const correctedType = resolveType(products, label_id);

  // ── 3. Update requirements row ─────────────────────────────
  const updatePayload: Record<string, unknown> = {
    type:       correctedType,
    status:     "OPEN",
    updated_by: userId ? parseInt(userId, 10) : null,
  };
  if (label_name    !== undefined) updatePayload.label_name    = label_name    || null;
  if (label_id      !== undefined) updatePayload.label_id      = label_id      || null;
  if (category_name !== undefined) updatePayload.category_name = category_name || null;
  if (expiry_date   !== undefined) updatePayload.expiry_date   = expiry_date   || null;
  if (qty_required  !== undefined) updatePayload.qty_required  = qty_required  || null;
  if (remarks       !== undefined) updatePayload.remarks       = remarks       || null;

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

  // ── 4. Save ai_extractions ─────────────────────────────────
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
