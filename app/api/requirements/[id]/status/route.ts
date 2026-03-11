// PATCH /api/requirements/[id]/status — update requirement status
//
// Permission rules:
//   Creator (created_by = userId):
//     REVIEW_FOR_COMPLETION → COMPLETED | PARTIALLY_COMPLETE | INCOMPLETE
//   Assignee (assigned_to_user_id = userId):
//     OPEN → IN_PROCESS | CANNOT_BE_DONE
//     IN_PROCESS → REVIEW_FOR_COMPLETION | CANNOT_BE_DONE

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

type AllowedTransition = Record<string, string[]>;

const CREATOR_TRANSITIONS: AllowedTransition = {
  REVIEW_FOR_COMPLETION: ["COMPLETED", "PARTIALLY_COMPLETE", "INCOMPLETE"],
};

const ASSIGNEE_TRANSITIONS: AllowedTransition = {
  OPEN:       ["IN_PROCESS", "CANNOT_BE_DONE"],
  IN_PROCESS: ["REVIEW_FOR_COMPLETION", "CANNOT_BE_DONE"],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: { userId?: number | string; newStatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, newStatus } = body;
  if (!userId || !newStatus) {
    return NextResponse.json({ error: "userId and newStatus are required" }, { status: 400 });
  }

  const userIdNum = Number(userId);
  if (Number.isNaN(userIdNum)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  // Fetch current requirement
  const { data: req_data, error: fetchError } = await supabaseAdmin
    .from("requirements")
    .select("status, created_by, assigned_to_user_id")
    .eq("id", requirementId)
    .single();

  if (fetchError || !req_data) {
    const status = fetchError?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: fetchError?.message ?? "Not found" }, { status });
  }

  const currentStatus: string = req_data.status;
  const isCreator  = req_data.created_by === userIdNum;
  const isAssignee = req_data.assigned_to_user_id === userIdNum;

  // Check if transition is allowed
  const creatorAllowed  = CREATOR_TRANSITIONS[currentStatus]?.includes(newStatus)  && isCreator;
  const assigneeAllowed = ASSIGNEE_TRANSITIONS[currentStatus]?.includes(newStatus) && isAssignee;

  if (!creatorAllowed && !assigneeAllowed) {
    return NextResponse.json(
      { error: `Transition from ${currentStatus} to ${newStatus} is not allowed for this user` },
      { status: 403 }
    );
  }

  // Apply update — set updated_by so the DB trigger captures it for audit log
  const { error: updateError } = await supabaseAdmin
    .from("requirements")
    .update({ status: newStatus, updated_by: userIdNum })
    .eq("id", requirementId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Send push notification to the other party
  (async () => {
    try {
      const { data: req_detail } = await supabaseAdmin
        .from("requirements")
        .select("label_name, created_by, assigned_to_user_id")
        .eq("id", requirementId)
        .single();

      if (!req_detail) return;

      const label = req_detail.label_name ?? "a requirement";

      // Assignee acted → notify creator
      // Creator acted → notify assignee
      const notifyUserId = assigneeAllowed
        ? req_detail.created_by
        : req_detail.assigned_to_user_id;

      if (!notifyUserId) return;

      const messages: Record<string, { title: string; body: string }> = {
        IN_PROCESS:            { title: "Work started", body: `Someone started working on ${label}` },
        REVIEW_FOR_COMPLETION: { title: "Ready for review", body: `${label} is ready for your review` },
        CANNOT_BE_DONE:        { title: "Cannot be done", body: `${label} was marked as cannot be done` },
        COMPLETED:             { title: "Completed", body: `${label} has been marked as Completed` },
        PARTIALLY_COMPLETE:    { title: "Partially complete", body: `${label} has been marked as Partially Complete` },
        INCOMPLETE:            { title: "Needs rework", body: `${label} was marked as Incomplete` },
      };

      const msg = messages[newStatus];
      if (!msg) return;

      await sendPushNotification(notifyUserId, {
        ...msg,
        url: `/requirements/${requirementId}`,
      });
    } catch {
      // Notification failure must not affect the API response
    }
  })();

  return NextResponse.json({ data: { id: requirementId, status: newStatus } });
}
