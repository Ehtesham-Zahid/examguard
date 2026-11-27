import type { Prefs } from './types';

const FONTS: Record<string, string> = {
  default: "'Instrument Sans', system-ui, sans-serif",
  legible: "'Atkinson Hyperlegible', system-ui, sans-serif",
  dyslexic: "'Lexend', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  let theme = p.theme ?? 'system';
  if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.dataset.reduceMotion = String(!!p.reduceMotion);
  root.style.setProperty('--exam-font', FONTS[p.font ?? 'default'] ?? FONTS.default);
  root.style.setProperty('--exam-size', `${p.fontSize ?? 17}px`);
  root.style.setProperty('--exam-leading', String(p.lineHeight ?? 1.65));
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
