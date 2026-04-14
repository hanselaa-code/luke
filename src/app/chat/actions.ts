'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents, getUpcomingEvents } from '@/lib/google/calendar';
import { CalendarToolRequest, generateToolRequest, generateFinalResponse } from '@/lib/ai/openai';

function getStartHour(timeStr: string): number {
  if (timeStr === 'All Day') return 0;
  const match = timeStr.match(/^(\d{2}):/);
  if (match) return parseInt(match[1], 10);
  return 0; // fallback
}

/**
 * Single server-side tool abstraction handling all calendar query combinations.
 */
async function getCalendarContext(accessToken: string, params: CalendarToolRequest): Promise<string> {
  const currentWeekDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  
  let baseContext = `System Context: The current time is ${timeStr}. Today is ${currentWeekDay}. `;

  if (params.summaryStyle) {
    baseContext += `The user explicitly requested a ${params.summaryStyle.replace('_', ' ')} style summary. Format your response accordingly. `;
  }

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

  // Apply Time Bounds Filters
  if (params.partOfDay) {
    if (params.partOfDay === 'morning') {
      events = events.filter(e => e.time === 'All Day' || getStartHour(e.time) < 12);
    } else if (params.partOfDay === 'afternoon') {
      events = events.filter(e => e.time !== 'All Day' && getStartHour(e.time) >= 12 && getStartHour(e.time) < 17);
    } else if (params.partOfDay === 'evening') {
      events = events.filter(e => e.time !== 'All Day' && getStartHour(e.time) >= 17);
    }
  }

  if (params.beforeTime) {
    const limitH = parseInt(params.beforeTime.split(':')[0], 10) || 24;
    events = events.filter(e => e.time === 'All Day' || getStartHour(e.time) < limitH);
  }

  if (params.afterTime) {
    const limitH = parseInt(params.afterTime.split(':')[0], 10) || 0;
    events = events.filter(e => e.time !== 'All Day' && getStartHour(e.time) >= limitH);
  }

  // Apply Limit / Ordering Filters
  if (params.first && events.length > 0) {
    events = [events[0]];
  } else if (params.last && events.length > 0) {
    events = [events[events.length - 1]];
  } else if (params.limit) {
    events = events.slice(0, params.limit);
  }

  // Format payload for the model
  if (events.length === 0) {
    return baseContext + `The calendar tool executed but found 0 matching events based on the requested filters.`;
  }

  const eventList = events.map(e => `- ${e.date} at ${e.time}: ${e.title} (Type: ${e.type})`).join('\n');
  return baseContext + `\n\nFetched Calendar Data:\n${eventList}`;
}

export async function processChatInteraction(message: string) {
  console.log("CHAT ACTION STARTED");

  try {
    const session = await auth();
    const lang = detectResponseLanguage(message);

    // 1. Guard against missing/expired local session state immediately
    if (!session?.accessToken) {
      console.log("CHAT BLOCKED: No valid accessToken in session.");
      return lang === 'no' 
        ? "Tilkoblingen til Google Kalender har utløpt. Vennligst logg inn på nytt for å fortsette."
        : "Your Google Calendar connection has expired. Please sign in again to continue.";
    }

    // 2. Ask OpenAI to interpret the need and generate tool arguments
    const toolRequest = await generateToolRequest(message);
    console.log("TOOL PARAMS:", toolRequest);

    // 3. Execute the single calendar tool abstraction server-side
    const toolContext = await getCalendarContext(session.accessToken, toolRequest);

    // 4. Provide the result context to the final generation model
    const finalResponse = await generateFinalResponse(message, toolContext, lang);
    
    return finalResponse;

  } catch (error) {
    const lang = detectResponseLanguage(message);

    if (error instanceof Error && error.message === 'GOOGLE_AUTH_EXPIRED') {
      console.log("CHAT BLOCKED: Caught GOOGLE_AUTH_EXPIRED during tool execution.");
      return lang === 'no' 
        ? "Tilkoblingen til Google Kalender har utløpt. Vennligst logg inn på nytt for å fortsette."
        : "Your Google Calendar connection has expired. Please sign in again to continue.";
    }

    console.error("CHAT ERROR FULL:", error);
    console.error("STACK:", error instanceof Error ? error.stack : error);

    // Return a plain string so Next.js does not hide the error behind a digest
    return lang === 'no'
      ? `Serverfeil: ${error instanceof Error ? error.message : String(error)}`
      : `Server Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

