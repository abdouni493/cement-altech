import { useMemo, useState } from 'react';
import { Banknote, Clock, Printer, CheckCircle2, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useWorkerStore } from '@/store/workerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { printOvertimeReceipt } from '@/lib/documents';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Paiement d'un employé.
 *  · onglet « Salaire » : salaire de base − acomptes − absences,
 *  · onglet « Heures supplémentaires » : liste des heures NON PAYÉES ; une fois
 *    réglées elles disparaissent de cet écran et apparaissent dans l'historique.
 */
export function WorkerPayment({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t, language } = useLanguage();
  const { addPayment, deletePayment, payOvertimes } = useWorkerStore();
  const workers = useWorkerStore((s) => s.workers);
  const settings = useSettingsStore((s) => s.settings);
  const current = workers.find((w) => w.id === worker.id) || worker;

  const [tab, setTab] = useState<'salary' | 'overtime'>('salary');

  // ---- salary ----
  const base = current.paymentAmount;
  const totalAcomptes = useMemo(() => current.acomptes.reduce((s, a) => s + a.amount, 0), [current]);
  const totalAbsences = useMemo(() => current.absences.reduce((s, a) => s + a.cost, 0), [current]);
  const computed = Math.max(0, base - totalAcomptes - totalAbsences);

  const [period, setPeriod] = useState('');
  const [net, setNet] = useState<number>(computed);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);

  // ---- overtime ----
  const unpaidOvertimes = useMemo(
    () => (current.overtimes ?? []).filter((o) => !o.isPaid).sort((a, b) => a.date.localeCompare(b.date)),
    [current.overtimes]
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [otDate, setOtDate] = useState(todayISO());
  const selectedList = unpaidOvertimes.filter((o) => selected.includes(o.id));
  const selectedTotal = selectedList.reduce((s, o) => s + o.amount, 0);
  const selectedHours = selectedList.reduce((s, o) => s + o.hours, 0);

  const handlePaySalary = async () => {
    if (net <= 0) { toast.error('Montant invalide'); return; }
    setSaving(true);
    try {
      await addPayment(worker.id, {
        date,
        period: period || formatDate(date, language),
        amount: Number(net),
        description,
        kind: 'salary',
      });
      toast.success('Salaire payé — sortie de caisse enregistrée');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handlePayOvertime = async () => {
    if (selected.length === 0) { toast.error('Sélectionnez au moins une ligne'); return; }
    setSaving(true);
    try {
      const snapshot = selectedList;
      await payOvertimes(worker.id, selected, otDate, `Heures supplémentaires — ${current.fullName}`);
      toast.success('Heures supplémentaires payées');
      // offer the receipt right away
      printOvertimeReceipt(
        {
          workerName: current.fullName,
          paidAt: new Date(otDate).toISOString(),
          amount: snapshot.reduce((s, o) => s + o.amount, 0),
          lines: snapshot.map((o) => ({
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
      setSelected([]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-vanilla/50 rounded-xl p-3 text-sm border border-gold/15 flex items-center justify-between">
        <div>
          <p className="font-semibold text-text-primary">{current.fullName}</p>
          <p className="text-text-muted text-xs">
            {current.paymentType === 'monthly' ? 'Salaire mensuel' : 'Salaire journalier'} ·{' '}
            {formatCurrency(current.paymentAmount)}
          </p>
        </div>
        {unpaidOvertimes.length > 0 && (
          <Badge variant="warning" className="gap-1">
            <Clock size={11} /> {unpaidOvertimes.length} h. sup. à payer
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gold/15">
        {([
          ['salary', 'Salaire'],
          ['overtime', `Heures supplémentaires (${unpaidOvertimes.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all ${
              tab === key ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'salary' ? (
        <div className="space-y-4">
          <Input label="Période" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Ex : Juin 2026" />

          <div className="rounded-xl border border-gold/15 bg-gradient-card p-4 space-y-2 text-sm">
            <Row label="Salaire de base" value={formatCurrency(base)} />
            <Row label="Acomptes déduits" value={`- ${formatCurrency(totalAcomptes)}`} color="text-caramel" />
            <Row label="Absences déduites" value={`- ${formatCurrency(totalAbsences)}`} color="text-rose-deep" />
            <div className="border-t border-gold/15 pt-2 flex justify-between font-bold">
              <span>Net à payer</span>
              <span className="tabular text-pistachio text-lg">{formatCurrency(computed)}</span>
            </div>
          </div>

          <Input
            label="Net à payer (modifiable)" type="number" step="any"
            value={net} onChange={(e) => setNet(Number(e.target.value))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optionnel" />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button variant="gold" onClick={handlePaySalary} disabled={saving}>
              <Banknote size={16} /> {saving ? 'Enregistrement…' : 'Payer le salaire'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {unpaidOvertimes.length === 0 ? (
            <div className="rounded-2xl border border-pistachio/30 bg-pistachio/10 px-4 py-6 text-center">
              <CheckCircle2 size={30} className="text-pistachio mx-auto mb-2" />
              <p className="text-sm font-semibold text-pistachio">
                Toutes les heures supplémentaires de cet employé sont réglées.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">
                  Sélectionnez les heures à régler — une fois payées elles n'apparaîtront plus ici.
                </p>
                <Button
                  size="sm" variant="secondary"
                  onClick={() =>
                    setSelected(selected.length === unpaidOvertimes.length ? [] : unpaidOvertimes.map((o) => o.id))
                  }
                >
                  {selected.length === unpaidOvertimes.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gold/15">
                <table className="w-full text-sm">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 w-10"></th>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-center px-3 py-2">Horaire</th>
                      <th className="text-center px-3 py-2">Durée</th>
                      <th className="text-right px-3 py-2">Taux</th>
                      <th className="text-right px-3 py-2">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaidOvertimes.map((o) => (
                      <tr key={o.id} className="border-t border-gold/10">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={selected.includes(o.id)}
                            onChange={(v) =>
                              setSelected((prev) => (v ? [...prev, o.id] : prev.filter((x) => x !== o.id)))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-xs">{formatDate(o.date, language)}</td>
                        <td className="px-3 py-2 text-center text-xs tabular">
                          {pad(o.workEndHour)}:{pad(o.workEndMinute)} → {pad(o.overtimeEndHour)}:{pad(o.overtimeEndMinute)}
                        </td>
                        <td className="px-3 py-2 text-center tabular">{o.hours.toFixed(2)} h</td>
                        <td className="px-3 py-2 text-right tabular text-text-muted">{formatCurrency(o.hourlyRate)}</td>
                        <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">{formatCurrency(o.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Input label="Date du paiement" type="date" value={otDate} onChange={(e) => setOtDate(e.target.value)} className="max-w-[220px]" />

              <div className="flex items-center justify-between rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3">
                <span className="text-xs text-text-muted">
                  {selected.length} ligne(s) · {selectedHours.toFixed(2)} h
                </span>
                <span className="text-xl font-bold tabular text-gold-dark">{formatCurrency(selectedTotal)}</span>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={onClose} disabled={saving}>Fermer</Button>
                <Button variant="gold" onClick={handlePayOvertime} disabled={saving || selected.length === 0}>
                  <Printer size={16} /> {saving ? 'Enregistrement…' : 'Payer & imprimer le reçu'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Payment history */}
      {current.payments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-text-secondary mb-2">Historique des paiements</h4>
          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Période / motif</th>
                  <th className="text-right px-3 py-2">Montant</th>
                  <th className="text-center px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...current.payments].sort((a, b) => b.date.localeCompare(a.date)).map((p) => (
                  <tr key={p.id} className="border-t border-gold/10">
                    <td className="px-3 py-2 text-xs">{formatDate(p.date, language)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={p.kind === 'overtime' ? 'warning' : 'info'}>
                        {p.kind === 'overtime' ? 'Heures sup.' : 'Salaire'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">{p.period || p.description || '—'}</td>
                    <td className="px-3 py-2 text-right tabular font-bold">{formatCurrency(p.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <Button size="icon" variant="ghost" title="Supprimer" onClick={() => setDeletePaymentId(p.id)}>
                        <Trash2 size={14} className="text-rose-deep" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deletePaymentId}
        onClose={() => setDeletePaymentId(null)}
        onConfirm={() => {
          if (deletePaymentId) {
            void deletePayment(worker.id, deletePaymentId).then(() => toast.success('Paiement supprimé'));
          }
        }}
        title="Supprimer le paiement"
        message="La sortie de caisse sera annulée. Si ce paiement réglait des heures supplémentaires, elles redeviendront « non payées »."
      />
    </div>
  );
}

function Row({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular ${color}`}>{value}</span>
    </div>
  );
}
