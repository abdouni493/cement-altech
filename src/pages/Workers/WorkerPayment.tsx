import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

export function WorkerPayment({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t, language } = useLanguage();
  const addPayment = useWorkerStore((s) => s.addPayment);
  const workers = useWorkerStore((s) => s.workers);
  const current = workers.find((w) => w.id === worker.id) || worker;

  const base = current.paymentAmount;
  const totalAcomptes = useMemo(() => current.acomptes.reduce((s, a) => s + a.amount, 0), [current]);
  const totalAbsences = useMemo(() => current.absences.reduce((s, a) => s + a.cost, 0), [current]);
  const computed = Math.max(0, base - totalAcomptes - totalAbsences);

  const [period, setPeriod] = useState('');
  const [net, setNet] = useState<number>(computed);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const handlePay = () => {
    if (net <= 0) { toast.error('Montant invalide'); return; }
    addPayment(worker.id, { date, period: period || formatDate(date, language), amount: Number(net), description });
    toast.success('Paiement enregistré');
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="bg-vanilla/50 rounded-xl p-3 text-sm">
        <p className="font-semibold text-text-primary">{current.fullName}</p>
        <p className="text-text-muted">{current.paymentType === 'monthly' ? t('monthly') : t('daily')}</p>
      </div>

      <Input label="Période" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Ex: Juin 2026" />

      <div className="bg-white rounded-xl border border-gold/15 p-4 space-y-2 text-sm">
        <Row label={`${t('salary')} de base`} value={formatCurrency(base)} />
        <Row label="Acomptes déduits" value={`- ${formatCurrency(totalAcomptes)}`} color="text-caramel" />
        <Row label="Absences déduites" value={`- ${formatCurrency(totalAbsences)}`} color="text-rose-deep" />
        <div className="border-t border-gold/15 pt-2 flex justify-between font-bold">
          <span>{t('netToPay')}</span><span className="tabular text-pistachio text-lg">{formatCurrency(computed)}</span>
        </div>
      </div>

      <Input label={`${t('netToPay')} (éditable)`} type="number" value={net} onChange={(e) => setNet(Number(e.target.value))} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label={t('date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optionnel" />
      </div>

      {current.payments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-text-secondary mb-2">{t('history')}</h4>
          {current.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm py-1.5 border-b border-gold/10">
              <span className="text-text-muted">{formatDate(p.date, language)} — {p.period}</span>
              <span className="tabular font-medium">{formatCurrency(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handlePay}>{t('save')}</Button>
      </div>
    </div>
  );
}

function Row({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return <div className="flex justify-between"><span className="text-text-muted">{label}</span><span className={`tabular ${color}`}>{value}</span></div>;
}
