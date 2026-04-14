'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents, getUpcomingEvents, FormattedEvent } from '@/lib/google/calendar';
import { interpretCalendarIntent } from '@/lib/ai/openai';
import { format } from 'date-fns';

// Small wrapper utilities leveraging the existing Google Calendar functions
async function getTodaysEvents(accessToken: string) {
  const events = await getUpcomingEvents(accessToken, 50);
  return events.filter(e => e.date === 'Today');
}

async function getNextEvent(accessToken: string) {
  const events = await getUpcomingEvents(accessToken, 1);
  return events.slice(0, 1);
}

async function getNextFlightEvent(accessToken: string) {
  const events = await getUpcomingEvents(accessToken, 100);
  return events.find(e => e.title.toLowerCase().includes('flight'));
}

async function getEventsForDay(accessToken: string, day: string) {
  const events = await getUpcomingEvents(accessToken, 50);
  const target = day.toLowerCase().trim();
  return events.filter(e => e.date.toLowerCase().includes(target));
}

export async function processChatInteraction(message: string) {
  console.log("CHAT ACTION STARTED");
  console.log("OPENAI KEY EXISTS:", !!process.env.OPENAI_API_KEY);
  console.log("OPENAI KEY LENGTH:", process.env.OPENAI_API_KEY?.length);

  try {
    const session = await auth();

    if (!session?.accessToken) {
      return "I need to connect to your Google Calendar first. Please make sure you are signed in and have granted calendar permissions.";
    }

    const { intent, day } = await interpretCalendarIntent(message);
    console.log("AI intent:", intent);

    switch (intent) {
      case 'current_day': {
        const todayStr = format(new Date(), 'EEEE, MMMM d');
        return `Today is ${todayStr}.`;
      }
      case 'current_time': {
        const timeStr = format(new Date(), 'HH:mm');
        return `The time is ${timeStr}.`;
      }
      case 'today': {
        const events = await getTodaysEvents(session.accessToken);
        if (events.length === 0) return "You have nothing scheduled today.";
        const list = events.map(e => `• ${e.time}: ${e.title}`).join('\n');
        return `You have ${events.length} event${events.length === 1 ? '' : 's'} today:\n${list}`;
      }
      case 'tomorrow': {
        const events = await getTomorrowsEvents(session.accessToken);
        if (events.length === 0) return "You have nothing scheduled tomorrow.";
        const list = events.map(e => `• ${e.time}: ${e.title}`).join('\n');
        return `You have ${events.length} event${events.length === 1 ? '' : 's'} tomorrow:\n${list}`;
      }
      case 'this_week':
      case 'summary': {
        const events = await getUpcomingEvents(session.accessToken, 15);
        if (events.length === 0) return "Your schedule is clear for the coming days.";
        const list = events.map(e => `• ${e.date} at ${e.time}: ${e.title}`).join('\n');
        return `You have ${events.length} event${events.length === 1 ? '' : 's'} left this week. Here is your summary:\n${list}`;
      }
      case 'next_event': {
        const events = await getNextEvent(session.accessToken);
        if (events.length === 0) return "You have no upcoming events.";
        const e = events[0];
        return `Your next event is ${e.title} on ${e.date} at ${e.time}.`;
      }
      case 'next_flight': {
        const flight = await getNextFlightEvent(session.accessToken);
        if (!flight) return "You do not have any flights coming up.";
        return `Your next flight is ${flight.title} on ${flight.date} at ${flight.time}.`;
      }
      case 'specific_day': {
        if (!day) return "I'm not sure which day you mean.";
        const events = await getEventsForDay(session.accessToken, day);
        if (events.length === 0) return `You have nothing scheduled on ${day}.`;
        const list = events.map(e => `• ${e.time}: ${e.title}`).join('\n');
        return `You have ${events.length} event${events.length === 1 ? '' : 's'} on ${day}:\n${list}`;
      }
      case 'unknown':
      default:
        return "I'm still learning! Try asking me what you have today, when your next flight is, or simply what time it is.";
    }

  } catch (error) {
    console.error("CHAT ERROR FULL:", error);
    console.error(
      "STACK:",
      error instanceof Error ? error.stack : error
    );

    // Return a plain string so Next.js does not hide the error behind a digest
    return `Server Error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

