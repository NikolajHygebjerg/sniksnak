import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { scanMessageForRisk } from "@/lib/keyword-scanner";

/**
 * API endpoint to scan a message for safety keywords and flag if needed
 * Called after a message is successfully sent (non-blocking)
 * 
 * POST /api/messages/scan-and-flag
 * Body: { messageId: string, childId: string, messageText: string, chatId: string }
 */
export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error("⚠️ [Keyword Scanner] Failed to parse request body:", parseError);
      return NextResponse.json({ ok: false, error: "Ugyldig JSON" }, { status: 400 });
    }

    const { messageId, childId, messageText, chatId } = body || {};

    // Validate input
    if (!messageId || !childId || typeof messageText !== "string") {
      console.error("⚠️ [Keyword Scanner] Invalid input:", { messageId, childId, messageText, chatId });
      return NextResponse.json({ ok: false, error: "Ugyldigt input" }, { status: 400 });
    }

    // Scan the message
    const match = scanMessageForRisk(messageText);

    if (!match) {
      // No keywords found - message is clean
      return NextResponse.json({ ok: true, flagged: false });
    }

    // Keyword found - log to database
    console.log(`⚠️ [Keyword Scanner] Safety alert for child ${childId}: matched "${match.keyword}" (category: ${match.category})`);

    const admin = createServiceRoleClient();

    const { error: insertError } = await admin
      .from("flagged_messages")
      .insert({
        child_id: childId,
        message_id: messageId,
        matched_keyword: match.keyword,
        category: match.category,
      });

    if (insertError) {
      console.error("⚠️ [Keyword Scanner] Failed to insert flagged message:", insertError);
      // Don't fail the request - logging error is acceptable
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    // Notify parent of the recipient child (the child who received the message)
    if (chatId) {
      try {
        // Get the chat to find the recipient child
        const { data: chatData } = await admin
          .from("chats")
          .select("user1_id, user2_id")
          .eq("id", chatId)
          .single();

        if (chatData) {
          // Find the recipient child (the other user in the chat, not the sender)
          const recipientChildId = chatData.user1_id === childId ? chatData.user2_id : chatData.user1_id;

          // Get recipient child's parent(s) with surveillance level
          // Only notify parents with 'medium' or 'strict' surveillance level
          const { data: parentLinks } = await admin
            .from("parent_child_links")
            .select("parent_id, surveillance_level")
            .eq("child_id", recipientChildId)
            .in("surveillance_level", ["strict", "medium"]);

          if (parentLinks && parentLinks.length > 0) {
            // Get sender child's name for the notification
            const { data: senderChild } = await admin
              .from("users")
              .select("first_name, surname, username")
              .eq("id", childId)
              .single();

            const senderName = senderChild
              ? (senderChild.first_name && senderChild.surname
                  ? `${senderChild.first_name} ${senderChild.surname}`
                  : senderChild.username || "Et barn")
              : "Et barn";

            // Get recipient child's name
            const { data: recipientChild } = await admin
              .from("users")
              .select("first_name, surname, username")
              .eq("id", recipientChildId)
              .single();

            const recipientName = recipientChild
              ? (recipientChild.first_name && recipientChild.surname
                  ? `${recipientChild.first_name} ${recipientChild.surname}`
                  : recipientChild.username || "Dit barn")
              : "Dit barn";

            // Get "Sikker chat" system user
            // Note: This user must be created manually via Supabase Dashboard first
            // See: docs/SIKKER_CHAT_SETUP.md or migration 013_create_sikker_chat_user.sql
            const SIKKER_CHAT_USER_ID = "13afd8bf-90a6-49b9-b38e-49c8274ac157"; // Sikker chat system user ID
            
            // Check if Sikker chat user exists
            const { data: sikkerUser, error: sikkerUserError } = await admin
              .from("users")
              .select("id, email")
              .eq("id", SIKKER_CHAT_USER_ID)
              .maybeSingle();

            if (sikkerUserError) {
              console.error("⚠️ [Keyword Scanner] Error checking Sikker chat user:", sikkerUserError);
              // Continue without failing the request
            } else if (!sikkerUser) {
              console.error("⚠️ [Keyword Scanner] Sikker chat user not found!");
              console.error("⚠️ [Keyword Scanner] Please create the user manually:");
              console.error("⚠️ [Keyword Scanner] 1. Create auth user in Supabase Dashboard");
              console.error("⚠️ [Keyword Scanner] 2. Run migration 013_create_sikker_chat_user.sql");
              console.error("⚠️ [Keyword Scanner] Skipping parent notification.");
              // Continue without failing the request - return success
              return NextResponse.json({ 
                ok: true, 
                flagged: true, 
                category: match.category,
                keyword: match.keyword,
                warning: "Sikker chat user not found - notification not sent",
              });
            }

            // Notify each parent
            for (const link of parentLinks) {
              const parentId = link.parent_id;
              
              // Create or find chat between parent and Sikker chat
              const [u1, u2] = [parentId, SIKKER_CHAT_USER_ID].sort();
              let { data: sikkerChat } = await admin
                .from("chats")
                .select("id")
                .eq("user1_id", u1)
                .eq("user2_id", u2)
                .maybeSingle();

              if (!sikkerChat) {
                const { data: newChat, error: chatErr } = await admin
                  .from("chats")
                  .insert({ user1_id: u1, user2_id: u2 })
                  .select("id")
                  .single();
                if (chatErr) {
                  console.error("⚠️ [Keyword Scanner] Failed to create Sikker chat:", chatErr);
                  continue;
                }
                sikkerChat = newChat;
              }

              // Send notification message with clickable link
              // The link will be automatically detected and made clickable by renderMessageWithLinks
              const notificationMessage = `Dit barn ${recipientName} har modtaget en besked indeholdende dårligt sprog fra ${senderName}.\n\nBeskeden indeholdt: "${match.keyword}" (kategori: ${match.category}).\n\nVil du se chatten? Klik her: /chats/${chatId}`;

              const { error: msgErr } = await admin
                .from("messages")
                .insert({
                  chat_id: sikkerChat.id,
                  sender_id: SIKKER_CHAT_USER_ID,
                  content: notificationMessage,
                });

              if (msgErr) {
                console.error("⚠️ [Keyword Scanner] Failed to send notification to parent:", msgErr);
              } else {
                console.log(`✅ [Keyword Scanner] Notified parent ${parentId} about flagged message`);
              }
            }
          }
        }
      } catch (notifyError: any) {
        // Don't fail the request if notification fails
        console.error("⚠️ [Keyword Scanner] Error notifying parent:", notifyError);
      }
    }

    return NextResponse.json({ 
      ok: true, 
      flagged: true, 
      category: match.category,
      keyword: match.keyword,
    });

  } catch (error) {
    console.error("⚠️ [Keyword Scanner] Error scanning message:", error);
    // Never fail - return success so message sending isn't blocked
    return NextResponse.json({ ok: false, error: "Scan failed" }, { status: 500 });
  }
}
