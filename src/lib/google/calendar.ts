import { google } from 'googleapis';
import { startOfTomorrow, endOfTomorrow } from 'date-fns';

/**
 * Validates the access token and returns an authenticated Google Calendar client.
 */
function getCalendarClient(accessToken: string) {
  if (!accessToken) {
    throw new Error('Access token is required to initialize Google Calendar client.');
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  // Use v3 API for calendar
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface FormattedEvent {
  id: string;
  title: string;
  time: string;
  date: string;
  location?: string;
  type: string;
  startIso?: string;
  endIso?: string;
}

/**
 * Format a raw Google Calendar event into a UI-friendly structure
 */
function formatEvent(event: any): FormattedEvent {
  const isAllDay = !!event.start?.date;
  const startTime = isAllDay ? new Date(event.start.date) : new Date(event.start.dateTime);
  const endTime = event.end?.dateTime ? new Date(event.end.dateTime) : (event.end?.date ? new Date(event.end.date) : null);

  // Format time string
  let timeStr = 'All Day';
  if (!isAllDay && endTime) {
    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' };
    timeStr = `${startTime.toLocaleTimeString([], timeOptions)} - ${endTime.toLocaleTimeString([], timeOptions)}`;
  } else if (!isAllDay) {
      const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' };
      timeStr = startTime.toLocaleTimeString([], timeOptions);
  }

  // Very basic semantic typing based on title keywords for UI aesthetics
  let type = 'Event';
  const titleLower = (event.summary || '').toLowerCase();
  if (titleLower.includes('meeting') || titleLower.includes('sync') || titleLower.includes('1:1')) {
    type = 'Meeting';
  } else if (titleLower.includes('focus') || titleLower.includes('deep work')) {
    type = 'Deep Work';
  } else if (titleLower.includes('call') || titleLower.includes('chat')) {
    type = 'Call';
  }

  // Format date relative to now
  const dateOptions: Intl.DateTimeFormatOptions = { timeZone: 'Europe/Oslo' };
  const evtDateStr = startTime.toLocaleDateString([], dateOptions);
  const todayStr = new Date().toLocaleDateString([], dateOptions);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString([], dateOptions);

  let dateDisplay = evtDateStr;
  if (evtDateStr === todayStr) dateDisplay = 'Today';
  else if (evtDateStr === tomorrowStr) dateDisplay = 'Tomorrow';
  else {
    dateDisplay = startTime.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Europe/Oslo' });
  }

  return {
    id: event.id || Math.random().toString(),
    title: event.summary || 'Busy',
    time: timeStr,
    date: dateDisplay,
    location: event.location,
    type,
    startIso: startTime.toISOString(),
    endIso: endTime ? endTime.toISOString() : undefined,
  };
}

/**
 * Availability Engine Context Generator
 * Bounds: Default 08:00 to 18:00
 */
export function getFreeSlots(events: FormattedEvent[], durationMinutes: number = 30, boundsStartIso?: string, boundsEndIso?: string, partOfDay?: 'morning' | 'afternoon' | 'evening'): string[] {
  const suggestions: string[] = [];
  
  // Hard defaults to next 7 days if boundaries aren't passed explicitly, for suggestion loop safety.
  const startObj = boundsStartIso ? new Date(boundsStartIso) : new Date();
  const endObj = boundsEndIso ? new Date(boundsEndIso) : new Date(Date.now() + 7 * 86400000);
  
  let currentCursor = startObj.getTime();
  
  // We process by shifting the cursor day-by-day.
  // We'll iterate up to 14 days max for safety to prevent infinite loops.
  
  // Filter events down to standard timed events that actually block schedule
  const blockingEvents = events
    .filter(e => e.startIso && e.endIso && e.time !== 'All Day' && !e.title.toLowerCase().includes('flight'))
    .map(e => ({ start: new Date(e.startIso!).getTime(), end: new Date(e.endIso!).getTime() }))
    .sort((a, b) => a.start - b.start);

  const durationMs = durationMinutes * 60 * 1000;
  let dayOffset = 0;
  
  while (currentCursor < endObj.getTime() && dayOffset < 14) {
    const cursorDate = new Date(currentCursor);
    const osloOptions = { timeZone: 'Europe/Oslo' };
    
    // Convert current cursor day to Oslo bounds using native string parsing
    const yStr = new Intl.DateTimeFormat('en-US', { ...osloOptions, year: 'numeric' }).format(cursorDate);
    const mStr = new Intl.DateTimeFormat('en-US', { ...osloOptions, month: 'numeric' }).format(cursorDate);
    const dStr = new Intl.DateTimeFormat('en-US', { ...osloOptions, day: 'numeric' }).format(cursorDate);
    const y = parseInt(yStr); const m = parseInt(mStr); const d = parseInt(dStr);
    
    // Determine the user's local Workday Bounds (default 08:00 - 18:00) by converting it to UTC
    const getDummyDate = (h: number, min: number) => new Date(Date.UTC(y, m - 1, d, h, min, 0));
    const offsetStr = new Intl.DateTimeFormat('en-US', { ...osloOptions, timeZoneName: 'longOffset' }).format(getDummyDate(12, 0));
    // extract UTC offset from 'GMT+02:00'
    let hoursOffset = 1; // fallback
    const match = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (match) {
      hoursOffset = parseInt(match[2]);
      if (match[1] === '-') hoursOffset = -hoursOffset;
    }
    
    // Shift dummy UTC inputs to exact local ms using the inversion of the timezone offset
    const msOffset = hoursOffset * 3600000;
    
    let startHour = 8;
    let endHour = 18;
    
    if (partOfDay === 'morning') { startHour = 8; endHour = 12; }
    else if (partOfDay === 'afternoon') { startHour = 12; endHour = 17; }
    else if (partOfDay === 'evening') { startHour = 17; endHour = 21; }

    const workdayStartMs = new Date(Date.UTC(y, m - 1, d, startHour, 0, 0)).getTime() - msOffset;
    const workdayEndMs = new Date(Date.UTC(y, m - 1, d, endHour, 0, 0)).getTime() - msOffset;
    
    let pointerMs = Math.max(workdayStartMs, startObj.getTime());
    const stopMs = Math.min(workdayEndMs, endObj.getTime());

    // Iterate through blocks within this day
    while (pointerMs + durationMs <= stopMs) {
      // Find following blocking event
      const conflict = blockingEvents.find(e => e.start < pointerMs + durationMs && e.end > pointerMs);
      
      if (conflict) {
        pointerMs = conflict.end; // jump to end of conflict
      } else {
        // Free slot found!
        const slotStart = new Date(pointerMs);
        const slotEnd = new Date(pointerMs + durationMs);
        
        // Format nicely into string
        const fOptions: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo', hour12: false };
        const fEndOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo', hour12: false };
        const slotString = `${new Intl.DateTimeFormat('en-GB', fOptions).format(slotStart)} - ${new Intl.DateTimeFormat('en-GB', fEndOptions).format(slotEnd)} (Oslo Time)`;
        
        suggestions.push(slotString);
        pointerMs += durationMs; // jump forward by the duration to find next block
      }
    }
    
    // Advance to next day at midnight
    currentCursor = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)).getTime() - msOffset;
    dayOffset++;
  }

  return suggestions;
}

export function getOsloDate() {
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date());
  const [y, m, d] = format.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function getOsloOffsetString(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' }).format(d);
  const match = offsetStr.match(/GMT([+-]\d{2}:\d{2})/);
  if (match) return match[1];
  return '+01:00';
}

function buildOsloISO(year: number, month: number, day: number, hour: string, minute: string, second: string) {
   const y = String(year).padStart(4, '0');
   const m = String(month).padStart(2, '0');
   const d = String(day).padStart(2, '0');
   const offset = getOsloOffsetString(year, month, day);
   return `${y}-${m}-${d}T${hour}:${minute}:${second}${offset}`;
}

export function getOsloBounds(range: 'this_week' | 'next_week' | 'this_month') {
  const { year, month, day } = getOsloDate();
  const getDummyDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dummyNow = getDummyDate(year, month, day);

  let startDummy = dummyNow;
  let endDummy = dummyNow;

  if (range === 'this_week') {
    const dow = dummyNow.getUTCDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    startDummy = new Date(dummyNow.getTime() + diffToMonday * 86400000);
    endDummy = new Date(startDummy.getTime() + 6 * 86400000);
  } else if (range === 'next_week') {
    const dow = dummyNow.getUTCDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    startDummy = new Date(dummyNow.getTime() + (diffToMonday + 7) * 86400000);
    endDummy = new Date(startDummy.getTime() + 6 * 86400000);
  } else if (range === 'this_month') {
    startDummy = getDummyDate(year, month, 1);
    endDummy = getDummyDate(year, month + 1, 0); 
  }

  return { 
    timeMin: buildOsloISO(startDummy.getUTCFullYear(), startDummy.getUTCMonth() + 1, startDummy.getUTCDate(), '00', '00', '00'),
    timeMax: buildOsloISO(endDummy.getUTCFullYear(), endDummy.getUTCMonth() + 1, endDummy.getUTCDate(), '23', '59', '59')
  };
}

/**
 * Fetch generic upcoming events for the calendar page.
 */
export async function getUpcomingEvents(accessToken: string, maxResults = 10, timeMin?: string, timeMax?: string): Promise<FormattedEvent[]> {
  const calendar = getCalendarClient(accessToken);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      ...(timeMax ? { timeMax } : {}),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    let events = response.data.items || [];
    
    // Filter out birthday-style events to avoid cluttering the primary schedule view.
    events = events.filter((event: any) => {
      const isBirthdayType = event.eventType?.toLowerCase() === 'birthday';
      const summaryHasBirthday = (event.summary || '').toLowerCase().includes('birthday');
      return !(isBirthdayType || summaryHasBirthday);
    });

    return events.map(formatEvent);
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || String(error).toLowerCase();
    console.error('[DEBUG - ERROR] Google Calendar API error (getUpcomingEvents):', error.message || error);
    
    if (errorMsg.includes('401') || errorMsg.includes('credential') || errorMsg.includes('unauthorized') || errorMsg.includes('auth')) {
      throw new Error('GOOGLE_AUTH_EXPIRED');
    }

    throw new Error(`Google API Error: ${error.message || 'Failed to fetch calendar events'}`);
  }
}

/**
 * Fetch events strictly bounded by tomorrow's start and end times.
 */
export async function getTomorrowsEvents(accessToken: string): Promise<FormattedEvent[]> {
  const calendar = getCalendarClient(accessToken);

  try {
    const start = startOfTomorrow();
    const end = endOfTomorrow();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    let events = response.data.items || [];
    
    // Filter out birthday-style events to avoid cluttering the primary schedule view.
    events = events.filter((event: any) => {
      const isBirthdayType = event.eventType?.toLowerCase() === 'birthday';
      const summaryHasBirthday = (event.summary || '').toLowerCase().includes('birthday');
      return !(isBirthdayType || summaryHasBirthday);
    });

    return events.map(formatEvent);
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || String(error).toLowerCase();
    console.error('Error fetching tomorrow\'s events:', error);

    if (errorMsg.includes('401') || errorMsg.includes('credential') || errorMsg.includes('unauthorized') || errorMsg.includes('auth')) {
      throw new Error('GOOGLE_AUTH_EXPIRED');
    }

    throw new Error('Failed to fetch tomorrow\'s events from Google.');
  }
}

/**
 * Creates a new event in the primary Google Calendar.
 */
export async function createCalendarEvent(
  accessToken: string,
  event: { summary: string; startIso: string; endIso: string }
) {
  const calendar = getCalendarClient(accessToken);

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.summary,
        start: {
          dateTime: event.startIso,
          timeZone: 'Europe/Oslo',
        },
        end: {
          dateTime: event.endIso,
          timeZone: 'Europe/Oslo',
        },
      },
    });

    return response.data;
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || String(error).toLowerCase();
    console.error('Error creating calendar event:', error);

    if (errorMsg.includes('401') || errorMsg.includes('credential') || errorMsg.includes('unauthorized') || errorMsg.includes('auth')) {
      throw new Error('GOOGLE_AUTH_EXPIRED');
    }

    throw new Error(`Google API Error: ${error.message || 'Failed to create calendar event'}`);
  }
}
