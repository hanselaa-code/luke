import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing in environment");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CalendarToolRequest {
  requiresCalendar: boolean;
  action?: string;
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
1. "requiresCalendar" (boolean): true if querying Google Calendar is necessary to answer the question.
2. "action" (string, optional): e.g., "query", "summarize", "suggest"
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
13. "durationMinutes" (number, optional): numeric duration for the requested slot (e.g., 30, 60). Default to 30 if unstated but suggestion is requested.
14. "date" (string, optional): exact "YYYY-MM-DD" target if resolving a specific date context from history. DO NOT use if they ask for "last" or multiple things.

Examples:
User: "What time is it?" -> {"requiresCalendar": false}
User: "Am I free tomorrow afternoon?" -> {"requiresCalendar": true, "range": "tomorrow", "partOfDay": "afternoon"}
User: "Summarize only important things this week" -> {"requiresCalendar": true, "range": "this_week", "summaryStyle": "important_only"}
History: [User: "Am I free this week?", Assistant: "You are busy on Monday."], User: "What about Tuesday?" -> {"requiresCalendar": true, "date": "Resolved YYYY-MM-DD of Tuesday this week."}
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
