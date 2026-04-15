import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing in environment");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CalendarToolRequest {
  requiresCalendar: boolean;
  action?: 'query' | 'summarize' | 'suggest' | 'create_calendar_event' | 'confirm_create' | 'cancel_create' | 'update_calendar_event' | 'confirm_update' | 'cancel_update';
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
CRITICAL RULE: If the user provides a follow-up reference (e.g., "Hva med tirsdag?"), you MUST look at the conversational history to resolve exactly WHICH Tuesday they mean based on the timeline, and explicitly use the target "date" string in "YYYY-MM-DD" format. Do not guess aimlessly.

Keys:
1. "requiresCalendar" (boolean): true if querying or modifying Google Calendar is necessary.
2. "action" (string, optional): "query", "summarize", "suggest", "create_calendar_event", "confirm_create", "cancel_create", "update_calendar_event", "confirm_update", "cancel_update"
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
17. "endTime" (string, optional): "HH:mm" for event creation or requested new end time for event updates. If the user provides an explicit end time, include it and do not replace it with durationMinutes.
18. "targetStartTime" / "targetEndTime" (string, optional): existing event time when the user says "from 10:15-12:37".
19. "newTitle" (string, optional): new title only if the user clearly asks to rename the event.
20. "newDate" (string, optional): new event date for update requests. Use "date" for the existing event date/context, and "newDate" for the requested destination date.

SPECIAL FLOWS:
- CREATE: If the user wants to add, book, or schedule an event (e.g., "legg inn møte", "book time"), use action "create_calendar_event". Extract title, date, and startTime if possible.
- CONFIRM: If the user says "ja", "ok", "gjør det", "confirm" in response to an assistant proposing to create an event, use action "confirm_create".
- CANCEL: If the user says "nei", "stopp", "avbryt", "cancel" in response to a proposed event, use action "cancel_create".

UPDATE FLOWS:
- If the user wants to move, change, rename, or update exactly one existing event, use action "update_calendar_event". Put the existing event title/search phrase in "title", existing date in "date" if known, existing time in targetStartTime/targetEndTime if known, and requested new values in newDate/startTime/endTime/newTitle.
- If the user says "ja", "ok", "gjÃ¸r det", "confirm" in response to an assistant proposing an update, use action "confirm_update".
- If the user says "nei", "stopp", "avbryt", "cancel" in response to a proposed update, use action "cancel_update".

Examples:
User: "Flytt mÃ¸tet med Kari til 14:30" -> {"requiresCalendar": true, "action": "update_calendar_event", "title": "Kari", "startTime": "14:30"}
User: "Endre skolebesÃ¸k Valencia fra 10:15-12:37 til 11:00-13:00" -> {"requiresCalendar": true, "action": "update_calendar_event", "title": "skolebesÃ¸k Valencia", "targetStartTime": "10:15", "targetEndTime": "12:37", "startTime": "11:00", "endTime": "13:00"}
History: [Assistant: "Jeg fant denne avtalen... Vil du at jeg skal endre den...", User: "ja"] -> {"requiresCalendar": true, "action": "confirm_update"}
User: "What time is it?" -> {"requiresCalendar": false}
User: "Am I free tomorrow afternoon?" -> {"requiresCalendar": true, "range": "tomorrow", "partOfDay": "afternoon"}
User: "Train from 11:09 to 13:47 Friday" -> {"requiresCalendar": true, "action": "create_calendar_event", "title": "Train", "date": "YYYY-MM-DD for Friday", "startTime": "11:09", "endTime": "13:47"}
User: "Legg inn møte med Per fredag kl 14" -> {"requiresCalendar": true, "action": "create_calendar_event", "title": "Møte med Per", "date": "YYYY-MM-DD for Friday", "startTime": "14:00", "durationMinutes": 60}
History: [Assistant: "Jeg kan opprette følgende avtale: Møte med Per...", User: "ja"] -> {"requiresCalendar": true, "action": "confirm_create"}
History: [Assistant: "Jeg kan opprette følgende avtale: ...", User: "nei"] -> {"requiresCalendar": true, "action": "cancel_create"}
User: "Sett opp avtale i morgen" -> {"requiresCalendar": true, "action": "create_calendar_event", "date": "YYYY-MM-DD for tomorrow"} (Note: startTime is missing, this is fine, Stage 2 will handle it).
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
  if (/\b(kan|du|t[\u00f8o]mme|slette|slett|fjern|kalenderen|avtaler)\b/u.test(lower)) {
    return 'no';
  }

  const norwegianWords = ['hva', 'når', 'hvem', 'hvordan', 'hvilken', 'hvilket', 'har', 'jeg', 'er', 'på', 'til', 'om', 'i', 'dag', 'morgen', 'kveld', 'uke', 'helg', 'hei', 'hallo', 'møte', 'neste', 'mitt', 'mine', 'noe', 'ingenting', 'fly', 'flyreise', 'kjedelig', 'rolig', 'avtale', 'jobb', 'fritid'];
  const words = msg.toLowerCase().replace(/[^a-zæøå]/g, ' ').split(/\s+/);
  
  let noScore = 0;
  for (const w of words) {
    if (norwegianWords.includes(w)) noScore++;
  }
  
  return noScore > 0 ? 'no' : 'en';
}

/**
 * Stage 2: Final Natural Language Generation
 */
export async function generateFinalResponse(messages: {role: 'user' | 'assistant', content: string}[], systemContext: string, lang: 'no' | 'en'): Promise<string> {
  const osloNow = new Date();
  const strNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' }).format(osloNow);

  const langRule = lang === 'no' 
    ? "IMPORTANT: The user wrote in Norwegian. You MUST reply ONLY in natural Norwegian Bokmål. NEVER use Danish or English."
    : "IMPORTANT: The user wrote in English. You MUST reply ONLY in English. NEVER use Danish or Norwegian.";

  const finalSystemPrompt = `You are an executive personal assistant named Luke.
You are concise, professional, but friendly.

CRITICAL BEHAVIOR RULES:
1. ${langRule}
2. CURRENT DATE GROUNDING: Today is ${strNow} local time. NEVER reason about dates as if it is a different day.
3. CONVERSATIONAL ANCHORING: If the context fetched from the tool refers to one specific day, ONLY answer about that specific day. Do not ramble into other days unless the user asked a multi-day question like "this week".
4. MULTI-DAY SUMMARIES: If the user asked about a whole week, provide a useful summary of the week's availability or business. Do not answer by only mentioning Monday.
5. PAST DATE REJECTION: If the system context flags that a requested date is in the past, or if you notice you are suggesting a slot that occurred prior to ${strNow}, immediately apologize and inform the user that the date has passed naturally. DO NOT suggest passed dates.
6. EVENT CREATION CONFIRMATION: If the system context indicates a pending event (PENDING_CREATE), you MUST present a summary using this EXACT format (in the requested language):
   "Jeg kan opprette følgende avtale:
   Møte: [Title]
   Dato: [Weekday] [Day]. [Month]
   Tid: [Start]–[End]
   Vil du at jeg skal legge dette inn i kalenderen?"
7. CLARIFICATION RULE: If scheduling details (date or time) are missing for a creation request, do NOT guess. Ask a short clarification question (e.g., "Hvilket tidspunkt...?", "Hvilken dag...?").

TOOL OR SYSTEM CONTEXT:
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

    return response.choices[0]?.message?.content || 
      (lang === 'no' ? "Beklager, jeg hadde problemer med å tolke det." : "I'm sorry, I encountered an issue interpreting that.");

  } catch (error) {
    console.error('Error generating final response:', error);
    return lang === 'no' 
      ? "Beklager, jeg hadde problemer med å generere et svar fra kalenderen din akkurat nå." 
      : "I'm so sorry, I had trouble generating a response based on your calendar just now.";
  }
}
