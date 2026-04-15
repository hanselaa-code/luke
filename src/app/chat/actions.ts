'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents, getUpcomingEvents, getOsloBounds, getFreeSlots } from '@/lib/google/calendar';
import { CalendarToolRequest, generateToolRequest, generateFinalResponse, detectResponseLanguage } from '@/lib/ai/openai';

function getStartHour(timeStr: string): number {
  if (timeStr === 'All Day') return 0;
  const match = timeStr.match(/^(\d{2}):/);
  if (match) return parseInt(match[1], 10);
  return 0; // fallback
}

function getUnsupportedQuestionReply(lang: 'no' | 'en'): string {
  return lang === 'no'
    ? "Jeg er ikke helt sikker på det ennå, men jeg kan hjelpe deg med kalenderen din. Du kan for eksempel spørre: hva har jeg i morgen, når er jeg ledig neste uke, eller når går neste flyvning."
    : "I'm not fully sure about that yet, but I can help with your calendar. You can ask things like: what do I have tomorrow, when am I free next week, or when is my next flight.";
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
    return baseContext + "The user's question is outside the supported calendar scope. Reply with the concise fallback guidance in the user's language.";
  }

  // Determine standard fetch boundary
  let fetchLimit = (params.range === 'upcoming' || params.keyword) ? 50 : 20;
  let timeMin: string | undefined;
  let timeMax: string | undefined;

  if (params.range === 'this_week' || params.range === 'next_week' || params.range === 'this_month') {
    const bounds = getOsloBounds(params.range);
    timeMin = bounds.timeMin;
    timeMax = bounds.timeMax;
    fetchLimit = 200; // expand limit safely to ensure entire block is fetched
    console.log(`[DEBUG] Explicit bounds for ${params.range}: calculated start ${timeMin}, calculated end ${timeMax}`);
  }

  let events = await getUpcomingEvents(accessToken, fetchLimit, timeMin, timeMax);
  console.log(`[DEBUG] Fetched ${events.length} explicit events from Google API.`);

  // Past Date Verification & Resolution
  if (params.date) {
    const targetDate = params.date;
    console.log(`[DEBUG] Conversational explicit date requested: ${targetDate}`);
    // Compare YYYY-MM-DD string natively. sv-SE provides YYYY-MM-DD cleanly.
    const osloFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (targetDate < osloFormat) {
      console.log(`[DEBUG] BLOCKED: Requested date ${targetDate} is in the past relative to Oslo current date (${osloFormat})`);
      return baseContext + `[SYSTEM FLAG]: The user's explicitly requested date (${targetDate}) is ALREADY IN THE PAST. DO NOT suggest free or booked time. Simply inform the user naturally that this date has passed.`;
    }
    
    // Filter purely by exact date match in Iso format
    events = events.filter(e => e.startIso?.startsWith(targetDate) || e.endIso?.startsWith(targetDate));
  }

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
    const flightVariants = ['flight', 'fly', 'flyvning', 'reise'];
    
    if (flightVariants.some(v => kw.includes(v))) {
      const matchCountBefore = events.length;
      events = events.filter(e => {
        const title = e.title.toLowerCase();
        return flightVariants.some(v => title.includes(v));
      });
      console.log(`[DEBUG] Number of flights matched: ${events.length} (out of ${matchCountBefore} total fetched)`);
    } else {
      events = events.filter(e => e.title.toLowerCase().includes(kw));
    }
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
    if (params.needsSuggestion) {
      const freeSlots = getFreeSlots([], params.durationMinutes || 30, timeMin, timeMax, params.partOfDay);
      return baseContext + `The requested window is completely empty! Here are the computed free slots for the user:\n` + freeSlots.slice(0, 5).map(s => `- ${s}`).join('\n');
    }
    return baseContext + `The calendar tool executed but found 0 matching events based on the requested filters.`;
  }

  const eventList = events.map(e => `- ${e.date} at ${e.time}: ${e.title} (Type: ${e.type})`).join('\n');
  let finalContext = baseContext + `\n\nFetched Calendar Data:\n${eventList}`;
  
  if (params.needsSuggestion) {
    const freeSlots = getFreeSlots(events, params.durationMinutes || 30, timeMin, timeMax, params.partOfDay);
    console.log(`[DEBUG] Suggestion mode triggered! Computed ${freeSlots.length} free windows.`);
    finalContext += `\n\nComputed Free Slots for Suggestion:\n` + (freeSlots.length > 0 ? freeSlots.slice(0, 5).map(s => `- ${s}`).join('\n') : "NO FREE TIME DETECTED IN BOUNDS.");
  }

  return finalContext;
}

export async function processChatInteraction(messages: {role: 'user' | 'assistant', content: string}[]) {
  console.log("CHAT ACTION STARTED");

  try {
    const session = await auth();
    const userMessageContent = messages.length > 0 ? messages[messages.length - 1].content : '';
    const lang = detectResponseLanguage(userMessageContent);

    // 1. Guard against missing/expired local session state immediately
    if (!session?.accessToken) {
      console.log("CHAT BLOCKED: No valid accessToken in session.");
      return lang === 'no' 
        ? "Tilkoblingen til Google Kalender har utløpt. Vennligst logg inn på nytt for å fortsette."
        : "Your Google Calendar connection has expired. Please sign in again to continue.";
    }

    const toolRequest = await generateToolRequest(messages);

    if (!toolRequest.requiresCalendar) {
      return getUnsupportedQuestionReply(lang);
    }

    // 3. Execute the single calendar tool abstraction server-side
    const toolContext = await getCalendarContext(session.accessToken, toolRequest);
    console.log("[DEBUG] Final Tool Context for LLM:", toolContext);

    // 4. Provide the result context to the final generation model
    const finalResponse = await generateFinalResponse(messages, toolContext, lang);
    
    return finalResponse;

  } catch (error) {
    const userMessageContent = messages.length > 0 ? messages[messages.length - 1].content : '';
    const lang = detectResponseLanguage(userMessageContent);

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
