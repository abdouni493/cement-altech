import { useAuthStore } from '@/store/authStore';
import { translate, type TranslationKey } from '@/lib/i18n';
import type { Lang } from '@/types';

export function useLanguage() {
  const language = useAuthStore((s) => s.language);
  const setLanguage = useAuthStore((s) => s.setLanguage);

  const t = (key: TranslationKey) => translate(language, key);
  const isRTL = language === 'ar';

  return { language, setLanguage, t, isRTL };
}

export type { Lang };
