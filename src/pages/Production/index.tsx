import { useMemo, useState } from 'react';
import {
  FlaskConical, Plus, Eye, Trash2, Search, X, Clock, User, Pencil, FileText,
  BookOpen, AlertTriangle, Printer, Factory, Coins, TrendingUp, PackageCheck,
  CreditCard, Receipt,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Input, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { StatCard } from '@/components/shared/StatCard';
import { useSettingsStore } from '@/store/settingsStore';
import { printProductionSheet } from '@/lib/documents';
import { motion } from 'framer-motion';
import { useProductionStore } from '@/store/productionStore';
import { useFicheTechnicStore, type FicheTechnic } from '@/store/ficheTechnicStore';
import { useStockStore } from '@/store/stockStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO, nowTime, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Production, UsedProduct, Product } from '@/types';

export default function ProductionPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { productions, addProduction, deleteProduction } = useProductionStore();
  const { ficheTechnics, deleteFicheTechnic } = useFicheTechnicStore();
  const settings = useSettingsStore((s) => s.settings);

  /** Imprime la fiche complète d'une production (matières, résultat, gains). */
  const printProduction = (prod: Production) =>
    printProductionSheet(
      {
        name: prod.name,
        date: prod.date,
        hour: prod.hour,
        categoryName: prod.categoryName,
        description: prod.description,
        createdBy: prod.createdBy,
        outputQuantity: prod.outputQuantity,
        sellUnit: prod.sellByUnit ? prod.sellUnit : undefined,
        unitPrice: prod.unitPrice,
        totalValue: prod.totalValue,
        totalCost: prod.totalCost ?? 0,
        sentToComptoir: prod.sentToComptoir ?? 0,
        hasLoss: prod.hasLoss,
        expectedQuantity: prod.expectedQuantity,
        lossQuantity: prod.lossQuantity,
        lossValue: prod.lossValue,
        lossDescription: prod.lossDescription,
        ingredients: prod.usedProducts.map((u) => ({
          productName: u.productName,
          quantityUsed: u.quantityUsed,
          unit: u.unit,
          unitCost: u.unitCost ?? 0,
          lineCost: u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0)),
        })),
      },
      settings
    );

  // KPI de l'onglet Productions
  const prodStats = useMemo(() => {
    const cost = productions.reduce((sum, x) => sum + (x.totalCost ?? 0), 0);
    const value = productions.reduce((sum, x) => sum + x.totalValue, 0);
    const remaining = productions.reduce(
      (sum, x) => sum + (x.outputQuantity - (x.sentToComptoir ?? 0)),
      0
    );
    const loss = productions.reduce((sum, x) => sum + (x.lossValue ?? 0), 0);
    return { cost, value, remaining, loss, gains: value - cost };
  }, [productions]);

  const [activeTab, setActiveTab] = useState<'productions' | 'fiche_technics'>('productions');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // manuelle (écran Production) ou lancée depuis le point de vente
  const [originFilter, setOriginFilter] = useState<'all' | 'manual' | 'pos'>('all');
  
  // Production Modals
  const [prodCreateOpen, setProdCreateOpen] = useState(false);
  const [prodViewing, setProdViewing] = useState<Production | null>(null);
  const [prodDeleteId, setProdDeleteId] = useState<string | null>(null);
  const [transferProd, setTransferProd] = useState<Production | null>(null);

  // Fiche Technic Modals
  const [ftCreateOpen, setFtCreateOpen] = useState(false);
  const [ftEditing, setFtEditing] = useState<FicheTechnic | null>(null);
  const [ftViewing, setFtViewing] = useState<FicheTechnic | null>(null);
  const [ftDeleteId, setFtDeleteId] = useState<string | null>(null);

  // Filter productions
  const filteredProductions = useMemo(
    () =>
      productions.filter(
        (p) =>
          (p.name.toLowerCase().includes(search.toLowerCase()) ||
            (p.saleReference || '').toLowerCase().includes(search.toLowerCase())) &&
          matchesDateFilter(p.date, dateFilter) &&
          (originFilter === 'all' || (p.origin ?? 'manual') === originFilter)
      ),
    [productions, search, dateFilter, originFilter]
  );

  const posCount = useMemo(
    () => productions.filter((p) => p.origin === 'pos').length,
    [productions]
  );

  // Filter Fiche Technics
  const filteredFicheTechnics = useMemo(
    () => ficheTechnics.filter((ft) => ft.name.toLowerCase().includes(search.toLowerCase())),
    [ficheTechnics, search]
  );

  return (
    <div className="space-y-6">
      <PageHeader 
        title={t('production')} 
        icon={<FlaskConical size={24} />} 
        subtitle={`${productions.length} productions, ${ficheTechnics.length} fiches techniques`}
        actions={
          <div className="flex gap-2">
            {activeTab === 'productions' ? (
              can('production', 'create') && (
                <Button variant="gold" onClick={() => setProdCreateOpen(true)}>
                  <Plus size={18} /> {t('newProduction')}
                </Button>
              )
            ) : (
              can('production', 'create') && (
                <Button variant="gold" onClick={() => setFtCreateOpen(true)}>
                  <Plus size={18} /> Nouvelle Fiche Technique
                </Button>
              )
            )}
          </div>
        }
      />

      {/* Navigation tabs */}
      <div className="flex border-b border-gold/15">
        <button
          onClick={() => { setActiveTab('productions'); setSearch(''); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-[2px] ${
            activeTab === 'productions'
              ? 'border-gold-dark text-gold-dark'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <FlaskConical size={16} />
          <span>Productions</span>
        </button>
        <button
          onClick={() => { setActiveTab('fiche_technics'); setSearch(''); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-[2px] ${
            activeTab === 'fiche_technics'
              ? 'border-gold-dark text-gold-dark'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <FileText size={16} />
          <span>Fiches Techniques (Formules)</span>
        </button>
      </div>

      {activeTab === 'productions' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Valeur produite" value={prodStats.value} format="currency" icon={<Factory size={22} />} index={0} accent="gold" />
            <StatCard label="Coût des matières" value={prodStats.cost} format="currency" icon={<Coins size={22} />} index={1} accent="rose" />
            <StatCard label="Gains estimés" value={prodStats.gains} format="currency" icon={<TrendingUp size={22} />} index={2} accent="pistachio" />
            <StatCard label="Reste à envoyer au comptoir" value={prodStats.remaining} icon={<PackageCheck size={22} />} index={3} accent="caramel" />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex-1 min-w-[200px]"><SearchBar value={search} onChange={setSearch} placeholder={t('search')} /></div>
            <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              options={[{ value: 'all', label: t('all') }, { value: 'today', label: t('today') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} className="max-w-[180px]" />
            <Select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as 'all' | 'manual' | 'pos')}
              options={[
                { value: 'all', label: 'Toutes les origines' },
                { value: 'manual', label: 'Lancées manuellement' },
                { value: 'pos', label: `Issues du point de vente (${posCount})` },
              ]}
              className="max-w-[240px]"
            />
          </div>

          {filteredProductions.length === 0 ? <EmptyState message={t('noData')} /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProductions.map((p, i) => (
                <Card
                  key={p.id}
                  index={i}
                  hoverable
                  className={`flex flex-col rounded-2xl p-0 overflow-hidden border ${
                    p.hasLoss ? 'border-rose-deep/35' : 'border-gold/20 hover:border-gold/45'
                  }`}
                >
                  {/* Bandeau */}
                  <div className={`px-4 py-3 flex items-start justify-between gap-2 ${p.hasLoss ? 'bg-rose-deep/10' : 'bg-gold/10'}`}>
                    <div className="min-w-0">
                      <h3 className="font-display font-semibold text-text-primary text-base truncate">{p.name}</h3>
                      <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5">
                        <Clock size={11} /> {formatDate(p.date, language)} — {p.hour}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {p.origin === 'pos' && (
                        <Badge variant="success" className="gap-1"><CreditCard size={10} /> Point de vente</Badge>
                      )}
                      {p.categoryName && <Badge variant="info">{p.categoryName}</Badge>}
                      {p.hasLoss && (
                        <motion.div animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                          <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Perte</Badge>
                        </motion.div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 flex-1 flex flex-col">
                    {p.description && (
                      <p className="text-xs text-text-secondary mb-3 line-clamp-2 italic">« {p.description} »</p>
                    )}

                    {/* Quantité produite + jauge comptoir */}
                    <div className="mb-3">
                      <div className="flex items-end justify-between mb-1.5">
                        <span className="text-[11px] uppercase tracking-wider font-bold text-text-muted">Quantité produite</span>
                        <span className="tabular font-extrabold text-xl leading-none text-text-primary">
                          {p.outputQuantity}
                          <span className="text-xs font-semibold text-text-muted ml-1">
                            {p.sellByUnit && p.sellUnit ? p.sellUnit : ''}
                          </span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{
                            width: `${p.outputQuantity > 0 ? Math.min(100, ((p.sentToComptoir ?? 0) / p.outputQuantity) * 100) : 0}%`,
                          }}
                          transition={{ delay: i * 0.05, duration: 0.8 }}
                          className="h-full rounded-full bg-gradient-mint"
                        />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px] text-text-muted">
                        <span>Envoyé au comptoir : {p.sentToComptoir ?? 0}</span>
                        <span>Reste : {p.outputQuantity - (p.sentToComptoir ?? 0)}</span>
                      </div>
                    </div>

                    {/* Chiffres */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <MiniTile label="Ingrédients" value={String(p.usedProducts.length)} />
                      <MiniTile
                        label="Prix unitaire"
                        value={`${formatCurrency(p.unitPrice)}${p.sellByUnit && p.sellUnit ? `/${p.sellUnit}` : ''}`}
                      />
                      <MiniTile label="Coût de production" value={formatCurrency(p.totalCost ?? 0)} accent="text-rose-deep" />
                      <MiniTile label="Valeur de vente" value={formatCurrency(p.totalValue)} accent="text-gold-dark" />
                    </div>

                    {p.hasLoss && (
                      <div className="rounded-xl border border-rose-deep/25 bg-rose-deep/5 px-3 py-2 mb-3 text-xs">
                        <div className="flex justify-between text-text-muted">
                          <span>Quantité prévue</span>
                          <span className="tabular">{p.expectedQuantity}{p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : ''}</span>
                        </div>
                        <div className="flex justify-between font-bold text-rose-deep mt-0.5">
                          <span>Perte constatée</span>
                          <span className="tabular">
                            − {p.lossQuantity}{p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : ''} ({formatCurrency(p.lossValue ?? 0)})
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 mb-3">
                      <span className="text-xs font-semibold text-text-secondary">Gain net estimé</span>
                      <span className={`text-base font-bold tabular ${p.totalValue - (p.totalCost ?? 0) >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>
                        {formatCurrency(p.totalValue - (p.totalCost ?? 0))}
                      </span>
                    </div>

                    {p.saleReference && (
                      <p className="text-[10px] text-pistachio flex items-center gap-1 mb-1.5 font-semibold">
                        <Receipt size={10} /> Produite pour la vente {p.saleReference}
                      </p>
                    )}

                    {p.createdBy && (
                      <p className="text-[10px] text-text-muted flex items-center gap-1 mb-3">
                        <User size={10} className="text-gold" /> Produit par {p.createdBy}
                      </p>
                    )}

                    {p.outputQuantity - (p.sentToComptoir ?? 0) > 0 && can('production', 'edit') && (
                      <Button
                        size="sm"
                        variant="gold"
                        className="w-full text-xs mb-2"
                        onClick={() => setTransferProd(p)}
                      >
                        <Plus size={13} /> Mettre au comptoir ({p.outputQuantity - (p.sentToComptoir ?? 0)})
                      </Button>
                    )}

                    <div className="flex gap-1.5 mt-auto pt-2 border-t border-gold/10">
                      <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => setProdViewing(p)}>
                        <Eye size={13} /> Détails
                      </Button>
                      <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => printProduction(p)}>
                        <Printer size={13} /> Imprimer
                      </Button>
                      {can('production', 'delete') && (
                        <Button size="sm" variant="ghost" onClick={() => setProdDeleteId(p.id)} title="Supprimer">
                          <Trash2 size={13} className="text-rose-deep" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex-1 min-w-[200px]"><SearchBar value={search} onChange={setSearch} placeholder="Rechercher une formule..." /></div>
          </div>

          {filteredFicheTechnics.length === 0 ? <EmptyState message="Aucune fiche technique enregistrée" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredFicheTechnics.map((ft, i) => (
                <Card key={ft.id} index={i} hoverable className="flex flex-col border border-gold/10 hover:border-gold/30 bg-gradient-to-br from-white to-vanilla/5">
                  <div className="flex justify-between items-start mb-1 gap-2">
                    <h3 className="font-display font-semibold text-text-primary text-base">{ft.name}</h3>
                    <Badge variant="warning" className="bg-caramel/10 text-caramel border-0">{ft.categoryName}</Badge>
                  </div>
                  <p className="text-[10px] text-text-muted mb-2">Créé le {formatDate(ft.createdAt, language)}</p>
                  {ft.description && <p className="text-xs text-text-muted mb-3 line-clamp-2">{ft.description}</p>}
                  
                  <div className="bg-vanilla/40 rounded-xl p-3 space-y-1.5 text-xs mb-3">
                    <div className="flex justify-between"><span className="text-text-muted">Ingrédients</span><span className="tabular text-text-secondary">{ft.usedProducts.length}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">Rendement base</span><span className="tabular font-medium text-text-primary">{ft.outputQuantity}{ft.sellByUnit && ft.sellUnit ? ` ${ft.sellUnit}` : ''}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">Coût base total</span><span className="tabular text-rose-deep font-semibold">{formatCurrency(ft.totalCost)}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">Coût par unité</span><span className="tabular text-rose-deep font-bold bg-rose-deep/5 px-1.5 py-0.5 rounded">{formatCurrency(ft.costPerUnit)}</span></div>
                    <div className="flex justify-between border-t border-gold/5 pt-1.5 mt-1.5"><span className="text-text-muted">Gain par unité</span><span className="tabular text-pistachio font-bold">{formatCurrency(ft.gainsPerUnit)}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted font-semibold">Total Gains base</span><span className="tabular text-pistachio font-bold bg-pistachio/5 px-1.5 py-0.5 rounded">{formatCurrency(ft.totalGains)}</span></div>
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {ft.sellByUnit && (
                      <Badge variant="info" className="bg-pistachio/15 text-pistachio hover:bg-pistachio/20 border-0 self-start text-[10px]">
                        Unité de détail: {ft.sellUnit}
                      </Badge>
                    )}
                    {ft.usableInProduction && (
                      <Badge variant="info" className="bg-caramel/15 text-caramel hover:bg-caramel/20 border-0 self-start text-[10px]">
                        Réutilisable{ft.productUnit ? ` (${ft.productUnit})` : ''}
                      </Badge>
                    )}
                  </div>

                  <div className="flex gap-2 mt-auto pt-2 border-t border-gold/5">
                    <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => setFtViewing(ft)}><Eye size={13} /> {t('view')}</Button>
                    {can('production', 'edit') && (
                      <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setFtEditing(ft)} title={t('edit')}><Pencil size={13} /></Button>
                    )}
                    {can('production', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => setFtDeleteId(ft.id)} className="px-2.5 hover:bg-rose-deep/5"><Trash2 size={13} className="text-rose-deep" /></Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Production Form Modal */}
      <Modal open={prodCreateOpen} onClose={() => setProdCreateOpen(false)} title="Lancer une Production" size="lg">
        <CreateProductionForm
          onClose={() => setProdCreateOpen(false)}
          onSubmit={async (data) => {
            await addProduction(data);
            toast.success("Production enregistrée — stock d'ingrédients déduit");
            setProdCreateOpen(false);
          }}
        />
      </Modal>

      {/* Fiche Technic Modals */}
      <Modal open={ftCreateOpen} onClose={() => setFtCreateOpen(false)} title="Créer Fiche Technique" size="lg">
        <FicheTechnicForm onClose={() => setFtCreateOpen(false)} />
      </Modal>

      <Modal open={!!ftEditing} onClose={() => setFtEditing(null)} title="Modifier Fiche Technique" size="lg">
        {ftEditing && <FicheTechnicForm initial={ftEditing} onClose={() => setFtEditing(null)} />}
      </Modal>

      {/* Viewing Production */}
      <Modal open={!!prodViewing} onClose={() => setProdViewing(null)} title={prodViewing?.name} size="md">
        {prodViewing && (() => {
          const cost = prodViewing.totalCost ?? prodViewing.usedProducts.reduce((s, u) => s + (u.lineCost ?? 0), 0);
          const gains = prodViewing.totalValue - cost;
          const su = prodViewing.sellByUnit && prodViewing.sellUnit ? ` ${prodViewing.sellUnit}` : '';
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/5 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  {prodViewing.categoryName && <Badge variant="info">{prodViewing.categoryName}</Badge>}
                  {prodViewing.sellByUnit && prodViewing.sellUnit && <Badge variant="warning">{t('sellUnit')}: {prodViewing.sellUnit}</Badge>}
                  {prodViewing.origin === 'pos' && (
                    <Badge variant="success" className="gap-1">
                      <CreditCard size={10} /> Lancée depuis le point de vente
                      {prodViewing.saleReference ? ` · ${prodViewing.saleReference}` : ''}
                    </Badge>
                  )}
                </div>
              </div>
              {prodViewing.description && <p className="text-sm text-text-secondary bg-vanilla/20 p-2.5 rounded-xl border border-gold/5 italic">« {prodViewing.description} »</p>}
              <p className="text-xs text-text-muted flex items-center gap-2">
                <span>{formatDate(prodViewing.date, language)} — {prodViewing.hour}</span>
                {prodViewing.createdBy && <span className="flex items-center gap-1"><User size={11} /> {prodViewing.createdBy}</span>}
              </p>
              <div>
                <h4 className="text-sm font-semibold text-text-secondary mb-2">Ingrédients Consommés</h4>
                <div className="rounded-xl border border-gold/15 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60 text-text-secondary"><tr>
                      <th className="text-left px-3 py-2">{t('ingredient')}</th>
                      <th className="text-right px-3 py-2">{t('quantity')}</th>
                      <th className="text-right px-3 py-2">Coût Unitaire</th>
                      <th className="text-right px-3 py-2">Coût Total</th>
                    </tr></thead>
                    <tbody>
                      {prodViewing.usedProducts.map((u, i) => (
                        <tr key={i} className="border-t border-gold/10">
                          <td className="px-3 py-2 font-medium">{u.productName}</td>
                          <td className="px-3 py-2 text-right tabular">{u.quantityUsed}{u.unit ? ` ${u.unit}` : ''}</td>
                          <td className="px-3 py-2 text-right tabular">{formatCurrency(u.unitCost ?? 0)}</td>
                          <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0)))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gold/15 bg-vanilla/40 font-semibold text-text-primary">
                        <td className="px-3 py-2" colSpan={3}>Coût Total des Ingrédients</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(cost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Tile label="Quantité Produite" value={`${prodViewing.outputQuantity}${su}`} />
                <Tile label="Envoyé au Comptoir" value={`${prodViewing.sentToComptoir ?? 0}${su}`} />
                <Tile label="Reste en Stock Prod" value={`${prodViewing.outputQuantity - (prodViewing.sentToComptoir ?? 0)}${su}`} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Tile label="Prix de Vente Unitaire" value={formatCurrency(prodViewing.unitPrice)} />
                <Tile label="Valeur de Production" value={formatCurrency(prodViewing.totalValue)} />
                <Tile label="Coût Total Ingrédients" value={formatCurrency(cost)} />
              </div>
              <div className="bg-vanilla/40 rounded-lg p-2.5 text-center flex flex-col justify-center items-center">
                <p className="text-[10px] text-text-muted">Gains Nets Estimés</p>
                <p className={`text-base font-bold tabular ${gains >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>{formatCurrency(gains)}</p>
              </div>

              <Button variant="gold" className="w-full" onClick={() => printProduction(prodViewing)}>
                <Printer size={16} /> Imprimer la fiche de production
              </Button>

              {prodViewing.hasLoss && (
                <div className="bg-rose-deep/5 border border-rose-deep/20 rounded-xl p-3 space-y-2">
                  <p className="text-sm font-semibold text-rose-deep flex items-center gap-1.5"><AlertTriangle size={14} /> {t('productionLoss')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Tile label={t('expectedQty')} value={`${prodViewing.expectedQuantity}${su}`} />
                    <Tile label={t('lossQty')} value={`${prodViewing.lossQuantity}${su}`} />
                    <Tile label={t('lossValueLabel')} value={formatCurrency(prodViewing.lossValue ?? 0)} />
                  </div>
                  {prodViewing.lossDescription && <p className="text-xs text-text-secondary bg-vanilla/50 p-2 rounded-lg italic">« {prodViewing.lossDescription} »</p>}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Viewing Fiche Technic */}
      <Modal open={!!ftViewing} onClose={() => setFtViewing(null)} title={ftViewing?.name} size="md">
        {ftViewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/5 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">{ftViewing.categoryName}</Badge>
                {ftViewing.sellByUnit && ftViewing.sellUnit && <Badge variant="info">Unité de vente: {ftViewing.sellUnit}</Badge>}
                {ftViewing.usableInProduction && <Badge variant="info" className="bg-caramel/15 text-caramel border-0">Réutilisable en production{ftViewing.productUnit ? ` (${ftViewing.productUnit})` : ''}</Badge>}
              </div>
            </div>
            {ftViewing.description && <p className="text-sm text-text-secondary bg-vanilla/20 p-2.5 rounded-xl border border-gold/5 italic">« {ftViewing.description} »</p>}
            
            <div>
              <h4 className="text-sm font-semibold text-text-secondary mb-2">Ingrédients &amp; Dosage (Fiche Technique)</h4>
              <div className="rounded-xl border border-gold/15 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-vanilla/60 text-text-secondary"><tr>
                    <th className="text-left px-3 py-2">{t('ingredient')}</th>
                    <th className="text-right px-3 py-2">Dosage Base</th>
                    <th className="text-right px-3 py-2">Coût Unitaire</th>
                    <th className="text-right px-3 py-2">Coût Ligne</th>
                  </tr></thead>
                  <tbody>
                    {ftViewing.usedProducts.map((u, i) => (
                      <tr key={i} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-medium">
                          <span className="flex items-center gap-1.5">
                            {u.sourceType === 'fiche' && <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px] px-1.5 py-0">Prod</Badge>}
                            {u.productName}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular">{u.quantityUsed}{u.unit ? ` ${u.unit}` : ''}</td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(u.unitCost ?? 0)}</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(u.lineCost ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gold/15 bg-vanilla/40 font-semibold text-text-primary">
                      <td className="px-3 py-2" colSpan={3}>Coût Total Ingrédients Base</td>
                      <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(ftViewing.totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label="Rendement Base" value={`${ftViewing.outputQuantity}${ftViewing.sellByUnit && ftViewing.sellUnit ? ' ' + ftViewing.sellUnit : ''}`} />
              <Tile label="Prix Vente Unitaire" value={formatCurrency(ftViewing.unitPrice)} />
              <Tile label="Coût de Revient / Unité" value={formatCurrency(ftViewing.costPerUnit)} />
              <div className="bg-pistachio/5 border border-pistachio/20 rounded-lg p-2.5 text-center flex flex-col justify-center items-center">
                <p className="text-[10px] text-pistachio font-medium">Gain / Unité</p>
                <p className="text-sm font-bold text-pistachio tabular">{formatCurrency(ftViewing.gainsPerUnit)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-gold/5 pt-3">
              <Tile label="Valeur Totale Base" value={formatCurrency(ftViewing.totalValue)} />
              <div className="bg-pistachio/5 border border-pistachio/20 rounded-lg p-2.5 text-center flex flex-col justify-center items-center">
                <p className="text-[10px] text-pistachio font-medium">Gain Total Base</p>
                <p className="text-base font-bold text-pistachio tabular">{formatCurrency(ftViewing.totalGains)}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Deletion */}
      <ConfirmDialog open={!!prodDeleteId} onClose={() => setProdDeleteId(null)}
        onConfirm={() => { if (prodDeleteId) void deleteProduction(prodDeleteId).then(() => toast.success('Production supprimée')); }} />
      <ConfirmDialog open={!!ftDeleteId} onClose={() => setFtDeleteId(null)}
        onConfirm={() => { if (ftDeleteId) void deleteFicheTechnic(ftDeleteId).then(() => toast.success('Fiche technique supprimée')); }} />

      {/* Transfer to Comptoir Modal */}
      <Modal open={!!transferProd} onClose={() => setTransferProd(null)} title="Mettre au comptoir" size="sm">
        {transferProd && (
          <TransferToComptoirModal
            production={transferProd}
            onClose={() => setTransferProd(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function TransferToComptoirModal({ production, onClose }: { production: Production; onClose: () => void }) {
  const { t } = useLanguage();
  const { transferToComptoir } = useProductionStore();
  const remainingQty = production.outputQuantity - (production.sentToComptoir ?? 0);
  
  const [quantity, setQuantity] = useState<number>(remainingQty);
  
  const restQty = remainingQty - quantity;
  const su = production.sellByUnit && production.sellUnit ? ` ${production.sellUnit}` : '';

  const handleTransfer = async () => {
    if (quantity <= 0) {
      toast.error('La quantité doit être supérieure à 0');
      return;
    }
    if (quantity > remainingQty) {
      toast.error('La quantité ne peut pas dépasser le reste en stock de production');
      return;
    }
    try {
      await transferToComptoir(production.id, quantity);
      toast.success('Transfert au comptoir réussi');
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Une erreur est survenue');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-vanilla/20 p-3 rounded-xl border border-gold/15 space-y-2 text-xs text-text-secondary">
        <p className="flex justify-between">
          <span>Produit:</span>
          <span className="font-semibold text-text-primary">{production.name}</span>
        </p>
        <p className="flex justify-between">
          <span>Quantité totale produite:</span>
          <span className="font-semibold">{production.outputQuantity}{su}</span>
        </p>
        <p className="flex justify-between">
          <span>Déjà envoyé au comptoir:</span>
          <span className="font-semibold text-pistachio">{production.sentToComptoir ?? 0}{su}</span>
        </p>
        <p className="flex justify-between border-t border-gold/5 pt-1.5 font-bold text-text-primary">
          <span>Reste en stock production:</span>
          <span>{remainingQty}{su}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-text-secondary">Quantité à envoyer au comptoir</label>
        <div className="flex gap-2">
          <Input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setQuantity(remainingQty)}
            title="Envoyer le maximum"
            className="shrink-0 text-xs px-3"
          >
            Max
          </Button>
        </div>
      </div>

      <div className="bg-vanilla/10 rounded-lg p-2.5 text-center flex justify-between items-center text-xs text-text-muted">
        <span>Reste après transfert:</span>
        <span className={`font-bold tabular ${restQty < 0 ? 'text-rose-deep' : 'text-text-primary'}`}>{restQty.toFixed(2)}{su}</span>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleTransfer} disabled={quantity <= 0 || quantity > remainingQty}>
          Mettre au comptoir
        </Button>
      </div>
    </div>
  );
}

function MiniTile({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gold/10 bg-vanilla/40 px-2.5 py-2">
      <p className="text-[10px] text-text-muted leading-tight">{label}</p>
      <p className={`text-xs font-bold tabular ${accent} mt-0.5`}>{value}</p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="bg-vanilla/40 rounded-lg p-2.5 text-center"><p className="text-[10px] text-text-muted">{label}</p><p className="text-xs font-bold tabular text-text-primary mt-0.5">{value}</p></div>;
}

// -------------------------------------------------------------
// Form to Create/Edit Fiche Technic
// -------------------------------------------------------------
function FicheTechnicForm({ initial, onClose }: { initial?: FicheTechnic; onClose: () => void }) {
  const { t } = useLanguage();
  const products = useStockStore((s) => s.products);
  const { categories, addCategory, deleteCategory, addFicheTechnic, updateFicheTechnic, ficheTechnics } = useFicheTechnicStore();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [lines, setLines] = useState<any[]>(
    initial
      ? initial.usedProducts.map((u) => ({
          _key: u.productId + Math.random(),
          productId: u.productId,
          productName: u.productName,
          quantityUsed: u.quantityUsed,
          unitCost: u.unitCost ?? 0,
          unit: u.unit,
          sourceType: u.sourceType ?? 'stock',
        }))
      : []
  );
  const [outputQuantity, setOutputQuantity] = useState<number>(initial?.outputQuantity ?? 1);
  const [unitPrice, setUnitPrice] = useState<number>(initial?.unitPrice ?? 0);
  const [sellByUnit, setSellByUnit] = useState(!!initial?.sellByUnit);
  const [sellUnit, setSellUnit] = useState(initial?.sellUnit ?? '');
  // New: allow this product to be reused as an ingredient in another fiche.
  const [usableInProduction, setUsableInProduction] = useState(!!initial?.usableInProduction);
  const [productUnit, setProductUnit] = useState(initial?.productUnit ?? '');

  // Category mini-modal
  const [catModal, setCatModal] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [confirmDelCat, setConfirmDelCat] = useState<{ id: string; name: string } | null>(null);

  // Reusable fiches that can be used as ingredients (semi-finished products),
  // excluding the fiche currently being edited to avoid self-reference.
  const reusableFiches = useMemo(
    () => ficheTechnics.filter((f) => f.usableInProduction && f.id !== initial?.id),
    [ficheTechnics, initial]
  );

  // Combined ingredient search: raw stock products + reusable fiches.
  const ingResults = useMemo(() => {
    if (!ingredientSearch) return [] as Array<
      | { kind: 'stock'; product: Product }
      | { kind: 'fiche'; fiche: FicheTechnic }
    >;
    const s = ingredientSearch.toLowerCase();
    const stockMatches = products
      .filter((p) => p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s))
      .slice(0, 6)
      .map((product) => ({ kind: 'stock' as const, product }));
    const ficheMatches = reusableFiches
      .filter((f) => f.name.toLowerCase().includes(s))
      .slice(0, 6)
      .map((fiche) => ({ kind: 'fiche' as const, fiche }));
    return [...ficheMatches, ...stockMatches];
  }, [ingredientSearch, products, reusableFiches]);

  const addIngredient = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) return;
    setLines([
      ...lines,
      {
        _key: p.id + Date.now(),
        productId: p.id,
        productName: p.name,
        quantityUsed: 1,
        unitCost: p.purchasePrice || 0,
        unit: p.unitEnabled && p.unit ? p.unit : undefined,
        sourceType: 'stock' as const,
      },
    ]);
    setIngredientSearch('');
  };

  // Add a reusable fiche (semi-finished product) as an ingredient. Its unit cost
  // is the fiche's cost per unit and its measurement unit is the fiche's productUnit.
  const addFicheIngredient = (f: FicheTechnic) => {
    if (lines.some((l) => l.productId === f.id)) return;
    setLines([
      ...lines,
      {
        _key: f.id + Date.now(),
        productId: f.id,
        productName: f.name,
        quantityUsed: 1,
        unitCost: f.costPerUnit || 0,
        unit: f.productUnit || undefined,
        sourceType: 'fiche' as const,
      },
    ]);
    setIngredientSearch('');
  };

  const removeLine = (key: string) => {
    setLines(lines.filter((l) => l._key !== key));
  };

  const updateLineQty = (key: string, qty: number) => {
    setLines(lines.map((l) => (l._key === key ? { ...l, quantityUsed: qty } : l)));
  };

  /** The user picks — or creates — the unit each ingredient is dosed in. */
  const updateLineUnit = (key: string, unit: string) => {
    setLines(lines.map((l) => (l._key === key ? { ...l, unit: unit || undefined } : l)));
  };

  // Calculations
  const totalCost = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.quantityUsed * l.unitCost, 0);
  }, [lines]);

  const costPerUnit = useMemo(() => {
    return outputQuantity > 0 ? totalCost / outputQuantity : 0;
  }, [totalCost, outputQuantity]);

  const totalValue = useMemo(() => {
    return outputQuantity * unitPrice;
  }, [outputQuantity, unitPrice]);

  const gainsPerUnit = useMemo(() => {
    return unitPrice - costPerUnit;
  }, [unitPrice, costPerUnit]);

  const totalGains = useMemo(() => {
    return totalValue - totalCost;
  }, [totalValue, totalCost]);

  const handleAddCat = async () => {
    if (!newCat.trim()) return;
    const c = await addCategory(newCat.trim());
    setCategoryId(c.id);
    setNewCat('');
    setCatModal(false);
  };

  const [savingFiche, setSavingFiche] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Nom de produit requis'); return; }
    if (!categoryId) { toast.error('Sélectionnez une catégorie'); return; }
    if (lines.length === 0) { toast.error('Ajoutez au moins un ingrédient'); return; }
    if (outputQuantity <= 0) { toast.error('Le rendement doit être supérieur à 0'); return; }
    if (sellByUnit && !sellUnit) { toast.error("Veuillez sélectionner l'unité de vente"); return; }
    if (usableInProduction && !productUnit) { toast.error("Veuillez sélectionner l'unité du produit (utilisable en production)"); return; }

    const categoryName = categories.find((c) => c.id === categoryId)?.name || '—';
    const usedProducts: UsedProduct[] = lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      quantityUsed: Number(l.quantityUsed),
      unit: l.unit,
      unitCost: l.unitCost,
      lineCost: l.quantityUsed * l.unitCost,
      sourceType: l.sourceType ?? 'stock',
    }));

    const data = {
      name: name.trim(),
      categoryId,
      categoryName,
      description: description.trim(),
      usedProducts,
      sellByUnit,
      sellUnit: sellByUnit ? sellUnit : undefined,
      usableInProduction,
      productUnit: usableInProduction ? productUnit : undefined,
      outputQuantity: Number(outputQuantity),
      unitPrice: Number(unitPrice),
      totalCost,
      costPerUnit,
      totalValue,
      gainsPerUnit,
      totalGains,
    };

    setSavingFiche(true);
    try {
      if (initial) {
        await updateFicheTechnic(initial.id, data);
        toast.success('Fiche technique mise à jour');
      } else {
        await addFicheTechnic(data);
        toast.success('Fiche technique créée');
      }
      onClose();
    } finally {
      setSavingFiche(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Info card */}
        <div className="space-y-3 bg-vanilla/20 p-4 rounded-xl border border-gold/15">
          <h4 className="font-display font-semibold text-gold-dark text-sm border-b border-gold/5 pb-1">1. Informations Générales</h4>
          
          <Input label="Nom de Produit *" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Solution Hydroalcoolique" />

          <div className="flex items-end gap-2">
            <Select label="Catégorie *" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              placeholder="—" options={categories.map((c) => ({ value: c.id, label: c.name }))} className="flex-1" />
            <Button type="button" variant="secondary" size="icon" onClick={() => setCatModal(true)} title="Nouvelle catégorie"><Plus size={16} /></Button>
            <Button type="button" variant="danger" size="icon" disabled={!categoryId}
              onClick={() => { const c = categories.find((x) => x.id === categoryId); if (c) setConfirmDelCat({ id: c.id, name: c.name }); }} title="Supprimer"><Trash2 size={16} /></Button>
          </div>

          <Textarea label="Description / Procédé (Optionnel)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Détaillez le procédé de fabrication..." />
        </div>

        {/* Output card */}
        <div className="space-y-3 bg-vanilla/20 p-4 rounded-xl border border-gold/15 flex flex-col">
          <h4 className="font-display font-semibold text-gold-dark text-sm border-b border-gold/5 pb-1">2. Rendement et Tarification</h4>
          
          <div className="flex flex-wrap items-end gap-3 mb-2 bg-vanilla/50 p-2 rounded-xl border border-gold/5">
            <Switch checked={sellByUnit} onChange={setSellByUnit} label="Vendre avec unité de détail" />
            {sellByUnit && <UnitSelect label="Unité de détail" value={sellUnit} onChange={setSellUnit} className="min-w-[150px] flex-1" />}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-2 bg-pistachio/5 p-2 rounded-xl border border-pistachio/20">
            <Switch checked={usableInProduction} onChange={setUsableInProduction} label="Utilisable comme ingrédient dans une autre production" />
            {usableInProduction && <UnitSelect label="Unité du produit (g, kg, litre…)" value={productUnit} onChange={setProductUnit} className="min-w-[150px] flex-1" />}
          </div>
          {usableInProduction && (
            <p className="text-[11px] text-pistachio -mt-1 mb-1 px-1">
              Ce produit (ex: solution acide) pourra être recherché et ajouté comme réactif/composant dans d'autres formules (ex: composé chimique), avec la quantité en {productUnit || 'unité choisie'}.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input label={sellByUnit && sellUnit ? `Rendement (${sellUnit})` : "Rendement (Quantité)"} type="number" step="any" value={outputQuantity} onChange={(e) => setOutputQuantity(Number(e.target.value))} />
            <Input label={sellByUnit && sellUnit ? `Prix de vente / ${sellUnit}` : "Prix de vente unitaire"} type="number" step="any" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
          </div>

          {/* Realtime calculations display */}
          <div className="mt-auto pt-3 border-t border-gold/10 space-y-2 bg-vanilla/60 rounded-xl p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Coût des ingrédients total:</span>
              <span className="font-semibold text-rose-deep tabular">{formatCurrency(totalCost)}</span>
            </div>
            <div className="flex justify-between font-bold border-b border-gold/5 pb-1 text-sm">
              <span className="text-text-secondary">Coût de revient unitaire:</span>
              <span className="text-rose-deep tabular">{formatCurrency(costPerUnit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Valeur de vente totale:</span>
              <span className="font-semibold text-gold-dark tabular">{formatCurrency(totalValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Gains par unité:</span>
              <span className={`font-semibold tabular ${gainsPerUnit >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>{formatCurrency(gainsPerUnit)}</span>
            </div>
            <div className="flex justify-between text-base font-extrabold border-t border-gold/10 pt-2">
              <span className="text-text-primary">Gains nets totaux:</span>
              <span className={`tabular ${totalGains >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>{formatCurrency(totalGains)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Used Ingredients selection */}
      <div className="bg-vanilla/20 p-4 rounded-xl border border-gold/15 space-y-3">
        <h4 className="font-display font-semibold text-gold-dark text-sm border-b border-gold/5 pb-1">3. Ingrédients (Produits consommés)</h4>
        
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={ingredientSearch} onChange={(e) => setIngredientSearch(e.target.value)} placeholder="Rechercher un produit en stock ou une formule réutilisable (ex: solution acide)..." className="pl-10" />
          {ingResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-[--surface-dropdown] rounded-xl border border-gold/20 shadow-lg max-h-[220px] overflow-y-auto">
              {ingResults.map((r) =>
                r.kind === 'fiche' ? (
                  <button key={`f-${r.fiche.id}`} type="button" onClick={() => addFicheIngredient(r.fiche)} className="w-full text-left px-4 py-2 text-sm hover:bg-pistachio/10 flex justify-between items-center border-b border-gold/5 last:border-0">
                    <span className="flex items-center gap-2">
                      <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px] px-1.5 py-0">Production</Badge>
                      <span className="font-medium text-text-primary">{r.fiche.name}</span>
                    </span>
                    <span className="text-xs text-text-muted">Coût: {formatCurrency(r.fiche.costPerUnit)}{r.fiche.productUnit ? `/${r.fiche.productUnit}` : ''}</span>
                  </button>
                ) : (
                  <button key={`s-${r.product.id}`} type="button" onClick={() => addIngredient(r.product)} className="w-full text-left px-4 py-2 text-sm hover:bg-gold/10 flex justify-between items-center border-b border-gold/5 last:border-0">
                    <span className="font-medium text-text-primary">{r.product.name}</span>
                    <span className="text-xs text-text-muted">P.U: {formatCurrency(r.product.purchasePrice)} {r.product.unitEnabled && r.product.unit ? `/${r.product.unit}` : ''}</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Selected ingredients list */}
        <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
          {lines.map((l) => (
            <div
              key={l._key}
              className={`rounded-xl p-3 border shadow-sm transition-all ${
                l.sourceType === 'fiche'
                  ? 'bg-pistachio/5 border-pistachio/20 hover:border-pistachio/40'
                  : 'bg-gradient-card border-gold/10 hover:border-gold/25'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary text-sm truncate flex items-center gap-1.5">
                    {l.sourceType === 'fiche' && (
                      <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px] px-1.5 py-0">Production</Badge>
                    )}
                    {l.productName}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {l.sourceType === 'fiche' ? 'Coût de revient' : "Prix d'achat"} :{' '}
                    {formatCurrency(l.unitCost)}{l.unit ? `/${l.unit}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(l._key)}
                  className="text-rose-deep p-1 hover:bg-rose-deep/10 rounded-lg transition-all shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Quantité utilisée + unité de CE produit dans la production */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">
                    {l.unit ? `Quantité utilisée (${l.unit})` : 'Quantité utilisée'}
                  </label>
                  <Input
                    type="number" step="any" min={0}
                    value={l.quantityUsed}
                    onChange={(e) => updateLineQty(l._key, Number(e.target.value))}
                    className="text-center"
                  />
                </div>
                <UnitSelect
                  label="Unité de ce produit"
                  value={l.unit || ''}
                  onChange={(u) => updateLineUnit(l._key, u)}
                  compact
                  allowDelete={false}
                />
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Coût de la ligne</p>
                  <p className="text-base font-bold tabular text-rose-deep">
                    {formatCurrency((Number(l.quantityUsed) || 0) * (Number(l.unitCost) || 0))}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="text-sm text-text-muted text-center py-6 bg-vanilla/40 rounded-xl border border-dashed border-gold/15">
              Aucun ingrédient ajouté — recherchez un produit du stock ci-dessus.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-gold/5 pt-4">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleSave} disabled={savingFiche}>
          {savingFiche ? 'Enregistrement…' : initial ? 'Mettre à jour' : 'Créer la Fiche'}
        </Button>
      </div>

      {/* Category Creation Modal */}
      <Modal open={catModal} onClose={() => setCatModal(false)} title="Ajouter une Catégorie de Formule" size="sm">
        <div className="space-y-4">
          <Input label="Nom de Catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCat(); } }} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCatModal(false)}>{t('cancel')}</Button>
            <Button type="button" variant="gold" onClick={handleAddCat}>{t('add')}</Button>
          </div>
        </div>
      </Modal>

      {/* Category Deletion Confirm */}
      <ConfirmDialog open={!!confirmDelCat} onClose={() => setConfirmDelCat(null)}
        onConfirm={() => {
          if (!confirmDelCat) return;
          void deleteCategory(confirmDelCat.id).then(() => {
            if (categoryId === confirmDelCat.id) setCategoryId('');
            toast.success('Catégorie supprimée');
          });
        }}
        title="Catégorie" message={`Voulez-vous supprimer « ${confirmDelCat?.name} » ?`} />
    </div>
  );
}

// -------------------------------------------------------------
// Form to Create Production from Fiche Technic
// -------------------------------------------------------------
function CreateProductionForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void | Promise<void> }) {
  const { t } = useLanguage();
  const products = useStockStore((s) => s.products);
  const { ficheTechnics } = useFicheTechnicStore();

  const [ficheSearch, setFicheSearch] = useState('');
  const [selectedFt, setSelectedFt] = useState<FicheTechnic | null>(null);
  
  // Production input details (loaded from FT, but quantity can be edited)
  const [productionQuantity, setProductionQuantity] = useState<number>(0);
  const [showFicheResults, setShowFicheResults] = useState(false);

  // Perte (production loss) option
  const [hasLoss, setHasLoss] = useState(false);
  const [realQuantity, setRealQuantity] = useState<number>(0);
  const [lossDescription, setLossDescription] = useState('');

  const ficheResults = useMemo(() => {
    if (!ficheSearch) return [];
    const q = ficheSearch.toLowerCase();
    return ficheTechnics.filter((ft) => ft.name.toLowerCase().includes(q)).slice(0, 6);
  }, [ficheSearch, ficheTechnics]);

  const selectFicheTechnic = (ft: FicheTechnic) => {
    setSelectedFt(ft);
    setProductionQuantity(ft.outputQuantity); // defaults to base recipe output
    setRealQuantity(ft.outputQuantity);
    setHasLoss(false);
    setLossDescription('');
    setFicheSearch('');
    setShowFicheResults(false);
    toast.success(`Fiche formule « ${ft.name} » chargée !`);
  };

  // Ratio calculations
  const ratio = useMemo(() => {
    if (!selectedFt || selectedFt.outputQuantity <= 0) return 1;
    return productionQuantity / selectedFt.outputQuantity;
  }, [selectedFt, productionQuantity]);

  // Scaled used products list
  const scaledUsedProducts = useMemo(() => {
    if (!selectedFt) return [];
    return selectedFt.usedProducts.map((u) => {
      const scaledQty = u.quantityUsed * ratio;
      const isFiche = u.sourceType === 'fiche';
      // Semi-finished (fiche) ingredients aren't tracked in raw stock, so they
      // never block production; keep the cost captured on the recipe line.
      // Fall back to matching by name if the id is stale (e.g. the product was
      // deleted and re-created since the recipe was saved) so real stock is
      // still found instead of showing a false "0 available".
      const stockProd = isFiche
        ? undefined
        : products.find((p) => p.id === u.productId) ??
          products.find((p) => p.name.trim().toLowerCase() === u.productName.trim().toLowerCase());
      const available = isFiche ? Infinity : (stockProd ? stockProd.currentQuantity : 0);
      const unitCost = isFiche ? (u.unitCost ?? 0) : (stockProd ? stockProd.purchasePrice : (u.unitCost ?? 0));
      const lineCost = scaledQty * unitCost;

      return {
        ...u,
        // Use the resolved product's real id so stock consumption on save
        // targets the actual product. An id that no longer exists is dropped:
        // sending it would silently skip the decrement on the database side.
        productId: isFiche ? u.productId : stockProd ? stockProd.id : '',
        isFiche,
        quantityUsed: Number(scaledQty.toFixed(4)),
        unitCost,
        lineCost: Number(lineCost.toFixed(2)),
        available,
        resolved: isFiche || !!stockProd,
      };
    });
  }, [selectedFt, ratio, products]);

  // Totals calculations based on scaled quantities
  const totalCost = useMemo(() => {
    return scaledUsedProducts.reduce((sum, u) => sum + u.lineCost, 0);
  }, [scaledUsedProducts]);

  const costPerUnit = useMemo(() => {
    return productionQuantity > 0 ? totalCost / productionQuantity : 0;
  }, [totalCost, productionQuantity]);

  // ---- Perte (loss) ----
  // The recipe attempts `productionQuantity` (expected) but the batch only
  // yielded `realQuantity`. The difference is the loss; the money value of the
  // loss is the raw-material cost that went into the missing quantity.
  const lossQuantity = useMemo(
    () => (hasLoss ? Math.max(0, productionQuantity - realQuantity) : 0),
    [hasLoss, productionQuantity, realQuantity]
  );
  const lossValue = useMemo(() => lossQuantity * costPerUnit, [lossQuantity, costPerUnit]);
  // Quantity actually saved with the production (after loss).
  const finalOutputQuantity = hasLoss ? realQuantity : productionQuantity;

  const totalValue = useMemo(() => {
    return selectedFt ? finalOutputQuantity * selectedFt.unitPrice : 0;
  }, [selectedFt, finalOutputQuantity]);

  const gainsPerUnit = useMemo(() => {
    return selectedFt ? selectedFt.unitPrice - costPerUnit : 0;
  }, [selectedFt, costPerUnit]);

  const totalGains = useMemo(() => {
    return totalValue - totalCost;
  }, [totalValue, totalCost]);

  // Verify stock levels
  const hasInsufficientStock = useMemo(() => {
    return scaledUsedProducts.some((u) => u.quantityUsed > u.available);
  }, [scaledUsedProducts]);

  /** Ingrédients qui ne correspondent à aucun produit du stock : la production
   *  serait enregistrée sans que rien ne soit déduit. */
  const unknownIngredients = useMemo(
    () => scaledUsedProducts.filter((u) => !u.resolved).map((u) => u.productName),
    [scaledUsedProducts]
  );

  const handleSave = () => {
    if (!selectedFt) { toast.error('Veuillez sélectionner une fiche technique'); return; }
    if (productionQuantity <= 0) { toast.error('La quantité de production doit être supérieure à 0'); return; }
    if (hasLoss) {
      if (realQuantity <= 0) { toast.error('La quantité réellement produite doit être supérieure à 0'); return; }
      if (realQuantity > productionQuantity) { toast.error('La quantité réelle ne peut pas dépasser la quantité prévue'); return; }
    }
    if (unknownIngredients.length > 0) {
      toast.error(
        `Matières introuvables dans le stock : ${unknownIngredients.join(', ')} — ` +
        'rattachez-les à un produit existant, sinon leurs quantités ne seront pas déduites.'
      );
      return;
    }
    if (hasInsufficientStock) {
      toast.error('Certains ingrédients ont un stock insuffisant. Impossible de valider la production.');
      return;
    }

    const lossActive = hasLoss && lossQuantity > 0;

    onSubmit({
      name: selectedFt.name,
      description: selectedFt.description || '',
      date: todayISO(),
      hour: nowTime(),
      categoryId: selectedFt.categoryId,
      categoryName: selectedFt.categoryName,
      usedProducts: scaledUsedProducts.map((u) => ({
        productId: u.productId,
        productName: u.productName,
        quantityUsed: u.quantityUsed,
        unit: u.unit,
        unitCost: u.unitCost,
        lineCost: u.lineCost,
        sourceType: u.sourceType ?? 'stock',
      })),
      outputQuantity: Number(finalOutputQuantity),
      unitPrice: Number(selectedFt.unitPrice),
      sellByUnit: selectedFt.sellByUnit,
      sellUnit: selectedFt.sellUnit,
      hasLoss: lossActive || undefined,
      expectedQuantity: lossActive ? Number(productionQuantity) : undefined,
      lossQuantity: lossActive ? Number(lossQuantity) : undefined,
      lossDescription: lossActive ? lossDescription.trim() : undefined,
      lossValue: lossActive ? Number(lossValue) : undefined,
    });
  };

  return (
    <div className="space-y-5">
      {/* Search and Select Fiche Technic */}
      <div className="bg-vanilla/30 p-4 rounded-xl border border-gold/15 relative">
        <label className="block text-sm font-semibold text-text-primary mb-1.5">Rechercher &amp; Charger Fiche Technique *</label>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input 
            value={ficheSearch} 
            onChange={(e) => { setFicheSearch(e.target.value); setShowFicheResults(true); }} 
            onFocus={() => setShowFicheResults(true)}
            placeholder="Rechercher par nom de fiche technique..." 
            className="pl-10" 
          />
          {showFicheResults && ficheResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-[--surface-dropdown] rounded-xl border border-gold/20 shadow-lg max-h-[220px] overflow-y-auto">
              {ficheResults.map((ft) => (
                <button key={ft.id} type="button" onClick={() => selectFicheTechnic(ft)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10 flex justify-between items-center border-b border-gold/5 last:border-0">
                  <div>
                    <span className="font-semibold text-text-primary">{ft.name}</span>
                    <span className="text-xs text-text-muted ml-2">({ft.categoryName})</span>
                  </div>
                  <span className="text-xs font-semibold text-gold-dark">Rendement base: {ft.outputQuantity}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {ficheSearch && ficheResults.length === 0 && (
          <p className="text-xs text-rose-deep mt-1">Aucune fiche technique correspondante. Veuillez d'abord en créer une.</p>
        )}
      </div>

      {selectedFt ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
          {/* Left panel: loaded recipe information */}
          <div className="space-y-4 bg-vanilla/10 p-4 rounded-xl border border-gold/10">
            <div className="flex justify-between items-start border-b border-gold/5 pb-2">
              <div>
                <h4 className="font-display font-semibold text-base text-text-primary">{selectedFt.name}</h4>
                <p className="text-xs text-text-muted">Catégorie: {selectedFt.categoryName}</p>
              </div>
              <Badge variant="warning" className="bg-gold/10 text-gold-dark border-0">Rendement base: {selectedFt.outputQuantity}</Badge>
            </div>

            {selectedFt.description && (
              <p className="text-xs text-text-secondary bg-vanilla/40 p-2.5 rounded-lg italic">« {selectedFt.description} »</p>
            )}

            {/* Input to scale production */}
            <div className="bg-vanilla/60 p-3 rounded-xl border border-gold/10 space-y-2">
              <label className="block text-xs font-bold text-text-secondary">
                {selectedFt.sellByUnit && selectedFt.sellUnit ? `Modifier la Quantité à Produire (${selectedFt.sellUnit})` : 'Modifier la Quantité à Produire'}
              </label>
              <div className="flex items-center gap-3">
                <Input 
                  type="number" 
                  step="any" 
                  value={productionQuantity} 
                  onChange={(e) => setProductionQuantity(Math.max(0, Number(e.target.value)))} 
                  className="text-lg font-bold text-center tabular max-w-[150px]"
                />
                <div className="text-xs text-text-muted">
                  <p>Facteur d'échelle: <span className="font-semibold text-gold-dark">{ratio.toFixed(2)}x</span></p>
                  <p className="mt-0.5">Formule de base: {selectedFt.outputQuantity} {selectedFt.sellUnit || 'unités'}</p>
                </div>
              </div>
            </div>

            {/* Perte (production loss) */}
            <div className={`p-3 rounded-xl border space-y-2.5 transition-colors ${hasLoss ? 'bg-rose-deep/5 border-rose-deep/25' : 'bg-vanilla/60 border-gold/10'}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className={hasLoss ? 'text-rose-deep' : 'text-text-muted'} />
                <Switch
                  checked={hasLoss}
                  onChange={(v) => { setHasLoss(v); if (v) setRealQuantity(productionQuantity); }}
                  label={t('enableLoss')}
                />
              </div>
              {hasLoss && (
                <div className="space-y-2.5 animate-fadeIn">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-text-muted mb-0.5">{t('expectedQty')}</label>
                      <div className="h-9 flex items-center px-2.5 rounded-lg bg-vanilla/40 border border-gold/10 text-sm font-bold tabular text-text-secondary">
                        {productionQuantity}{selectedFt.sellUnit ? ` ${selectedFt.sellUnit}` : ''}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-rose-deep mb-0.5">{t('realProducedQty')}</label>
                      <Input
                        type="number"
                        step="any"
                        value={realQuantity}
                        onChange={(e) => setRealQuantity(Math.max(0, Number(e.target.value)))}
                        className="text-sm font-bold text-center tabular"
                      />
                    </div>
                  </div>
                  <Textarea
                    label={t('lossDescriptionLabel')}
                    value={lossDescription}
                    onChange={(e) => setLossDescription(e.target.value)}
                    placeholder="Ex: évaporation, casse, non conforme…"
                    rows={2}
                  />
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-rose-deep/10">
                    <div className="text-center bg-rose-deep/10 rounded-lg py-1.5">
                      <p className="text-[10px] text-rose-deep">{t('lossQty')}</p>
                      <p className="text-sm font-bold text-rose-deep tabular">{lossQuantity}{selectedFt.sellUnit ? ` ${selectedFt.sellUnit}` : ''}</p>
                    </div>
                    <div className="text-center bg-rose-deep/10 rounded-lg py-1.5">
                      <p className="text-[10px] text-rose-deep">{t('lossValueLabel')}</p>
                      <p className="text-sm font-bold text-rose-deep tabular">{formatCurrency(lossValue)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-text-muted">
                    Quantité enregistrée: <span className="font-bold text-gold-dark">{finalOutputQuantity}{selectedFt.sellUnit ? ` ${selectedFt.sellUnit}` : ''}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Scale-based price statistics */}
            <div className="bg-vanilla/60 p-3 rounded-xl border border-gold/10 space-y-2 text-xs">
              <h5 className="font-semibold text-text-secondary border-b border-gold/5 pb-1">Calculs et Profits Recalculés:</h5>
              <div className="flex justify-between">
                <span>Coût de production total:</span>
                <span className="font-semibold text-rose-deep tabular">{formatCurrency(totalCost)}</span>
              </div>
              <div className="flex justify-between">
                <span>Coût de revient / unité:</span>
                <span className="font-bold text-rose-deep tabular">{formatCurrency(costPerUnit)}</span>
              </div>
              <div className="flex justify-between">
                <span>Chiffre d'affaires estimé:</span>
                <span className="font-semibold text-gold-dark tabular">{formatCurrency(totalValue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Gain par unité:</span>
                <span className={`font-semibold tabular ${gainsPerUnit >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>{formatCurrency(gainsPerUnit)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-gold/5 pt-1.5 mt-1.5">
                <span>Total gains de production:</span>
                <span className={`tabular ${totalGains >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>{formatCurrency(totalGains)}</span>
              </div>
            </div>
          </div>

          {/* Right panel: scaled ingredients and stock check */}
          <div className="bg-vanilla/10 p-4 rounded-xl border border-gold/10 flex flex-col">
            <h4 className="font-display font-semibold text-sm text-text-secondary border-b border-gold/5 pb-2 mb-3">
              Dosage Proportionnel des Composants
            </h4>

            {hasInsufficientStock && (
              <div className="bg-rose-deep/10 text-rose-deep border border-rose-deep/20 p-2.5 rounded-xl text-xs mb-3 flex items-start gap-2 animate-bounce">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Stock Insuffisant !</p>
                  <p className="mt-0.5">Impossible de valider cette production. Veuillez d'abord réapprovisionner les composants manquants (indiqués en rouge).</p>
                </div>
              </div>
            )}

            <div className="space-y-2 overflow-y-auto max-h-[350px] pr-1">
              {scaledUsedProducts.map((u) => {
                const isInsufficient = !u.isFiche && u.quantityUsed > u.available;
                return (
                  <div key={u.productId} className={`p-3 rounded-xl border transition-all ${
                    isInsufficient
                      ? 'bg-rose-deep/5 border-rose-deep/30'
                      : u.isFiche
                        ? 'bg-pistachio/5 border-pistachio/20'
                        : 'bg-gradient-card border-gold/10'
                  }`}>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-semibold text-xs text-text-primary truncate flex items-center gap-1.5">
                        {u.isFiche && <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px] px-1.5 py-0">Production</Badge>}
                        {u.productName}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        u.isFiche ? 'bg-pistachio/15 text-pistachio' : isInsufficient ? 'bg-rose-deep/15 text-rose-deep' : 'bg-pistachio/15 text-pistachio'
                      }`}>
                        {u.isFiche ? 'Semi-fini' : `Stock: ${u.available} ${u.unit || ''}`}
                      </span>
                    </div>

                    <div className="flex justify-between items-end mt-2">
                      <div className="text-[10px] text-text-muted">
                        Dosage FT: {u.quantityUsed / ratio} {u.unit || ''}
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-text-muted block">Requis (Dosé)</span>
                        <span className={`text-xs font-bold tabular ${isInsufficient ? 'text-rose-deep' : 'text-text-secondary'}`}>
                          {u.quantityUsed} {u.unit || ''}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-text-muted block">Coût estimé</span>
                        <span className="text-xs font-bold text-rose-deep tabular">{formatCurrency(u.lineCost)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-vanilla/10 rounded-xl p-8 border border-dashed border-gold/10 text-center text-text-muted">
          <BookOpen size={36} className="mx-auto text-gold mb-3 opacity-60" />
          <p className="text-sm">Veuillez d'abord rechercher et sélectionner une fiche technique (formule de base) ci-dessus pour lancer la production.</p>
        </div>
      )}

      <div className="flex justify-end gap-3 border-t border-gold/5 pt-4">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleSave} disabled={!selectedFt || hasInsufficientStock}>
          Valider la Production
        </Button>
      </div>
    </div>
  );
}
