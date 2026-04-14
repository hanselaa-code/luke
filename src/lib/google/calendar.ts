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

/**
 * Fetch generic upcoming events for the calendar page.
 */
export async function getUpcomingEvents(accessToken: string, maxResults = 10): Promise<FormattedEvent[]> {
  const calendar = getCalendarClient(accessToken);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    return events.map(formatEvent);
  } catch (error: any) {
    console.error('[DEBUG - ERROR] Google Calendar API error (getUpcomingEvents):', error.message || error);
    // Explicitly rethrow so the consuming component can handle errors gracefully
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

    const events = response.data.items || [];
    return events.map(formatEvent);
  } catch (error) {
    console.error('Error fetching tomorrow\'s events:', error);
    throw new Error('Failed to fetch tomorrow\'s events from Google.');
  }
}
