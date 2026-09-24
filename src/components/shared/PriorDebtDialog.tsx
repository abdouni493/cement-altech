import { AlertTriangle, CalendarClock, History, Printer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDate } from '@/lib/utils';
import { dayBefore } from '@/lib/statementPrint';
import type { LedgerSlice } from '@/lib/ledger';

/* ============================================================================
 *  DETTE ANTERIEURE A LA PERIODE — ALERTE AVANT IMPRESSION
 * ----------------------------------------------------------------------------
 *  L'operateur imprime du 1er mars au 31 mars, mais le tiers avait deja une
 *  dette le 1er janvier : elle n'apparait pas dans la periode choisie. Avant
 *  d'imprimer, l'application le PREVIENT, detaille cette dette (anciennes
 *  dettes datees, operations et versements anterieurs) et lui demande s'il
 *  veut l'ajouter au document — au-dessus du total, avec sa date.
 * ========================================================================== */

export function PriorDebtDialog({
  open, onClose, onDecide, partyName, slice, kind,
}: {
  open: boolean;
  onClose: () => void;
  onDecide: (include: boolean) => void;
  partyName: string;
  slice: LedgerSlice | null;
  kind: 'client' | 'supplier';
}) {
  if (!slice) return null;
  const until = formatDate(dayBefore(slice.from));
  const isDebt = slice.priorBalance > 0;
  const who = kind === 'client' ? 'Ce client' : 'Ce fournisseur';

  return (
    <Modal open={open} onClose={onClose} title="Dette antérieure à la période" size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-caramel/40 bg-caramel/10 px-4 py-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-caramel" />
          <div className="text-sm">
            <p className="font-bold text-text-primary">
              {who} {isDebt ? 'avait déjà une dette' : 'avait déjà un acompte'} avant le {formatDate(slice.from)}.
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              {partyName} — {isDebt ? 'cette dette' : 'cet acompte'} n&rsquo;est pas compris dans la période du{' '}
              {formatDate(slice.from)} au {formatDate(slice.to)}. Voulez-vous l&rsquo;ajouter à cette impression ?
              Il apparaîtra au-dessus du total, avec sa date.
            </p>
          </div>
        </div>

        {slice.priorOldDebts.length > 0 && (
          <div className="rounded-xl border border-gold/20 bg-vanilla/40 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gold-dark">
              <History size={13} /> Anciennes dettes avant la période
            </p>
            {slice.priorOldDebts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 border-b border-gold/10 py-1.5 text-xs last:border-0">
                <span className="text-text-secondary">
                  <b className="text-text-primary">{formatDate(d.date)}</b>
                  {d.description ? ` — ${d.description}` : ' — Ancienne dette'}
                </span>
                <span className="shrink-0 text-right tabular">
                  <b className="text-text-primary">{formatCurrency(d.amount)}</b>
                  <span className="block text-[10px] text-text-muted">reste aujourd&rsquo;hui {formatCurrency(d.restNow)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Figure label={`Opérations avant le ${formatDate(slice.from)}`} value={formatCurrency(slice.priorDebitsTotal)} />
          <Figure label={`Versements avant le ${formatDate(slice.from)}`} value={formatCurrency(slice.priorCreditsTotal)} />
          <Figure
            label={isDebt ? `Dette antérieure au ${until}` : `Acompte antérieur au ${until}`}
            value={formatCurrency(Math.abs(slice.priorBalance))}
            strong
          />
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <CalendarClock size={13} className="text-gold" />
          Le reste imprimé sera alors le solde réel du compte au {formatDate(slice.to)}.
        </p>

        <div className="flex flex-col gap-2 border-t border-gold/15 pt-4 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={() => onDecide(false)}>
            <Printer size={15} /> Imprimer sans
          </Button>
          <Button variant="gold" className="flex-1 font-bold" onClick={() => onDecide(true)}>
            <Printer size={15} /> Oui, ajouter {isDebt ? 'la dette antérieure' : "l'acompte antérieur"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-center">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${strong ? 'text-rose-deep' : 'text-text-primary'}`}>{value}</p>
    </div>
  );
}
