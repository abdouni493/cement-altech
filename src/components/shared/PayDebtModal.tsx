import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

interface PayDebtModalProps {
  open: boolean;
  onClose: () => void;
  reference: string;
  partyName: string;
  total: number;
  paid: number;
  onPay: (amount: number, description: string) => void;
}

export function PayDebtModal({ open, onClose, reference, partyName, total, paid, onPay }: PayDebtModalProps) {
  const { t } = useLanguage();
  const rest = Math.max(0, total - paid);
  const [amount, setAmount] = useState<number>(rest);
  const [description, setDescription] = useState('');

  const newRest = Math.max(0, rest - (Number(amount) || 0));

  const handlePay = () => {
    const a = Number(amount);
    if (a <= 0) {
      toast.error('Montant invalide');
      return;
    }
    onPay(Math.min(a, rest), description);
    toast.success('Paiement enregistré');
    onClose();
    setAmount(0);
    setDescription('');
  };

  return (
    <Modal open={open} onClose={onClose} title={t('payDebt')} size="sm">
      <div className="space-y-4">
        <div className="bg-vanilla/50 rounded-xl p-4 border border-gold/15 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Facture:</span>
            <span className="font-semibold text-text-primary">{reference} — {partyName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">{t('total')}:</span>
            <span className="tabular">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">{t('paid')}:</span>
            <span className="tabular text-pistachio">{formatCurrency(paid)}</span>
          </div>
          <div className="flex justify-between border-t border-gold/15 pt-1.5">
            <span className="text-text-muted">{t('restAmount')}:</span>
            <span className="tabular text-rose-deep font-bold">{formatCurrency(rest)}</span>
          </div>
        </div>

        <Input
          label={`${t('amount')} (DA)`}
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          autoFocus
        />
        <Input label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optionnel" />

        <div className="flex justify-between items-center bg-gold/5 rounded-xl p-3 text-sm">
          <span className="text-text-muted">Nouveau reste:</span>
          <span className="tabular font-bold text-text-primary">{formatCurrency(newRest)}</span>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="gold" onClick={handlePay}>{t('confirm')}</Button>
        </div>
      </div>
    </Modal>
  );
}
