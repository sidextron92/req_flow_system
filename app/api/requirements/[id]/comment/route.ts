// POST /api/requirements/[id]/comment
// Appends a comment object to the comment_log JSONB array.
//
// Body: { userId: number, name: string, comment: string }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requirementId } = await params;

  let body: { userId: number; name: string; comment: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, name, comment } = body;
  if (!userId || !name || !comment?.trim()) {
    return NextResponse.json({ error: "userId, name, and comment are required" }, { status: 400 });
  }

  const newEntry = {
    userId,
    name,
    comment: comment.trim(),
    date: new Date().toISOString(),
  };

  // Atomically append using Postgres jsonb concatenation
  const { error } = await supabaseAdmin.rpc("append_comment", {
    req_id: requirementId,
    new_comment: newEntry,
  });

  if (error) {
    // Fallback: read-modify-write if the RPC doesn't exist yet
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("requirements")
      .select("comment_log")
      .eq("id", requirementId)
      .single();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const updatedLog = [...(existing.comment_log ?? []), newEntry];

    const { error: updateErr } = await supabaseAdmin
      .from("requirements")
      .update({ comment_log: updatedLog })
      .eq("id", requirementId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // Fire-and-forget push notification to the other party
  // Only notify if both creator and assignee exist (assigned_to_user_id must be non-null)
  (async () => {
    const { data: requirement } = await supabaseAdmin
      .from("requirements")
      .select("created_by, assigned_to_user_id, label_name, category_name")
      .eq("id", requirementId)
      .single();

    if (!requirement?.assigned_to_user_id) return; // don't notify if unassigned

    const recipientId =
      requirement.created_by === userId
        ? requirement.assigned_to_user_id
        : requirement.created_by;

    if (!recipientId || recipientId === userId) return; // no self-notification

    const label = requirement.label_name || requirement.category_name || "Requirement";

    await sendPushNotification(recipientId, {
      title: `Msg received - ${label} requirement`,
      body: `${name}: ${comment.trim()}`,
      url: `/requirements/${requirementId}?userId=${recipientId}`,
    });
  })();

  return NextResponse.json({ data: newEntry }, { status: 201 });
}
