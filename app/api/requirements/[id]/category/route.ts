// PATCH /api/requirements/[id]/category — update requirement category
//
// Permission rules:
//   Only users with role = 'bijnisBuyer' can change the category.
//   The DB trigger log_requirement_changes() logs CATEGORY_CHANGE automatically.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: { userId?: number | string; newCategory?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, newCategory } = body;
  if (!userId || !newCategory || typeof newCategory !== "string") {
    return NextResponse.json(
      { error: "userId and newCategory are required" },
      { status: 400 }
    );
  }

  const userIdNum = Number(userId);
  if (Number.isNaN(userIdNum)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  // Verify user exists and has bijnisBuyer role
  const { data: userData, error: userError } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userIdNum)
    .single();

  if (userError || !userData) {
    const status = userError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: userError?.message ?? "User not found" },
      { status }
    );
  }

  if (userData.role !== "bijnisBuyer") {
    return NextResponse.json(
      { error: "Only bijnisBuyer role can change category" },
      { status: 403 }
    );
  }

  // Fetch current requirement to return old value
  const { data: reqData, error: fetchError } = await supabaseAdmin
    .from("requirements")
    .select("category_name")
    .eq("id", requirementId)
    .single();

  if (fetchError || !reqData) {
    const status = fetchError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: fetchError?.message ?? "Requirement not found" },
      { status }
    );
  }

  const oldCategory = reqData.category_name;

  // Apply update — set updated_by so the DB trigger captures it for audit log
  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update({ category_name: newCategory, updated_by: userIdNum })
    .eq("id", requirementId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      id: requirementId,
      oldCategory,
      newCategory,
    },
  });
}
