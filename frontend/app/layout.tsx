import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WesSignal Terminal | High-Performance Trading & Signal Engine',
  description: 'Real-time multi-asset trading engine, technical decision lines, paper simulator, Telegram broadcaster, and Supabase cloud backend.',
  // Declared explicitly so the tab icon does not depend on the app/ file
  // convention alone. icon.svg is the square mark; apple-touch-icon.png is the
  // same lockup rasterised for iOS home-screen shortcuts.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: ['/icon.svg'],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
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
