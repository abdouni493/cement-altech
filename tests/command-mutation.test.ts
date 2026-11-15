import { describe, expect, it } from 'vitest';
import { toCommandMutation } from '../src/lib/db';

describe('committed command response mapping', () => {
  it('keeps duplicate product line IDs and server order rather than joining by product name', () => {
    const result = toCommandMutation({
      command: { id: 'cmd', reference: 'CMD-2026-1000', client_name: 'Client', command_items: [
        { id: 'second', position: 1, product_name: 'Ciment', quantity: '3', unit_price: '20', total_price: '60' },
        { id: 'first', position: 0, product_name: 'Ciment', quantity: '2', unit_price: '10', total_price: '20' },
      ] },
      delivery: { id: 'bl', command_id: 'cmd', reference: 'BL-CMD-2026-1000-100', sale_id: 'invoice', command_delivery_items: [
        { id: 'di1', command_item_id: 'first', product_name: 'Ciment', quantity: '1' },
        { id: 'di2', command_item_id: 'second', product_name: 'Ciment', quantity: '2' },
      ] }, deliveries: [], sales: [], client: null, credit_applied: '12.50', replayed: true,
    });
    expect(result.command.items.map(line => line.id)).toEqual(['first', 'second']);
    expect(result.command.items.map(line => line.unitPrice)).toEqual([10, 20]);
    expect(result.delivery?.items.map(line => line.commandItemId)).toEqual(['first', 'second']);
    expect(result.delivery?.saleId).toBe('invoice');
    expect(result.creditApplied).toBe(12.5);
    expect(result.replayed).toBe(true);
  });
});
