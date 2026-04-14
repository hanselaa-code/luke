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
}

/**
 * Format a raw Google Calendar event into a UI-friendly structure
 */
function formatEvent(event: any): FormattedEvent {
  const isAllDay = !!event.start?.date;
  const startTime = isAllDay ? new Date(event.start.date) : new Date(event.start.dateTime);
  const endTime = event.end?.dateTime ? new Date(event.end.dateTime) : null;

  // Format time string
  let timeStr = 'All Day';
  if (!isAllDay && endTime) {
    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    timeStr = `${startTime.toLocaleTimeString([], timeOptions)} - ${endTime.toLocaleTimeString([], timeOptions)}`;
  } else if (!isAllDay) {
      const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
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
  const evtDateStr = startTime.toLocaleDateString();
  const todayStr = new Date().toLocaleDateString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString();

  let dateDisplay = evtDateStr;
  if (evtDateStr === todayStr) dateDisplay = 'Today';
  else if (evtDateStr === tomorrowStr) dateDisplay = 'Tomorrow';
  else {
    dateDisplay = startTime.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  return {
    id: event.id || Math.random().toString(),
    title: event.summary || 'Busy',
    time: timeStr,
    date: dateDisplay,
    location: event.location,
    type,
  };
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
