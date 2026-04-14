import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6 text-center">
      <div className="relative mb-8">
        <div className="absolute -inset-4 rounded-full bg-accent/20 blur-2xl animate-pulse" />
        <div className="relative h-24 w-24 rounded-3xl bg-accent flex items-center justify-center shadow-indigo-500/20 shadow-2xl">
          <span className="text-4xl font-bold text-white">L</span>
        </div>
      </div>
      
      <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl mb-4">
        Meet Luke
      </h1>
      
      <p className="text-lg text-slate-400 max-w-xs mx-auto mb-10">
        Your elegant, personal AI assistant for a calmer, more organized life.
      </p>
      
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <Link 
          href="/chat"
          className="bg-accent hover:bg-accent/90 text-white font-semibold py-4 px-8 rounded-2xl transition-all active:scale-95 shadow-lg shadow-indigo-500/25"
        >
          Get Started
        </Link>
        
        <button className="bg-slate-900/50 hover:bg-slate-900 border border-slate-800 text-slate-300 font-medium py-4 px-8 rounded-2xl transition-all">
          Already have an account?
        </button>
      </div>
      
      <div className="mt-16 grid grid-cols-3 gap-8 text-slate-500">
        <div className="flex flex-col items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[10px] uppercase tracking-widest">Calendar</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[10px] uppercase tracking-widest">Gmail</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[10px] uppercase tracking-widest">OpenAI</span>
        </div>
      </div>
    </div>
  );
}
