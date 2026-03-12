// PATCH /api/requirements/[id]/assign — reassign a requirement to a different bijnisBuyer
//
// Permission rules:
//   - Only the current assignee (assigned_to_user_id = userId) can reassign.
//   - Current user must have role 'bijnisBuyer'.
//   - Requirement must be in status OPEN or IN_PROCESS.
//   - newAssigneeId must be a valid user with role 'bijnisBuyer'.
//   - Self-assignment (newAssigneeId = userId) is not allowed.
//
// Audit:
//   - Sets updated_by = userId so the DB trigger logs an ASSIGNMENT_CHANGE row.
//   - assigned_date is NOT changed (kept from original assignment).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

const REASSIGN_ALLOWED_STATUSES = ["OPEN", "IN_PROCESS"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: { userId?: number | string; newAssigneeId?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, newAssigneeId } = body;
  if (!userId || !newAssigneeId) {
    return NextResponse.json(
      { error: "userId and newAssigneeId are required" },
      { status: 400 }
    );
  }

  const userIdNum       = Number(userId);
  const newAssigneeIdNum = Number(newAssigneeId);
  if (Number.isNaN(userIdNum) || Number.isNaN(newAssigneeIdNum)) {
    return NextResponse.json({ error: "Invalid userId or newAssigneeId" }, { status: 400 });
  }

  if (userIdNum === newAssigneeIdNum) {
    return NextResponse.json({ error: "Cannot reassign to yourself" }, { status: 400 });
  }

  // Fetch current requirement
  const { data: reqData, error: fetchReqError } = await supabaseAdmin
    .from("requirements")
    .select("status, assigned_to_user_id")
    .eq("id", requirementId)
    .single();

  if (fetchReqError || !reqData) {
    const status = fetchReqError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: fetchReqError?.message ?? "Requirement not found" },
      { status }
    );
  }

  // Only current assignee can reassign
  if (reqData.assigned_to_user_id !== userIdNum) {
    return NextResponse.json(
      { error: "Only the current assignee can reassign this requirement" },
      { status: 403 }
    );
  }

  // Requirement must be in an allowed status
  if (!REASSIGN_ALLOWED_STATUSES.includes(reqData.status)) {
    return NextResponse.json(
      { error: `Reassignment is only allowed when status is OPEN or IN_PROCESS` },
      { status: 403 }
    );
  }

  // Verify the current user is a bijnisBuyer
  const { data: currentUser, error: currentUserError } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userIdNum)
    .single();

  if (currentUserError || !currentUser) {
    return NextResponse.json({ error: "Current user not found" }, { status: 404 });
  }

  if (currentUser.role !== "bijnisBuyer") {
    return NextResponse.json(
      { error: "Only users with role bijnisBuyer can reassign requirements" },
      { status: 403 }
    );
  }

  // Verify the new assignee exists and is a bijnisBuyer
  const { data: newAssignee, error: newAssigneeError } = await supabaseAdmin
    .from("users")
    .select("id, name, role")
    .eq("id", newAssigneeIdNum)
    .single();

  if (newAssigneeError || !newAssignee) {
    return NextResponse.json({ error: "New assignee not found" }, { status: 404 });
  }

  if (newAssignee.role !== "bijnisBuyer") {
    return NextResponse.json(
      { error: "New assignee must have role bijnisBuyer" },
      { status: 400 }
    );
  }

  // Apply update — set updated_by so the DB trigger captures ASSIGNMENT_CHANGE in audit log
  // assigned_date is intentionally NOT updated (keep original assignment date)
  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update({
      assigned_to_user_id: newAssigneeIdNum,
      updated_by: userIdNum,
    })
    .eq("id", requirementId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Notify new assignee
  (async () => {
    try {
      const { data: req_detail } = await supabaseAdmin
        .from("requirements")
        .select("label_name")
        .eq("id", requirementId)
        .single();

      const label = req_detail?.label_name ?? "a requirement";
      await sendPushNotification(newAssigneeIdNum, {
        title: "Requirement reassigned to you",
        body: label,
        url: `/requirements/${requirementId}?userId=${newAssigneeIdNum}`,
      });
    } catch {
      // Notification failure must not affect the API response
    }
  })();

  return NextResponse.json({
    data: {
      id: requirementId,
      assigned_to_user_id: newAssigneeIdNum,
      assignee_name: newAssignee.name,
    },
  });
}
