import { Eye, Pencil, Trash2, User, Barcode } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, daysUntil } from '@/lib/utils';
import type { Product } from '@/types';

interface ProductCardProps {
  product: Product;
  index: number;
  marque: string;
  category: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}

export function ProductCard({ product, index, marque, category, onView, onEdit, onDelete, canEdit, canDelete }: ProductCardProps) {
  const { t, language } = useLanguage();
  const isLow = product.currentQuantity <= product.minAlertQuantity;
  const expDays = daysUntil(product.expirationDate);
  const expSoon = expDays !== null && expDays <= 7 && expDays >= 0;
  const u = product.unitEnabled && product.unit ? ` ${product.unit}` : '';

  return (
    <Card index={index} hoverable className="flex flex-col border border-gold/20 hover:border-gold/50 transition-all duration-300 shadow-card hover:shadow-hover rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2 pb-2.5 border-b border-gold/10">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-text-primary text-base truncate" title={product.name}>{product.name}</h3>
          <p className="text-xs text-text-muted mt-0.5 font-medium flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold"></span>
            {marque}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="info" className="bg-pistachio/15 text-pistachio border border-pistachio/30">{category}</Badge>
          {product.unitEnabled && product.unit && (
            <Badge variant="warning" className="bg-caramel/15 text-caramel border border-caramel/30 text-[10px] px-1.5 py-0.5">
              {t('unit')}: {product.unit}
            </Badge>
          )}
        </div>
      </div>

      <div className="bg-vanilla/40 rounded-xl p-3 space-y-2.5 my-2 text-xs border border-gold/10">
        <div className="flex justify-between items-center">
          <span className="text-text-muted">{t('principalQty')}</span>
          <span className="tabular font-semibold text-text-secondary">{product.principalQuantity}{u}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-text-muted font-medium">{t('currentQty')}</span>
          <span className={`tabular font-bold text-sm ${isLow ? 'text-rose-deep animate-pulse font-extrabold' : 'text-pistachio'}`}>
            {product.currentQuantity}{u}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-text-muted">{t('minAlertQty')}</span>
          <span className="tabular text-text-secondary">{product.minAlertQuantity}{u}</span>
        </div>
        {product.expirationEnabled && product.expirationDate && (
          <div className="flex justify-between items-center border-t border-gold/10 pt-2 mt-2">
            <span className="text-text-muted">{t('expiration')}</span>
            <span className={`tabular font-medium ${expSoon ? 'text-caramel font-semibold animate-pulse' : 'text-text-secondary'}`}>
              {formatDate(product.expirationDate, language)}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-1 mb-3">
        <div>
          {isLow && <Badge variant="danger" className="bg-rose-deep/15 text-rose-deep border border-rose-deep/30 text-[10px]">{t('lowStock')}</Badge>}
        </div>
        <div className="text-right">
          <span className="text-[10px] text-text-muted block leading-none mb-0.5">{t('purchasePrice')}</span>
          <span className="text-sm tabular text-gold font-bold">
            {formatCurrency(product.purchasePrice)}
            {product.unitEnabled && product.unit ? <span className="text-xs text-text-muted font-normal">/{product.unit}</span> : null}
          </span>
        </div>
      </div>

      <div className="bg-vanilla/50 border border-gold/15 rounded-xl px-3 py-2 flex items-center justify-between text-xs mb-3 text-text-secondary">
        <span className="flex items-center gap-1.5 font-medium text-text-muted">
          <Barcode size={14} className="text-gold" />
          <span>Code-barres:</span>
        </span>
        <span className="font-mono font-bold tracking-wider text-text-primary bg-gold/10 px-2 py-0.5 rounded border border-gold/20">{product.barcode}</span>
      </div>

      {product.createdBy && (
        <p className="text-[10px] text-text-muted flex items-center gap-1 mb-3">
          <User size={10} className="text-gold" /> {t('createdBy')}: {product.createdBy}
        </p>
      )}

      <div className="flex gap-2 mt-auto pt-2 border-t border-gold/10">
        <Button size="sm" variant="liver" className="flex-1 text-xs" onClick={onView}>
          <Eye size={13} /> {t('view')}
        </Button>
        {canEdit && (
          <Button size="sm" variant="liver" className="flex-1 text-xs" onClick={onEdit}>
            <Pencil size={13} /> {t('edit')}
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="px-2.5 hover:bg-rose-deep/10" onClick={onDelete}>
            <Trash2 size={13} className="text-rose-deep" />
          </Button>
        )}
      </div>
    </Card>
  );
}
