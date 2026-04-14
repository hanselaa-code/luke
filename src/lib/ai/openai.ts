import OpenAI from 'openai';

// Initialize the standard OpenAI client
// The SDK automatically uses process.env.OPENAI_API_KEY
const openai = new OpenAI();

export interface CalendarIntent {
  intent: 'tomorrow' | 'today' | 'this_week' | 'next_event' | 'specific_day' | 'summary' | 'unknown';
  day: string | null;
}

/**
 * Classifies a user's natural language request into a strongly typed calendar data intent.
 * Runs strictly server-side.
 */
export async function interpretCalendarIntent(message: string): Promise<CalendarIntent> {
  const fallback: CalendarIntent = { intent: 'unknown', day: null };
  
  const systemPrompt = `You are an AI assistant module for a calendar app.
Your job is to classify the user's natural language message to determine what calendar data they want to fetch.

You MUST return a JSON object with exactly two keys:
1. "intent": A string representing the action. It MUST be EXACTLY one of the following:
   ["tomorrow", "today", "this_week", "next_event", "specific_day", "summary", "unknown"]
2. "day": If intent is "specific_day", extract the day string (e.g., "friday", "monday"). Otherwise, provide null.

Examples:
User: "What do I have tomorrow?"
JSON: {"intent": "tomorrow", "day": null}

User: "Do I have anything on Friday?"
JSON: {"intent": "specific_day", "day": "friday"}

User: "Show my schedule for today"
JSON: {"intent": "today", "day": null}

User: "What's my next meeting?"
JSON: {"intent": "next_event", "day": null}

User: "How does my week look?"
JSON: {"intent": "this_week", "day": null}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2, // Low temperature for maximum deterministic classification
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as Partial<CalendarIntent>;
    
    return {
      intent: (parsed.intent as CalendarIntent['intent']) || 'unknown',
      day: parsed.day || null
    };

  } catch (error) {
    console.error('Error communicating with OpenAI (interpretCalendarIntent):', error);
    return fallback;
  }
}
