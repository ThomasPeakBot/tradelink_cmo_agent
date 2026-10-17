'use client';

import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

const key = 'tradelink-theme';

export function ThemeToggle() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(key);
      } catch {
        /* Storage may be disabled. */
      }
      document.documentElement.dataset.theme =
        saved === 'light' || saved === 'dark' ? saved : media.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', sync);
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener('storage', storage);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('storage', storage);
    };
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle btn"
      aria-label="Toggle light and dark mode"
      onClick={() => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem(key, theme);
        } catch {
          /* Keep the current theme without persistence. */
        }
      }}
    >
      <span className="theme-to-dark">
        <Moon size={15} /> Dark mode
      </span>
      <span className="theme-to-light">
        <Sun size={15} /> Light mode
      </span>
    </button>
  );
}
