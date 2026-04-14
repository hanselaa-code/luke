import React from 'react';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Luke
        </h1>
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
            <span className="text-xs font-medium text-accent">L</span>
          </div>
        </div>
      </div>
    </header>
  );
}
