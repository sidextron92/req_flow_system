import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/push/subscribe?userId=123
// Returns current subscription status for the user
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId || isNaN(Number(userId))) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("device_info, created_at")
    .eq("user_id", Number(userId))
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    subscribed: !!data,
    device_info: data?.device_info ?? null,
    created_at: data?.created_at ?? null,
  });
}

// POST /api/push/subscribe
// Upserts subscription for a user (one per user — replaces existing)
export async function POST(req: NextRequest) {
  let body: {
    userId?: number | string;
    subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
    device_info?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, subscription, device_info } = body;

  if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "userId and subscription are required" }, { status: 400 });
  }

  const userIdNum = Number(userId);
  if (isNaN(userIdNum)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userIdNum,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        device_info: device_info ?? null,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/push/subscribe
// Removes subscription for a user
export async function DELETE(req: NextRequest) {
  let body: { userId?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const userIdNum = Number(userId);
  if (isNaN(userIdNum)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userIdNum);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
