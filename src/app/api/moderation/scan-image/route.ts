import { NextRequest, NextResponse } from "next/server";
import { detectNSFW, validateImageUrl } from "@/lib/nsfw-detector";
import { createServiceRoleClient } from "@/lib/supabase-server";

/**
 * API endpoint to scan an uploaded image for NSFW content
 * Called after an image is successfully uploaded (non-blocking)
 * 
 * POST /api/moderation/scan-image
 * Body: { messageId: string, imageUrl: string, childId: string, chatId: string }
 */
export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error("⚠️ [Image Scanner] Failed to parse request body:", parseError);
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const { messageId, imageUrl, childId, chatId } = body || {};

    // Validate input
    if (!messageId || !imageUrl || !childId) {
      console.error("⚠️ [Image Scanner] Invalid input:", { messageId, imageUrl, childId, chatId });
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    // Validate image URL
    let isValidUrl = false;
    try {
      isValidUrl = await validateImageUrl(imageUrl);
    } catch (validateErr) {
      console.error("⚠️ [Image Scanner] Error validating image URL:", validateErr);
      return NextResponse.json({ ok: false, error: "Failed to validate image URL" }, { status: 400 });
    }
    
    if (!isValidUrl) {
      console.error("⚠️ [Image Scanner] Invalid image URL:", imageUrl);
      return NextResponse.json({ ok: false, error: "Invalid image URL" }, { status: 400 });
    }

    // Scan the image for NSFW content
    let detectionResult;
    try {
      detectionResult = await detectNSFW(imageUrl);
    } catch (detectErr) {
      console.error("⚠️ [Image Scanner] Error during NSFW detection:", detectErr);
      // Return safe result if detection fails
      detectionResult = {
        isUnsafe: false,
        confidence: 0,
        category: "error",
        reason: "Detection failed - manual review recommended",
      };
    }

    if (!detectionResult.isUnsafe) {
      // Image is safe - no action needed
      return NextResponse.json({ 
        ok: true, 
        flagged: false,
        confidence: detectionResult.confidence 
      });
    }

    // Unsafe content detected - flag the message
    console.log(`⚠️ [Image Scanner] Unsafe image detected for message ${messageId}: ${detectionResult.reason || detectionResult.category}`);

    let admin;
    try {
      admin = createServiceRoleClient();
    } catch (adminErr) {
      console.error("⚠️ [Image Scanner] Failed to create admin client:", adminErr);
      return NextResponse.json(
        { ok: false, error: "Failed to initialize database client" },
        { status: 500 }
      );
    }

    // Get "Sikker Chat" system user ID (same as keyword scanner)
    const SIKKER_CHAT_USER_ID = "13afd8bf-90a6-49b9-b38e-49c8274ac157";

    // Check if Sikker chat user exists
    const { data: sikkerUser, error: sikkerUserError } = await admin
      .from("users")
      .select("id, email")
      .eq("id", SIKKER_CHAT_USER_ID)
      .maybeSingle();

    if (sikkerUserError) {
      console.error("⚠️ [Image Scanner] Error checking Sikker chat user:", sikkerUserError);
    }

    if (!sikkerUser) {
      console.error("⚠️ [Image Scanner] Sikker chat user not found!");
      console.error("⚠️ [Image Scanner] 1. Check docs/SIKKER_CHAT_SETUP_STEPS.md");
      console.error("⚠️ [Image Scanner] 2. Run migration 013_create_sikker_chat_user.sql");
      
      // Still flag the message, but without notification
      const { error: flagError } = await admin.from("flags").insert({
        message_id: messageId,
        flagged_by: SIKKER_CHAT_USER_ID, // Will fail if user doesn't exist, but we'll handle it
        reason: `Unsafe image detected: ${detectionResult.reason || detectionResult.category || "NSFW content"} (confidence: ${detectionResult.confidence.toFixed(2)})`,
      });

      if (flagError) {
        console.error("⚠️ [Image Scanner] Failed to flag message (Sikker chat user missing):", flagError);
        return NextResponse.json({
          ok: false,
          error: "Failed to flag message",
          warning: "Sikker chat user not found - flag not created",
        }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Sikker chat user not found - notification not sent",
      });
    }

    // Flag the message in the flags table
    const { error: flagError } = await admin.from("flags").insert({
      message_id: messageId,
      flagged_by: SIKKER_CHAT_USER_ID,
      reason: `Unsafe image detected: ${detectionResult.reason || detectionResult.category || "NSFW content"} (confidence: ${detectionResult.confidence.toFixed(2)})`,
    });

    if (flagError) {
      console.error("⚠️ [Image Scanner] Failed to flag message:", flagError);
      return NextResponse.json({
        ok: false,
        error: "Failed to flag message",
      }, { status: 500 });
    }

    // Get the recipient child's parent (same logic as keyword scanner)
    // Find the other participant in the chat (not the sender)
    const { data: messageData, error: messageDataError } = await admin
      .from("messages")
      .select("sender_id, chat_id")
      .eq("id", messageId)
      .maybeSingle();

    if (messageDataError) {
      console.error("⚠️ [Image Scanner] Error fetching message:", messageDataError);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Error fetching message - flag created but notification not sent",
      });
    }

    if (!messageData || !messageData.chat_id) {
      console.error("⚠️ [Image Scanner] Message not found:", messageId);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Message not found - flag created but notification not sent",
      });
    }

    const { data: chatData, error: chatDataError } = await admin
      .from("chats")
      .select("user1_id, user2_id")
      .eq("id", messageData.chat_id)
      .maybeSingle();

    if (chatDataError) {
      console.error("⚠️ [Image Scanner] Error fetching chat:", chatDataError);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Error fetching chat - flag created but notification not sent",
      });
    }

    if (!chatData || !chatData.user1_id || !chatData.user2_id) {
      console.error("⚠️ [Image Scanner] Chat not found or invalid:", messageData.chat_id);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Chat not found - flag created but notification not sent",
      });
    }

    // Find the recipient (other participant)
    const recipientId = chatData.user1_id === childId ? chatData.user2_id : chatData.user1_id;

    // Find parent of the recipient child
    const { data: parentLink, error: parentLinkError } = await admin
      .from("parent_child_links")
      .select("parent_id")
      .eq("child_id", recipientId)
      .maybeSingle();

    if (parentLinkError) {
      console.error("⚠️ [Image Scanner] Error finding parent link:", parentLinkError);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Error finding parent - flag created but notification not sent",
      });
    }

    if (!parentLink || !parentLink.parent_id) {
      console.log("⚠️ [Image Scanner] No parent found for recipient child:", recipientId);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "No parent found for recipient - flag created but notification not sent",
      });
    }

    const parentId = parentLink.parent_id;

    // Create or find chat between parent and Sikker chat
    const [u1, u2] = [parentId, SIKKER_CHAT_USER_ID].sort();
    let sikkerChatId: string;
    
    try {
      const { data: existingChat, error: existingChatError } = await admin
        .from("chats")
        .select("id")
        .eq("user1_id", u1)
        .eq("user2_id", u2)
        .maybeSingle();

      if (existingChatError) {
        console.error("⚠️ [Image Scanner] Error checking for existing Sikker chat:", existingChatError);
      }

      if (existingChat && existingChat.id) {
        sikkerChatId = existingChat.id;
      } else {
        const { data: newChat, error: chatErr } = await admin
          .from("chats")
          .insert({
            user1_id: u1,
            user2_id: u2,
          })
          .select("id")
          .maybeSingle();

        if (chatErr) {
          console.error("⚠️ [Image Scanner] Failed to create Sikker chat:", chatErr);
          return NextResponse.json({
            ok: true,
            flagged: true,
            warning: "Failed to create notification chat - flag created but notification not sent",
          });
        }
        
        if (!newChat || !newChat.id) {
          console.error("⚠️ [Image Scanner] Sikker chat creation returned no data");
          return NextResponse.json({
            ok: true,
            flagged: true,
            warning: "Failed to create notification chat - flag created but notification not sent",
          });
        }
        
        sikkerChatId = newChat.id;
      }
    } catch (chatError) {
      console.error("⚠️ [Image Scanner] Exception creating/finding Sikker chat:", chatError);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Exception creating notification chat - flag created but notification not sent",
      });
    }

    // Send notification message to parent
    const notificationMessage = `⚠️ Sikkerhedsadvarsel: Et billede med usikker indhold er blevet sendt i chatten med dit barn. Billedet er blevet markeret. Klik her for at se chatten: /chats/${messageData.chat_id}`;

    try {
      const { error: msgError } = await admin.from("messages").insert({
        chat_id: sikkerChatId,
        sender_id: SIKKER_CHAT_USER_ID,
        content: notificationMessage,
      });

      if (msgError) {
        console.error("⚠️ [Image Scanner] Failed to send notification:", msgError);
        return NextResponse.json({
          ok: true,
          flagged: true,
          warning: "Flag created but notification failed",
        });
      }
    } catch (msgErr) {
      console.error("⚠️ [Image Scanner] Exception sending notification:", msgErr);
      return NextResponse.json({
        ok: true,
        flagged: true,
        warning: "Flag created but notification exception",
      });
    }

    console.log(`✅ [Image Scanner] Image flagged and parent notified: message ${messageId}, parent ${parentId}`);

    return NextResponse.json({
      ok: true,
      flagged: true,
      category: detectionResult.category,
      confidence: detectionResult.confidence,
      reason: detectionResult.reason,
    });
  } catch (error) {
    // Safe error logging
    try {
      if (error && typeof error === "object" && Object.keys(error).length > 0) {
        console.error("⚠️ [Image Scanner] Unexpected error:", error);
      } else {
        console.error("⚠️ [Image Scanner] Unknown error occurred:", error);
      }
    } catch (logErr) {
      console.error("⚠️ [Image Scanner] Error occurred but could not be logged:", String(error || "Unknown"));
    }
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
