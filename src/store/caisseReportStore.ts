import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CaisseReport, CaisseReportType } from '@/types';
import { uid, todayISO, nowTime } from '@/lib/utils';
import { getCurrentUsername } from './authStore';

interface CaisseReportState {
  reports: CaisseReport[];
  addReport: (data: {
    description: string;
    declaredAmount: number;
    reportType?: CaisseReportType;
    date?: string;
    endDate?: string;
    hour?: string;
  }) => CaisseReport;
  updateReport: (id: string, data: Partial<CaisseReport>) => void;
  deleteReport: (id: string) => void;
}

export const useCaisseReportStore = create<CaisseReportState>()(
  persist(
    (set, get) => ({
      reports: [],

      addReport: ({ description, declaredAmount, reportType, date, endDate, hour }) => {
        const type: CaisseReportType = reportType || 'day';
        const report: CaisseReport = {
          id: uid('crep'),
          reportType: type,
          date: date || todayISO(),
          endDate: type === 'period' ? (endDate || date || todayISO()) : undefined,
          hour: hour || nowTime(),
          description,
          declaredAmount,
          createdAt: new Date().toISOString(),
          createdBy: getCurrentUsername(),
        };
        set({ reports: [report, ...get().reports] });
        return report;
      },

      updateReport: (id, data) =>
        set({ reports: get().reports.map((r) => (r.id === id ? { ...r, ...data } : r)) }),

      deleteReport: (id) => set({ reports: get().reports.filter((r) => r.id !== id) }),
    }),
    { name: 'labochimie-caisse-reports' }
  )
);
