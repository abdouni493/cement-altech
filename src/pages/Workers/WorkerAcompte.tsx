import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

export function WorkerAcompte({ worker }: { worker: Worker }) {
  const { t, language } = useLanguage();
  const addAcompte = useWorkerStore((s) => s.addAcompte);
  const workers = useWorkerStore((s) => s.workers);
  const current = workers.find((w) => w.id === worker.id) || worker;

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState('');

  const handleAdd = async () => {
    if (amount <= 0) { toast.error('Montant invalide'); return; }
    await addAcompte(worker.id, { date, amount: Number(amount), description });
    toast.success('Acompte enregistré');
    setAmount(0); setDescription('');
  };

  return (
    <div className="space-y-4">
      <div className="bg-vanilla/40 rounded-xl p-4 border border-gold/15 space-y-3">
        <h4 className="font-medium text-text-primary flex items-center gap-2"><Plus size={16} /> {t('newAcompte')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label={t('date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label={`${t('amount')} (DA)`} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <Input label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button variant="gold" onClick={handleAdd}>{t('save')}</Button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-text-secondary mb-2">{t('history')}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">{t('date')}</th><th className="text-right px-3 py-2">{t('amount')}</th><th className="text-left px-3 py-2">{t('description')}</th></tr></thead>
            <tbody>{current.acomptes.map((a) => (
              <tr key={a.id} className="border-t border-gold/10"><td className="px-3 py-2">{formatDate(a.date, language)}</td><td className="px-3 py-2 text-right tabular text-caramel font-medium">{formatCurrency(a.amount)}</td><td className="px-3 py-2 text-text-muted">{a.description}</td></tr>
            ))}</tbody>
          </table>
          {current.acomptes.length === 0 && <p className="text-center text-text-muted py-4">{t('noData')}</p>}
        </div>
      </div>
    </div>
  );
}
