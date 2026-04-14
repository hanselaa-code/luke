import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing in environment");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CalendarToolRequest {
  requiresCalendar: boolean;
  range?: 'today' | 'tomorrow' | 'this_week' | 'upcoming';
  weekday?: string;
  keyword?: string;
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
2. "range" (string, optional): "today" | "tomorrow" | "this_week" | "upcoming"
3. "weekday" (string, optional): specific day like "friday", "monday"
4. "keyword" (string, optional): title keyword to search for, e.g., "flight", "meeting"
5. "limit" (number, optional): max number of events to fetch, e.g. 1 for "next event"

Examples:
User: "What time is it?" -> {"requiresCalendar": false}
User: "Do I have anything on Friday?" -> {"requiresCalendar": true, "weekday": "friday", "range": "this_week"}
User: "When is my next flight?" -> {"requiresCalendar": true, "keyword": "flight", "range": "upcoming", "limit": 1}
User: "What do I have today?" -> {"requiresCalendar": true, "range": "today"}`;

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

/**
 * Stage 2: Final Natural Language Generation
 */
export async function generateFinalResponse(message: string, context: string): Promise<string> {
  const systemPrompt = `You are Luke, a premium, helpful, concise personal assistant.
Answer the user's message naturally based exactly on the provided tool context. 
Be direct, helpful, and do not yap excessively. Keep formatting elegant and readable. If time context dictates it, act warmly.

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

    return response.choices[0]?.message?.content || "I'm sorry, I encountered an issue interpreting that.";

  } catch (error) {
    console.error('Error generating final response:', error);
    return "I'm so sorry, I had trouble generating a response based on your calendar just now.";
  }
}
