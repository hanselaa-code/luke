'use server';

import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { getTomorrowsEvents, getUpcomingEvents, getOsloBounds, getFreeSlots, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, FormattedEvent } from '@/lib/google/calendar';
import { getEmailSummaries, getUnreadEmails } from '@/lib/google/gmail';
import { LukeToolRequest, generateToolRequest, generateFinalResponse, detectResponseLanguage } from '@/lib/ai/openai';

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
    ? "Beklager, jeg kan ikke slette eller tømme kalenderen ennå. Jeg kan derimot hjelpe deg med å se avtaler, finne ledig tid og opprette nye avtaler."
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
    ? `Jeg kan opprette følgende avtale:\nMøte: ${title}\nDato: ${dateLabel}\nTid: ${start}–${end}\nVil du at jeg skal legge dette inn i kalenderen?`
    : `I can create this event:\nEvent: ${title}\nDate: ${dateLabel}\nTime: ${start}–${end}\nDo you want me to add it to your calendar?`;
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
    ? `Avtalen er opprettet i Google Kalender:\nMøte: ${title}\nDato: ${dateLabel}\nTid: ${start}–${end}`
    : `The event has been created in Google Calendar:\nEvent: ${title}\nDate: ${dateLabel}\nTime: ${start}–${end}`;
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

function findUpdateMatches(events: FormattedEvent[], params: LukeToolRequest, lastEventId?: string): FormattedEvent[] {
  if (lastEventId) {
    const directMatch = events.find(e => e.id === lastEventId);
    if (directMatch && titleMatches(directMatch.title, params.title)) {
       const eventDate = getOsloDateFromIso(directMatch.startIso);
       if (!params.date || eventDate === params.date) {
         return [directMatch];
       }
    }
  }

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

function hasDeleteLookupDetail(params: LukeToolRequest): boolean {
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
  return `Møte: ${event.title}\nDato: ${formatOsloDateLabel(event.date, 'no')}\nTid: ${event.startTime}–${event.endTime}`;
}

function buildPendingUpdate(event: FormattedEvent, params: LukeToolRequest): PendingUpdate | null {
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
  return `Møte: ${update.title}\nDato: ${formatOsloDateLabel(update.date, 'no')}\nTid: ${update.startTime}–${update.endTime}\n\nVil du at jeg skal endre den til:\nMøte: ${newTitle}\nDato: ${formatOsloDateLabel(update.newDate, 'no')}\nTid: ${update.newStartTime}–${update.newEndTime}?`;
}

function getDeterministicUpdateReply(toolContext: string): string | null {
  if (toolContext.startsWith('[UPDATE_NO_MATCH]')) return "Beklager, jeg fant ingen avtale som passer med det du ba om. Kan du skrive navnet, datoen eller tidspunktet litt mer presist?";
  if (toolContext.startsWith('[UPDATE_MISSING_CHANGE]')) return "Hva vil du endre avtalen til? Du kan for eksempel oppgi ny dato, nytt tidspunkt eller ny tittel.";
  if (toolContext.startsWith('[UPDATE_MULTIPLE]')) return toolContext.replace('[UPDATE_MULTIPLE]\n', '');
  if (toolContext.startsWith('[PENDING_UPDATE]')) return toolContext.replace('[PENDING_UPDATE]\n', '');
  if (toolContext.startsWith('[UPDATE_NOT_EDITABLE]')) return "Beklager, jeg fant avtalen, men Google Kalender tillater ikke at jeg endrer den. Den kan være fra en synkronisert eller skrivebeskyttet kalender.";
  if (toolContext.startsWith('[UPDATE_SUCCESS]')) return toolContext.replace('[UPDATE_SUCCESS]\n', '');
  if (toolContext.startsWith('[UPDATE_CANCELLED]')) return toolContext.replace('[UPDATE_CANCELLED]\n', '');
  return null;
}

function getDeterministicDeleteReply(toolContext: string): string | null {
  if (toolContext.startsWith('[DELETE_NO_MATCH]')) return "Beklager, jeg fant ingen avtale som passer med det du ba om. Kan du skrive navnet, datoen eller tidspunktet litt mer presist?";
  if (toolContext.startsWith('[DELETE_MISSING_TARGET]')) return "Hvilken avtale vil du slette? Oppgi gjerne navn, dato eller tidspunkt.";
  if (toolContext.startsWith('[DELETE_MULTIPLE]')) return toolContext.replace('[DELETE_MULTIPLE]\n', '');
  if (toolContext.startsWith('[PENDING_DELETE]')) return toolContext.replace('[PENDING_DELETE]\n', '');
  if (toolContext.startsWith('[DELETE_NOT_ALLOWED]')) return "Beklager, jeg fant avtalen, men Google Kalender tillater ikke at jeg sletter den. Den kan være fra en synkronisert eller skrivebeskyttet kalender.";
  if (toolContext.startsWith('[DELETE_SUCCESS]')) return toolContext.replace('[DELETE_SUCCESS]\n', '');
  if (toolContext.startsWith('[DELETE_CANCELLED]')) return toolContext.replace('[DELETE_CANCELLED]\n', '');
  return null;
}

function detectCollisions(events: FormattedEvent[]): string[] {
  const collisions: string[] = [];
  const timed = events.filter(e => e.startIso && e.endIso && e.time !== 'All Day');
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const e1 = timed[i]; const e2 = timed[j];
      const s1 = new Date(e1.startIso!).getTime(); const s2 = new Date(e2.startIso!).getTime();
      const e1E = new Date(e1.endIso!).getTime(); const e2E = new Date(e2.endIso!).getTime();
      if (s1 < e2E && s2 < e1E) {
        const cStart = getOsloTimeFromIso(new Date(Math.max(s1, s2)).toISOString());
        const cEnd = getOsloTimeFromIso(new Date(Math.min(e1E, e2E)).toISOString());
        collisions.push(`Collision detected: "${e1.title}" and "${e2.title}" overlap from ${cStart} to ${cEnd}.`);
      }
    }
  }
  return collisions;
}

async function getCalendarContext(accessToken: string, params: LukeToolRequest): Promise<string> {
  const currentWeekDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  let baseContext = `System Context: The current time is ${timeStr}. Today is ${currentWeekDay}. `;

  if (params.summaryStyle) baseContext += `The user explicitly requested a ${params.summaryStyle.replace('_', ' ')} style summary. `;
  if (!params.requiresCalendar) return baseContext + "The user's question is outside the supported calendar scope.";

  const cookieStore = await cookies();
  const lastEventId = cookieStore.get('last_discussed_event_id')?.value;

  if (params.action === 'delete_calendar_event') {
    if (!hasDeleteLookupDetail(params)) return "[DELETE_MISSING_TARGET]";
    const timeMin = params.date ? getOsloDayBounds(params.date).timeMin : undefined;
    const timeMax = params.date ? getOsloDayBounds(params.date).timeMax : undefined;
    const events = await getUpcomingEvents(accessToken, params.date ? 100 : 200, timeMin, timeMax);
    const matches = findUpdateMatches(events, params, lastEventId);
    if (matches.length === 0) return "[DELETE_NO_MATCH]";
    if (matches.length > 1) {
      const choices = matches.slice(0, 5).map((e, index) => `${index + 1}. ${e.title} - ${e.date} ${e.time}`).join('\n');
      return `[DELETE_MULTIPLE]\nJeg fant flere avtaler. Hvilken vil du slette?\n${choices}`;
    }
    const pendingDelete = buildPendingDelete(matches[0]);
    if (!pendingDelete) return "[DELETE_NO_MATCH]";
    cookieStore.set('pending_delete', JSON.stringify(pendingDelete), { maxAge: 600, path: '/' });
    return `[PENDING_DELETE]\nJeg fant denne avtalen:\n${formatDeleteDetails(pendingDelete)}\n\nVil du at jeg skal slette denne?`;
  }

  if (params.action === 'update_calendar_event') {
    if (params.newDate && isPastOsloDate(params.newDate)) return `[PAST_DATE]:${params.newDate}`;
    if (!params.newDate && !params.startTime && !params.endTime && !params.newTitle) return "[UPDATE_MISSING_CHANGE]";
    const timeMin = params.date ? getOsloDayBounds(params.date).timeMin : undefined;
    const timeMax = params.date ? getOsloDayBounds(params.date).timeMax : undefined;
    const events = await getUpcomingEvents(accessToken, params.date ? 100 : 200, timeMin, timeMax);
    const matches = findUpdateMatches(events, params, lastEventId);
    if (matches.length === 0) return "[UPDATE_NO_MATCH]";
    if (matches.length > 1) {
      const choices = matches.slice(0, 5).map((e, index) => `${index + 1}. ${e.title} - ${e.date} ${e.time}`).join('\n');
      return `[UPDATE_MULTIPLE]\nJeg fant flere avtaler. Hvilken vil du endre?\n${choices}`;
    }
    const pendingUpdate = buildPendingUpdate(matches[0], params);
    if (!pendingUpdate) return "[UPDATE_NO_MATCH]";
    cookieStore.set('pending_update', JSON.stringify(pendingUpdate), { maxAge: 600, path: '/' });
    return `[PENDING_UPDATE]\nJeg fant denne avtalen:\n${formatUpdateDetails(pendingUpdate)}`;
  }

  if (params.action === 'create_calendar_event') {
    const { title, date, startTime, endTime: pEnd, durationMinutes = 60 } = params;
    if (!date && !startTime) return baseContext + "[SYSTEM INSTRUCTION]: Date and time missing. Ask for both.";
    if (!date) return baseContext + `[SYSTEM INSTRUCTION]: Date missing (time was ${startTime}). Ask for day.`;
    if (!startTime) return baseContext + `[SYSTEM INSTRUCTION]: Time missing (date was ${date}). Ask for time.`;
    if (isPastOsloDate(date)) return `[PAST_DATE]:${date}`;
    let endTime = pEnd;
    if (!endTime) {
      const [h, m] = startTime.split(':').map(Number);
      const sObj = new Date(0); sObj.setHours(h, m, 0);
      const eObj = new Date(sObj.getTime() + durationMinutes * 60000);
      endTime = `${String(eObj.getHours()).padStart(2, '0')}:${String(eObj.getMinutes()).padStart(2, '0')}`;
    }
    const pendingEvent = { title: title || 'Møte', date, startTime, endTime };
    cookieStore.set('pending_event', JSON.stringify(pendingEvent), { maxAge: 600, path: '/' });
    return `[PENDING_CREATE]: Title: ${pendingEvent.title}\nDate: ${pendingEvent.date}\nStart: ${pendingEvent.startTime}\nEnd: ${pendingEvent.endTime}`;
  }

  if (params.action === 'confirm_create') {
    const cookie = cookieStore.get('pending_event');
    if (!cookie) return baseContext + "Couldn't find meeting details to confirm.";
    const e = JSON.parse(cookie.value);
    const bounds = getOsloDayBounds(e.date);
    const offset = bounds.timeMin.slice(-6);
    const sIso = `${e.date}T${e.startTime}:00${offset}`;
    const eIso = `${e.date}T${e.endTime}:00${offset}`;
    await createCalendarEvent(accessToken, { summary: e.title, startIso: sIso, endIso: eIso });
    cookieStore.delete('pending_event');
    return `[SUCCESS]: Created: ${e.title} on ${e.date} from ${e.startTime} to ${e.endTime}`;
  }

  if (params.action === 'cancel_create') { cookieStore.delete('pending_event'); return "[CANCELLED]"; }

  if (params.action === 'confirm_update') {
    const cookie = cookieStore.get('pending_update');
    if (!cookie) return "[UPDATE_NO_MATCH]";
    const u = JSON.parse(cookie.value) as PendingUpdate;
    const sIso = buildTimedOsloIso(u.newDate, u.newStartTime);
    const eIso = buildTimedOsloIso(u.newDate, u.newEndTime);
    try {
      await updateCalendarEvent(accessToken, u.eventId, { summary: u.newTitle, startIso: sIso, endIso: eIso });
      cookieStore.delete('pending_update');
      return `[UPDATE_SUCCESS]\nOppdatert: ${u.newTitle || u.title} på ${u.newDate} kl ${u.newStartTime}–${u.newEndTime}`;
    } catch (e) { if (e instanceof Error && e.message === 'GOOGLE_EVENT_NOT_EDITABLE') return "[UPDATE_NOT_EDITABLE]"; throw e; }
  }

  if (params.action === 'cancel_update') { cookieStore.delete('pending_update'); return "[UPDATE_CANCELLED]"; }

  if (params.action === 'confirm_delete') {
    const cookie = cookieStore.get('pending_delete');
    if (!cookie) return "[DELETE_NO_MATCH]";
    const e = JSON.parse(cookie.value) as PendingDelete;
    try {
      await deleteCalendarEvent(accessToken, e.eventId);
      cookieStore.delete('pending_delete');
      return `[DELETE_SUCCESS]\nSlettet: ${e.title} på ${e.date} kl ${e.startTime}`;
    } catch (e) { if (e instanceof Error && e.message === 'GOOGLE_EVENT_NOT_DELETABLE') return "[DELETE_NOT_ALLOWED]"; throw e; }
  }

  if (params.action === 'cancel_delete') { cookieStore.delete('pending_delete'); return "[DELETE_CANCELLED]"; }

  let fetchLimit = (params.range === 'upcoming' || params.keyword) ? 50 : 20;
  let timeMin: string | undefined; let timeMax: string | undefined;

  if (params.range === 'this_week' || params.range === 'next_week' || params.range === 'this_month') {
    const bounds = getOsloBounds(params.range); timeMin = bounds.timeMin; timeMax = bounds.timeMax; fetchLimit = 200;
  }
  if (params.date) {
    if (isPastOsloDate(params.date)) return baseContext + `[SYSTEM FLAG]: Requested date ${params.date} is in the past.`;
    const bounds = getOsloDayBounds(params.date); timeMin = bounds.timeMin; timeMax = bounds.timeMax; fetchLimit = 200;
  }

  let events = await getUpcomingEvents(accessToken, fetchLimit, timeMin, timeMax);
  if (params.date) events = events.filter(e => e.startIso?.split('T')[0] === params.date);
  if (params.range === 'today') events = events.filter(e => e.date === 'Today');
  else if (params.range === 'tomorrow') events = await getTomorrowsEvents(accessToken);
  else if (params.weekday) events = events.filter(e => e.date.toLowerCase().includes(params.weekday!.toLowerCase()));

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    events = events.filter(e => e.title.toLowerCase().includes(kw));
  }

  if (params.partOfDay) {
    if (params.partOfDay === 'morning') events = events.filter(e => e.time === 'All Day' || getStartHour(e.time) < 12);
    else if (params.partOfDay === 'afternoon') events = events.filter(e => e.time !== 'All Day' && getStartHour(e.time) >= 12 && getStartHour(e.time) < 17);
    else if (params.partOfDay === 'evening') events = events.filter(e => e.time !== 'All Day' && getStartHour(e.time) >= 17);
  }

  if (params.first && events.length > 0) events = [events[0]];
  else if (params.last && events.length > 0) events = [events[events.length - 1]];
  else if (params.limit) events = events.slice(0, params.limit);

  if (events.length === 0) {
    if (params.needsSuggestion) {
      const free = getFreeSlots([], params.durationMinutes || 30, timeMin, timeMax, params.partOfDay);
      return baseContext + "No matching events. Here are free chunks:\n" + free.slice(0, 5).map(s => `- ${s}`).join('\n');
    }
    return baseContext + "Found 0 matching events.";
  }

  const list = events.map(e => `- ${e.date} kl ${e.time}: ${e.title} (ID: ${e.id})`).join('\n');
  const collisions = detectCollisions(events);
  let final = baseContext + `\n\nFetched Calendar Data:\n${list}`;
  if (collisions.length > 0) final += `\n\nCONFLICT WARNINGS:\n${collisions.join('\n')}`;

  if (events.length === 1) cookieStore.set('last_discussed_event_id', events[0].id, { maxAge: 600, path: '/' });
  else cookieStore.delete('last_discussed_event_id');

  if (params.needsSuggestion) {
    const free = getFreeSlots(events, params.durationMinutes || 30, timeMin, timeMax, params.partOfDay);
    final += `\n\nFree slots for suggestion:\n` + (free.length > 0 ? free.slice(0, 5).join('\n') : "NONE DETECTED.");
  }
  return final;
}

async function getGmailContext(accessToken: string, params: LukeToolRequest): Promise<string> {
  const { gmailAction, emailFilter, unreadOnly, limit = 5 } = params;
  
  try {
    let emails = [];
    if (unreadOnly || gmailAction === 'summarize') {
      emails = await getUnreadEmails(accessToken, limit);
    } else {
      // General list or search
      emails = await getEmailSummaries(accessToken, emailFilter || '', limit);
    }

    if (emails.length === 0) {
      return "Found 0 matching emails.";
    }

    const list = emails.map(e => `- Fra: ${e.from}\n  Emne: ${e.subject}\n  Dato: ${e.date}\n  Sammendrag: ${e.snippet}`).join('\n\n');
    return `Fetched Gmail Data:\n${list}`;
  } catch (error: any) {
    if (error.message === 'GMAIL_PERMISSION_DENIED') {
      return "[GMAIL_PERMISSION_DENIED]: Luke trenger tilgang til e-posten din. Logg inn på nytt for å gi tilgang.";
    }
    if (error.message === 'GMAIL_API_DISABLED') {
      return "[GMAIL_API_DISABLED]: Gmail API er ikke aktivert i Google Cloud for dette prosjektet.";
    }
    throw error;
  }
}

export async function processChatInteraction(messages: {role: 'user' | 'assistant', content: string}[]) {
  try {
    const session = await auth();
    const userMsg = messages[messages.length - 1].content;
    const lang = detectResponseLanguage(userMsg);

    if (isUnsupportedDestructiveRequest(userMsg)) return getUnsupportedDestructiveReply(lang);
    if (!session?.accessToken || session.error === "RefreshTokenError") {
      return lang === 'no' ? "Tilkoblingen har utløpt. Logg inn på nytt." : "Connection expired. Please re-login.";
    }

    const toolReq = await generateToolRequest(messages);
    
    let combinedContext = "";

    if (toolReq.requiresCalendar) {
      combinedContext += await getCalendarContext(session.accessToken, toolReq);
    }

    if (toolReq.requiresGmail) {
      const gmailContext = await getGmailContext(session.accessToken, toolReq);
      combinedContext += (combinedContext ? "\n\n" : "") + gmailContext;
    }

    // Fallback if neither was triggered but should have been
    if (!toolReq.requiresCalendar && !toolReq.requiresGmail) {
       return getUnsupportedQuestionReply(lang);
    }

    // Specific deterministic replies for calendar flows (confirmation, etc.)
    const dCreate = getDeterministicCreateReply(combinedContext, lang); if (dCreate) return dCreate;
    const dUpdate = getDeterministicUpdateReply(combinedContext); if (dUpdate) return dUpdate;
    const dDelete = getDeterministicDeleteReply(combinedContext); if (dDelete) return dDelete;

    // Custom fallback for Gmail permission errors
    if (combinedContext.includes("[GMAIL_PERMISSION_DENIED]")) {
      return lang === 'no' 
        ? "Jeg trenger tilgang til e-posten din for å svare på dette. Vennligst logg ut og logg inn igjen for å gi Luke tillatelse til å se e-poster."
        : "I need access to your email to answer this. Please sign out and sign in again to grant Luke permission to see emails.";
    }

    return await generateFinalResponse(messages, combinedContext, lang);
  } catch (err) {
    console.error("CHAT ERROR:", err);
    return "Beklager, det oppsto en teknisk feil.";
  }
}
