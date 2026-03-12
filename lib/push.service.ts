import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function sendPushNotification(
  userId: number,
  payload: PushPayload
): Promise<void> {
  try {
    const { data: sub, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !sub) return;

    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };

    try {
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" } // high urgency = FCM delivers immediately even with screen off
      );
    } catch (sendErr: unknown) {
      // Remove stale subscription
      const statusCode =
        sendErr && typeof sendErr === "object" && "statusCode" in sendErr
          ? (sendErr as { statusCode: number }).statusCode
          : null;
      if (statusCode === 410 || statusCode === 404) {
        await supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId);
      } else {
        console.error("[push] send failed for user", userId, sendErr);
      }
    }
  } catch (err) {
    console.error("[push] unexpected error for user", userId, err);
  }
}
