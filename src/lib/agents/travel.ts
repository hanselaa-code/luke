import OpenAI from 'openai';

let missingOpenAIKeyWarned = false;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    if (!missingOpenAIKeyWarned) {
      console.warn("OPENAI_API_KEY is missing in environment; travel responses are unavailable at runtime.");
      missingOpenAIKeyWarned = true;
    }
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export interface TravelResult {
  title: string;
  recommendations: string[];
  directions?: string[];
  packingList?: string[];
  links: { label: string; url: string }[];
  advice?: string;
}

/**
 * Generates a clean Google Maps search or direction link.
 */
export function generateMapsLink(query: string, type: 'search' | 'dir' = 'search', destination?: string): string {
  const baseSearch = 'https://www.google.com/maps/search/?api=1&query=';
  const baseDir = 'https://www.google.com/maps/dir/?api=1&destination=';
  
  if (type === 'dir' && destination) {
    return `${baseDir}${encodeURIComponent(destination)}`;
  }
  return `${baseSearch}${encodeURIComponent(query)}`;
}

/**
 * Travel Agent Module: A specialized agent that provides travel-related data.
 */
export async function getTravelAgentResponse(params: {
  action?: string;
  destination?: string;
  query?: string;
  calendarContext?: string;
}): Promise<string> {
  const { action, destination, query, calendarContext } = params;

  if (!destination && action !== 'packing_list') {
    return "MISSING_LOCATION: I need to know the destination or city to provide specific travel advice.";
  }

  const travelExpertPrompt = `You are the Travel Agent module for Luke, a personal assistant.
Your task is to provide structured, practical travel information.

MISSION:
- For 'places': Recommend 3-5 top-rated restaurants, cafes, or bars in the given destination. Include a brief reason why.
- For 'sights': Suggest top 3-5 attractions or activities.
- For 'transport': Provide typical transport options (e.g. from airport to city center, or local public transport tips). 
- For 'packing_list': Generate a concise packing list based on the destination and current season (Late April).
- For 'map': Provide logic for a map search.

OUTPUT FORMAT:
Return a structured but readable list of facts, names, and tips. Do NOT use Norwegian yet; Luke will translate. Keep it in English for internal processing. ALWAYS include specific names of places or transport lines.

CONTEXT:
Action: ${action}
Destination: ${destination || 'Unknown'}
Specific Query/Filters: ${query || 'None'}
Calendar Context: ${calendarContext || 'No relevant travel events found.'}
`;

  try {
    const openai = getOpenAIClient();
    if (!openai) return "The travel module encountered an error.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: 'system', content: travelExpertPrompt },
        { role: 'user', content: `Provide travel data for ${action} in ${destination || 'unknown location'}.` }
      ],
      temperature: 0.2,
    });

    const travelData = response.choices[0].message?.content || "No travel data found.";
    
    // Simple logic to append a map link if a specific destination was requested
    let finalContext = `[TRAVEL AGENT OUTPUT]:\n${travelData}`;
    if (destination && (action === 'places' || action === 'sights' || action === 'map')) {
      const mapUrl = generateMapsLink(`${query || ''} ${destination}`.trim());
      finalContext += `\n\n[RECOMMENDED MAP LINK]: ${mapUrl}`;
    }
    if (destination && action === 'transport') {
        const dirUrl = generateMapsLink(destination, 'dir', destination);
        finalContext += `\n\n[TRANSPORT ROUTE LINK]: ${dirUrl}`;
    }

    return finalContext;
  } catch (error) {
    console.error('[TRAVEL AGENT ERROR]:', error);
    return "The travel module encountered an error.";
  }
}
