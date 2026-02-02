/**
 * Child safety keyword scanner
 * Scans message text for potentially concerning Danish phrases
 */

export type KeywordCategory = 
  | "violence"
  | "pressure_secrets"
  | "sexual"
  | "bullying"
  | "selfworth";

export interface KeywordMatch {
  keyword: string;
  category: KeywordCategory;
}

/**
 * Hardcoded keyword list with Danish phrases
 * Categories:
 * - violence: threats or violent language
 * - pressure_secrets: pressure to keep secrets
 * - sexual: sexual content or pressure
 * - bullying: hurtful or bullying language
 * - selfworth: negative self-worth statements
 */
const KEYWORDS: Record<KeywordCategory, string[]> = {
  violence: [
    "slå",
    "dræbe",
    "skade",
    "tæve",
    "banke",
    "slag",
    "kniv",
    "våben",
    "jeg vil slå dig",
    "jeg vil dræbe dig",
  ],
  pressure_secrets: [
    "du må ikke sige det til nogen",
    "fortæl det ikke til nogen",
    "det er vores hemmelighed",
    "hvis du fortæller",
    "du må ikke fortælle",
    "hold det hemmeligt",
  ],
  sexual: [
    "nøgen",
    "nøgenhed",
    "send et billede",
    "send mig et billede",
    "vis mig",
    "kom alene",
    "mød mig alene",
    "seksuel",
    "sex",
  ],
  bullying: [
    "jeg hader dig",
    "du er dum",
    "du er grim",
    "ingen kan lide dig",
    "du er værdiløs",
    "du er en taber",
    "gå væk",
    "hold op med at eksistere",
  ],
  selfworth: [
    "ingen ville savne mig",
    "jeg vil dø",
    "jeg vil ikke leve",
    "jeg er værdiløs",
    "jeg er ingenting",
    "jeg vil forsvinde",
    "jeg vil begå selvmord",
  ],
};

/**
 * Scans message text for flagged keywords
 * Returns the first match found (or null if no match)
 * Case-insensitive matching
 */
export function scanMessageForRisk(messageText: string): KeywordMatch | null {
  if (!messageText || typeof messageText !== "string") {
    return null;
  }

  const normalizedText = messageText.toLowerCase().trim();
  if (!normalizedText) {
    return null;
  }

  // Check each category
  for (const [category, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase();
      // Simple includes check (case-insensitive)
      if (normalizedText.includes(normalizedKeyword)) {
        return {
          keyword: keyword,
          category: category as KeywordCategory,
        };
      }
    }
  }

  return null;
}

/**
 * Get all keywords for a specific category (for debugging/admin)
 */
export function getKeywordsForCategory(category: KeywordCategory): string[] {
  return KEYWORDS[category] || [];
}

/**
 * Get all keywords (for debugging/admin)
 */
export function getAllKeywords(): Record<KeywordCategory, string[]> {
  return KEYWORDS;
}
