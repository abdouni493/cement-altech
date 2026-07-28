import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'dark' | 'light';

interface ThemeState {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
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
    { name: 'cement-theme-store' }
  )
);

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}
