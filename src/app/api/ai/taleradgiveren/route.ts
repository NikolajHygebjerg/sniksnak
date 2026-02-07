import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { getFollowUpTaleradgiverenResponse } from "@/lib/taleradgiveren-responses";

const TALERADGIVEREN_USER_ID = process.env.TALERADGIVEREN_USER_ID || "945d9864-7118-487b-addb-1dd1e821bc30";

/**
 * POST /api/ai/taleradgiveren
 * Håndterer beskeder fra barnet til Talerådgiveren og sender prædefinerede svar
 * Body: { childId: string, message: string, conversationHistory?: Array<{role: string, content: string}> }
 */
export async function POST(request: NextRequest) {
  console.log("✅ [Talerådgiveren] Modtog besked fra barn");

  let body: {
    childId?: string;
    message?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    flaggedMessageText?: string;
    flaggedCategory?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON body" }, { status: 400 });
  }

  const { childId, message, flaggedCategory } = body;

  if (!childId || !message) {
    return NextResponse.json(
      { error: "childId og message er påkrævet" },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();

  // Check if Talerådgiveren user exists
  const { data: taleradgiverenUser } = await admin
    .from("users")
    .select("id")
    .eq("id", TALERADGIVEREN_USER_ID)
    .maybeSingle();

  if (!taleradgiverenUser) {
    console.error(`⚠️ [Talerådgiveren] User not found with ID: ${TALERADGIVEREN_USER_ID}`);
    return NextResponse.json(
      { error: "Talerådgiveren user ikke fundet" },
      { status: 500 }
    );
  }

  // Find chat between child and Talerådgiveren
  const [u1, u2] = [childId, TALERADGIVEREN_USER_ID].sort();
  const { data: chat } = await admin
    .from("chats")
    .select("id")
    .eq("user1_id", u1)
    .eq("user2_id", u2)
    .maybeSingle();

  if (!chat) {
    return NextResponse.json(
      { error: "Chat med Talerådgiveren ikke fundet" },
      { status: 404 }
    );
  }

  // Get the most recent flagged message category for context
  // This helps us provide relevant responses
  const category = flaggedCategory || "default";

  // Get response from Talerådgiveren based on child's message
  const response = getFollowUpTaleradgiverenResponse(message, category);

  // Send response as a message in the chat
  const { data: sentMessage, error: insertError } = await admin
    .from("messages")
    .insert({
      chat_id: chat.id,
      sender_id: TALERADGIVEREN_USER_ID,
      content: response,
    })
    .select("id, content, created_at")
    .single();

  if (insertError) {
    console.error("⚠️ [Talerådgiveren] Failed to send message:", insertError);
    return NextResponse.json(
      { error: "Kunne ikke sende besked" },
      { status: 500 }
    );
  }

  console.log(`✅ [Talerådgiveren] Sent response to child ${childId}`);

  return NextResponse.json({
    success: true,
    message: sentMessage,
  });
}
