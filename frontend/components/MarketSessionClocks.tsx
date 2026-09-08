'use client';

import React, { useState, useEffect } from 'react';
import { Clock, MapPin } from 'lucide-react';

interface MarketSession {
  name: string;
  city: string;
  timezone: string;
  openHour: number;  // in local time
  closeHour: number; // in local time
  flag: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}

const SESSIONS: MarketSession[] = [
  {
    name: 'ASIA (Tokyo)',
    city: 'Tokyo',
    timezone: 'Asia/Tokyo',
    openHour: 9,   // 9:00 AM JST
    closeHour: 18,  // 6:00 PM JST (3:00 PM actual close, extended for overlap)
    flag: '🇯🇵',
    color: 'text-amber-400',
    bgColor: 'bg-amber-950/60',
    borderColor: 'border-amber-800/50',
    glowColor: 'shadow-amber-900/30',
  },
  {
    name: 'LONDON (UK)',
    city: 'London',
    timezone: 'Europe/London',
    openHour: 8,   // 8:00 AM GMT/BST
    closeHour: 16,  // 4:30 PM GMT/BST (using 16 for simplicity)
    flag: '🇬🇧',
    color: 'text-blue-400',
    bgColor: 'bg-blue-950/60',
    borderColor: 'border-blue-800/50',
    glowColor: 'shadow-blue-900/30',
  },
  {
    name: 'NEW YORK (US)',
    city: 'New York',
    timezone: 'America/New_York',
    openHour: 9,   // 9:30 AM EST (using 9 for pre-market)
    closeHour: 17,  // 5:00 PM EST
    flag: '🇺🇸',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-950/60',
    borderColor: 'border-emerald-800/50',
    glowColor: 'shadow-emerald-900/30',
  },
];

function getSessionLocalTime(timezone: string): Date {
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: timezone });
  return new Date(localStr);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function isMarketOpen(timezone: string, openHour: number, closeHour: number): boolean {
  const localTime = getSessionLocalTime(timezone);
  const day = localTime.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false; // Weekend
  const hour = localTime.getHours();
  return hour >= openHour && hour < closeHour;
}

function getTimeUntilEvent(timezone: string, targetHour: number): string {
  const localTime = getSessionLocalTime(timezone);
  const currentHour = localTime.getHours();
  const currentMin = localTime.getMinutes();
  const currentSec = localTime.getSeconds();

  let diffMinutes = (targetHour * 60) - (currentHour * 60 + currentMin);
  if (diffMinutes < 0) diffMinutes += 24 * 60; // Next day

  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;

  if (hours === 0 && mins === 0) return 'Now';
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export default function MarketSessionClocks() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <Clock className="w-4 h-4 text-blue-400" />
        <span className="text-[11px] font-bold text-white uppercase tracking-wider">
          Market Sessions — Where Real Deals Happen
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-slate-700 to-transparent" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {SESSIONS.map((session) => {
          const localTime = getSessionLocalTime(session.timezone);
          const open = isMarketOpen(session.timezone, session.openHour, session.closeHour);
          const timeStr = formatTime(localTime);

          const openTimeStr = `${session.openHour > 12 ? session.openHour - 12 : session.openHour}:00 ${session.openHour >= 12 ? 'PM' : 'AM'}`;
          const closeTimeStr = `${session.closeHour > 12 ? session.closeHour - 12 : session.closeHour}:00 ${session.closeHour >= 12 ? 'PM' : 'AM'}`;

          const countdown = open
            ? `Closes in ${getTimeUntilEvent(session.timezone, session.closeHour)}`
            : `Opens in ${getTimeUntilEvent(session.timezone, session.openHour)}`;

          return (
            <div
              key={session.name}
              className={`relative ${session.bgColor} ${session.borderColor} border rounded-lg p-3 transition-all duration-300 ${
                open ? `shadow-lg ${session.glowColor}` : 'opacity-75'
              }`}
            >
              {/* Status Indicator */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">{session.flag}</span>
                  <span className={`text-[11px] font-extrabold tracking-wide ${session.color}`}>
                    {session.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      open ? 'bg-emerald-400 animate-pulse shadow-lg shadow-emerald-500/50' : 'bg-slate-600'
                    }`}
                  />
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      open ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {open ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
              </div>

              {/* Current Local Time */}
              <div className="text-center mb-2">
                <div className={`text-lg font-black font-mono tracking-tight ${open ? 'text-white' : 'text-slate-400'}`}>
                  {timeStr}
                </div>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] text-slate-500">{session.city} Local Time</span>
                </div>
              </div>

              {/* Open / Close Times */}
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                <div className="bg-black/30 rounded px-2 py-1.5 text-center">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Open</div>
                  <div className={`text-[11px] font-bold ${session.color}`}>{openTimeStr}</div>
                </div>
                <div className="bg-black/30 rounded px-2 py-1.5 text-center">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Close</div>
                  <div className={`text-[11px] font-bold ${session.color}`}>{closeTimeStr}</div>
                </div>
              </div>

              {/* Countdown */}
              <div className={`text-center text-[10px] font-mono font-bold ${
                open ? 'text-emerald-400/80' : 'text-slate-500'
              }`}>
                {localTime.getDay() === 0 || localTime.getDay() === 6
                  ? '📅 Weekend — Markets Resume Monday'
                  : countdown
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
