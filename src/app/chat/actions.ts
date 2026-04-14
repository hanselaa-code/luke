'use server';

import { auth } from '@/auth';
import { getTomorrowsEvents } from '@/lib/google/calendar';

export async function processChatInteraction(message: string) {
  const session = await auth();

  if (!session?.accessToken) {
    return "I need to connect to your Google Calendar first. Please make sure you are signed in and have granted calendar permissions.";
  }

  const msgNormalized = message.toLowerCase().trim();

  // Temporary explicit match for the upcoming events explicitly requested
  if (msgNormalized.includes('what do i have tomorrow')) {
    try {
      const events = await getTomorrowsEvents(session.accessToken);
      
      if (events.length === 0) {
        return "You have nothing scheduled for tomorrow. Enjoy your free day!";
      }

      const eventList = events.map(e => `- ${e.time}: ${e.title}`).join('\n');
      return `You have ${events.length} event${events.length === 1 ? '' : 's'} scheduled for tomorrow:\n\n${eventList}`;
      
    } catch (error) {
      console.error('Error fetching calendar in chat:', error);
      return "I'm sorry, I had trouble fetching your calendar right now. Please try again later.";
    }
  }

  // Fallback response for unhandled prompts
  return "I'm still learning! Right now, I can only check your calendar if you ask: 'What do I have tomorrow?'.";
}
