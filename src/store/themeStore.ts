import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'dark' | 'light';

interface ThemeState {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

/**
 * The application opens in LIGHT mode by default. The choice is remembered per
 * browser (the only thing still kept in localStorage — it is a display
 * preference, not business data).
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggleTheme: () => {
        const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: nextTheme });
        applyTheme(nextTheme);
      },
      setTheme: (theme: ThemeMode) => {
        set({ theme });
        applyTheme(theme);
      },
    }),
    {
      name: 'altech-theme',
      // a browser that never chose a theme starts in light mode
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<ThemeState> | undefined),
        theme: ((persisted as Partial<ThemeState> | undefined)?.theme as ThemeMode) || 'light',
      }),
    }
  )
);

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.remove('light');
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }
}

// Paint the light theme before React mounts so there is no dark flash.
if (typeof document !== 'undefined') {
  applyTheme(useThemeStore.getState().theme);
}
