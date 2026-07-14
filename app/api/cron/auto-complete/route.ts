import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push.service";

export async function GET(request: Request) {
  // Basic secret validation
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find requirements that transitioned to AUTO_COMPLETED in the last 25 hours
  // (25h instead of 24h to avoid edge-case misses due to clock drift)
  const { data, error } = await supabaseAdmin
    .from("status_update_log")
    .select("requirement_id, requirements!inner(created_by, label_name)")
    .eq("change_type", "STATUS_CHANGE")
    .eq("new_value", "AUTO_COMPLETED")
    .gte("changed_at", new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notified = new Set<number>();
  for (const row of data ?? []) {
    const req = Array.isArray(row.requirements) ? row.requirements[0] : row.requirements;
    const creatorId = req?.created_by as number | undefined;
    const labelName = req?.label_name as string | undefined;
    if (!creatorId || notified.has(creatorId)) continue;

    try {
      await sendPushNotification(creatorId, {
        title: "Requirement Auto Completed",
        body: `Your requirement "${labelName ?? "Untitled"}" was automatically completed after 10 days with no action.`,
        url: `/requirements/${row.requirement_id}?userId=${creatorId}`,
      });
      notified.add(creatorId);
    } catch {
      // Fire-and-forget: don't fail the cron if one push fails
    }
  }

  return NextResponse.json({ notified: notified.size });
}
