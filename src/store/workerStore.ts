import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Worker, Role, Acompte, Absence, WorkerPaymentRecord, WorkerPermissions } from '@/types';
import { uid } from '@/lib/utils';
import { db, rpc } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

export const INITIAL_ROLES: Role[] = [
  { id: 'role-chef', name: 'Chef de Chantier & Centralier' },
  { id: 'role-caisse', name: 'Agent Caisse & Comptoir' },
  { id: 'role-chauffeur', name: 'Chauffeur Toupie Béton' },
];

export const INITIAL_WORKERS: Worker[] = [
  {
    id: 'wrk-1',
    fullName: 'Mustapha Said',
    birthday: '1988-04-12',
    idCardNumber: '1029384756',
    phone: '0550112233',
    roleId: 'role-chef',
    paymentEnabled: true,
    paymentType: 'monthly',
    paymentAmount: 65000,
    startDate: '2025-01-10',
    hasAccount: true,
    username: 'mustapha',
    email: 'mustapha@cementstore.com',
    password: '123',
    permissions: {
      dashboard: { view: true },
      stock: { view: true, create: true, edit: true, delete: true },
      production: { view: true, create: true, edit: true, delete: true },
    },
    acomptes: [],
    absences: [],
    payments: [],
  },
  {
    id: 'wrk-2',
    fullName: 'Omar Farouk',
    birthday: '1992-09-25',
    idCardNumber: '9876543210',
    phone: '0661223344',
    roleId: 'role-caisse',
    paymentEnabled: true,
    paymentType: 'monthly',
    paymentAmount: 45000,
    startDate: '2025-03-15',
    hasAccount: true,
    username: 'omar',
    email: 'omar@cementstore.com',
    password: '123',
    permissions: {
      pos: { view: true, create: true, pay: true },
      sales: { view: true, create: true, pay: true },
      clients: { view: true, create: true, edit: true },
    },
    acomptes: [],
    absences: [],
    payments: [],
  },
  {
    id: 'wrk-3',
    fullName: 'Youcef Toumi',
    birthday: '1990-11-05',
    idCardNumber: '5647382910',
    phone: '0770445566',
    roleId: 'role-chauffeur',
    paymentEnabled: true,
    paymentType: 'monthly',
    paymentAmount: 50000,
    startDate: '2025-05-01',
    hasAccount: false,
    username: 'youcef',
    email: 'youcef@cementstore.com',
    password: '123',
    permissions: {},
    acomptes: [],
    absences: [],
    payments: [],
  },
];

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
      workers: INITIAL_WORKERS,
      roles: INITIAL_ROLES,

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
    {
      name: 'labochimie-workers',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkerState>;
        return {
          ...current,
          ...p,
          workers: p.workers && p.workers.length ? p.workers : INITIAL_WORKERS,
          roles: p.roles && p.roles.length ? p.roles : INITIAL_ROLES,
        };
      },
    }
  )
);
