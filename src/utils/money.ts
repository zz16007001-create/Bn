/**
 * Integer-piastre monetary utilities.
 * Every monetary figure in IndexedDB is stored strictly as integer piastres (1 EGP = 100 piastres)
 * to eliminate IEEE-754 floating-point drift.
 */

export function assertPiastres(value: number, fieldName = 'amount'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`قيمة غير صالحة للحقل (${fieldName}): يجب أن تكون عدداً صحيحاً بالقروش.`);
  }
  return value;
}

export function toPiastres(egpValue: string | number): number {
  const cleaned = typeof egpValue === 'number' ? String(egpValue) : egpValue.trim().replace(/,/g, '');
  if (!cleaned) {
    return 0;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100);
}

export function fromPiastres(piastres: number): number {
  return Math.round(piastres) / 100;
}

export function formatEGP(piastres: number, currencySymbol = 'ج.م'): string {
  const safe = Number.isFinite(piastres) ? Math.round(piastres) : 0;
  const egp = safe / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(egp);
  return `${formatted} ${currencySymbol}`;
}
