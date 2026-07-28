import { Menu, Globe, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { useThemeStore } from '@/store/themeStore';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useThemeStore();

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 h-16 bg-cream/80 backdrop-blur-md border-b border-gold/15 flex items-center justify-between px-4 lg:px-6">
      <button onClick={onMenuClick} className="lg:hidden text-text-secondary hover:text-text-primary">
        <Menu size={24} />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Passer en Mode Clair' : 'Passer en Mode Sombre'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-vanilla/70 border border-gold/20 text-sm font-medium text-text-secondary hover:bg-gold/10 hover:text-gold transition-all"
        >
          {theme === 'dark' ? (
            <>
              <Sun size={16} className="text-amber-400" />
              <span className="hidden sm:inline">Mode Clair</span>
            </>
          ) : (
            <>
              <Moon size={16} className="text-indigo-600" />
              <span className="hidden sm:inline">Mode Sombre</span>
            </>
          )}
        </button>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-vanilla/70 border border-gold/20 text-sm font-medium text-text-secondary hover:bg-gold/10 transition-colors"
        >
          <Globe size={16} />
          {language === 'fr' ? '🇫🇷 FR' : '🇩🇿 AR'}
        </button>

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-text-primary leading-tight">{user?.name}</p>
            <p className="text-[11px] text-text-muted capitalize">{user?.role}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-gradient-button flex items-center justify-center text-white text-sm font-semibold shadow-gold">
            {initials || 'U'}
          </div>
        </div>
      </div>
    </header>
  );
}
