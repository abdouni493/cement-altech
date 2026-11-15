import { describe, expect, it, vi } from 'vitest';
import { bindOperation, newOperation, operationConfirmed, operationRpcReturned, operationFailed } from '../src/lib/commandOperation';

describe('durable command action tickets', () => {
  it('restores an unresolved ticket across remounts and isolates different cashiers', () => {
    const values = new Map<string,string>();
    vi.stubGlobal('sessionStorage', {getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
    try {
      const original = newOperation('command:cashier-a');
      bindOperation(original, {total_amount:10});
      expect(newOperation('command:cashier-a')).toMatchObject({id:original.id,payload:original.payload});
      expect(newOperation('command:cashier-b').id).not.toBe(original.id);
      operationFailed(original, new Error('Failed to fetch'));
      expect(newOperation('command:cashier-a').id).toBe(original.id);
      operationConfirmed(original,'command');
      expect(newOperation('command:cashier-a').id).not.toBe(original.id);
    } finally { vi.unstubAllGlobals(); }
  });
  it('permits correcting a confirmed database rejection without replaying an ambiguous network error', () => {
    const ticket = newOperation();
    bindOperation(ticket,{quantity:100});
    const id=ticket.id;
    operationFailed(ticket, {code:'P0001',message:'Stock insuffisant'});
    expect(ticket.id).not.toBe(id);
    expect(()=>bindOperation(ticket,{quantity:1})).not.toThrow();
  });
  it('keeps the same operation and first start timestamp across an ambiguous-response retry', () => {
    const ticket = newOperation();
    const initialId = ticket.id;
    bindOperation(ticket, { command_id: 'a', items: [{ quantity: 1 }] });
    const started = ticket.startedAt;
    bindOperation(ticket, { command_id: 'a', items: [{ quantity: 1 }] });
    expect(ticket.id).toBe(initialId);
    expect(ticket.startedAt).toBe(started);
    expect(newOperation().id).not.toBe(initialId);
  });

  it('rejects editing a pending action rather than reusing a possibly committed operation', () => {
    const ticket = newOperation();
    bindOperation(ticket, { requested_credit: 10, cash_paid: 20 });
    expect(() => bindOperation(ticket, { requested_credit: 20, cash_paid: 20 })).toThrow(/mêmes valeurs/);
  });

  it('records separate RPC, confirmation, and print-ready intervals without payload data', () => {
    const clock = vi.spyOn(performance, 'now');
    const target = globalThis as typeof globalThis & { __commandTimings?: unknown[] };
    target.__commandTimings = [];
    const ticket = newOperation();
    clock.mockReturnValueOnce(10).mockReturnValueOnce(30).mockReturnValueOnce(35);
    bindOperation(ticket, { client_name: 'Private fixture name' });
    operationRpcReturned(ticket);
    operationConfirmed(ticket, 'delivery');
    expect(target.__commandTimings).toEqual([{ operationId: ticket.id, kind: 'delivery', rpcMs: 20, confirmationMs: 5, printReadyMs: 25 }]);
    expect(JSON.stringify(target.__commandTimings)).not.toContain('Private fixture');
    clock.mockRestore();
  });
});
