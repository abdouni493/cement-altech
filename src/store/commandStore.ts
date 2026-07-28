import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db, rpc } from '@/lib/db';
import { push } from '@/lib/persist';

export interface CommandItem {
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sellByUnit?: boolean;
  sellUnit?: string;
  ficheTechnicId?: string;
}

export type CommandLine = CommandItem;

export interface Command {
  id: string;
  reference: string;
  createdAt: string;
  receiveDate: string;
  receiveHour: string;
  receiveMinute: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  items: CommandItem[];
  totalAmount: number;
  advancePaid: number;
  paidAmount: number;
  restAmount: number;
  status: 'pending' | 'finalised' | 'cancelled';
  notes?: string;
  createdBy: string;
}

export type AddCommandInput = Omit<Command, 'id' | 'reference' | 'createdAt' | 'paidAmount' | 'restAmount' | 'status' | 'createdBy' | 'advancePaid'> & {
  createdBy?: string;
  advancePaid?: number;
};

interface CommandState {
  commands: Command[];
  addCommand: (c: AddCommandInput) => Command;
  updateCommand: (id: string, data: Partial<Command>) => void;
  finaliseCommand: (id: string) => void;
  payDebt: (commandId: string, amount: number, date?: string) => void;
  updateStatus: (commandId: string, status: Command['status']) => void;
  deleteCommand: (id: string) => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      commands: [],
      addCommand: (data) => {
        const count = get().commands.length + 1;
        const ref = `CMD-${new Date().getFullYear()}-${String(count).padStart(3, '0')}`;
        const advance = data.advancePaid ?? (data as any).paidAmount ?? 0;
        const restAmount = Math.max(0, data.totalAmount - advance);
        const cmd: Command = {
          ...data,
          id: uid('cmd'),
          reference: ref,
          createdAt: new Date().toISOString(),
          advancePaid: advance,
          paidAmount: advance,
          restAmount,
          status: 'pending',
          createdBy: data.createdBy || getCurrentUsername(),
        };
        set({ commands: [cmd, ...get().commands] });

        push(
          'commands.create',
          () =>
            rpc.createCommand({
              client_id: cmd.clientId,
              client_name: cmd.clientName,
              client_phone: cmd.clientPhone ?? null,
              receive_date: cmd.receiveDate || null,
              receive_hour: cmd.receiveHour,
              receive_minute: cmd.receiveMinute,
              total_amount: cmd.totalAmount,
              advance_paid: cmd.advancePaid,
              notes: cmd.notes ?? null,
              items: cmd.items.map((i) => ({
                product_id: i.productId ?? null,
                fiche_technic_id: i.ficheTechnicId ?? null,
                product_name: i.productName,
                quantity: i.quantity,
                unit_price: i.unitPrice,
                total_price: i.totalPrice,
                sell_by_unit: i.sellByUnit ?? false,
                sell_unit: i.sellUnit ?? null,
              })),
            }),
          (row: { id: string; reference: string }) =>
            set({
              commands: get().commands.map((c) =>
                c.id === cmd.id ? { ...c, id: row.id, reference: row.reference || c.reference } : c
              ),
            })
        );
        return cmd;
      },

      updateCommand: (id, data) =>
        set({ commands: get().commands.map((c) => (c.id === id ? { ...c, ...data } : c)) }),

      finaliseCommand: (id) => {
        push('commands.finalise', () => rpc.setCommandStatus(id, 'finalised'));
        set({ commands: get().commands.map((c) => (c.id === id ? { ...c, status: 'finalised' } : c)) });
      },

      payDebt: (commandId, amount) => {
        push('commands.pay', () => rpc.payCommand(commandId, amount));
        set({
          commands: get().commands.map((cmd) => {
            if (cmd.id !== commandId) return cmd;
            const newPaid = Math.min(cmd.totalAmount, cmd.paidAmount + amount);
            const newRest = Math.max(0, cmd.totalAmount - newPaid);
            return { ...cmd, paidAmount: newPaid, restAmount: newRest };
          }),
        });
      },

      updateStatus: (commandId, status) => {
        push('commands.status', () => rpc.setCommandStatus(commandId, status));
        set({
          commands: get().commands.map((c) => (c.id === commandId ? { ...c, status } : c)),
        });
      },

      deleteCommand: (id) => {
        set({ commands: get().commands.filter((c) => c.id !== id) });
        push('commands.delete', () => db.commands.remove(id));
      },
    }),
    { name: 'altech-commands' }
  )
);
