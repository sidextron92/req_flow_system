// POST /api/requirements/[id]/reopen — create a clone of a closed requirement
//
// Permission: only the creator (created_by = userId) can reopen.
// Allowed statuses: INCOMPLETE, CANNOT_BE_DONE, AUTO_CLOSED
// Body: { userId, newExpiryDate }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

interface Product {
  product_name: string;
  product_id?: string | null;
  notes?: string | null;
}

type RequirementType = "RESTOCK" | "NEW_VARIETY" | "NEW_LABEL";

// ── Requirement type correction rule ──────────────────────────
// product_id found → RESTOCK
// label_id found (no product_id) → NEW_VARIETY
// neither found → NEW_LABEL
function resolveType(products: Product[] | undefined, label_id: string | null | undefined): RequirementType {
  const hasProductId = products?.some((p) => p.product_id);
  if (hasProductId) return "RESTOCK";
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
): Promise<number | null> {
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

const REOPENABLE_STATUSES = new Set(["INCOMPLETE", "CANNOT_BE_DONE", "AUTO_CLOSED"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: { userId?: number | string; newExpiryDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, newExpiryDate } = body;
  if (!userId || !newExpiryDate) {
    return NextResponse.json({ error: "userId and newExpiryDate are required" }, { status: 400 });
  }

  const userIdNum = Number(userId);
  if (Number.isNaN(userIdNum)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  // Validate newExpiryDate is a valid date
  const expiryDateObj = new Date(newExpiryDate);
  if (isNaN(expiryDateObj.getTime())) {
    return NextResponse.json({ error: "Invalid newExpiryDate" }, { status: 400 });
  }

  // Fetch the original requirement
  const { data: original, error: fetchError } = await supabaseAdmin
    .from("requirements")
    .select("id, type, status, label_name, label_id, category_id, category_name, expiry_date, notes, remarks, qty_required, expected_price, attachments, comment_log, created_by, created_at, updated_at, updated_by, assigned_to_user_id, assigned_date, products_suggested_count, requirement_products ( id, product_id, product_name, notes )")
    .eq("id", requirementId)
    .single();

  if (fetchError || !original) {
    const status = fetchError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: fetchError?.message ?? "Not found" }, { status });
  }

  // Validate: only creator can reopen
  if (original.created_by !== userIdNum) {
    return NextResponse.json({ error: "Only the creator can reopen this requirement" }, { status: 403 });
  }

  // Validate: only reopenable statuses
  if (!REOPENABLE_STATUSES.has(original.status)) {
    return NextResponse.json({ error: `Cannot reopen a requirement with status ${original.status}` }, { status: 403 });
  }

  // ── 1. Insert new cloned requirement ─────────────────────────
  const insertPayload: Record<string, unknown> = {
    type:                original.type,
    status:              "OPEN",
    label_name:          original.label_name,
    label_id:            original.label_id,
    category_id:         original.category_id,
    category_name:       original.category_name,
    expiry_date:         newExpiryDate,
    notes:               original.notes,
    remarks:             original.remarks,
    qty_required:        original.qty_required,
    expected_price:      original.expected_price,
    attachments:         original.attachments,
    comment_log:         [],
    created_by:          original.created_by,
    updated_by:          null,
    parent_requirement_id: original.id,
    products_suggested_count: 0,
  };

  const { data: newReq, error: insertError } = await supabaseAdmin
    .from("requirements")
    .insert(insertPayload)
    .select("id, type, status, label_name, label_id, category_name, expiry_date, notes, remarks, qty_required, expected_price, attachments, comment_log, created_by, created_at, updated_at, updated_by, assigned_to_user_id, assigned_date, products_suggested_count, parent_requirement_id")
    .single();

  if (insertError || !newReq) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create clone" }, { status: 500 });
  }

  const newRequirementId = newReq.id;

  // ── 2. Copy requirement_products ───────────────────────────
  if (original.requirement_products && original.requirement_products.length > 0) {
    const productRows = original.requirement_products.map((p: Record<string, unknown>) => ({
      requirement_id: newRequirementId,
      product_id:     p.product_id ?? null,
      product_name:   p.product_name,
      notes:          p.notes ?? null,
    }));

    const { error: productInsertError } = await supabaseAdmin
      .from("requirement_products")
      .insert(productRows);

    if (productInsertError) {
      console.error("Failed to copy requirement_products:", productInsertError.message);
    }
  }

  // ── 3. Re-run resolveAssignee and resolveType ──────────────
  // We need to fetch the newly inserted products to resolve correctly
  const { data: newProducts } = await supabaseAdmin
    .from("requirement_products")
    .select("product_id, product_name, notes")
    .eq("requirement_id", newRequirementId);

  const products: Product[] = (newProducts ?? []).map((p: Record<string, unknown>) => ({
    product_name: p.product_name as string,
    product_id:   p.product_id as string | null,
    notes:        p.notes as string | null,
  }));

  // Re-run type correction
  const correctedType = resolveType(products, newReq.label_id);

  // Re-run assignee resolution
  // We need to determine bijnis_buyer_id and supply_tl_id from the catalog
  // Since we copied the exact same products and label_id, we can look them up
  let bijnisBuyerId: string | null = null;
  let supplyTlId: string | null = null;

  // Find the buyer/TL from the catalog for the matched products
  if (products.some((p) => p.product_id)) {
    const { data: bpData } = await supabaseAdmin
      .from("brand_product_data")
      .select("bijnis_buyer_id, supply_tl_id")
      .in("product_id", products.map((p) => p.product_id).filter(Boolean))
      .limit(1)
      .single();
    if (bpData) {
      bijnisBuyerId = bpData.bijnis_buyer_id;
      supplyTlId = bpData.supply_tl_id;
    }
  } else if (newReq.label_id) {
    const { data: bpData } = await supabaseAdmin
      .from("brand_product_data")
      .select("supply_tl_id")
      .eq("brand_id", newReq.label_id)
      .limit(1)
      .single();
    if (bpData) {
      supplyTlId = bpData.supply_tl_id;
    }
  }

  const assigneeId = await resolveAssignee(products, newReq.label_id, bijnisBuyerId, supplyTlId, newReq.category_name);

  // ── 4. Update the clone with resolved type and assignee ────
  const updatePayload: Record<string, unknown> = {
    type: correctedType,
    updated_by: userIdNum,
  };
  if (assigneeId !== null) {
    updatePayload.assigned_to_user_id = assigneeId;
    updatePayload.assigned_date = new Date().toISOString();
  }

  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update(updatePayload)
    .eq("id", newRequirementId);

  if (updateError) {
    console.error("Failed to update clone with resolved type/assignee:", updateError.message);
  }

  // ── 5. Write status_update_log entry for the clone ───────────
  const { error: logError } = await supabaseAdmin
    .from("status_update_log")
    .insert({
      requirement_id: newRequirementId,
      changed_by:   userIdNum,
      change_type:  "STATUS_CHANGE",
      old_value:    null,
      new_value:    "OPEN",
    });

  if (logError) {
    console.error("Failed to write status_update_log:", logError.message);
  }

  // ── 6. Notify newly assigned user ───────────────────────────
  if (assigneeId !== null) {
    (async () => {
      try {
        await sendPushNotification(assigneeId, {
          title: "New requirement assigned to you",
          body: `${correctedType.replace("_", " ")} · ${newReq.label_name ?? newReq.category_name ?? "New requirement"}`,
          url: `/requirements/${newRequirementId}?userId=${assigneeId}`,
        });
      } catch {
        // Notification failure must not affect the API response
      }
    })();
  }

  return NextResponse.json({ data: { newRequirementId } });
}
