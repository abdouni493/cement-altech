/** A ticket belongs to one operator action, including retries after a lost response. */
export interface OperationTicket {
  id: string;
  storageKey?: string;
  payload?: string;
  startedAt?: number;
  rpcReturnedAt?: number;
}
export const newOperation = (scope?: string): OperationTicket => {
  const storageKey = scope ? `altech-pending-operation:${scope}` : undefined;
  if (storageKey) try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored?.id && typeof stored.payload === 'string') return { id: stored.id, payload: stored.payload, storageKey };
  } catch { /* use an in-memory ticket */ }
  return { id: crypto.randomUUID(), storageKey };
};

export function bindOperation(ticket: OperationTicket, payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (ticket.payload !== undefined && ticket.payload !== serialized) {
    throw new Error('Une tentative est déjà en attente. Réessayez avec les mêmes valeurs pour vérifier son résultat avant de créer un autre document.');
  }
  ticket.payload = serialized;
  if (ticket.storageKey) try { sessionStorage.setItem(ticket.storageKey, JSON.stringify({ id: ticket.id, payload: serialized })); } catch { /* ticket survives while mounted */ }
  ticket.startedAt ??= performance.now();
  performance.mark(`command:${ticket.id}:rpc-start`);
}

export function operationRpcReturned(ticket: OperationTicket): void {
  ticket.rpcReturnedAt = performance.now();
  performance.mark(`command:${ticket.id}:rpc-return`);
}

/** Inspect window.__commandTimings in a benchmark; no business data or credentials. */
export function operationConfirmed(ticket: OperationTicket, kind: 'command' | 'delivery'): void {
  clearOperation(ticket);
  const confirmedAt = performance.now();
  const sample = {
    operationId: ticket.id, kind,
    rpcMs: (ticket.rpcReturnedAt ?? confirmedAt) - (ticket.startedAt ?? confirmedAt),
    confirmationMs: confirmedAt - (ticket.rpcReturnedAt ?? confirmedAt),
    printReadyMs: confirmedAt - (ticket.startedAt ?? confirmedAt),
  };
  const target = globalThis as typeof globalThis & { __commandTimings?: typeof sample[] };
  target.__commandTimings = [...(target.__commandTimings ?? []).slice(-199), sample];
  performance.mark(`command:${ticket.id}:print-ready`);
}

export function operationFailed(ticket: OperationTicket, error: unknown): void {
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as Error)?.message ?? '';
  // A PostgreSQL error is a rolled-back transaction. Transport failures remain unresolved.
  if (/^[0-9A-Z]{5}$/.test(code) || /PGRST20[2-5]|Could not find the function|statement timeout|canceling statement/i.test(message)) {
    clearOperation(ticket);
    ticket.id = crypto.randomUUID(); ticket.payload = undefined; ticket.startedAt = undefined;
  }
}
export function clearOperation(ticket: OperationTicket): void {
  if (ticket.storageKey) try { sessionStorage.removeItem(ticket.storageKey); } catch { /* memory ticket remains */ }
}
