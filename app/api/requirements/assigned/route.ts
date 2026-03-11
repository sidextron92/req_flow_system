// GET /api/requirements/assigned?userId=X
// Returns requirements assigned to the given user,
// excluding DRAFT status only (COMPLETED is included for "Req for me" closed filter).
// Includes creator info (name, darkstore_name) via users FK join.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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
      assigned_to_user_id, assigned_date, created_by,
      requirement_products ( id, product_id, product_name, notes ),
      creator:users!requirements_created_by_fkey ( name, darkstore_name )
    `)
    .eq("assigned_to_user_id", userId)
    .neq("status", "DRAFT")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type CreatorShape = { name: string; darkstore_name: string | null } | null;

  // Flatten the nested `creator` object into top-level fields
  const flattened = (data ?? []).map((row) => {
    // Supabase infers creator as an array type for FK joins; cast through unknown first
    const creator = (row.creator as unknown) as CreatorShape;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { creator: _, ...rest } = row as typeof row & { creator: unknown };
    return {
      ...rest,
      created_by_name:      creator?.name ?? null,
      created_by_darkstore: creator?.darkstore_name ?? null,
    };
  });

  return NextResponse.json({ data: flattened });
}
