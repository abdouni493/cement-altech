import { create } from 'zustand';
import type { StoreSettings } from '@/types';
import { db } from '@/lib/db';
import { save } from '@/lib/persist';

interface SettingsState {
  settings: StoreSettings;
  load: () => Promise<void>;
  updateSettings: (data: Partial<StoreSettings>) => Promise<void>;
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

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: defaultSettings,

  load: async () => {
    const settings = await db.settings.get();
    if (settings) set({ settings });
  },

  updateSettings: async (data) => {
    const next = { ...get().settings, ...data };
    await save('settings.save', () => db.settings.save(next));
    set({ settings: next });
  },
}));
