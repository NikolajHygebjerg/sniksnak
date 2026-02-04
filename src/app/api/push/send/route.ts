import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import webpush from "web-push";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || "mailto:admin@example.com";

// Configure web-push with VAPID keys
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

interface SendPushNotificationRequest {
  userId: string;
  title: string;
  body: string;
  url?: string;
  chatId?: string;
  tag?: string;
}

/**
 * POST /api/push/send
 * Send push notification to a user
 * Can be called from client-side (with auth) or server-side (with service key)
 */
export async function POST(request: NextRequest) {
  try {
    // Check if this is a server-side call (with service key) or client-side (with auth token)
    const serviceKey = request.headers.get("x-service-key");
    const authHeader = request.headers.get("authorization");
    
    // Parse body first
    const body: SendPushNotificationRequest & { userId?: string } = await request.json();
    
    let userId: string | undefined;
    
    if (serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Server-side call - userId should be in body
      userId = body.userId;
    } else if (authHeader) {
      // Client-side call - verify user and get userId from session
      const token = authHeader.replace("Bearer ", "").trim();
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      if (!supabaseUrl || !anonKey) {
        return NextResponse.json(
          { error: "Server configuration error" },
          { status: 500 }
        );
      }
      const client = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await client.auth.getUser(token);
      if (authErr || !user) {
        return NextResponse.json(
          { error: "Unauthorized - invalid session" },
          { status: 401 }
        );
      }
      userId = user.id;
    } else {
      return NextResponse.json(
        { error: "Unauthorized - service key or auth token required" },
        { status: 401 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json(
        { error: "VAPID keys not configured" },
        { status: 500 }
      );
    }

    const { title, body: messageBody, url, chatId, tag } = body;

    if (!title || !messageBody) {
      return NextResponse.json(
        { error: "Missing required fields: title, body" },
        { status: 400 }
      );
    }

    // Get all push subscriptions for this user
    const admin = createServiceRoleClient();
    const { data: subscriptions, error } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching push subscriptions:", error);
      return NextResponse.json(
        { error: "Failed to fetch subscriptions", details: error.message },
        { status: 500 }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json(
        { message: "No push subscriptions found for user", sent: 0 },
        { status: 200 }
      );
    }

    // Send push notification to all subscriptions
    const notificationPayload = JSON.stringify({
      title,
      body: messageBody,
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      tag: tag || "chat-message",
      url: url || (chatId ? `/chats/${chatId}` : "/chats"),
      chatId,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            notificationPayload
          );
          return { success: true, endpoint: sub.endpoint };
        } catch (error: any) {
          // If subscription is invalid, delete it
          if (error.statusCode === 410 || error.statusCode === 404) {
            await admin
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint);
            console.log(`Deleted invalid subscription: ${sub.endpoint}`);
          }
          return { success: false, endpoint: sub.endpoint, error: error.message };
        }
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failed = results.length - successful;

    return NextResponse.json({
      success: true,
      sent: successful,
      failed,
      total: subscriptions.length,
    });
  } catch (error: any) {
    console.error("Error sending push notification:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
