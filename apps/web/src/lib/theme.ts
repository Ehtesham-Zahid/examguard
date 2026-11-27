import type { Prefs } from './types';

const FONTS: Record<string, string> = {
  default: "'Atkinson Hyperlegible', system-ui, sans-serif",
  legible: "'Familjen Grotesk', system-ui, sans-serif",
  dyslexic: "'Lexend', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  // light is the default on every device; dark / high contrast / system are opt-in from Settings
  let theme = p.theme ?? 'light';
  if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.dataset.reduceMotion = String(!!p.reduceMotion);
  root.style.setProperty('--exam-font', FONTS[p.font ?? 'default'] ?? FONTS.default);
  root.style.setProperty('--exam-size', `${p.fontSize ?? 17}px`);
  root.style.setProperty('--exam-leading', String(p.lineHeight ?? 1.65));
}

import { useEffect, useState } from 'react';

/** Current resolved theme ('light' | 'dark' | 'contrast'), updated live when it changes. */
export function useThemeMode() {
  const read = () => (document.documentElement.dataset.theme as 'light' | 'dark' | 'contrast') || 'light';
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

/** Keep the "System" theme in sync with the OS. */
export function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const h = () => {
    const p = localPrefs();
    if (p.theme === 'system') applyPrefs(p);
  };
  mq.addEventListener?.('change', h);
  return () => mq.removeEventListener?.('change', h);
}

export function localPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem('eg_prefs') ?? '{}');
  } catch {
    return {};
  }
}
export function saveLocalPrefs(p: Prefs) {
  try {
    localStorage.setItem('eg_prefs', JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
