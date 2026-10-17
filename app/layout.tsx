import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'TradeLink | CMO Operating System',
  description: 'The internal growth operating system for TradeLink.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { let theme; try { theme = localStorage.getItem("tradelink-theme"); } catch {} document.documentElement.dataset.theme = theme === "light" || theme === "dark" ? theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; })();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
