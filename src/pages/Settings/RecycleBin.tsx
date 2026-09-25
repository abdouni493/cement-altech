import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, RotateCcw, Eye, RefreshCw, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { recycleBin, type RecycleRow } from '@/lib/db';
import { formatDateTime } from '@/lib/utils';

const TABLE_LABELS: Record<string, string> = {
  products: 'Produit', marques: 'Marque', categories: 'Catégorie', units: 'Unité',
  suppliers: 'Fournisseur', clients: 'Client', client_debts: 'Dette client',
  client_debt_versements: 'Versement de dette', client_payments: 'Versement client',
  supplier_payments: 'Règlement fournisseur', party_old_debts: 'Ancienne dette',
  party_credit_refunds: 'Remboursement d\'avance',
  purchases: 'Achat', purchase_lines: 'Ligne d\'achat', purchase_payments: 'Paiement d\'achat',
  purchase_orders: 'Bon de commande', purchase_order_items: 'Ligne de bon de commande',
  sales: 'Vente', sale_lines: 'Ligne de vente', sale_payments: 'Paiement de vente',
  commands: 'Commande', command_items: 'Ligne de commande', command_payments: 'Versement de commande',
  command_deliveries: 'Livraison', command_delivery_items: 'Ligne de livraison',
  command_delivery_consumptions: 'Consommation de livraison',
  command_adjustments: 'Compte rendu', command_adjustment_lines: 'Ligne de compte rendu',
  productions: 'Production', production_categories: 'Catégorie de production',
  production_used_products: 'Produit utilisé', fiche_technics: 'Fiche technique',
  fiche_technic_lines: 'Ligne de fiche technique', fiche_categories: 'Catégorie de fiche',
  comptoir_items: 'Article comptoir', destructions: 'Destruction',
  workers: 'Employé', roles: 'Rôle', worker_acomptes: 'Acompte', worker_absences: 'Absence',
  worker_payments: 'Paiement de salaire', worker_overtimes: 'Heures supplémentaires',
  expenses: 'Dépense', expense_categories: 'Catégorie de dépense',
  caisse_transactions: 'Opération de caisse', caisse_categories: 'Catégorie de caisse',
  caisse_reports: 'Rapport de caisse', document_titles: 'Titre de document',
  stock_movements: 'Mouvement de stock',
};
const tableLabel = (t: string) => TABLE_LABELS[t] ?? t;

const NAME_KEYS = ['name', 'full_name', 'title', 'label', 'reference', 'invoice_number', 'number', 'code', 'description', 'note'];
const AMOUNT_KEYS = ['total', 'amount', 'total_amount', 'montant', 'cost', 'price'];

function summarize(d: Record<string, unknown>): string {
  const parts: string[] = [];
  const name = NAME_KEYS.map((k) => d[k]).find((v) => typeof v === 'string' && v.trim());
  if (name) parts.push(String(name));
  const amount = AMOUNT_KEYS.map((k) => d[k]).find((v) => v !== null && v !== undefined && v !== '');
  if (amount !== undefined) parts.push(`${Number(amount).toLocaleString('fr-FR')} DA`);
  const date = d.date ?? d.sale_date ?? d.purchase_date;
  if (typeof date === 'string') parts.push(date.slice(0, 10));
  return parts.join(' · ') || String(d.id ?? '');
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface Group {
  txId: number;
  deletedAt: string;
  deletedBy: string;
  main: RecycleRow;
  rows: RecycleRow[];
}

// La ligne « principale » : la première qui n'est pas une ligne de détail.
const DETAIL = new Set([
  'command_items', 'sale_lines', 'purchase_lines', 'purchase_order_items', 'fiche_technic_lines',
  'command_delivery_items', 'command_delivery_consumptions', 'command_adjustment_lines',
  'production_used_products', 'stock_movements', 'caisse_transactions',
]);

export function RecycleBin() {
  const [rows, setRows] = useState<RecycleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Group | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await recycleBin.list());
      setMissing(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (/Could not find the function|PGRST202|does not exist/i.test(msg)) setMissing(true);
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<number, RecycleRow[]>();
    rows.forEach((r) => { const l = map.get(r.tx_id) ?? []; l.push(r); map.set(r.tx_id, l); });
    const list = [...map.entries()].map(([txId, rs]) => {
      rs.sort((a, b) => a.id - b.id);
      const main = rs.find((r) => !DETAIL.has(r.table_name)) ?? rs[0];
      return { txId, rows: rs, main, deletedAt: rs[0].deleted_at, deletedBy: rs[0].deleted_by_name };
    });
    list.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((g) =>
      `${tableLabel(g.main.table_name)} ${summarize(g.main.data)} ${g.deletedBy}`.toLowerCase().includes(q));
  }, [rows, query]);

  const restore = async (g: Group) => {
    if (!window.confirm(`Restaurer « ${tableLabel(g.main.table_name)} — ${summarize(g.main.data)} » ?`)) return;
    setBusy(g.txId);
    try {
      await recycleBin.restore(g.txId);
      toast.success('Élément restauré — rechargement...');
      setDetail(null);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card index={0}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-rose-deep">
          <Trash2 size={20} />
          <h3 className="font-display font-semibold text-text-primary">Corbeille</h3>
          <span className="text-xs text-text-muted">({groups.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher..."
              className="h-9 pl-8 pr-3 rounded-xl border border-gold/25 bg-transparent text-sm"
            />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
          </Button>
        </div>
      </div>
      <p className="text-xs text-text-muted mb-4">
        Toutes les données supprimées depuis n'importe quelle interface arrivent ici. « Restaurer » les remet
        exactement comme avant la suppression (avec leurs lignes liées).
      </p>

      {missing ? (
        <p className="rounded-xl border border-rose-deep/30 bg-rose-deep/5 px-3.5 py-3 text-sm text-rose-deep">
          La corbeille n'est pas encore installée : exécutez <b>altech_production_update_corbeille.sql</b> dans Supabase.
        </p>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">{loading ? 'Chargement...' : 'La corbeille est vide.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-text-muted border-b border-gold/15">
                <th className="py-2 pr-3">Date de suppression</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Informations</th>
                <th className="py-2 pr-3">Lignes</th>
                <th className="py-2 pr-3">Supprimé par</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.txId} className="border-b border-gold/10">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(g.deletedAt)}</td>
                  <td className="py-2 pr-3 font-medium">{tableLabel(g.main.table_name)}</td>
                  <td className="py-2 pr-3">{summarize(g.main.data)}</td>
                  <td className="py-2 pr-3">{g.rows.length}</td>
                  <td className="py-2 pr-3">{g.deletedBy || '—'}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDetail(g)}><Eye size={14} /> Détails</Button>
                      <Button variant="gold" size="sm" onClick={() => restore(g)} disabled={busy === g.txId}>
                        <RotateCcw size={14} /> Restaurer
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? `${tableLabel(detail.main.table_name)} — détails de la suppression` : ''}
        footer={detail && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDetail(null)}>Fermer</Button>
            <Button variant="gold" onClick={() => restore(detail)} disabled={busy === detail.txId}>
              <RotateCcw size={16} /> Restaurer
            </Button>
          </div>
        )}
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div><span className="text-text-muted">Supprimé le : </span>{formatDateTime(detail.deletedAt)}</div>
              <div><span className="text-text-muted">Par : </span>{detail.deletedBy || '—'}</div>
              <div><span className="text-text-muted">Lignes : </span>{detail.rows.length}</div>
            </div>
            {detail.rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-gold/20 p-3">
                <h4 className="font-semibold text-sm mb-2">{tableLabel(r.table_name)}</h4>
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(r.data).map(([k, v]) => (
                      <tr key={k} className="border-b border-gold/10 last:border-0">
                        <td className="py-1 pr-3 text-text-muted whitespace-nowrap align-top">{k}</td>
                        <td className="py-1 break-all">{formatValue(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  );
}
