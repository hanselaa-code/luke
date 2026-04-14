'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents, getUpcomingEvents, FormattedEvent } from '@/lib/google/calendar';
import { interpretCalendarIntent } from '@/lib/ai/openai';

// Small wrapper utilities leveraging the existing Google Calendar functions
async function getTodaysEvents(accessToken: string) {
  const events = await getUpcomingEvents(accessToken, 50);
  return events.filter(e => e.date === 'Today');
}

async function getNextEvent(accessToken: string) {
  const events = await getUpcomingEvents(accessToken, 1);
  return events.slice(0, 1);
}

async function getEventsForDay(accessToken: string, day: string) {
  const events = await getUpcomingEvents(accessToken, 50);
  const target = day.toLowerCase().trim();
  return events.filter(e => e.date.toLowerCase().includes(target));
}

function formatEventsResponse(events: FormattedEvent[], timeContext: string) {
  if (!events || events.length === 0) {
    return "You have nothing scheduled.";
  }

  const eventList = events.map(e => `• ${e.title} at ${e.time}`).join('\n');
  return `You have ${events.length} event${events.length === 1 ? '' : 's'} ${timeContext}:\n${eventList}`;
}

export async function processChatInteraction(message: string) {
  const session = await auth();

  if (!session?.accessToken) {
    return "I need to connect to your Google Calendar first. Please make sure you are signed in and have granted calendar permissions.";
  }

  try {
    const { intent, day } = await interpretCalendarIntent(message);
    console.log("AI intent:", intent);

    let events: FormattedEvent[] = [];
    let timeContext = '';

    switch (intent) {
      case 'today':
        events = await getTodaysEvents(session.accessToken);
        timeContext = 'today';
        break;
      case 'tomorrow':
        events = await getTomorrowsEvents(session.accessToken);
        timeContext = 'tomorrow';
        break;
      case 'this_week':
      case 'summary':
        events = await getUpcomingEvents(session.accessToken, 10);
        timeContext = 'coming up';
        break;
      case 'next_event':
        events = await getNextEvent(session.accessToken);
        timeContext = 'next';
        break;
      case 'specific_day':
        if (day) {
          events = await getEventsForDay(session.accessToken, day);
          timeContext = `on ${day}`;
        } else {
          events = await getUpcomingEvents(session.accessToken, 10);
          timeContext = `coming up`;
        }
        break;
      case 'unknown':
      default:
        return "I'm still learning! Right now, I can check your calendar for today, tomorrow, or a specific day.";
    }

    return formatEventsResponse(events, timeContext);

  } catch (error) {
    console.error("CHAT ERROR:", error);

    return `Server Error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

