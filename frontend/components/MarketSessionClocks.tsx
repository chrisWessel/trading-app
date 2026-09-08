'use client';

import React, { useState, useEffect } from 'react';
import { Clock, MapPin, Flame, Globe2, AlertCircle } from 'lucide-react';

interface MarketSession {
  id: string;
  name: string;
  city: string;
  timezone: string;
  openLocalStr: string;
  closeLocalStr: string;
  openUtcStr: string;
  closeUtcStr: string;
  openHarareStr: string;
  closeHarareStr: string;
  openUtcHour: number;
  closeUtcHour: number;
  flag: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
  description: string;
}

const SESSIONS: MarketSession[] = [
  {
    id: 'asia',
    name: 'ASIA (Tokyo)',
    city: 'Tokyo',
    timezone: 'Asia/Tokyo',
    openLocalStr: '09:00 AM JST',
    closeLocalStr: '06:00 PM JST',
    openUtcStr: '00:00 UTC',
    closeUtcStr: '09:00 UTC',
    openHarareStr: '02:00 AM CAT',
    closeHarareStr: '11:00 AM CAT',
    openUtcHour: 0,
    closeUtcHour: 9,
    flag: '🇯🇵',
    color: 'text-amber-400',
    bgColor: 'bg-amber-950/40',
    borderColor: 'border-amber-800/60',
    glowColor: 'shadow-amber-900/40 border-amber-500/80',
    description: 'Asian liquidity & YEN movement',
  },
  {
    id: 'london',
    name: 'LONDON (UK)',
    city: 'London',
    timezone: 'Europe/London',
    openLocalStr: '08:00 AM BST',
    closeLocalStr: '04:30 PM BST',
    openUtcStr: '07:00 UTC',
    closeUtcStr: '15:30 UTC',
    openHarareStr: '09:00 AM CAT',
    closeHarareStr: '05:30 PM CAT',
    openUtcHour: 7,
    closeUtcHour: 15.5,
    flag: '🇬🇧',
    color: 'text-blue-400',
    bgColor: 'bg-blue-950/40',
    borderColor: 'border-blue-800/60',
    glowColor: 'shadow-blue-900/40 border-blue-500/80',
    description: 'Euro & Cable breakout volume',
  },
  {
    id: 'ny',
    name: 'NEW YORK (US)',
    city: 'New York',
    timezone: 'America/New_York',
    openLocalStr: '08:00 AM EDT',
    closeLocalStr: '05:00 PM EDT',
    openUtcStr: '12:00 UTC',
    closeUtcStr: '21:00 UTC',
    openHarareStr: '02:00 PM CAT',
    closeHarareStr: '11:00 PM CAT',
    openUtcHour: 12,
    closeUtcHour: 21,
    flag: '🇺🇸',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-950/40',
    borderColor: 'border-emerald-800/60',
    glowColor: 'shadow-emerald-900/40 border-emerald-500/80',
    description: 'USD, Gold & Index volatility',
  },
];

function getUtcHoursMinutes(): { currentUtcDecimal: number; isWeekend: boolean; utcTimeStr: string } {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMins = now.getUTCMinutes();
  const utcSecs = now.getUTCSeconds();
  const day = now.getUTCDay(); // 0 = Sun, 6 = Sat

  const currentUtcDecimal = utcHours + utcMins / 60;
  const isWeekend = day === 0 || day === 6;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const utcTimeStr = `${pad(utcHours)}:${pad(utcMins)}:${pad(utcSecs)} UTC`;

  return { currentUtcDecimal, isWeekend, utcTimeStr };
}

function getLocalCityTimeStr(timezone: string): string {
  try {
    return new Date().toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch (e) {
    return '--:--:--';
  }
}

function getHarareTimeStr(): string {
  try {
    return new Date().toLocaleTimeString('en-US', {
      timeZone: 'Africa/Harare',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch (e) {
    return '--:--:--';
  }
}

function getCountdownText(currentUtcDecimal: number, openUtcHour: number, closeUtcHour: number, isOpen: boolean): string {
  let targetHour = isOpen ? closeUtcHour : openUtcHour;
  let diffHours = targetHour - currentUtcDecimal;
  if (diffHours < 0) diffHours += 24;

  const h = Math.floor(diffHours);
  const m = Math.floor((diffHours - h) * 60);

  if (isOpen) {
    return `Closes in ${h}h ${m}m`;
  } else {
    return `Opens in ${h}h ${m}m`;
  }
}

export default function MarketSessionClocks() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const { currentUtcDecimal, isWeekend, utcTimeStr } = getUtcHoursMinutes();
  const harareTimeStr = getHarareTimeStr();

  // London / NY Overlap: 12:00 UTC to 15:30 UTC (8:00 AM to 11:30 AM EST / 2:00 PM to 5:30 PM CAT)
  const isOverlapActive = !isWeekend && currentUtcDecimal >= 12 && currentUtcDecimal < 15.5;

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-2xl space-y-4 font-mono">
      {/* Component Top Title & Global Clocks Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="bg-blue-950 p-2 rounded-lg border border-blue-800">
            <Globe2 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Global Market Sessions</span>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-bold">
                Where Real Deals Happen
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 font-sans">
              Exact Opening & Closing Times • Asian, London & New York Key Trading Windows
            </p>
          </div>
        </div>

        {/* Live Global Time Clocks */}
        <div className="flex items-center gap-3 text-xs">
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">UTC:</span>
            <span className="text-white font-bold">{utcTimeStr}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">Local (CAT):</span>
            <span className="text-emerald-400 font-bold">{harareTimeStr}</span>
          </div>
        </div>
      </div>

      {/* 4 Cards Grid: Asia, London, New York, and Overlap Zone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {SESSIONS.map((session) => {
          const isOpen = !isWeekend && currentUtcDecimal >= session.openUtcHour && currentUtcDecimal < session.closeUtcHour;
          const cityTimeStr = getLocalCityTimeStr(session.timezone);
          const countdown = getCountdownText(currentUtcDecimal, session.openUtcHour, session.closeUtcHour, isOpen);

          return (
            <div
              key={session.id}
              className={`relative ${session.bgColor} ${session.borderColor} border rounded-xl p-3.5 transition-all duration-300 flex flex-col justify-between ${
                isOpen ? `shadow-xl ${session.glowColor} ring-1 ring-slate-700` : 'opacity-80'
              }`}
            >
              {/* Card Header: Flag, Name, Status Badge */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">{session.flag}</span>
                  <span className={`text-xs font-black tracking-wide ${session.color}`}>
                    {session.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      isOpen ? 'bg-emerald-400 animate-pulse shadow-md shadow-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  <span
                    className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                      isOpen ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-950 text-slate-500 border border-slate-800'
                    }`}
                  >
                    {isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
              </div>

              {/* City Clock */}
              <div className="text-center my-1.5">
                <div className={`text-xl font-black tracking-tight ${isOpen ? 'text-white' : 'text-slate-300'}`}>
                  {cityTimeStr}
                </div>
                <div className="text-[10px] text-slate-400">{session.city} Local Time</div>
              </div>

              {/* Open & Close Times Table */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2 my-2 space-y-1 text-[11px]">
                <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-900 pb-1">
                  <span className="text-slate-400 text-[10px] uppercase">OPENING TIME:</span>
                  <span className={session.color}>{session.openLocalStr}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-900 pb-1">
                  <span className="text-slate-400 text-[10px] uppercase">CLOSING TIME:</span>
                  <span className={session.color}>{session.closeLocalStr}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
                  <span>UTC Hours:</span>
                  <span className="text-slate-200 font-bold">{session.openUtcStr} - {session.closeUtcStr}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400">
                  <span>Local (CAT):</span>
                  <span className="text-emerald-400 font-bold">{session.openHarareStr} - {session.closeHarareStr}</span>
                </div>
              </div>

              {/* Countdown Footer */}
              <div className={`text-center text-[10px] font-bold py-1 rounded bg-slate-950/60 border border-slate-800/60 ${
                isOpen ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {isWeekend ? '📅 Weekend — Markets Resume Mon' : countdown}
              </div>
            </div>
          );
        })}

        {/* 4th Card: REAL DEALS OVERLAP ZONE (London + NY Overlap) */}
        <div
          className={`relative bg-gradient-to-b from-rose-950/50 via-slate-950 to-slate-900 border ${
            isOverlapActive
              ? 'border-rose-500 shadow-xl shadow-rose-900/50 ring-1 ring-rose-500'
              : 'border-slate-800 opacity-85'
          } rounded-xl p-3.5 flex flex-col justify-between transition-all`}
        >
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Flame className={`w-4 h-4 ${isOverlapActive ? 'text-rose-400 animate-bounce' : 'text-slate-500'}`} />
              <span className="text-xs font-black tracking-wide text-rose-400 uppercase">
                LDN / NY OVERLAP
              </span>
            </div>
            <span
              className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                isOverlapActive
                  ? 'bg-rose-950 text-rose-400 border border-rose-800 animate-pulse'
                  : 'bg-slate-950 text-slate-500 border border-slate-800'
              }`}
            >
              {isOverlapActive ? '🔥 HIGH VOLATILITY' : 'INACTIVE'}
            </span>
          </div>

          <div className="text-center my-1">
            <div className="text-xs font-extrabold text-amber-300 uppercase tracking-wide">
              ⚡ Where Real Deals Happen
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              London & New York Institutional Overlap
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2 my-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-900 pb-1">
              <span className="text-slate-400 text-[10px]">OVERLAP START:</span>
              <span className="text-rose-400">12:00 UTC / 08:00 EST</span>
            </div>
            <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-900 pb-1">
              <span className="text-slate-400 text-[10px]">OVERLAP END:</span>
              <span className="text-rose-400">15:30 UTC / 11:30 EST</span>
            </div>
            <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
              <span>Local (CAT):</span>
              <span className="text-emerald-400 font-bold">02:00 PM - 05:30 PM</span>
            </div>
          </div>

          <div className="text-center text-[10px] font-bold py-1 rounded bg-slate-950/60 border border-slate-800/60 text-amber-400">
            {isOverlapActive ? '🚀 Active Peak Liquidity Window' : '80% of Daily Volume Traded Here'}
          </div>
        </div>
      </div>
    </div>
  );
}
