import React from 'react';
import { auth } from '@/auth';
import { SignOutButton } from '@/components/AuthButtons';
import Image from 'next/image';

const SettingGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 px-2">
      {title}
    </h3>
    <div className="bg-card/50 border border-border rounded-3xl overflow-hidden">
      {children}
    </div>
  </div>
);

const SettingItem = ({ 
  label, 
  value, 
  icon, 
  type = 'toggle' 
}: { 
  label: string; 
  value?: string; 
  icon: React.ReactNode;
  type?: 'toggle' | 'link' | 'text' 
}) => (
  <div className="flex items-center justify-between p-4 hover:bg-card/80 border-b border-border last:border-0 transition-colors cursor-pointer">
    <div className="flex items-center gap-4">
      <div className="h-10 w-10 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-accent group-hover:bg-accent/10 transition-colors shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {value && <p className="text-[10px] text-slate-500 truncate max-w-[150px]">{value}</p>}
      </div>
    </div>
    
    {type === 'toggle' && (
      <div className="h-6 w-11 bg-accent/20 border border-accent/30 rounded-full relative p-1 flex items-center justify-end">
        <div className="h-4 w-4 bg-accent rounded-full shadow-lg shadow-indigo-500/50" />
      </div>
    )}
    
    {type === 'link' && (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600"><polyline points="9 18 15 12 9 6"/></svg>
    )}
  </div>
);

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="p-6 space-y-8 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Settings</h2>
          <p className="text-sm text-slate-400">Configure your assistant.</p>
        </div>
        {user?.image && (
          <div className="h-12 w-12 rounded-2xl border border-border overflow-hidden ring-4 ring-accent/10">
            <Image 
              src={user.image} 
              alt={user.name || "User"} 
              width={48} 
              height={48} 
              className="object-cover"
            />
          </div>
        )}
      </div>

      <SettingGroup title="Account">
        <SettingItem 
          label="Profile" 
          value={user?.name || "Luke User"} 
          type="text"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} 
        />
        <SettingItem 
          label="Email" 
          value={user?.email || "not available"} 
          type="text"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} 
        />
      </SettingGroup>

      <SettingGroup title="Integrations">
        <SettingItem 
          label="Google Account" 
          value="Connected" 
          type="link"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>} 
        />
      </SettingGroup>

      <SettingGroup title="Preferences">
        <SettingItem 
          label="Smart Notifications" 
          value="Priority only" 
          type="toggle"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} 
        />
      </SettingGroup>

      <div className="pt-4">
        <SignOutButton />
      </div>

      <div className="text-center">
        <p className="text-[10px] text-slate-600">Luke MVP v0.1.0 • Built with Next.js</p>
      </div>
    </div>
  );
}
