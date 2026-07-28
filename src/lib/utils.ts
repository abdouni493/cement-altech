import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = 'id') {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

// Format currency: "1 550,00 DA"
export function formatCurrency(amount: number): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  // Intl uses non-breaking spaces; keep them for nice grouping
  return `${formatted} DA`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value || 0);
}

// Format date DD/MM/YYYY (fr) or YYYY/MM/DD (ar)
export function formatDate(dateStr: string | Date, lang: 'fr' | 'ar' = 'fr'): string {
  if (!dateStr) return '—';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return String(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return lang === 'ar' ? `${year}/${month}/${day}` : `${day}/${month}/${year}`;
}

export function formatDateTime(dateStr: string | Date, lang: 'fr' | 'ar' = 'fr'): string {
  if (!dateStr) return '—';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return String(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return lang === 'ar'
    ? `${year}/${month}/${day} ${hours}:${minutes}`
    : `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Days difference from today
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function isWithinRange(dateStr: string, from: string, to: string): boolean {
  const d = new Date(dateStr).getTime();
  return d >= new Date(from).getTime() && d <= new Date(to + 'T23:59:59').getTime();
}

// Date filter helpers for "today / week / month"
export type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';

export function matchesDateFilter(
  dateStr: string,
  filter: DateFilter,
  customFrom?: string,
  customTo?: string
): boolean {
  if (filter === 'all') return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (filter === 'today') {
    return d.toDateString() === now.toDateString();
  }
  if (filter === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);
    return d >= weekAgo && d <= now;
  }
  if (filter === 'month') {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  if (filter === 'custom' && customFrom && customTo) {
    return isWithinRange(dateStr, customFrom, customTo);
  }
  return true;
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function getMonthLabel(dateStr: string): string {
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const d = new Date(dateStr);
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}
