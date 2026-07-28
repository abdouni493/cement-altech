import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Switch';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { toast } from '@/components/ui/Toast';
import { PERMISSION_MODULES, type Worker, type WorkerPermissions as PermsType } from '@/types';
import type { TranslationKey } from '@/lib/i18n';

interface WorkerPermissionsProps {
  worker: Worker;
  onClose: () => void;
}

// Which actions apply to each module
const moduleActions: Record<string, Array<'view' | 'create' | 'edit' | 'delete' | 'pay'>> = {
  dashboard: ['view'],
  stock: ['view', 'create', 'edit', 'delete'],
  purchase: ['view', 'create', 'edit', 'delete', 'pay'],
  production: ['view', 'create', 'edit', 'delete'],
  comptoir: ['view', 'delete'],
  pos: ['view', 'create'],
  sales: ['view', 'create', 'edit', 'delete', 'pay'],
  clients: ['view', 'create', 'edit', 'delete'],
  suppliers: ['view', 'create', 'edit', 'delete'],
  workers: ['view', 'create', 'edit', 'delete'],
  expenses: ['view', 'create', 'edit', 'delete'],
  caisse: ['view', 'create', 'edit', 'delete'],
  reports: ['view'],
  settings: ['view'],
};

const actionLabels: Record<string, string> = {
  view: 'Voir', create: 'Créer', edit: 'Modifier', delete: 'Supprimer', pay: 'Payer',
};

export function WorkerPermissions({ worker, onClose }: WorkerPermissionsProps) {
  const { t } = useLanguage();
  const setPermissions = useWorkerStore((s) => s.setPermissions);
  const [perms, setPerms] = useState<PermsType>(JSON.parse(JSON.stringify(worker.permissions || {})));

  const toggle = (module: string, action: string, value: boolean) => {
    setPerms((prev) => {
      const next = { ...prev };
      next[module] = { ...next[module], [action]: value };
      // turning off view turns off all
      if (action === 'view' && !value) next[module] = { view: false };
      // turning on any sub-action turns on view
      if (action !== 'view' && value) next[module] = { ...next[module], view: true };
      return next;
    });
  };

  const handleSave = () => {
    setPermissions(worker.id, perms);
    toast.success('Permissions enregistrées');
    onClose();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">Sélectionnez les interfaces accessibles pour <strong>{worker.fullName}</strong></p>
      <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
        {PERMISSION_MODULES.map((module) => {
          const actions = moduleActions[module] || ['view'];
          const modulePerms = perms[module] || {};
          return (
            <div key={module} className="bg-vanilla/40 rounded-xl p-3 border border-gold/10">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-text-primary text-sm">{t(module as TranslationKey)}</span>
                <Checkbox checked={!!modulePerms.view} onChange={(v) => toggle(module, 'view', v)} label="Activer" />
              </div>
              {modulePerms.view && actions.length > 1 && (
                <div className="flex flex-wrap gap-3 pl-1 pt-1 border-t border-gold/10">
                  {actions.filter((a) => a !== 'view').map((action) => (
                    <Checkbox key={action} checked={!!modulePerms[action]} onChange={(v) => toggle(module, action, v)} label={actionLabels[action]} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleSave}>{t('save')}</Button>
      </div>
    </div>
  );
}
