import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing in environment");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface LukeToolRequest {
  requiresCalendar: boolean;
  requiresGmail?: boolean;
  action?: 'query' | 'summarize' | 'suggest' | 'create_calendar_event' | 'confirm_create' | 'cancel_create' | 'update_calendar_event' | 'confirm_update' | 'cancel_update' | 'delete_calendar_event' | 'confirm_delete' | 'cancel_delete';
  gmailAction?: 'list' | 'summarize' | 'search' | 'read';
  range?: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month' | 'upcoming';
  weekday?: string;
  date?: string;
  partOfDay?: 'morning' | 'afternoon' | 'evening';
  beforeTime?: string;
  afterTime?: string;
  keyword?: string;
  emailFilter?: string; // e.g. "fra Kari" or "fra skolen"
  emailId?: string;
  emailIndex?: number; // 1-based, e.g. "den øverste"
  unreadOnly?: boolean;
  first?: boolean;
  last?: boolean;
  summaryStyle?: 'full' | 'important_only';
  limit?: number;
  needsSuggestion?: boolean;
  durationMinutes?: number;
  title?: string;
  startTime?: string;
  endTime?: string;
  targetStartTime?: string;
  targetEndTime?: string;
  newTitle?: string;
  newDate?: string;
}

/**
 * Stage 1: Classify the user's query into a structured tool argument.
 */
export async function generateToolRequest(messages: {role: 'user' | 'assistant', content: string}[]): Promise<LukeToolRequest> {
  const fallback: LukeToolRequest = { requiresCalendar: false };
  
  const osloNow = new Date();
  const osloOptions: Intl.DateTimeFormatOptions = { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' };
  const strNow = new Intl.DateTimeFormat('en-GB', osloOptions).format(osloNow);
  const [datePart, timePart] = strNow.split(', ');

  const systemPrompt = `You are an AI assistant orchestrator determining if a user's message requires checking their calendar OR their email (Gmail).
You MUST return a JSON object representing the tool call parameters.

LOCAL TIME CONTEXT: The exact current time in Europe/Oslo is ${timePart}. Today is ${datePart}.

Keys for CALENDAR (requiresCalendar: true):
1. "action": "query", "summarize", "suggest", "create_calendar_event", etc.
2. "range", "weekday", "date", "startTime", "endTime", "title", "newTitle", "newDate", etc.

Keys for GMAIL (requiresGmail: true):
1. "gmailAction": 
   - "summarize": summarize unread or recent (default overview).
   - "search": specific search for sender or topic.
   - "read": read the FULL content of a SPECIFIC email.
2. "emailFilter": string keyword for search/filter.
3. "unreadOnly": boolean.
4. "emailIndex": 1 for "øverste/første", 2 for "neste", etc.
5. "emailId": specific ID if known from previous turns.
6. "limit": number of emails to fetch (default 5).

CRITICAL RULE: 
- Set "gmailAction": "read" IF the user wants to "åpne", "lese", or asks "hva står det i den?" for a specific message.
- "requiresGmail" is true for any email query.
- Both calendar and gmail can be true if requested.

EXAMPLES:
User: "Har jeg fått noen viktige e-poster i dag?" -> {"requiresGmail": true, "gmailAction": "summarize", "emailFilter": "viktig"}
User: "Les den øverste e-posten" -> {"requiresGmail": true, "gmailAction": "read", "emailIndex": 1}
User: "Hva står det i den?" -> {"requiresGmail": true, "gmailAction": "read"}
User: "Åpne e-posten fra Kari" -> {"requiresGmail": true, "gmailAction": "read", "emailFilter": "Kari"}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const out = response.choices[0].message?.content || '{}';
    console.log("[DEBUG] Stage 1 Output:", out);
    return JSON.parse(out) as LukeToolRequest;
  } catch (err) {
    console.error("[ERROR] Failed to map intent:", err);
    return fallback;
  }
}

export function detectResponseLanguage(msg: string): 'no' | 'en' {
  const lower = msg.toLowerCase();
  const norwegianWords = ['hva', 'når', 'hvem', 'hvordan', 'hvilken', 'hvilket', 'har', 'jeg', 'er', 'på', 'til', 'om', 'i', 'dag', 'morgen', 'kveld', 'uke', 'helg', 'hei', 'hallo', 'møte', 'neste', 'mitt', 'mine', 'noe', 'ingenting', 'fly', 'flyreise', 'kjedelig', 'rolig', 'avtale', 'jobb', 'fritid', 'flytt', 'slett', 'endre', 'legg', 'book', 'sett', 'epost', 'e-post', 'innboks', 'melding', 'les', 'åpne'];
  const words = lower.replace(/[^a-zæøå]/g, ' ').split(/\s+/);
  let noScore = 0;
  for (const w of words) if (norwegianWords.includes(w)) noScore++;
  return noScore > 0 ? 'no' : 'en';
}

/**
 * Stage 2: Final Natural Language Generation
 */
export async function generateFinalResponse(messages: {role: 'user' | 'assistant', content: string}[], systemContext: string, lang: 'no' | 'en'): Promise<string> {
  const osloNow = new Date();
  const strNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' }).format(osloNow);

  const langRule = lang === 'no' 
    ? "IMPORTANT: You MUST reply ONLY in natural Norwegian Bokmål. NEVER use Danish or English."
    : "IMPORTANT: You MUST reply ONLY in English.";

  const finalSystemPrompt = `You are an executive assistant named Luke.
You are concise, professional, but friendly.

CRITICAL BEHAVIOR RULES:
1. ${langRule}
2. CURRENT DATE GROUNDING: Today is ${strNow}. Never reason about dates as if it is a different day.
3. CONVERSATIONAL ANCHORING: If the context refers to specific events or emails, focus strictly on those.
4. NATURAL OVERVIEW: When describing emails, be concise. Use phrases like "Du har fått en e-post fra..." or "Her er et sammendrag av de siste meldingene:".
5. GMAIL READ DETAIL: If provided with a full email body, provide a helpful and clean summary in Norwegian. Focus on the core message, deadlines, or requested actions.
6. CONFLICT HANDLING: For calendar, explicitly mention overlaps.
7. EVENT CREATION CONFIRMATION: Use the specific summary format if a calendar event is pending.
8. GMAIL SUMMARIES: When summarizing emails, use the provided sender, subject, and snippet to give a useful overview in Norwegian. Do not list technical IDs.

TOOL CONTEXT:
${systemContext}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      messages: [
        { role: 'system', content: finalSystemPrompt },
        ...messages
      ]
    });
    return response.choices[0]?.message?.content || "Error generating response.";
  } catch (error) {
    console.error('Error generating final response:', error);
    return "Beklager, det oppsto en feil.";
  }
}
