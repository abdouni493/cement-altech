import { useMemo, useState } from 'react';
import { Banknote, Clock, Wallet, CalendarX, Printer, Coins, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate } from '@/lib/utils';
import { printOvertimeReceipt } from '@/lib/documents';
import type { Worker } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');
type Tab = 'payments' | 'overtime' | 'acomptes' | 'absences';

/**
 * Historique complet d'un employé : paiements de salaire, heures
 * supplémentaires (payées ou non), acomptes et absences.
 */
export function WorkerHistory({ worker, roleName }: { worker: Worker; roleName?: string }) {
  const { language } = useLanguage();
  const settings = useSettingsStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>('payments');

  const payments = useMemo(
    () => [...worker.payments].sort((a, b) => b.date.localeCompare(a.date)),
    [worker.payments]
  );
  const overtimes = useMemo(
    () => [...(worker.overtimes ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
    [worker.overtimes]
  );
  const acomptes = useMemo(
    () => [...worker.acomptes].sort((a, b) => b.date.localeCompare(a.date)),
    [worker.acomptes]
  );
  const absences = useMemo(
    () => [...worker.absences].sort((a, b) => b.date.localeCompare(a.date)),
    [worker.absences]
  );

  const totals = useMemo(() => {
    const salaryPaid = payments.filter((p) => p.kind !== 'overtime').reduce((s, p) => s + p.amount, 0);
    const overtimePaid = payments.filter((p) => p.kind === 'overtime').reduce((s, p) => s + p.amount, 0);
    const overtimeUnpaid = overtimes.filter((o) => !o.isPaid).reduce((s, o) => s + o.amount, 0);
    const overtimeHours = overtimes.reduce((s, o) => s + o.hours, 0);
    return {
      salaryPaid,
      overtimePaid,
      overtimeUnpaid,
      overtimeHours,
      acomptes: acomptes.reduce((s, a) => s + a.amount, 0),
      absences: absences.reduce((s, a) => s + a.cost, 0),
      grandTotal: salaryPaid + overtimePaid,
    };
  }, [payments, overtimes, acomptes, absences]);

  const printAllOvertime = () => {
    if (overtimes.length === 0) return;
    printOvertimeReceipt(
      {
        workerName: worker.fullName,
        role: roleName,
        paidAt: new Date().toISOString(),
        amount: overtimes.reduce((s, o) => s + o.amount, 0),
        lines: overtimes.map((o) => ({
          date: o.date,
          from: `${pad(o.workEndHour)}:${pad(o.workEndMinute)}`,
          to: `${pad(o.overtimeEndHour)}:${pad(o.overtimeEndMinute)}`,
          hours: o.hours,
          rate: o.hourlyRate,
          amount: o.amount,
          description: o.description,
        })),
      },
      settings
    );
  };

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Tile label="Salaires payés" value={formatCurrency(totals.salaryPaid)} color="text-pistachio" icon={<Banknote size={14} />} />
        <Tile label="H. sup. payées" value={formatCurrency(totals.overtimePaid)} color="text-gold-dark" icon={<Clock size={14} />} />
        <Tile label="H. sup. à payer" value={formatCurrency(totals.overtimeUnpaid)} color="text-rose-deep" icon={<Clock size={14} />} />
        <Tile label="Total heures sup." value={`${totals.overtimeHours.toFixed(2)} h`} icon={<Clock size={14} />} />
        <Tile label="Acomptes" value={formatCurrency(totals.acomptes)} color="text-caramel" icon={<Coins size={14} />} />
        <Tile label="Coût des absences" value={formatCurrency(totals.absences)} color="text-rose-deep" icon={<TrendingDown size={14} />} />
      </div>

      <div className="rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-secondary">Total versé à cet employé</span>
        <span className="text-xl font-bold tabular text-gold-dark">{formatCurrency(totals.grandTotal)}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gold/15 overflow-x-auto">
        {([
          ['payments', `Paiements (${payments.length})`],
          ['overtime', `Heures sup. (${overtimes.length})`],
          ['acomptes', `Acomptes (${acomptes.length})`],
          ['absences', `Absences (${absences.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
              tab === key ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'payments' && (
        payments.length === 0 ? (
          <EmptyState message="Aucun paiement enregistré" icon={<Banknote size={28} />} />
        ) : (
          <Table
            head={['Date', 'Type', 'Période / motif', 'Montant']}
            rows={payments.map((p) => [
              formatDate(p.date, language),
              <Badge key="t" variant={p.kind === 'overtime' ? 'warning' : 'info'}>
                {p.kind === 'overtime' ? 'Heures sup.' : 'Salaire'}
              </Badge>,
              p.period || p.description || '—',
              <span key="a" className="tabular font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
            ])}
          />
        )
      )}

      {tab === 'overtime' && (
        overtimes.length === 0 ? (
          <EmptyState message="Aucune heure supplémentaire" icon={<Clock size={28} />} />
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={printAllOvertime}>
                <Printer size={14} /> Imprimer le relevé
              </Button>
            </div>
            <Table
              head={['Date', 'Horaire', 'Durée', 'Taux', 'Montant', 'Statut']}
              rows={overtimes.map((o) => [
                formatDate(o.date, language),
                `${pad(o.workEndHour)}:${pad(o.workEndMinute)} → ${pad(o.overtimeEndHour)}:${pad(o.overtimeEndMinute)}`,
                `${o.hours.toFixed(2)} h`,
                formatCurrency(o.hourlyRate),
                <span key="a" className="tabular font-bold text-gold-dark">{formatCurrency(o.amount)}</span>,
                <Badge key="s" variant={o.isPaid ? 'success' : 'warning'}>{o.isPaid ? 'Payée' : 'Non payée'}</Badge>,
              ])}
            />
          </div>
        )
      )}

      {tab === 'acomptes' && (
        acomptes.length === 0 ? (
          <EmptyState message="Aucun acompte" icon={<Wallet size={28} />} />
        ) : (
          <Table
            head={['Date', 'Description', 'Montant']}
            rows={acomptes.map((a) => [
              formatDate(a.date, language),
              a.description || '—',
              <span key="a" className="tabular font-bold text-caramel">{formatCurrency(a.amount)}</span>,
            ])}
          />
        )
      )}

      {tab === 'absences' && (
        absences.length === 0 ? (
          <EmptyState message="Aucune absence" icon={<CalendarX size={28} />} />
        ) : (
          <Table
            head={['Date', 'Motif', 'Coût']}
            rows={absences.map((a) => [
              formatDate(a.date, language),
              a.description || '—',
              <span key="a" className="tabular font-bold text-rose-deep">{formatCurrency(a.cost)}</span>,
            ])}
          />
        )
      )}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gold/15">
      <table className="w-full text-sm">
        <thead className="bg-vanilla/60 text-text-secondary">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 ${i >= head.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gold/10">
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-2 text-xs ${j >= r.length - 1 ? 'text-right' : 'text-left'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, color = 'text-text-primary', icon }: {
  label: string; value: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1 leading-tight">{icon}{label}</p>
      <p className={`text-sm font-bold tabular ${color} mt-0.5`}>{value}</p>
    </div>
  );
}
