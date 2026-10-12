import { create } from 'zustand';
import type {
  Worker, Role, Acompte, Absence, WorkerPaymentRecord, WorkerPermissions, WorkerOvertime,
} from '@/types';
import { supabase } from '@/lib/supabase';
import { db, rpc, remove as removeRow } from '@/lib/db';
import { save } from '@/lib/persist';

/** Decimal hours between "fin du travail" and "fin des heures supplémentaires". */
export function overtimeHours(
  workEndH: number, workEndM: number, otEndH: number, otEndM: number
): number {
  const start = workEndH * 60 + workEndM;
  let end = otEndH * 60 + otEndM;
  if (end < start) end += 24 * 60;          // the overtime ran past midnight
  return Math.max(0, (end - start) / 60);
}

/** False when the overtime was entered as a plain number of hours (no start / end time). */
export function hasTimes(o: Pick<WorkerOvertime, 'workEndHour' | 'workEndMinute' | 'overtimeEndHour' | 'overtimeEndMinute'>) {
  return !(o.workEndHour === 0 && o.workEndMinute === 0 && o.overtimeEndHour === 0 && o.overtimeEndMinute === 0);
}

interface WorkerState {
  workers: Worker[];
  roles: Role[];
  load: () => Promise<void>;
  addWorker: (w: Partial<Worker> & { password?: string }) => Promise<Worker>;
  updateWorker: (id: string, data: Partial<Worker> & { password?: string }) => Promise<Worker>;
  deleteWorker: (id: string) => Promise<void>;
  addRole: (name: string) => Promise<Role>;
  deleteRole: (id: string) => Promise<void>;
  setPermissions: (workerId: string, perms: WorkerPermissions) => Promise<void>;
  addAcompte: (workerId: string, adv: Omit<Acompte, 'id'>) => Promise<void>;
  updateAcompte: (id: string, data: Partial<Omit<Acompte, 'id'>>) => Promise<void>;
  deleteAcompte: (workerId: string, id: string) => Promise<void>;
  addAbsence: (workerId: string, abs: Omit<Absence, 'id'>) => Promise<void>;
  updateAbsence: (id: string, data: Partial<Omit<Absence, 'id'>>) => Promise<void>;
  deleteAbsence: (workerId: string, id: string) => Promise<void>;
  addPayment: (workerId: string, p: Omit<WorkerPaymentRecord, 'id'>) => Promise<void>;
  updatePayment: (id: string, data: Partial<Omit<WorkerPaymentRecord, 'id' | 'kind'>>) => Promise<void>;
  deletePayment: (workerId: string, id: string) => Promise<void>;
  // ---- heures supplémentaires ----
  addOvertime: (data: Omit<WorkerOvertime, 'id' | 'isPaid'>) => Promise<void>;
  updateOvertime: (id: string, data: Partial<WorkerOvertime>) => Promise<void>;
  deleteOvertime: (workerId: string, id: string) => Promise<void>;
  payOvertimes: (workerId: string, ids: string[], date?: string, description?: string) => Promise<void>;
}

/** Plain row update on one of the worker HR tables. */
async function updateRow(table: string, id: string, patch: Record<string, unknown>) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const { error } = await supabase.from(table).update(clean).eq('id', id);
  if (error) throw new Error(`[${table}] ${error.message}`);
}

const overtimePayload = (d: Partial<WorkerOvertime>) => ({
  worker_id: d.workerId,
  date: d.date,
  work_end_hour: d.workEndHour,
  work_end_minute: d.workEndMinute,
  overtime_end_hour: d.overtimeEndHour,
  overtime_end_minute: d.overtimeEndMinute,
  hours: d.hours,
  hourly_rate: d.hourlyRate,
  amount: d.amount,
  description: d.description ?? '',
});

export const useWorkerStore = create<WorkerState>()((set, get) => {
  const reload = async () => set({ workers: await db.workers.list() });

  return {
    workers: [],
    roles: [],

    load: async () => {
      const [workers, roles] = await Promise.all([db.workers.list(), db.roles.list()]);
      set({ workers, roles });
    },

    addWorker: async (w) => {
      const row = await save('workers.create', () => db.workers.create(w));

      // A login account was requested → real row in the Supabase auth table
      if (w.hasAccount && w.email && w.password) {
        await save('workers.account', () =>
          rpc.createWorkerAccount(row.id, w.email!.trim(), w.password!, w.username?.trim() || undefined)
        );
      }
      // permissions are pushed through the dedicated RPC so `profiles` follows
      if (w.permissions && Object.keys(w.permissions).length) {
        await save('workers.permissions', () => rpc.setWorkerPermissions(row.id, w.permissions!));
      }
      await reload();
      return get().workers.find((x) => x.id === row.id) ?? row;
    },

    updateWorker: async (id, data) => {
      const row = await save('workers.update', () => db.workers.update(id, data));

      if (data.hasAccount && data.email && data.password) {
        await save('workers.account', () =>
          rpc.createWorkerAccount(id, data.email!.trim(), data.password!, data.username?.trim() || undefined)
        );
      }
      await reload();
      return get().workers.find((x) => x.id === id) ?? row;
    },

    deleteWorker: async (id) => {
      await save('workers.delete', () => db.workers.remove(id));
      set({ workers: get().workers.filter((w) => w.id !== id) });
    },

    addRole: async (name) => {
      const existing = get().roles.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const row = await save('roles.create', () => db.roles.create(name));
      set({ roles: [...get().roles, row] });
      return row;
    },

    deleteRole: async (id) => {
      await save('roles.delete', () => db.roles.remove(id));
      set({ roles: get().roles.filter((r) => r.id !== id) });
    },

    setPermissions: async (workerId, permissions) => {
      await save('workers.permissions', () => rpc.setWorkerPermissions(workerId, permissions));
      await reload();
    },

    addAcompte: async (workerId, adv) => {
      await save('workers.acompte', () =>
        rpc.addWorkerAcompte(workerId, adv.amount, adv.date, adv.description)
      );
      await reload();
    },

    updateAcompte: async (id, d) => {
      await save('workers.acompte.update', () =>
        updateRow('worker_acomptes', id, { date: d.date, amount: d.amount, description: d.description })
      );
      await reload();
    },

    deleteAcompte: async (workerId, id) => {
      await save('workers.acompte.delete', () => removeRow('worker_acomptes', id));
      await reload();
    },

    addAbsence: async (workerId, abs) => {
      await save('workers.absence', async () => {
        const { error } = await supabase.from('worker_absences').insert({
          worker_id: workerId, date: abs.date, description: abs.description, cost: abs.cost,
        });
        if (error) throw new Error(error.message);
      });
      await reload();
    },

    updateAbsence: async (id, d) => {
      await save('workers.absence.update', () =>
        updateRow('worker_absences', id, { date: d.date, cost: d.cost, description: d.description })
      );
      await reload();
    },

    deleteAbsence: async (_workerId, id) => {
      await save('workers.absence.delete', () => removeRow('worker_absences', id));
      await reload();
    },

    addPayment: async (workerId, p) => {
      await save('workers.payment', () =>
        rpc.payWorkerSalary(workerId, p.amount, p.period, p.date, p.description)
      );
      await reload();
    },

    updatePayment: async (id, d) => {
      await save('workers.payment.update', () =>
        updateRow('worker_payments', id, {
          date: d.date, amount: d.amount, period: d.period, description: d.description,
        })
      );
      await reload();
    },

    deletePayment: async (_workerId, id) => {
      await save('workers.payment.delete', () => removeRow('worker_payments', id));
      await reload();
    },

    addOvertime: async (data) => {
      await save('workers.overtime', () => rpc.addWorkerOvertime(overtimePayload(data)));
      await reload();
    },

    updateOvertime: async (id, data) => {
      await save('workers.overtime.update', () => rpc.updateWorkerOvertime(id, overtimePayload(data)));
      await reload();
    },

    deleteOvertime: async (_workerId, id) => {
      await save('workers.overtime.delete', () => rpc.deleteWorkerOvertime(id));
      await reload();
    },

    payOvertimes: async (workerId, ids, date, description) => {
      await save('workers.overtime.pay', () =>
        rpc.payWorkerOvertimes(workerId, ids, date, description ?? 'Paiement heures supplémentaires')
      );
      await reload();
    },
  };
});
