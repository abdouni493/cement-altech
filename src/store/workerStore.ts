import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Worker, Role, Acompte, Absence, WorkerPaymentRecord, WorkerPermissions } from '@/types';
import { uid } from '@/lib/utils';
import { db, rpc } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

interface WorkerState {
  workers: Worker[];
  roles: Role[];
  addWorker: (w: Omit<Worker, 'id' | 'permissions' | 'acomptes' | 'absences' | 'payments'> & Partial<Worker>) => Worker;
  updateWorker: (id: string, data: Partial<Worker>) => void;
  deleteWorker: (id: string) => void;
  addRole: (name: string) => Role;
  deleteRole: (id: string) => void;
  setPermissions: (workerId: string, perms: WorkerPermissions) => void;
  addAcompte: (workerId: string, adv: Omit<Acompte, 'id'>) => Acompte;
  deleteAcompte: (workerId: string, id: string) => void;
  addAbsence: (workerId: string, abs: Omit<Absence, 'id'>) => Absence;
  deleteAbsence: (workerId: string, id: string) => void;
  addPayment: (workerId: string, p: Omit<WorkerPaymentRecord, 'id'>) => WorkerPaymentRecord;
  deletePayment: (workerId: string, id: string) => void;
}

export const useWorkerStore = create<WorkerState>()(
  persist(
    (set, get) => ({
      workers: [],
      roles: [],

      addWorker: (w) => {
        const worker: Worker = {
          permissions: {},
          acomptes: [],
          absences: [],
          payments: [],
          ...w,
          // keep the Supabase uuid when the row was created in the database first
          id: w.id || uid('wrk'),
        };
        set({ workers: [...get().workers, worker] });
        return worker;
      },

      updateWorker: (id, data) =>
        set({ workers: get().workers.map((w) => (w.id === id ? { ...w, ...data } : w)) }),

      deleteWorker: (id) => {
        set({ workers: get().workers.filter((w) => w.id !== id) });
        push('workers.delete', () => db.workers.remove(id));
      },

      addRole: (name) => {
        const existing = get().roles.find((r) => r.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const role: Role = { id: uid('role'), name };
        set({ roles: [...get().roles, role] });
        push('roles.create', () => db.roles.create(name), (row) =>
          set({ roles: swapId(get().roles, role.id, row.id) })
        );
        return role;
      },

      deleteRole: (id) => {
        set({ roles: get().roles.filter((r) => r.id !== id) });
        push('roles.delete', () => db.roles.remove(id));
      },

      setPermissions: (workerId, permissions) =>
        set({
          workers: get().workers.map((w) => (w.id === workerId ? { ...w, permissions } : w)),
        }),

      addAcompte: (workerId, adv) => {
        const a: Acompte = { ...adv, id: uid('adv') };
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, acomptes: [a, ...(w.acomptes || [])] } : w
          ),
        });
        // books the matching caisse withdrawal (trg_worker_acompte_caisse)
        push('workers.acompte', () =>
          rpc.addWorkerAcompte(workerId, a.amount, a.date, a.description)
        );
        return a;
      },

      deleteAcompte: (workerId, id) =>
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, acomptes: (w.acomptes || []).filter((ac) => ac.id !== id) } : w
          ),
        }),

      addAbsence: (workerId, abs) => {
        const a: Absence = { ...abs, id: uid('abs') };
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, absences: [a, ...(w.absences || [])] } : w
          ),
        });
        return a;
      },

      deleteAbsence: (workerId, id) =>
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, absences: (w.absences || []).filter((ab) => ab.id !== id) } : w
          ),
        }),

      addPayment: (workerId, p) => {
        const pay: WorkerPaymentRecord = { ...p, id: uid('pay') };
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, payments: [pay, ...(w.payments || [])] } : w
          ),
        });
        // books the matching caisse withdrawal (trg_worker_payment_caisse)
        push('workers.payment', () =>
          rpc.payWorkerSalary(workerId, pay.amount, pay.period, pay.date, pay.description)
        );
        return pay;
      },

      deletePayment: (workerId, id) =>
        set({
          workers: get().workers.map((w) =>
            w.id === workerId ? { ...w, payments: (w.payments || []).filter((pay) => pay.id !== id) } : w
          ),
        }),
    }),
    { name: 'altech-workers' }
  )
);
