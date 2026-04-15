import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing in environment");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CalendarToolRequest {
  requiresCalendar: boolean;
  action?: 'query' | 'summarize' | 'suggest' | 'create_calendar_event' | 'confirm_create' | 'cancel_create' | 'update_calendar_event' | 'confirm_update' | 'cancel_update' | 'delete_calendar_event' | 'confirm_delete' | 'cancel_delete';
  range?: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month' | 'upcoming';
  weekday?: string;
  date?: string;
  partOfDay?: 'morning' | 'afternoon' | 'evening';
  beforeTime?: string;
  afterTime?: string;
  keyword?: string;
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
export async function generateToolRequest(messages: {role: 'user' | 'assistant', content: string}[]): Promise<CalendarToolRequest> {
  const fallback: CalendarToolRequest = { requiresCalendar: false };
  
  const osloNow = new Date();
  const osloOptions: Intl.DateTimeFormatOptions = { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' };
  const strNow = new Intl.DateTimeFormat('en-GB', osloOptions).format(osloNow);
  const [datePart, timePart] = strNow.split(', ');

  const systemPrompt = `You are an AI assistant orchestrator determining if a user's message requires checking their calendar.
You MUST return a JSON object representing the tool call parameters.

LOCAL TIME CONTEXT: The exact current time in Europe/Oslo is ${timePart}. Today is ${datePart}.
CRITICAL RULE: If the user provides a follow-up reference like "den", "det", "denne", or "it", you MUST look at the conversational history to identify which specific event was last discussed. If the user asks to "move it", they usually refer to the event that the assistant just fetched or described.
RESOLVE RELATIVE TIME: For requests like "flytt den en time frem" or "neste trening", calculate the target based on the grounded logic. "After [Event]" means fetching the event first or identifying its end time.

Keys:
1. "requiresCalendar" (boolean): true if querying or modifying Google Calendar is necessary.
2. "action" (string, optional): "query", "summarize", "suggest", "create_calendar_event", "confirm_create", "cancel_create", "update_calendar_event", "confirm_update", "cancel_update", "delete_calendar_event", "confirm_delete", "cancel_delete"
3. "range" (string, optional): "today" | "tomorrow" | "this_week" | "next_week" | "this_month" | "upcoming"
4. "weekday" (string, optional): specific day like "friday", "monday"
5. "partOfDay" (string, optional): "morning" | "afternoon" | "evening"
6. "beforeTime" (string, optional): "HH:mm" boundary (e.g. "12:00")
7. "afterTime" (string, optional): "HH:mm" boundary (e.g. "16:00")
8. "keyword" (string, optional): word to filter by, e.g., "flight", "dentist"
9. "first" / "last" (boolean, optional): if they ask for the first/last event.
10. "summaryStyle" (string, optional): "full" or "important_only"
11. "limit" (number, optional): max number of events to return.
12. "needsSuggestion" (boolean, optional): true if user asks for free time, a meeting slot, or scheduling availability.
13. "durationMinutes" (number, optional): numeric duration for the requested slot (e.g., 30, 60). Default to 60 for "create_calendar_event" if unstated.
14. "date" (string, optional): exact "YYYY-MM-DD" target.
15. "title" (string, optional): The title of the event for "create_calendar_event".
16. "startTime" (string, optional): "HH:mm" for event creation.
17. "endTime" (string, optional): "HH:mm" for event creation or requested new end time for event updates.
18. "targetStartTime" / "targetEndTime" (string, optional): existing event time when the user says "from 10:15-12:37".
19. "newTitle" (string, optional): new title only if the user clearly asks to rename the event.
20. "newDate" (string, optional): new event date for update requests.

SPECIAL FLOWS:
- CREATE: If the user wants to add, book, or schedule an event, use action "create_calendar_event".
- CONFIRM / CANCEL: Use the appropriate action for confirm/cancel in create, update, or delete flows.

UPDATE FLOWS:
- If the user wants to move, change, rename, or update exactly one existing event, use action "update_calendar_event".

DELETE FLOWS:
- If the user wants to delete, remove, or cancel exactly one existing event, use action "delete_calendar_event".
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
    return JSON.parse(out) as CalendarToolRequest;
  } catch (err) {
    console.error("[ERROR] Failed to map intent:", err);
    return fallback;
  }
}

export function detectResponseLanguage(msg: string): 'no' | 'en' {
  const lower = msg.toLowerCase();
  const norwegianWords = ['hva', 'når', 'hvem', 'hvordan', 'hvilken', 'hvilket', 'har', 'jeg', 'er', 'på', 'til', 'om', 'i', 'dag', 'morgen', 'kveld', 'uke', 'helg', 'hei', 'hallo', 'møte', 'neste', 'mitt', 'mine', 'noe', 'ingenting', 'fly', 'flyreise', 'kjedelig', 'rolig', 'avtale', 'jobb', 'fritid', 'flytt', 'slett', 'endre', 'legg', 'book', 'sett'];
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
3. CONVERSATIONAL ANCHORING: If the context refers to one specific day, focus your answer on that day.
4. NATURAL OVERVIEW: When describing a day or week, be concise and use professional Norwegian idioms. Example: "Det krasjer med..." or "Du har hele formiddagen ledig."
5. CONFLICT HANDLING: If the tool context contains CONFLICT WARNINGS, you MUST explicitly mention these overlaps clearly.
6. EVENT CREATION CONFIRMATION: If the context indicates a pending event, you MUST present a summary like this:
   "Jeg kan opprette følgende avtale:
   Møte: [Title]
   Dato: [Weekday] [Day]. [Month]
   Tid: [Start]–[End]
   Vil du at jeg skal legge dette inn i kalenderen?"
7. CLARIFICATION RULE: If scheduling details are missing, do NOT guess. Ask a short clarification question.

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
