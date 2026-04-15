'use server';

import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { getTomorrowsEvents, getUpcomingEvents, getOsloBounds, getFreeSlots, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, FormattedEvent } from '@/lib/google/calendar';
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

function getUnsupportedDestructiveReply(lang: 'no' | 'en'): string {
  return lang === 'no'
    ? "Beklager, jeg kan ikke slette eller t\u00f8mme kalenderen enn\u00e5. Jeg kan derimot hjelpe deg med \u00e5 se avtaler, finne ledig tid og opprette nye avtaler."
    : "I'm sorry, I can't delete or clear your calendar yet. I can help you view events, find free time, and create new events.";
}

function isUnsupportedDestructiveRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    /t[\u00f8o]m(me)?\s+(kalender(en)?|calendar)/,
    /slett(e)?\s+(alle|alt|kalender(en)?)/,
    /fjern\s+(alle|alt|kalender(en)?)/,
    /clear\s+(the\s+)?calendar/,
    /delete\s+(all|everything|the\s+calendar)/,
    /wipe\s+(a\s+day|the\s+day|everything|calendar)/,
    /remove\s+(all|everything)/,
  ].some((pattern) => pattern.test(normalized));
}

function getOsloDayBounds(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Oslo',
    timeZoneName: 'longOffset',
  }).format(noonUtc);
  const match = offsetStr.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = match?.[1] || '+01:00';

  return {
    timeMin: `${date}T00:00:00${offset}`,
    timeMax: `${date}T23:59:59${offset}`,
  };
}

function getOsloTodayDate(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isPastOsloDate(date: string): boolean {
  return date < getOsloTodayDate();
}

function formatOsloDateLabel(date: string, lang: 'no' | 'en'): string {
  const [year, month, day] = date.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const locale = lang === 'no' ? 'nb-NO' : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(utcNoon);
}

function getCreateConfirmationReply(toolContext: string, lang: 'no' | 'en'): string | null {
  if (!toolContext.startsWith('[PENDING_CREATE]:')) return null;

  const title = toolContext.match(/^Title: (.+)$/m)?.[1];
  const date = toolContext.match(/^Date: (.+)$/m)?.[1];
  const start = toolContext.match(/^Start: (.+)$/m)?.[1];
  const end = toolContext.match(/^End: (.+)$/m)?.[1];

  if (!title || !date || !start || !end) return null;

  const dateLabel = formatOsloDateLabel(date, lang);
  return lang === 'no'
    ? `Jeg kan opprette f\u00f8lgende avtale:\nM\u00f8te: ${title}\nDato: ${dateLabel}\nTid: ${start}\u2013${end}\nVil du at jeg skal legge dette inn i kalenderen?`
    : `I can create this event:\nEvent: ${title}\nDate: ${dateLabel}\nTime: ${start}\u2013${end}\nDo you want me to add it to your calendar?`;
}

function getPastDateReply(toolContext: string, lang: 'no' | 'en'): string | null {
  const match = toolContext.match(/\[PAST_DATE\]:([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  if (!match) return null;

  const dateLabel = formatOsloDateLabel(match[1], lang);
  return lang === 'no'
    ? `Beklager, jeg kan ikke opprette avtalen fordi ${dateLabel} allerede har passert.`
    : `I'm sorry, I can't create the event because ${dateLabel} has already passed.`;
}

function getCreateSuccessReply(toolContext: string, lang: 'no' | 'en'): string | null {
  if (!toolContext.startsWith('[SUCCESS]:')) return null;

  const title = toolContext.match(/^Title: (.+)$/m)?.[1];
  const date = toolContext.match(/^Date: (.+)$/m)?.[1];
  const start = toolContext.match(/^Start: (.+)$/m)?.[1];
  const end = toolContext.match(/^End: (.+)$/m)?.[1];

  if (!title || !date || !start || !end) {
    return lang === 'no'
      ? "Avtalen er opprettet i Google Kalender."
      : "The event has been created in Google Calendar.";
  }

  const dateLabel = formatOsloDateLabel(date, lang);
  return lang === 'no'
    ? `Avtalen er opprettet i Google Kalender:\nM\u00f8te: ${title}\nDato: ${dateLabel}\nTid: ${start}\u2013${end}`
    : `The event has been created in Google Calendar:\nEvent: ${title}\nDate: ${dateLabel}\nTime: ${start}\u2013${end}`;
}

function getDeterministicCreateReply(toolContext: string, lang: 'no' | 'en'): string | null {
  return getCreateConfirmationReply(toolContext, lang)
    ?? getPastDateReply(toolContext, lang)
    ?? getCreateSuccessReply(toolContext, lang);
}

interface PendingUpdate {
  eventId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  newTitle?: string;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
}

interface PendingDelete {
  eventId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
}

function getOsloDateFromIso(iso?: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function getOsloTimeFromIso(iso?: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function buildTimedOsloIso(date: string, time: string): string {
  const offset = getOsloDayBounds(date).timeMin.slice(-6);
  return `${date}T${time}:00${offset}`;
}

function addMinutesToOsloTime(date: string, time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const shifted = new Date(base.getTime() + minutes * 60000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

function minutesBetween(start: string, end: string): number {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

function titleMatches(eventTitle: string, query?: string): boolean {
  if (!query) return true;
  const normalizedTitle = eventTitle.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => normalizedTitle.includes(word));
}

function findUpdateMatches(events: FormattedEvent[], params: CalendarToolRequest): FormattedEvent[] {
  return events.filter((event) => {
    const eventDate = getOsloDateFromIso(event.startIso);
    const eventStart = getOsloTimeFromIso(event.startIso);
    const eventEnd = getOsloTimeFromIso(event.endIso);
    const targetStartTime = params.targetStartTime || (params.action === 'delete_calendar_event' ? params.startTime : undefined);
    const targetEndTime = params.targetEndTime || (params.action === 'delete_calendar_event' ? params.endTime : undefined);

    if (!titleMatches(event.title, params.title)) return false;
    if (params.date && eventDate !== params.date) return false;
    if (targetStartTime && eventStart !== targetStartTime) return false;
    if (targetEndTime && eventEnd !== targetEndTime) return false;

    return !!eventDate && !!eventStart && !!eventEnd;
  });
}

function hasDeleteLookupDetail(params: CalendarToolRequest): boolean {
  return !!(params.title || params.date || params.startTime || params.endTime || params.targetStartTime || params.targetEndTime);
}

function buildPendingDelete(event: FormattedEvent): PendingDelete | null {
  const date = getOsloDateFromIso(event.startIso);
  const startTime = getOsloTimeFromIso(event.startIso);
  const endTime = getOsloTimeFromIso(event.endIso);
  if (!date || !startTime || !endTime) return null;

  return {
    eventId: event.id,
    title: event.title,
    date,
    startTime,
    endTime,
  };
}

function formatDeleteDetails(event: PendingDelete): string {
  return `M\u00f8te: ${event.title}
Dato: ${formatOsloDateLabel(event.date, 'no')}
Tid: ${event.startTime}\u2013${event.endTime}`;
}

function buildPendingUpdate(event: FormattedEvent, params: CalendarToolRequest): PendingUpdate | null {
  const date = getOsloDateFromIso(event.startIso);
  const startTime = getOsloTimeFromIso(event.startIso);
  const endTime = getOsloTimeFromIso(event.endIso);
  if (!date || !startTime || !endTime) return null;

  const newDate = params.newDate || date;
  const newStartTime = params.startTime || startTime;
  const duration = Math.max(minutesBetween(startTime, endTime), 1);
  const newEndTime = params.endTime || (params.startTime ? addMinutesToOsloTime(newDate, newStartTime, duration) : endTime);

  return {
    eventId: event.id,
    title: event.title,
    date,
    startTime,
    endTime,
    newTitle: params.newTitle,
    newDate,
    newStartTime,
    newEndTime,
  };
}

function formatUpdateDetails(update: PendingUpdate): string {
  const newTitle = update.newTitle || update.title;
  return `M\u00f8te: ${update.title}
Dato: ${formatOsloDateLabel(update.date, 'no')}
Tid: ${update.startTime}\u2013${update.endTime}

Vil du at jeg skal endre den til:
M\u00f8te: ${newTitle}
Dato: ${formatOsloDateLabel(update.newDate, 'no')}
Tid: ${update.newStartTime}\u2013${update.newEndTime}?`;
}

function getDeterministicUpdateReply(toolContext: string): string | null {
  if (toolContext.startsWith('[UPDATE_NO_MATCH]')) {
    return "Beklager, jeg fant ingen avtale som passer med det du ba om. Kan du skrive navnet, datoen eller tidspunktet litt mer presist?";
  }

  if (toolContext.startsWith('[UPDATE_MISSING_CHANGE]')) {
    return "Hva vil du endre avtalen til? Du kan for eksempel oppgi ny dato, nytt tidspunkt eller ny tittel.";
  }

  if (toolContext.startsWith('[UPDATE_MULTIPLE]')) {
    return toolContext.replace('[UPDATE_MULTIPLE]\n', '');
  }

  if (toolContext.startsWith('[PENDING_UPDATE]')) {
    return toolContext.replace('[PENDING_UPDATE]\n', '');
  }

  if (toolContext.startsWith('[UPDATE_NOT_EDITABLE]')) {
    return "Beklager, jeg fant avtalen, men Google Kalender tillater ikke at jeg endrer den. Den kan være fra en synkronisert eller skrivebeskyttet kalender.";
  }

  if (toolContext.startsWith('[UPDATE_SUCCESS]')) {
    return toolContext.replace('[UPDATE_SUCCESS]\n', '');
  }

  if (toolContext.startsWith('[UPDATE_CANCELLED]')) {
    return toolContext.replace('[UPDATE_CANCELLED]\n', '');
  }

  return null;
}

function getDeterministicDeleteReply(toolContext: string): string | null {
  if (toolContext.startsWith('[DELETE_NO_MATCH]')) {
    return "Beklager, jeg fant ingen avtale som passer med det du ba om. Kan du skrive navnet, datoen eller tidspunktet litt mer presist?";
  }

  if (toolContext.startsWith('[DELETE_MISSING_TARGET]')) {
    return "Hvilken avtale vil du slette? Oppgi gjerne navn, dato eller tidspunkt.";
  }

  if (toolContext.startsWith('[DELETE_MULTIPLE]')) {
    return toolContext.replace('[DELETE_MULTIPLE]\n', '');
  }

  if (toolContext.startsWith('[PENDING_DELETE]')) {
    return toolContext.replace('[PENDING_DELETE]\n', '');
  }

  if (toolContext.startsWith('[DELETE_NOT_ALLOWED]')) {
    return "Beklager, jeg fant avtalen, men Google Kalender tillater ikke at jeg sletter den. Den kan v\u00e6re fra en synkronisert eller skrivebeskyttet kalender.";
  }

  if (toolContext.startsWith('[DELETE_SUCCESS]')) {
    return toolContext.replace('[DELETE_SUCCESS]\n', '');
  }

  if (toolContext.startsWith('[DELETE_CANCELLED]')) {
    return toolContext.replace('[DELETE_CANCELLED]\n', '');
  }

  return null;
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

  if (params.action === 'delete_calendar_event') {
    if (!hasDeleteLookupDetail(params)) {
      return "[DELETE_MISSING_TARGET]";
    }

    const timeMin = params.date ? getOsloDayBounds(params.date).timeMin : undefined;
    const timeMax = params.date ? getOsloDayBounds(params.date).timeMax : undefined;
    const events = await getUpcomingEvents(accessToken, params.date ? 100 : 200, timeMin, timeMax);
    const matches = findUpdateMatches(events, params);

    if (matches.length === 0) {
      return "[DELETE_NO_MATCH]";
    }

    if (matches.length > 1) {
      const choices = matches.slice(0, 5).map((event, index) => {
        const date = getOsloDateFromIso(event.startIso);
        const start = getOsloTimeFromIso(event.startIso);
        const end = getOsloTimeFromIso(event.endIso);
        const dateLabel = date ? formatOsloDateLabel(date, 'no') : event.date;
        return `${index + 1}. ${event.title} - ${dateLabel} ${start || ''}${end ? `\u2013${end}` : ''}`;
      }).join('\n');

      return `[DELETE_MULTIPLE]
Jeg fant flere avtaler som kan passe. Hvilken vil du slette?
${choices}`;
    }

    const pendingDelete = buildPendingDelete(matches[0]);
    if (!pendingDelete) {
      return "[DELETE_NO_MATCH]";
    }

    const cookieStore = await cookies();
    cookieStore.set('pending_delete', JSON.stringify(pendingDelete), { maxAge: 600, path: '/' });

    return `[PENDING_DELETE]
Jeg fant denne avtalen:
${formatDeleteDetails(pendingDelete)}

Vil du at jeg skal slette denne avtalen?`;
  }

  if (params.action === 'update_calendar_event') {
    if (params.newDate && isPastOsloDate(params.newDate)) {
      return `[PAST_DATE]:${params.newDate}`;
    }
    if (!params.newDate && !params.startTime && !params.endTime && !params.newTitle) {
      return "[UPDATE_MISSING_CHANGE]";
    }

    const timeMin = params.date ? getOsloDayBounds(params.date).timeMin : undefined;
    const timeMax = params.date ? getOsloDayBounds(params.date).timeMax : undefined;
    const events = await getUpcomingEvents(accessToken, params.date ? 100 : 200, timeMin, timeMax);
    const matches = findUpdateMatches(events, params);

    if (matches.length === 0) {
      return "[UPDATE_NO_MATCH]";
    }

    if (matches.length > 1) {
      const choices = matches.slice(0, 5).map((event, index) => {
        const date = getOsloDateFromIso(event.startIso);
        const start = getOsloTimeFromIso(event.startIso);
        const end = getOsloTimeFromIso(event.endIso);
        const dateLabel = date ? formatOsloDateLabel(date, 'no') : event.date;
        return `${index + 1}. ${event.title} - ${dateLabel} ${start || ''}${end ? `\u2013${end}` : ''}`;
      }).join('\n');

      return `[UPDATE_MULTIPLE]
Jeg fant flere avtaler som kan passe. Hvilken vil du endre?
${choices}`;
    }

    const pendingUpdate = buildPendingUpdate(matches[0], params);
    if (!pendingUpdate) {
      return "[UPDATE_NO_MATCH]";
    }

    const cookieStore = await cookies();
    cookieStore.set('pending_update', JSON.stringify(pendingUpdate), { maxAge: 600, path: '/' });

    return `[PENDING_UPDATE]
Jeg fant denne avtalen:
${formatUpdateDetails(pendingUpdate)}`;
  }

  if (params.action === 'create_calendar_event') {
    const { title, date, startTime, endTime: providedEndTime, durationMinutes = 60 } = params;
    
    // Safety Clarification Check: If date or time is missing, do NOT pick defaults.
    if (!date && !startTime) {
      return baseContext + "[SYSTEM INSTRUCTION]: Both date AND time are missing for the creation request. Ask the user for both.";
    }
    if (!date) {
      return baseContext + `[SYSTEM INSTRUCTION]: The date is missing for the creation request (time was ${startTime}). Ask the user which day they want to schedule it.`;
    }
    if (!startTime) {
      return baseContext + `[SYSTEM INSTRUCTION]: The time is missing for the creation request (date was ${date}). Ask the user what time they want to schedule it.`;
    }
    if (isPastOsloDate(date)) {
      return `[PAST_DATE]:${date}`;
    }

    let endTime = providedEndTime;
    if (!endTime) {
      const [h, m] = startTime.split(':').map(Number);
      const startObj = new Date(0); startObj.setHours(h, m, 0);
      const endObj = new Date(startObj.getTime() + durationMinutes * 60000);
      endTime = `${String(endObj.getHours()).padStart(2, '0')}:${String(endObj.getMinutes()).padStart(2, '0')}`;
    }

    // Store in Session Memory (Cookie)
    const pendingEvent = { title: title || 'Møte', date, startTime, endTime };
    const cookieStore = await cookies();
    cookieStore.set('pending_event', JSON.stringify(pendingEvent), { maxAge: 600, path: '/' });

    // Format for NL presentation
    return `[PENDING_CREATE]: The user wants to create an event. 
Title: ${pendingEvent.title}
Date: ${pendingEvent.date}
Start: ${pendingEvent.startTime}
End: ${pendingEvent.endTime}
The tool has stored this. Present the confirmation summary to the user exactly as instructed.`;
  }

  if (params.action === 'confirm_create') {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('pending_event');
    if (!cookie) {
      return baseContext + "I'm sorry, I couldn't find the meeting details to confirm. Could you please specify the meeting again?";
    }

    const event = JSON.parse(cookie.value);
    const bounds = getOsloDayBounds(event.date);
    
    // Build ISO strings using the offset derived from getOsloDayBounds
    const offset = bounds.timeMin.slice(-6); // e.g. +02:00
    const startIso = `${event.date}T${event.startTime}:00${offset}`;
    const endIso = `${event.date}T${event.endTime}:00${offset}`;

    await createCalendarEvent(accessToken, {
      summary: event.title,
      startIso,
      endIso
    });

    try {
      cookieStore.delete('pending_event');
    } catch (cleanupError) {
      console.error("Created calendar event, but failed to clear pending_event cookie:", cleanupError);
    }

    return `[SUCCESS]: The event has been successfully created in Google Calendar.
Title: ${event.title}
Date: ${event.date}
Start: ${event.startTime}
End: ${event.endTime}`;
  }

  if (params.action === 'cancel_create') {
    const cookieStore = await cookies();
    cookieStore.delete('pending_event');
    return baseContext + "[CANCELLED]: The user chose NOT to create the event. Confirm that you won't create it.";
  }

  if (params.action === 'confirm_update') {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('pending_update');
    if (!cookie) {
      return "[UPDATE_NO_MATCH]";
    }

    const update = JSON.parse(cookie.value) as PendingUpdate;
    const startIso = buildTimedOsloIso(update.newDate, update.newStartTime);
    const endIso = buildTimedOsloIso(update.newDate, update.newEndTime);

    try {
      await updateCalendarEvent(accessToken, update.eventId, {
        summary: update.newTitle,
        startIso,
        endIso,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'GOOGLE_EVENT_NOT_EDITABLE') {
        return "[UPDATE_NOT_EDITABLE]";
      }
      throw error;
    }

    try {
      cookieStore.delete('pending_update');
    } catch (cleanupError) {
      console.error("Updated calendar event, but failed to clear pending_update cookie:", cleanupError);
    }

    const finalTitle = update.newTitle || update.title;
    return `[UPDATE_SUCCESS]
Avtalen er oppdatert i Google Kalender:
M\u00f8te: ${finalTitle}
Dato: ${formatOsloDateLabel(update.newDate, 'no')}
Tid: ${update.newStartTime}\u2013${update.newEndTime}`;
  }

  if (params.action === 'cancel_update') {
    const cookieStore = await cookies();
    cookieStore.delete('pending_update');
    return "[UPDATE_CANCELLED]\nOk, jeg endrer ikke avtalen.";
  }

  if (params.action === 'confirm_delete') {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('pending_delete');
    if (!cookie) {
      return "[DELETE_NO_MATCH]";
    }

    const event = JSON.parse(cookie.value) as PendingDelete;

    try {
      await deleteCalendarEvent(accessToken, event.eventId);
    } catch (error) {
      if (error instanceof Error && error.message === 'GOOGLE_EVENT_NOT_DELETABLE') {
        return "[DELETE_NOT_ALLOWED]";
      }
      throw error;
    }

    try {
      cookieStore.delete('pending_delete');
    } catch (cleanupError) {
      console.error("Deleted calendar event, but failed to clear pending_delete cookie:", cleanupError);
    }

    return `[DELETE_SUCCESS]
Avtalen er slettet fra Google Kalender:
${formatDeleteDetails(event)}`;
  }

  if (params.action === 'cancel_delete') {
    const cookieStore = await cookies();
    cookieStore.delete('pending_delete');
    return "[DELETE_CANCELLED]\nOk, jeg sletter ikke avtalen.";
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

  // Past Date Verification & Resolution
  if (params.date) {
    const targetDate = params.date;
    console.log(`[DEBUG] Conversational explicit date requested: ${targetDate}`);
    const osloToday = getOsloTodayDate();
    if (isPastOsloDate(targetDate)) {
      console.log(`[DEBUG] BLOCKED: Requested date ${targetDate} is in the past relative to Oslo current date (${osloToday})`);
      return baseContext + `[SYSTEM FLAG]: The user's explicitly requested date (${targetDate}) is ALREADY IN THE PAST. DO NOT suggest free or booked time. Simply inform the user naturally that this date has passed.`;
    }

    const bounds = getOsloDayBounds(targetDate);
    timeMin = bounds.timeMin;
    timeMax = bounds.timeMax;
    fetchLimit = 200;
    console.log(`[DEBUG] Exact date bounds for ${targetDate}: calculated start ${timeMin}, calculated end ${timeMax}`);
  }

  let events = await getUpcomingEvents(accessToken, fetchLimit, timeMin, timeMax);
  console.log(`[DEBUG] Fetched ${events.length} explicit events from Google API.`);

  if (params.date) {
    // Filter purely by exact date match in Iso format
    events = events.filter(e => e.startIso?.startsWith(params.date!) || e.endIso?.startsWith(params.date!));
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

    if (isUnsupportedDestructiveRequest(userMessageContent)) {
      return getUnsupportedDestructiveReply(lang);
    }

    // 1. Guard against missing/expired local session state immediately
    if (!session?.accessToken || session.error === "RefreshTokenError") {
      console.log(`CHAT BLOCKED: Session error or missing token. Error: ${session?.error}`);
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

    const deterministicReply = getDeterministicCreateReply(toolContext, lang);
    if (deterministicReply) {
      return deterministicReply;
    }

    const deterministicUpdateReply = getDeterministicUpdateReply(toolContext);
    if (deterministicUpdateReply) {
      return deterministicUpdateReply;
    }

    const deterministicDeleteReply = getDeterministicDeleteReply(toolContext);
    if (deterministicDeleteReply) {
      return deterministicDeleteReply;
    }

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
