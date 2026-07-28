import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StoreSettings } from '@/types';
import { db } from '@/lib/db';
import { push } from '@/lib/persist';

interface SettingsState {
  settings: StoreSettings;
  updateSettings: (data: Partial<StoreSettings>) => void;
}

const defaultSettings: StoreSettings = {
  logo: null,
  name: 'Altech Production',
  description: 'Vente & Fabrication de Ciment',
  email: '',
  phone: '',
  address: '',
  socialMedia: '',
  nif: '',
  nis: '',
  article: '',
  rc: '',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      updateSettings: (data) => {
        const next = { ...get().settings, ...data };
        set({ settings: next });
        push('settings.save', () => db.settings.save(next));
      },
    }),
    { name: 'cement-settings' }
  )
);
