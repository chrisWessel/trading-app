import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WesSignal Terminal | High-Performance Trading & Signal Engine',
  description: 'Real-time multi-asset trading engine, technical decision lines, paper simulator, Telegram broadcaster, and Supabase cloud backend.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
