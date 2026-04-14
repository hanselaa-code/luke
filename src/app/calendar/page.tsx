import React from 'react';
import { auth } from '@/auth';
import { getUpcomingEvents, FormattedEvent } from '@/lib/google/calendar';

export default async function CalendarPage() {
  const session = await auth();
  let events: FormattedEvent[] = [];
  let errorMsg = null;

  console.log("[DEBUG] CalendarPage -> Session user present:", !!session?.user);
  console.log("[DEBUG] CalendarPage -> Access token present in session:", !!session?.accessToken);

  if (session?.accessToken) {
    try {
      events = await getUpcomingEvents(session.accessToken, 15);
      console.log(`[DEBUG] CalendarPage -> Successfully fetched ${events.length} events.`);
    } catch (e: any) {
      console.error("[DEBUG - ERROR] CalendarPage -> Failed to get events:", e);
      // Surface the error detail safely for diagnosis
      errorMsg = e.message || "Failed to load events. Please try reconnecting your account.";
    }
  } else if (session?.user) {
    console.error("[DEBUG - ERROR] CalendarPage -> User is logged in but session.accessToken is MISSING.");
  }


  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Upcoming</h2>
        <p className="text-sm text-slate-400">Your schedule for the next few days.</p>
      </div>

      {errorMsg ? (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
          <p className="text-red-400 text-sm font-medium">{errorMsg}</p>
        </div>
      ) : !session ? (
         <div className="p-8 bg-card/50 border border-border rounded-2xl text-center">
            <p className="text-slate-400">Please sign in to view your calendar.</p>
         </div>
      ) : events.length === 0 ? (
        <div className="p-8 bg-card/50 border border-dashed border-border rounded-2xl text-center flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p className="text-slate-300 font-medium">No upcoming events</p>
          <p className="text-xs text-slate-500">Your schedule is completely clear.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="group relative bg-card/50 hover:bg-card hover:shadow-md hover:shadow-indigo-500/5 border border-border rounded-2xl p-4 transition-all duration-300 active:scale-[0.98]"
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                  {event.date}
                </span>
                <span className="text-[10px] bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full text-accent">
                  {event.type}
                </span>
              </div>
              <h3 className="text-lg font-medium text-slate-100 mb-1">{event.title}</h3>
              
              <div className="flex flex-col gap-1.5 mt-2">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {event.time}
                </div>
                {event.location && (
                   <div className="flex items-center gap-2 text-xs text-slate-500 line-clamp-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {event.location}
                   </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-6 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl text-center mt-8">
        <p className="text-xs text-slate-500 italic">
          More integrations (iCal, Outlook) coming soon.
        </p>
      </div>
    </div>
  );
}
