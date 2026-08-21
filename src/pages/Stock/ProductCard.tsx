import { Eye, Pencil, Trash2, User, Ruler, AlertTriangle, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDate, daysUntil } from '@/lib/utils';
import type { Product } from '@/types';

interface ProductCardProps {
  product: Product;
  index: number;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}

export function ProductCard({ product, index, onView, onEdit, onDelete, canEdit, canDelete }: ProductCardProps) {
  const isLow = product.currentQuantity <= product.minAlertQuantity;
  const isOut = product.currentQuantity <= 0;
  const expDays = daysUntil(product.expirationDate ?? null);
  const expSoon = expDays !== null && expDays <= 7 && expDays >= 0;
  const unit = product.unit || '';
  const u = unit ? ` ${unit}` : '';
  const stockValue = product.currentQuantity * product.purchasePrice;
  const fillPct = product.minAlertQuantity > 0
    ? Math.min(100, (product.currentQuantity / (product.minAlertQuantity * 3)) * 100)
    : Math.min(100, product.currentQuantity > 0 ? 100 : 0);

  return (
    <Card
      index={index}
      hoverable
      className={`flex flex-col rounded-2xl p-4 border transition-all duration-300 ${
        isOut ? 'border-rose-deep/40' : isLow ? 'border-caramel/40' : 'border-gold/20 hover:border-gold/50'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3 pb-3 border-b border-gold/10">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-text-primary text-base truncate" title={product.name}>
            {product.name}
          </h3>
          {product.description && (
            <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1" title={product.description}>
              {product.description}
            </p>
          )}
        </div>
        {unit && (
          <Badge variant="warning" className="shrink-0 gap-1 bg-caramel/15 text-caramel border border-caramel/30">
            <Ruler size={10} /> {unit}
          </Badge>
        )}
      </div>

      {/* Current stock + gauge */}
      <div className="mb-3">
        <div className="flex items-end justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wider font-bold text-text-muted">Stock actuel</span>
          <span className={`tabular font-extrabold text-xl leading-none ${
            isOut ? 'text-rose-deep' : isLow ? 'text-caramel' : 'text-pistachio'
          }`}>
            {product.currentQuantity}
            <span className="text-xs font-semibold text-text-muted ml-1">{unit}</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${fillPct}%` }}
            transition={{ delay: index * 0.04, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className={`h-full rounded-full ${
              isOut ? 'bg-rose-deep' : isLow ? 'bg-caramel' : 'bg-gradient-mint'
            }`}
          />
        </div>
      </div>

      {/* Figures */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Tile label="Seuil d'alerte" value={`${product.minAlertQuantity}${u}`} />
        <Tile label="Total entré" value={`${product.principalQuantity}${u}`} />
        <Tile
          label={unit ? `Prix d'achat / ${unit}` : "Prix d'achat"}
          value={formatCurrency(product.purchasePrice)}
          accent="text-gold-dark"
        />
        <Tile label="Valeur du stock" value={formatCurrency(stockValue)} accent="text-lavender-deep" />
      </div>

      {/* Alerts */}
      <div className="flex flex-wrap gap-1.5 mb-3 min-h-[22px]">
        {isOut && (
          <motion.span animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Rupture de stock</Badge>
          </motion.span>
        )}
        {!isOut && isLow && (
          <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.8, repeat: Infinity }}>
            <Badge variant="warning" className="gap-1"><AlertTriangle size={10} /> Stock faible</Badge>
          </motion.span>
        )}
        {!isLow && <Badge variant="success" className="gap-1"><TrendingUp size={10} /> Stock sain</Badge>}
        {product.expirationEnabled && product.expirationDate && (
          <Badge variant={expSoon ? 'danger' : 'neutral'}>
            Péremption : {formatDate(product.expirationDate, 'fr')}
          </Badge>
        )}
      </div>

      {product.createdBy && (
        <p className="text-[10px] text-text-muted flex items-center gap-1 mb-3">
          <User size={10} className="text-gold" /> Créé par {product.createdBy}
        </p>
      )}

      <div className="flex gap-2 mt-auto pt-2 border-t border-gold/10">
        <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={onView}>
          <Eye size={13} /> Détails
        </Button>
        {canEdit && (
          <Button size="sm" variant="gold" className="flex-1 text-xs" onClick={onEdit}>
            <Pencil size={13} /> Modifier
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

function Tile({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gold/10 bg-vanilla/40 px-2.5 py-2">
      <p className="text-[10px] text-text-muted leading-tight">{label}</p>
      <p className={`text-xs font-bold tabular ${accent} mt-0.5`}>{value}</p>
    </div>
  );
}
