import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'TradeLink | CMO Operating System',
  description: 'The internal growth operating system for TradeLink.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
