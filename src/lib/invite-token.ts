import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.INVITE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type InvitePayload = { child_id: string; exp: number };

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/** Sign an invite token for a child (child_id). Valid for 7 days. */
export function signInviteToken(childId: string): string {
  if (!SECRET) throw new Error("INVITE_SECRET or SUPABASE_SERVICE_ROLE_KEY required for invite tokens");
  const payload: InvitePayload = { child_id: childId, exp: Date.now() + EXPIRY_MS };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", SECRET).update(payloadB64).digest();
  return `${payloadB64}.${base64UrlEncode(sig)}`;
}

/** Verify and decode an invite token. Returns payload or null if invalid/expired. */
export function verifyInviteToken(token: string): InvitePayload | null {
  if (!SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", SECRET).update(payloadB64).digest();
  const sig = base64UrlDecode(sigB64);
  if (sig.length !== expectedSig.length || !timingSafeEqual(sig, expectedSig)) return null;
  let payload: InvitePayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.child_id || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}
