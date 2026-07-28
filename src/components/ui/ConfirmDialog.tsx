import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useLanguage } from '@/hooks/useLanguage';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message }: ConfirmDialogProps) {
  const { t } = useLanguage();
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center py-2">
        <div className="h-14 w-14 rounded-full bg-rose-deep/10 flex items-center justify-center mb-4">
          <AlertTriangle size={28} className="text-rose-deep" />
        </div>
        <h3 className="font-display text-lg font-semibold text-text-primary mb-2">
          {title || t('confirm')}
        </h3>
        <p className="text-sm text-text-secondary mb-6">{message || t('deleteConfirm')}</p>
        <div className="flex gap-3 w-full">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
