'use client';

import React, { useEffect, useState } from 'react';
import { Newspaper, ExternalLink, TrendingUp, TrendingDown, MinusCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  timestamp_sec: number;
  time_harare: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
}

interface MarketNewsSectionProps {
  symbol: string;
}

export default function MarketNewsSection({ symbol }: MarketNewsSectionProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH'>('ALL');

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/news?symbol=${encodeURIComponent(symbol)}`);
      if (res.ok) {
        const data = await res.json();
        setNews(data.news || []);
      }
    } catch (e) {
      console.error('Market news fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 15000);
    return () => clearInterval(interval);
  }, [symbol]);

  const filteredNews = filter === 'ALL'
    ? news
    : news.filter((item) => item.sentiment === filter);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold text-white">Live Market & Macro Economic News Feed</h2>
        </div>

        {/* Sentiment Filter Tabs */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['ALL', 'BULLISH', 'BEARISH'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2.5 py-1 rounded-md font-bold transition ${
                  filter === s
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={fetchNews}
            className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition"
            title="Refresh News"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* News Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredNews.length === 0 ? (
          <div className="col-span-full py-8 text-center text-slate-500 font-mono text-xs">
            No market news items available for {symbol}.
          </div>
        ) : (
          filteredNews.map((item) => (
            <div
              key={item.id}
              className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex flex-col justify-between gap-3 transition shadow-md group"
            >
              <div className="space-y-2">
                {/* Meta Header */}
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400 font-semibold">{item.source}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">{item.time_harare} CAT</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.sentiment === 'BULLISH'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : item.sentiment === 'BEARISH'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {item.sentiment}
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-xs font-bold text-white group-hover:text-blue-400 transition leading-snug">
                  {item.title}
                </h3>

                {/* Summary */}
                <p className="text-[11px] text-slate-400 leading-normal line-clamp-2">
                  {item.summary}
                </p>
              </div>

              {/* Action Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-900 text-[10px] font-mono">
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    item.impact === 'HIGH'
                      ? 'bg-rose-950/60 text-rose-400 border border-rose-900'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {item.impact} IMPACT
                </span>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:underline font-bold"
                >
                  <span>Read Article</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
