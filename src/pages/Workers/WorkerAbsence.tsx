import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

export function WorkerAbsence({ worker }: { worker: Worker }) {
  const { t, language } = useLanguage();
  const addAbsence = useWorkerStore((s) => s.addAbsence);
  const workers = useWorkerStore((s) => s.workers);
  const current = workers.find((w) => w.id === worker.id) || worker;

  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState<number>(0);

  const handleAdd = () => {
    addAbsence(worker.id, { date, description, cost: Number(cost) });
    toast.success('Absence enregistrée');
    setDescription(''); setCost(0);
  };

  return (
    <div className="space-y-4">
      <div className="bg-vanilla/40 rounded-xl p-4 border border-gold/15 space-y-3">
        <h4 className="font-medium text-text-primary flex items-center gap-2"><Plus size={16} /> {t('newAbsence')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label={t('date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Input label={`${t('cost')} (DA)`} type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
        </div>
        <Button variant="gold" onClick={handleAdd}>{t('save')}</Button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-text-secondary mb-2">{t('history')}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">{t('date')}</th><th className="text-left px-3 py-2">{t('description')}</th><th className="text-right px-3 py-2">{t('cost')}</th></tr></thead>
            <tbody>{current.absences.map((a) => (
              <tr key={a.id} className="border-t border-gold/10"><td className="px-3 py-2">{formatDate(a.date, language)}</td><td className="px-3 py-2 text-text-muted">{a.description}</td><td className="px-3 py-2 text-right tabular text-rose-deep font-medium">{formatCurrency(a.cost)}</td></tr>
            ))}</tbody>
          </table>
          {current.absences.length === 0 && <p className="text-center text-text-muted py-4">{t('noData')}</p>}
        </div>
      </div>
    </div>
  );
}
