# Migration 015 Update: Medium Level Access Restriction

## Issue
Medium level parents were able to access all chats, but they should only access chats after receiving a keyword notification (i.e., chats with flagged messages).

## Solution
Updated migration 015 to restrict RLS policies so that:
- **Strict level**: Can view all chats and messages (via RLS)
- **Medium level**: Cannot view chats/messages via RLS - must access via frontend check (which verifies flagged_messages exist)
- **Mild level**: Cannot access chats/messages directly

## Changes Made

### 1. RLS Policies (Migration 015)
- Changed from allowing both 'strict' and 'medium' to only allowing 'strict' level parents
- Medium level parents now rely on frontend access checks

### 2. Frontend Access Check (`chats/[id]/page.tsx`)
- Updated to check for flagged messages in the specific chat for medium level parents
- Only allows access if there's at least one flagged message in that chat

### 3. Chat List Filtering (`chats/page.tsx`)
- Added filtering logic to hide chats for medium level parents unless they have flagged messages
- Strict level parents see all chats
- Medium level parents only see chats with flagged messages

## How It Works Now

### Strict Level
- Can see all chats in the chat list
- Can access any chat directly
- Full RLS access

### Medium Level
- Only sees chats with flagged messages in the chat list
- Can only access chats that have flagged messages (via the notification link)
- No direct RLS access - frontend enforces the restriction

### Mild Level
- Cannot see any chats
- Cannot access chats directly
- Only gets notifications when child manually flags a message

## Testing
1. Create a child with "Medium" level
2. Verify parent cannot see chats in the chat list (unless flagged)
3. Send a message with a keyword (e.g., "jeg hader dig")
4. Verify parent receives notification and can access that specific chat
5. Verify parent still cannot access other chats
