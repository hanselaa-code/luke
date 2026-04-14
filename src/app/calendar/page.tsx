import React from 'react';

const mockEvents = [
  {
    id: 1,
    title: 'Design Review',
    time: '10:00 - 11:00',
    date: 'Today',
    type: 'Meeting',
  },
  {
    id: 2,
    title: 'Weekly Sync',
    time: '14:00 - 15:00',
    date: 'Today',
    type: 'Meeting',
  },
  {
    id: 3,
    title: 'Focus Time',
    time: '09:00 - 11:00',
    date: 'Tomorrow',
    type: 'Deep Work',
  },
  {
    id: 4,
    title: 'Product Launch',
    time: '16:00 - 17:00',
    date: 'Friday',
    type: 'Event',
  },
];

export default function CalendarPage() {
  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Upcoming</h2>
        <p className="text-sm text-slate-400">Your schedule for the next few days.</p>
      </div>

      <div className="space-y-4">
        {mockEvents.map((event) => (
          <div
            key={event.id}
            className="group relative bg-card/50 hover:bg-card border border-border rounded-2xl p-4 transition-all duration-300 active:scale-[0.98]"
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
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {event.time}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4">
        <button className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95 shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Connect Google Calendar
        </button>
      </div>

      <div className="p-6 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl text-center mt-8">
        <p className="text-xs text-slate-500 italic">
          More integrations (iCal, Outlook) coming soon.
        </p>
      </div>
    </div>
  );
}
