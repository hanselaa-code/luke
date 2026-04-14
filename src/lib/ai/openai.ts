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
  range?: 'today' | 'tomorrow' | 'this_week' | 'upcoming';
  weekday?: string;
  partOfDay?: 'morning' | 'afternoon' | 'evening';
  beforeTime?: string;
  afterTime?: string;
  keyword?: string;
  first?: boolean;
  last?: boolean;
  summaryStyle?: 'full' | 'important_only';
  limit?: number;
}

/**
 * Stage 1: Classify the user's query into a structured tool argument.
 */
export async function generateToolRequest(message: string): Promise<CalendarToolRequest> {
  const fallback: CalendarToolRequest = { requiresCalendar: false };
  
  const systemPrompt = `You are an AI assistant orchestrator determining if a user's message requires checking their calendar.
You MUST return a JSON object representing the tool call parameters.

Keys:
1. "requiresCalendar" (boolean): true if querying Google Calendar is necessary to answer the question.
2. "action" (string, optional): e.g., "query", "summarize"
3. "range" (string, optional): "today" | "tomorrow" | "this_week" | "upcoming"
4. "weekday" (string, optional): specific day like "friday", "monday"
5. "partOfDay" (string, optional): "morning" | "afternoon" | "evening"
6. "beforeTime" (string, optional): "HH:mm" boundary (e.g. "12:00")
7. "afterTime" (string, optional): "HH:mm" boundary
8. "keyword" (string, optional): title keyword to search for, e.g., "flight", "meeting"
9. "first" (boolean, optional): true if they asked for their first event
10. "last" (boolean, optional): true if they asked for their last event
11. "summaryStyle" (string, optional): "full" | "important_only"
12. "limit" (number, optional): max number of events to fetch. DO NOT use if they ask for "last" or multiple things.

Examples:
User: "What time is it?" -> {"requiresCalendar": false}
User: "Am I free tomorrow afternoon?" -> {"requiresCalendar": true, "range": "tomorrow", "partOfDay": "afternoon"}
User: "Summarize only important things this week" -> {"requiresCalendar": true, "range": "this_week", "summaryStyle": "important_only"}
User: "What is my first event tomorrow?" -> {"requiresCalendar": true, "range": "tomorrow", "first": true}
User: "What is my last event today?" -> {"requiresCalendar": true, "range": "today", "last": true}
User: "Do I have anything before 12 on Friday?" -> {"requiresCalendar": true, "weekday": "friday", "range": "upcoming", "beforeTime": "12:00"}
User: "When is my next flight?" -> {"requiresCalendar": true, "keyword": "flight", "range": "upcoming", "first": true}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;

    return JSON.parse(content) as CalendarToolRequest;

  } catch (error) {
    console.error('Error generating tool request:', error);
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
export async function generateFinalResponse(message: string, context: string, lang: 'no' | 'en'): Promise<string> {
  const langRule = lang === 'no' 
    ? "IMPORTANT: The user wrote in Norwegian. You MUST reply ONLY in natural Norwegian Bokmål. NEVER use Danish or English."
    : "IMPORTANT: The user wrote in English. You MUST reply ONLY in English. NEVER use Danish or Norwegian.";

  const systemPrompt = `You are Luke, a premium, helpful, concise personal assistant.
Answer the user's message naturally based exactly on the provided tool context. 
Be direct, helpful, and do not yap excessively. Keep formatting elegant and readable. If time context dictates it, act warmly.

${langRule}

TOOL OR SYSTEM CONTEXT:
${context}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
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
