import { create } from 'zustand';
import type { CaisseReport, CaisseReportType } from '@/types';
import { todayISO, nowTime } from '@/lib/utils';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

interface CaisseReportState {
  reports: CaisseReport[];
  load: () => Promise<void>;
  addReport: (data: {
    description: string;
    declaredAmount: number;
    reportType?: CaisseReportType;
    date?: string;
    endDate?: string;
    hour?: string;
  }) => Promise<CaisseReport>;
  deleteReport: (id: string) => Promise<void>;
}

export const useCaisseReportStore = create<CaisseReportState>()((set, get) => ({
  reports: [],

  load: async () => set({ reports: await db.caisseReports.list() }),

  addReport: async ({ description, declaredAmount, reportType, date, endDate }) => {
    const type: CaisseReportType = reportType || 'day';
    const day = date || todayISO();
    const row = await save('caisseReports.create', () =>
      rpc.createCaisseReport(
        declaredAmount, description, type, day,
        type === 'period' ? (endDate || day) : undefined
      )
    );
    const reports = await db.caisseReports.list();
    set({ reports });
    return (
      reports.find((r) => r.id === row.id) ?? {
        id: row.id, reportType: type, date: day, endDate, hour: nowTime(),
        description, declaredAmount, createdAt: new Date().toISOString(),
      }
    );
  },

  deleteReport: async (id) => {
    await save('caisseReports.delete', () => db.caisseReports.remove(id));
    set({ reports: get().reports.filter((r) => r.id !== id) });
  },
}));
