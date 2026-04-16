import OpenAI from 'openai';

let missingOpenAIKeyWarned = false;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    if (!missingOpenAIKeyWarned) {
      console.warn("OPENAI_API_KEY is missing in environment; AI responses are unavailable at runtime.");
      missingOpenAIKeyWarned = true;
    }
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export interface LukeToolRequest {
  requiresCalendar: boolean;
  requiresGmail?: boolean;
  requiresTravel?: boolean;
  action?: 'query' | 'summarize' | 'suggest' | 'create_calendar_event' | 'confirm_create' | 'cancel_create' | 'update_calendar_event' | 'confirm_update' | 'cancel_update' | 'delete_calendar_event' | 'confirm_delete' | 'cancel_delete';
  gmailAction?: 'list' | 'summarize' | 'search' | 'read';
  travelAction?: 'places' | 'sights' | 'transport' | 'packing_list' | 'map';
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
  travelDestination?: string;
  travelQuery?: string;
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

  const systemPrompt = `You are an AI assistant orchestrator determining if a user's message requires checking their calendar, email (Gmail), or if it is a travel-related request.
You MUST return a JSON object representing the tool call parameters.

LOCAL TIME CONTEXT: The exact current time in Europe/Oslo is ${timePart}. Today is ${datePart}.

Keys for CALENDAR (requiresCalendar: true):
1. "action": "query", "summarize", "suggest", "create_calendar_event", etc.
2. "range", "weekday", "date", "startTime", "endTime", "title", "newTitle", "newDate", etc.

Keys for GMAIL (requiresGmail: true):
1. "gmailAction": "summarize", "search", "read".
2. "emailFilter", "unreadOnly", "emailIndex", "emailId".

Keys for TRAVEL (requiresTravel: true):
1. "travelAction": 
   - "places": Food, drink, restaurants, bars.
   - "sights": Attractions, sightseeing, child-friendly activities.
   - "transport": Airport transport, local transport, routes to/from places.
   - "packing_list": Packing suggestions based on duration and destination.
   - "map": Specific request for directions or map links.
2. "travelDestination": The city or place (e.g. "Oslo", "Roma", "London", "flyplassen"). Leave empty if not specified.
3. "travelQuery": Specific filter (e.g. "barnevennlig", "billig", "romantisk").

CRITICAL RULE: 
- If user asks about food, drink, sights, transport, or travel advice, set "requiresTravel" to true.
- If destination is missing and it's a travel query, Luke will ask for it in Stage 2.
- Multiple domains can be true if requested.

EXAMPLES:
User: "Finn et bra sted å spise i nærheten" -> {"requiresTravel": true, "travelAction": "places", "travelDestination": "", "travelQuery": "bra sted"}
User: "Lag en pakkeliste for Roma" -> {"requiresTravel": true, "travelAction": "packing_list", "travelDestination": "Roma"}
User: "Hvordan kommer jeg meg til Gardermoen?" -> {"requiresTravel": true, "travelAction": "transport", "travelDestination": "Gardermoen"}
User: "Vis e-poster fra Kari" -> {"requiresGmail": true, "gmailAction": "search", "emailFilter": "Kari"}
`;

  try {
    const openai = getOpenAIClient();
    if (!openai) return fallback;

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
  const norwegianWords = ['hva', 'når', 'hvem', 'hvordan', 'hvilken', 'hvilket', 'har', 'jeg', 'er', 'på', 'til', 'om', 'i', 'dag', 'morgen', 'kveld', 'uke', 'helg', 'hei', 'hallo', 'møte', 'neste', 'mitt', 'mine', 'noe', 'ingenting', 'fly', 'flyreise', 'kjedelig', 'rolig', 'avtale', 'jobb', 'fritid', 'flytt', 'slett', 'endre', 'legg', 'book', 'sett', 'epost', 'e-post', 'innboks', 'melding', 'les', 'åpne', 'reise', 'spise', 'mat', 'restaurant', 'severdighet', 'pakkeliste', 'kart', 'veibeskrivelse'];
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
3. CONVERSATIONAL ANCHORING: If the context refers to specific events, emails, or travel advice, focus strictly on those.
4. TRAVEL ADVICE: If provided with travel agent data, summarize it nicely in Norwegian. Use bullet points for lists. Provide Google Maps links clearly.
5. MISSING CONTEXT: If a travel query is missing a location (and not clear from context), ask "Hvilken by eller hvilket sted tenker du på?" kindly.
6. NATURAL OVERVIEW: When describing emails or calendar, be concise.
7. GMAIL READ DETAIL: For full email body, provide clean summary.
8. CONFLICT HANDLING: For calendar, explicitly mention overlaps.

TOOL CONTEXT:
${systemContext}`;

  try {
    const openai = getOpenAIClient();
    if (!openai) return "Beklager, det oppsto en feil.";

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
