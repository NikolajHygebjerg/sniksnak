/**
 * Prædefinerede svar fra Talerådgiveren
 * Disse svar bruges når et barns besked bliver flagged
 */

export interface TaleradgiverenResponse {
  initialMessage: string; // Første besked når en besked bliver flagged
  followUpResponses: {
    [key: string]: string[]; // Kategoriseret efter keyword eller kategori
  };
}

/**
 * Henter det første svar fra Talerådgiveren baseret på kategori
 */
export function getInitialTaleradgiverenMessage(
  category: string,
  childName?: string
): string {
  const name = childName ? `, ${childName}` : "";
  
  const responses: Record<string, string> = {
    violence: `Hej${name}! Jeg så at du skrev noget om vold. Det kan være svært at håndtere vrede og frustration. Vil du fortælle mig lidt mere om hvad du føler?`,
    self_harm: `Hej${name}! Jeg er bekymret for dig. Jeg så at du skrev noget der bekymrer mig. Det er vigtigt at vi taler sammen. Hvordan har du det?`,
    bullying: `Hej${name}! Jeg så at du skrev noget der kunne være mobning. Det er vigtigt at vi behandler hinanden med respekt. Kan du fortælle mig hvad der skete?`,
    inappropriate: `Hej${name}! Jeg så at du skrev noget der ikke er passende. Det er vigtigt at vi taler pænt til hinanden. Hvad tænkte du på da du skrev det?`,
    default: `Hej${name}! Jeg så at du skrev noget der bekymrer mig lidt. Det er okay at have det svært nogle gange. Vil du fortælle mig hvad der sker?`,
  };

  return responses[category] || responses.default;
}

/**
 * Henter et opfølgningssvar baseret på barnets besked
 * Dette er en simpel regelbaseret tilgang - vi matcher nogle nøgleord i barnets besked
 */
export function getFollowUpTaleradgiverenResponse(
  childMessage: string,
  category: string
): string {
  const message = childMessage.toLowerCase();

  // Svar baseret på kategori og indhold
  if (category === "violence") {
    if (message.includes("ikke") || message.includes("nej") || message.includes("bare")) {
      return "Det er godt at høre. Det er vigtigt at vi finder andre måder at håndtere vrede på. Hvad hjælper dig når du bliver vred?";
    }
    if (message.includes("vred") || message.includes("sur") || message.includes("hader")) {
      return "Det er helt normalt at føle sig vred nogle gange. Det vigtige er hvordan vi håndterer det. Hvad gør du normalt når du bliver vred?";
    }
    return "Jeg forstår at det kan være svært. Det er vigtigt at vi finder konstruktive måder at håndtere vrede på. Hvad tror du kunne hjælpe?";
  }

  if (category === "self_harm") {
    if (message.includes("ikke") || message.includes("nej") || message.includes("bare")) {
      return "Det er godt at høre. Hvis du nogensinde har det svært, er det vigtigt at du taler med en voksen du stoler på. Hvem kan du tale med?";
    }
    if (message.includes("træt") || message.includes("svært") || message.includes("dårligt")) {
      return "Det lyder som om du har det svært lige nu. Det er vigtigt at du ved, at der er mennesker der vil hjælpe dig. Hvad tror du kunne hjælpe?";
    }
    return "Jeg er her for at lytte. Det er vigtigt at du ved, at der er mennesker der bekymrer sig om dig. Hvordan har du det?";
  }

  if (category === "bullying") {
    if (message.includes("undskyld") || message.includes("beklager")) {
      return "Det er godt at du kan se at det ikke var okay. Det er vigtigt at vi behandler hinanden med respekt. Hvad tror du du kunne gøre anderledes næste gang?";
    }
    if (message.includes("ikke") || message.includes("mente")) {
      return "Jeg forstår. Nogle gange kan det vi siger have en større effekt end vi tror. Hvordan tror du den anden person følte sig?";
    }
    return "Det er vigtigt at vi alle behandler hinanden med respekt. Hvad tror du der skete?";
  }

  // Generelt svar
  if (message.includes("ikke") || message.includes("nej") || message.includes("bare")) {
    return "Det er godt at høre. Det er vigtigt at vi alle taler pænt til hinanden. Hvad tænker du om det?";
  }

  if (message.includes("undskyld") || message.includes("beklager")) {
    return "Det er godt at du kan se at det ikke var okay. Det er vigtigt at vi lærer af vores fejl. Hvad tror du du kunne gøre anderledes næste gang?";
  }

  // Standard opfølgningssvar
  return "Tak fordi du deler det med mig. Det er vigtigt at vi taler sammen når der er noget der bekymrer os. Hvordan har du det nu?";
}
