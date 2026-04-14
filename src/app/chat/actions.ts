'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents, getUpcomingEvents } from '@/lib/google/calendar';
import { CalendarToolRequest, generateToolRequest, generateFinalResponse } from '@/lib/ai/openai';

/**
 * Single server-side tool abstraction handling all calendar query combinations.
 */
async function getCalendarContext(accessToken: string, params: CalendarToolRequest): Promise<string> {
  const currentWeekDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  
  let baseContext = `System Context: The current time is ${timeStr}. Today is ${currentWeekDay}. `;

  if (!params.requiresCalendar) {
    return baseContext + "No calendar data was requested.";
  }

  // Determine standard fetch boundary
  const fetchLimit = (params.range === 'upcoming' || params.range === 'this_week' || params.keyword) ? 50 : 20;
  let events = await getUpcomingEvents(accessToken, fetchLimit);

  // Apply Range & Weekday Filters
  if (params.range === 'today') {
    events = events.filter(e => e.date === 'Today');
  } else if (params.range === 'tomorrow') {
    // getTomorrowsEvents correctly bounds the 24h period 
    events = await getTomorrowsEvents(accessToken);
  } else if (params.weekday) {
    const target = params.weekday.toLowerCase().trim();
    events = events.filter(e => e.date.toLowerCase().includes(target));
  }

  // Apply Keyword Filter
  if (params.keyword) {
    const kw = params.keyword.toLowerCase().trim();
    events = events.filter(e => e.title.toLowerCase().includes(kw));
  }

  // Apply Limit Filter
  if (params.limit) {
    events = events.slice(0, params.limit);
  }

  // Format payload for the model
  if (events.length === 0) {
    return baseContext + `The calendar tool executed but found 0 matching events.`;
  }

  const eventList = events.map(e => `- ${e.date} at ${e.time}: ${e.title}`).join('\n');
  return baseContext + `\n\nFetched Calendar Data:\n${eventList}`;
}

export async function processChatInteraction(message: string) {
  console.log("CHAT ACTION STARTED");

  try {
    const session = await auth();

    if (!session?.accessToken) {
      return "I need to connect to your Google Calendar first. Please make sure you are signed in and have granted calendar permissions.";
    }

    // 1. Ask OpenAI to interpret the need and generate tool arguments
    const toolRequest = await generateToolRequest(message);
    console.log("TOOL PARAMS:", toolRequest);

    // 2. Execute the single calendar tool abstraction server-side
    const toolContext = await getCalendarContext(session.accessToken, toolRequest);

    // 3. Provide the result context to the final generation model
    const finalResponse = await generateFinalResponse(message, toolContext);
    
    return finalResponse;

  } catch (error) {
    console.error("CHAT ERROR FULL:", error);
    console.error("STACK:", error instanceof Error ? error.stack : error);

    // Return a plain string so Next.js does not hide the error behind a digest
    return `Server Error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

