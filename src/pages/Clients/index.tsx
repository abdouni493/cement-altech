import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Eye, Pencil, Trash2, Phone, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ClientForm } from '@/components/shared/ClientForm';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { useClientStore } from '@/store/clientStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Client, Sale } from '@/types';
import type { Command } from '@/store/commandStore';

export default function ClientsPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { clients, addClient, updateClient, deleteClient } = useClientStore();
  const { sales, payDebt } = useSalesStore();
  const { commands } = useCommandStore();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [historyClient, setHistoryClient] = useState<Client | null>(null);
  const [historyTab, setHistoryTab] = useState<'sales' | 'commands'>('sales');
  const [paying, setPaying] = useState<Sale | null>(null);
  const [payingCmd, setPayingCmd] = useState<Command | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const stats = (clientId: string) => {
    const cs = sales.filter((s) => s.clientId === clientId);
    const cc = commands.filter((c) => c.clientId === clientId);
    return {
      count: cs.length,
      total: cs.reduce((s, x) => s + x.finalAmount, 0),
      paid: cs.reduce((s, x) => s + x.paidAmount, 0),
      rest: cs.reduce((s, x) => s + x.restAmount, 0),
      list: cs,
      commandsCount: cc.length,
      commandsTotal: cc.reduce((s, x) => s + x.totalAmount, 0),
      commandsPaid: cc.reduce((s, x) => s + x.paidAmount, 0),
      commandsRest: cc.reduce((s, x) => s + x.restAmount, 0),
      commandsList: cc,
    };
  };

  const filtered = useMemo(() => clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)), [clients, search]);

  const handleSubmit = (data: Omit<Client, 'id'>) => {
    if (editing) { updateClient(editing.id, data); toast.success('Client modifié'); }
    else { addClient(data); toast.success('Client créé'); }
    setFormOpen(false); setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('clients')} icon={<Users size={24} />} subtitle={`${clients.length} clients`}
        actions={
          <div className="flex gap-2">
            {can('clients', 'create') && <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={18} /> {t('newClient')}</Button>}
          </div>
        } />

      <div className="mb-6 max-w-md"><SearchBar value={search} onChange={setSearch} placeholder={`${t('search')} (nom / téléphone)`} /></div>

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c, i) => {
            const st = stats(c.id);
            const totalDette = st.rest + st.commandsRest;
            return (
              <Card key={c.id} index={i} hoverable className="flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-11 w-11 rounded-full bg-gradient-rose flex items-center justify-center text-white font-semibold">{c.name[0]}</div>
                  <div className="min-w-0"><h3 className="font-display font-semibold text-text-primary truncate">{c.name}</h3>
                    <p className="text-xs text-text-muted flex items-center gap-1"><Phone size={11} /> {c.phone}</p></div>
                </div>
                <div className="bg-vanilla/40 rounded-xl p-3 space-y-1 text-sm mb-3">
                  <div className="flex justify-between"><span className="text-text-muted">Achats Comptoir</span><span className="tabular">{st.count} ({formatCurrency(st.total)})</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">Commandes</span><span className="tabular">{st.commandsCount} ({formatCurrency(st.commandsTotal)})</span></div>
                  {totalDette > 0 && <div className="flex justify-between"><span className="text-text-muted">Total Dettes</span><span className="tabular text-rose-deep font-bold">{formatCurrency(totalDette)}</span></div>}
                </div>
                {totalDette > 0 && <Badge variant="danger" className="mb-3 self-start">Dette {formatCurrency(totalDette)}</Badge>}
                <div className="flex gap-1.5 mt-auto">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => { setHistoryClient(c); setHistoryTab('sales'); }}><Eye size={14} /> {t('viewHistory')}</Button>
                  {can('clients', 'edit') && <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setFormOpen(true); }}><Pencil size={14} /></Button>}
                  {can('clients', 'delete') && <Button size="sm" variant="ghost" onClick={() => setDeleteId(c.id)}><Trash2 size={14} className="text-rose-deep" /></Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit') : t('newClient')} size="sm">
        <ClientForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      <Modal open={!!historyClient} onClose={() => setHistoryClient(null)} title={historyClient?.name} size="lg">
        {historyClient && (() => {
          const st = stats(historyClient.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Tile label="Total Comptoir + Commandes" value={formatCurrency(st.total + st.commandsTotal)} />
                <Tile label={t('totalPaid')} value={formatCurrency(st.paid + st.commandsPaid)} color="text-pistachio" />
                <Tile label={t('totalRest')} value={formatCurrency(st.rest + st.commandsRest)} color="text-rose-deep" />
              </div>

              {/* Tab Selector */}
              <div className="flex gap-2 border-b border-gold/15 mb-3">
                <button
                  onClick={() => setHistoryTab('sales')}
                  className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all ${historyTab === 'sales' ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'}`}
                >
                  Achats Comptoir ({st.list.length})
                </button>
                <button
                  onClick={() => setHistoryTab('commands')}
                  className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all ${historyTab === 'commands' ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'}`}
                >
                  Commandes ({st.commandsList.length})
                </button>
              </div>

              {historyTab === 'sales' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">N°</th><th className="text-left px-3 py-2">{t('date')}</th><th className="text-right px-3 py-2">{t('total')}</th><th className="text-right px-3 py-2">{t('rest')}</th><th className="px-3 py-2">{t('status')}</th></tr></thead>
                    <tbody>{st.list.map((s) => (
                      <tr key={s.id} className="border-t border-gold/10">
                        <td className="px-3 py-2">{s.reference}</td><td className="px-3 py-2">{formatDate(s.date, language)}</td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(s.finalAmount)}</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(s.restAmount)}</td>
                        <td className="px-3 py-2 text-center">{s.restAmount > 0 ? <Button size="sm" variant="gold" onClick={() => setPaying(s)}>{t('pay')}</Button> : <Badge variant="success">OK</Badge>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {st.list.length === 0 && <p className="text-center text-text-muted py-6">{t('noData')}</p>}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60">
                      <tr>
                        <th className="text-left px-3 py-2">N° Commandes</th>
                        <th className="text-left px-3 py-2">Créée le</th>
                        <th className="text-left px-3 py-2">Livraison</th>
                        <th className="text-right px-3 py-2">{t('total')}</th>
                        <th className="text-right px-3 py-2">Reste</th>
                        <th className="text-center px-3 py-2">Statut</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {st.commandsList.map((cmd) => (
                        <tr key={cmd.id} className="border-t border-gold/10">
                          <td className="px-3 py-2 font-medium">{cmd.reference}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary">{formatDate(cmd.createdAt.slice(0, 10), language)}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary">
                            {formatDate(cmd.receiveDate, language)} à {cmd.receiveHour}h{cmd.receiveMinute}
                          </td>
                          <td className="px-3 py-2 text-right tabular">{formatCurrency(cmd.totalAmount)}</td>
                          <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(cmd.restAmount)}</td>
                          <td className="px-3 py-2 text-center">
                            {cmd.status === 'finalised' ? (
                              <Badge variant="success">Finalisée</Badge>
                            ) : (
                              <Badge variant="warning">En attente</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {cmd.restAmount > 0 && (
                              <Button size="sm" variant="gold" onClick={() => setPayingCmd(cmd)}>{t('pay')}</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {st.commandsList.length === 0 && <p className="text-center text-text-muted py-6">{t('noData')}</p>}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {paying && <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={historyClient?.name || ''} total={paying.finalAmount} paid={paying.paidAmount} onPay={(a, d) => payDebt(paying.id, a, d)} />}

      {payingCmd && (
        <PayDebtModal
          open={!!payingCmd}
          onClose={() => setPayingCmd(null)}
          reference={payingCmd.reference}
          partyName={historyClient?.name || ''}
          total={payingCmd.totalAmount}
          paid={payingCmd.paidAmount}
          onPay={(a, d) => {
            useCommandStore.getState().payDebt(payingCmd.id, a, d);
            toast.success('Règlement de commande enregistré');
            setPayingCmd(null);
          }}
        />
      )}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { deleteClient(deleteId); toast.success('Client supprimé'); } }} />
    </div>
  );
}

function Tile({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return <div className="bg-vanilla/40 rounded-xl p-3 text-center"><p className="text-xs text-text-muted mb-0.5">{label}</p><p className={`text-base font-bold tabular ${color}`}>{value}</p></div>;
}
