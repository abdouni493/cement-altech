import { useMemo, useState } from 'react';
import {
  FileBarChart, Printer, Banknote, Clock, Wallet, CalendarX, RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  PeriodPicker, ReportKpis, ReportSection, firstDayOfMonth, inPeriod,
} from '@/components/shared/PeriodReport';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { printDetailedReport, type PrintRow, type PrintTableSection } from '@/lib/reportPrint';
import { hasTimes } from '@/store/workerStore';
import type { Worker } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Rapport détaillé d'un employé sur une période : acomptes, absences, heures
 * supplémentaires et historique des paiements, avec tous les détails et une
 * impression professionnelle.
 */
export function WorkerReport({ worker, roleName }: { worker: Worker; roleName?: string }) {
  const { language } = useLanguage();
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  const data = useMemo(() => {
    if (!period) return null;
    const { from: f, to: t } = period;

    const payments = worker.payments
      .filter((p) => inPeriod(p.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));
    const overtimes = (worker.overtimes ?? [])
      .filter((o) => inPeriod(o.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));
    const acomptes = worker.acomptes
      .filter((a) => inPeriod(a.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));
    const absences = worker.absences
      .filter((a) => inPeriod(a.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));

    const salaryPaid = payments.filter((p) => p.kind !== 'overtime').reduce((s, p) => s + p.amount, 0);
    const overtimePaid = payments.filter((p) => p.kind === 'overtime').reduce((s, p) => s + p.amount, 0);
    const overtimeHours = overtimes.reduce((s, o) => s + o.hours, 0);
    const overtimeAmount = overtimes.reduce((s, o) => s + o.amount, 0);
    const overtimeUnpaid = overtimes.filter((o) => !o.isPaid).reduce((s, o) => s + o.amount, 0);
    const acomptesTotal = acomptes.reduce((s, a) => s + a.amount, 0);
    const absencesCost = absences.reduce((s, a) => s + a.cost, 0);

    // Salaire de base de la période : mensuel → montant × mois couverts,
    // journalier → montant × jours de la période.
    const start = new Date(f), end = new Date(t);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const months = Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
    const baseUnits = worker.paymentType === 'monthly' ? months : days;
    const baseSalary = worker.paymentEnabled ? worker.paymentAmount * baseUnits : 0;
    const netToPay = (baseSalary + overtimeAmount) - (acomptesTotal + absencesCost);

    return {
      baseSalary, baseUnits, netToPay,
      payments, overtimes, acomptes, absences,
      salaryPaid, overtimePaid, overtimeHours, overtimeAmount, overtimeUnpaid,
      acomptesTotal, absencesCost,
      totalPaid: salaryPaid + overtimePaid,
    };
  }, [worker, period]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  const baseDetail = data
    ? worker.paymentEnabled
      ? `${formatCurrency(worker.paymentAmount)} × ${data.baseUnits} ${worker.paymentType === 'monthly' ? 'mois' : 'jour(s)'}`
      : 'Non défini'
    : '';

  const doPrint = () => {
    if (!data || !period) return;

    const paymentsSection: PrintTableSection = {
      title: 'Historique des paiements',
      icon: '💵',
      headerTotal: formatCurrency(data.totalPaid),
      cols: [
        { label: 'Date' }, { label: 'Type' }, { label: 'Période / motif' },
        { label: 'Description' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.payments.map<PrintRow>((p) => ({
          cells: [
            formatDate(p.date, language),
            p.kind === 'overtime' ? 'Heures sup.' : 'Salaire',
            p.period || '—',
            p.description || '—',
            formatCurrency(p.amount),
          ],
          tone: 'pos',
        })),
        ...(data.payments.length
          ? [{
              cells: ['TOTAL VERSÉ', '', '', '', formatCurrency(data.totalPaid)],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucun paiement sur la période',
    };

    const overtimeSection: PrintTableSection = {
      title: 'Heures supplémentaires',
      icon: '⏱️',
      headerTotal: formatCurrency(data.overtimeAmount),
      note: `${data.overtimeHours.toFixed(2)} heure(s) au total · ${formatCurrency(data.overtimeUnpaid)} restant à payer`,
      cols: [
        { label: 'Date' }, { label: 'Fin de poste' }, { label: 'Fin des heures sup.' },
        { label: 'Durée', align: 'right' }, { label: 'Taux horaire', align: 'right' },
        { label: 'Montant', align: 'right' }, { label: 'Statut', align: 'center' },
        { label: 'Motif' },
      ],
      rows: [
        ...data.overtimes.map<PrintRow>((o) => ({
          cells: [
            formatDate(o.date, language),
            (hasTimes(o) ? `${pad(o.workEndHour)}:${pad(o.workEndMinute)}` : '—'),
            (hasTimes(o) ? `${pad(o.overtimeEndHour)}:${pad(o.overtimeEndMinute)}` : '—'),
            `${o.hours.toFixed(2)} h`,
            formatCurrency(o.hourlyRate),
            formatCurrency(o.amount),
            o.isPaid ? 'Payée' : 'Non payée',
            o.description || '—',
          ],
        })),
        ...(data.overtimes.length
          ? [{
              cells: ['TOTAL HEURES SUP.', '', '', `${data.overtimeHours.toFixed(2)} h`, '',
                formatCurrency(data.overtimeAmount), '', ''],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune heure supplémentaire sur la période',
    };

    const acompteSection: PrintTableSection = {
      title: 'Acomptes versés',
      icon: '🪙',
      headerTotal: formatCurrency(data.acomptesTotal),
      cols: [{ label: 'Date' }, { label: 'Description' }, { label: 'Montant', align: 'right' }],
      rows: [
        ...data.acomptes.map<PrintRow>((a) => ({
          cells: [formatDate(a.date, language), a.description || '—', formatCurrency(a.amount)],
          tone: 'accent',
        })),
        ...(data.acomptes.length
          ? [{ cells: ['TOTAL ACOMPTES', '', formatCurrency(data.acomptesTotal)], variant: 'total' as const }]
          : []),
      ],
      emptyLabel: 'Aucun acompte sur la période',
    };

    const absenceSection: PrintTableSection = {
      title: 'Absences',
      icon: '📅',
      headerTotal: formatCurrency(data.absencesCost),
      cols: [{ label: 'Date' }, { label: 'Motif' }, { label: 'Coût retenu', align: 'right' }],
      rows: [
        ...data.absences.map<PrintRow>((a) => ({
          cells: [formatDate(a.date, language), a.description || '—', formatCurrency(a.cost)],
          tone: 'neg',
        })),
        ...(data.absences.length
          ? [{ cells: ['TOTAL ABSENCES', '', formatCurrency(data.absencesCost)], variant: 'total' as const }]
          : []),
      ],
      emptyLabel: 'Aucune absence sur la période',
    };

    const netSection: PrintTableSection = {
      title: 'Net à payer',
      icon: '🧾',
      headerTotal: formatCurrency(data.netToPay),
      note: '(Salaire de base + heures sup.) − (acomptes + absences)',
      cols: [{ label: 'Élément' }, { label: 'Détail' }, { label: 'Montant', align: 'right' }],
      rows: [
        { cells: ['Salaire de base', baseDetail, formatCurrency(data.baseSalary)], tone: 'pos' },
        { cells: ['+ Heures supplémentaires', `${data.overtimeHours.toFixed(2)} h`, formatCurrency(data.overtimeAmount)], tone: 'pos' },
        { cells: ['− Acomptes', `${data.acomptes.length} acompte(s)`, formatCurrency(data.acomptesTotal)], tone: 'neg' },
        { cells: ['− Absences', `${data.absences.length} absence(s)`, formatCurrency(data.absencesCost)], tone: 'neg' },
        { cells: ['NET À PAYER', '', formatCurrency(data.netToPay)], variant: 'total' },
      ],
      emptyLabel: '',
    };

    printDetailedReport(
      {
        docTitle: `Rapport ${worker.fullName}`,
        headTitle: 'RAPPORT EMPLOYÉ',
        subtitle: periodLabel,
        meta: [
          { label: 'Employé', value: worker.fullName },
          { label: 'Poste', value: roleName || '—' },
          { label: 'Téléphone', value: worker.phone || '—' },
          { label: 'Carte identité', value: worker.idCardNumber || '—' },
          { label: 'Embauché le', value: worker.startDate ? formatDate(worker.startDate, language) : '—' },
          {
            label: 'Salaire',
            value: worker.paymentEnabled
              ? `${formatCurrency(worker.paymentAmount)} / ${worker.paymentType === 'monthly' ? 'mois' : 'jour'}`
              : '—',
          },
          { label: 'Période', value: periodLabel },
        ],
        kpis: [
          { label: 'Salaires payés', value: formatCurrency(data.salaryPaid), tone: 'pos' },
          { label: 'Heures sup. payées', value: formatCurrency(data.overtimePaid), tone: 'pos' },
          { label: 'Heures sup. à payer', value: formatCurrency(data.overtimeUnpaid), tone: 'neg' },
          { label: 'Total heures sup.', value: `${data.overtimeHours.toFixed(2)} h`, tone: 'accent' },
          { label: 'Acomptes', value: formatCurrency(data.acomptesTotal), tone: 'accent' },
          { label: 'Coût des absences', value: formatCurrency(data.absencesCost), tone: 'neg' },
          { label: 'Total versé', value: formatCurrency(data.totalPaid), tone: 'pos' },
          { label: 'Net à payer', value: formatCurrency(data.netToPay), tone: 'accent' },
        ],
        sections: [paymentsSection, overtimeSection, acompteSection, absenceSection, netSection],
      },
      settings,
      language
    );
  };

  return (
    <div className="space-y-5">
      <PeriodPicker
        from={from}
        to={to}
        onChange={(f, t) => { setFrom(f); setTo(t); setPeriod(null); }}
        onGenerate={() => setPeriod({ from, to })}
        label="Créer le rapport de l'employé"
      />

      {!data ? (
        <div className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center">
          <FileBarChart size={34} className="mx-auto text-gold opacity-60 mb-3" />
          <p className="text-sm text-text-muted">
            Choisissez une date de début et une date de fin, puis créez le rapport détaillé.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-display text-base font-semibold text-text-primary">{worker.fullName}</p>
              <p className="text-xs text-text-muted">{roleName ? `${roleName} · ` : ''}{periodLabel}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                <RotateCcw size={14} /> Changer la période
              </Button>
              <Button size="sm" variant="gold" onClick={doPrint}>
                <Printer size={14} /> Imprimer le rapport
              </Button>
            </div>
          </div>

          <ReportKpis
            items={[
              { label: 'Salaires payés', value: formatCurrency(data.salaryPaid), color: 'text-pistachio' },
              { label: 'H. sup. payées', value: formatCurrency(data.overtimePaid), color: 'text-gold-dark' },
              { label: 'H. sup. à payer', value: formatCurrency(data.overtimeUnpaid), color: 'text-rose-deep' },
              { label: 'Total heures sup.', value: `${data.overtimeHours.toFixed(2)} h` },
              { label: 'Acomptes', value: formatCurrency(data.acomptesTotal), color: 'text-caramel' },
              { label: 'Coût des absences', value: formatCurrency(data.absencesCost), color: 'text-rose-deep' },
              { label: 'Total versé', value: formatCurrency(data.totalPaid), color: 'text-pistachio' },
              { label: 'Net à payer', value: formatCurrency(data.netToPay), color: 'text-gold-dark' },
            ]}
          />

          <ReportSection
            title="Historique des paiements" icon={<Banknote size={14} />}
            total={formatCurrency(data.totalPaid)}
            head={['Date', 'Type', 'Période / motif', 'Description', 'Montant']}
            empty="Aucun paiement sur cette période"
            rows={data.payments.map((p) => [
              formatDate(p.date, language),
              <Badge key="t" variant={p.kind === 'overtime' ? 'warning' : 'info'}>
                {p.kind === 'overtime' ? 'Heures sup.' : 'Salaire'}
              </Badge>,
              p.period || '—',
              p.description || '—',
              <span key="a" className="font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
            ]).concat(data.payments.length ? [[
              <b key="tl">TOTAL VERSÉ</b>, '', '', '', <b key="a" className="text-pistachio">{formatCurrency(data.totalPaid)}</b>,
            ]] : [])}
          />

          <ReportSection
            title="Heures supplémentaires" icon={<Clock size={14} />}
            total={formatCurrency(data.overtimeAmount)}
            note={`${data.overtimeHours.toFixed(2)} heure(s) · ${formatCurrency(data.overtimeUnpaid)} restant à payer`}
            head={['Date', 'Fin de poste', 'Fin h. sup.', 'Durée', 'Taux', 'Montant', 'Statut', 'Motif']}
            empty="Aucune heure supplémentaire sur cette période"
            rows={data.overtimes.map((o) => [
              formatDate(o.date, language),
              (hasTimes(o) ? `${pad(o.workEndHour)}:${pad(o.workEndMinute)}` : '—'),
              (hasTimes(o) ? `${pad(o.overtimeEndHour)}:${pad(o.overtimeEndMinute)}` : '—'),
              `${o.hours.toFixed(2)} h`,
              formatCurrency(o.hourlyRate),
              <span key="a" className="font-bold text-gold-dark">{formatCurrency(o.amount)}</span>,
              <Badge key="s" variant={o.isPaid ? 'success' : 'warning'}>{o.isPaid ? 'Payée' : 'Non payée'}</Badge>,
              o.description || '—',
            ]).concat(data.overtimes.length ? [[
              <b key="tl">TOTAL</b>, '', '', <b key="h">{data.overtimeHours.toFixed(2)} h</b>, '',
              <b key="a" className="text-gold-dark">{formatCurrency(data.overtimeAmount)}</b>, '', '',
            ]] : [])}
          />

          <ReportSection
            title="Acomptes versés" icon={<Wallet size={14} />}
            total={formatCurrency(data.acomptesTotal)}
            head={['Date', 'Description', 'Montant']}
            empty="Aucun acompte sur cette période"
            rows={data.acomptes.map((a) => [
              formatDate(a.date, language),
              a.description || '—',
              <span key="a" className="font-bold text-caramel">{formatCurrency(a.amount)}</span>,
            ]).concat(data.acomptes.length ? [[
              <b key="tl">TOTAL ACOMPTES</b>, '', <b key="a" className="text-caramel">{formatCurrency(data.acomptesTotal)}</b>,
            ]] : [])}
          />

          <ReportSection
            title="Absences" icon={<CalendarX size={14} />}
            total={formatCurrency(data.absencesCost)}
            head={['Date', 'Motif', 'Coût retenu']}
            empty="Aucune absence sur cette période"
            rows={data.absences.map((a) => [
              formatDate(a.date, language),
              a.description || '—',
              <span key="a" className="font-bold text-rose-deep">{formatCurrency(a.cost)}</span>,
            ]).concat(data.absences.length ? [[
              <b key="tl">TOTAL ABSENCES</b>, '', <b key="a" className="text-rose-deep">{formatCurrency(data.absencesCost)}</b>,
            ]] : [])}
          />

          <ReportSection
            title="Net à payer" icon={<Banknote size={14} />}
            total={formatCurrency(data.netToPay)}
            note="(Salaire de base + heures sup.) − (acomptes + absences)"
            head={['Élément', 'Détail', 'Montant']}
            empty=""
            rows={[
              ['Salaire de base', baseDetail, <span key="a" className="font-bold text-pistachio">{formatCurrency(data.baseSalary)}</span>],
              ['+ Heures supplémentaires', `${data.overtimeHours.toFixed(2)} h`, <span key="a" className="font-bold text-pistachio">{formatCurrency(data.overtimeAmount)}</span>],
              ['− Acomptes', `${data.acomptes.length} acompte(s)`, <span key="a" className="font-bold text-rose-deep">{formatCurrency(data.acomptesTotal)}</span>],
              ['− Absences', `${data.absences.length} absence(s)`, <span key="a" className="font-bold text-rose-deep">{formatCurrency(data.absencesCost)}</span>],
              [<b key="tl">NET À PAYER</b>, '', <b key="a" className="text-base text-gold-dark">{formatCurrency(data.netToPay)}</b>],
            ]}
          />
        </div>
      )}
    </div>
  );
}
