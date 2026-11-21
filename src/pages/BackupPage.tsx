import {
  Check,
  Database,
  Download,
  HardDrive,
  Lock,
  Share2,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {CURRENT_DB_VERSION} from '../db/database';
import {DATABASE_SCHEMA_METADATA} from '../db/schemaMetadata';
import {
  backupRepository,
  decodeAndVerifyBackup,
  getStoredLastBackupAt,
  supportsGzipStreams,
  type TableRowCount,
  type VerifiedBackupPreview,
} from '../repositories/backupRepository';
import {formatArabicDateTime, todayISODate} from '../utils/date';

interface PendingRestoreState {
  fileName: string;
  buffer: ArrayBuffer;
  preview: VerifiedBackupPreview;
}

export const BackupPage: React.FC = () => {
  const {session, companySettings, can, refreshCompanySettings, refreshSession} = useAuth();
  const canBackup = can('backup.manage');

  const [tab, setTab] = useState<'backup' | 'schema'>('backup');
  const [counts, setCounts] = useState<TableRowCount[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestoreState | null>(null);
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const lastBackupAt = companySettings?.lastBackupAt ?? getStoredLastBackupAt();
  const canGzip = supportsGzipStreams();
  const canWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const loadCounts = useCallback(async () => {
    const data = await backupRepository.getTableRowCounts();
    setCounts(data);
  }, []);

  const checkStoragePersistence = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      try {
        const persisted = await navigator.storage.persisted();
        setStoragePersisted(persisted);
      } catch {
        setStoragePersisted(null);
      }
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    void checkStoragePersistence();
  }, [loadCounts, checkStoragePersistence]);

  const handleRequestPersistentStorage = async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      setMessage({
        type: 'error',
        text: 'المتصفح الحالي لا يدعم واجهة طلب التخزين الدائم.',
      });
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      setStoragePersisted(granted);
      setMessage({
        type: granted ? 'success' : 'error',
        text: granted
          ? 'تم تفعيل حماية التخزين الدائم للبيانات المحلية على هذا الجهاز.'
          : 'لم يوافق المتصفح على التخزين الدائم تلقائياً (يتم تفعيله عادةً بعد تثبيت التطبيق كـ PWA).',
      });
    } catch {
      setMessage({type: 'error', text: 'تعذر طلب حماية التخزين الدائم.'});
    }
  };

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCompressed = async () => {
    if (!session || !canBackup) return;
    setBusy(true);
    setMessage(null);
    try {
      const {payload, bytes, compressed} = await backupRepository.exportCompressedBackup(
        session.user
      );
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const fileName = compressed
        ? `nukhbat-albonn-backup-${todayISODate()}.json.gz`
        : `nukhbat-albonn-backup-${todayISODate()}.json`;
      const mime = compressed ? 'application/gzip' : 'application/json;charset=utf-8';
      triggerDownload(new Blob([copy], {type: mime}), fileName);

      await Promise.all([loadCounts(), refreshCompanySettings()]);
      const kb = (bytes.byteLength / 1024).toFixed(1);
      setMessage({
        type: 'success',
        text: `تم تنزيل النسخة الاحتياطية ${compressed ? 'المضغوطة (Gzip)' : '(JSON)'} بحجم ${kb} كيلوبايت مع توقيع SHA-256 (${payload.checksum.slice(0, 12)}...).`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = async () => {
    if (!session || !canBackup) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = await backupRepository.exportFullBackup(session.user);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      triggerDownload(blob, `nukhbat-albonn-backup-${todayISODate()}.json`);
      await Promise.all([loadCounts(), refreshCompanySettings()]);
      setMessage({
        type: 'success',
        text: `تم تنزيل ملف النسخة الاحتياطية (JSON) مع بصمة تحقق SHA-256 (${payload.checksum.slice(0, 12)}...).`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleShareBackup = async () => {
    if (!session || !canBackup) return;
    setBusy(true);
    setMessage(null);
    try {
      const {bytes, compressed} = await backupRepository.exportCompressedBackup(session.user);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const fileName = compressed
        ? `nukhbat-albonn-backup-${todayISODate()}.json.gz`
        : `nukhbat-albonn-backup-${todayISODate()}.json`;
      const mime = compressed ? 'application/gzip' : 'application/json';
      const file = new File([copy], fileName, {type: mime});

      if (navigator.canShare && !navigator.canShare({files: [file]})) {
        triggerDownload(file, fileName);
        setMessage({
          type: 'success',
          text: 'المشاركة المباشرة للملف غير مدعومة في هذا المتصفح، تم تنزيل الملف بدلاً من ذلك.',
        });
      } else {
        await navigator.share({
          files: [file],
          title: 'نسخة احتياطية - نُخبة البن للتوزيع',
          text: `نسخة احتياطية بتاريخ ${todayISODate()}`,
        });
        setMessage({type: 'success', text: 'تمت مشاركة النسخة الاحتياطية بنجاح.'});
      }
      await Promise.all([loadCounts(), refreshCompanySettings()]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessage({type: 'error', text: 'تم إلغاء مشاركة النسخة الاحتياطية.'});
      } else {
        setMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'تعذر مشاركة النسخة الاحتياطية.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    try {
      const buffer = await file.arrayBuffer();
      const preview = await decodeAndVerifyBackup(buffer);
      setPendingRestore({
        fileName: file.name,
        buffer,
        preview,
      });
    } catch (err) {
      setPendingRestore(null);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'ملف النسخة الاحتياطية غير صالح.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const confirmRestore = async () => {
    if (!session || !pendingRestore) return;
    setBusy(true);
    setMessage(null);
    try {
      const verified = await backupRepository.restoreFullBackup(
        session.user,
        pendingRestore.buffer
      );
      setPendingRestore(null);
      await Promise.all([refreshCompanySettings(), refreshSession(), loadCounts()]);
      setMessage({
        type: 'success',
        text: `تمت استعادة النسخة الاحتياطية بنجاح (${verified.totalRecords} سجل من إصدار v${verified.payload.schemaVersion}).`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'فشلت عملية الاستعادة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const countMap = new Map(counts.map((c) => [c.tableName, c.count]));
  const totalCurrentRecords = counts.reduce((s, c) => s + c.count, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setTab('backup')}
            className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'backup' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            النسخ الاحتياطي والاستعادة
          </button>
          <button
            type="button"
            onClick={() => setTab('schema')}
            className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'schema' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            مخطط الجداول ({DATABASE_SCHEMA_METADATA.length})
          </button>
        </div>

        <div className="text-xs font-semibold text-slate-600 tabular-nums">
          إجمالي السجلات الحالية: <span className="font-bold text-[#0B1F3A]">{totalCurrentRecords}</span>
        </div>
      </div>

      {/* Status & Persistent Storage Bar */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <HardDrive className="w-5 h-5 text-[#C9A227] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-[#0B1F3A]">
              آخر نسخة احتياطية:{' '}
              <span className={lastBackupAt ? 'text-emerald-700' : 'text-amber-700'}>
                {lastBackupAt ? formatArabicDateTime(lastBackupAt) : 'لم يتم أخذ نسخة احتياطية بعد'}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              حالة حماية التخزين المحلي (IndexedDB Persistence):{' '}
              {storagePersisted === true
                ? 'مفعّل — محمي من الحذف التلقائي بواسطة المتصفح'
                : storagePersisted === false
                ? 'غير مفعّل بعد — يُنصح بتفعيله بعد تثبيت التطبيق'
                : 'غير متاح في هذا المتصفح'}
            </p>
          </div>
        </div>

        {storagePersisted !== true && (
          <button
            type="button"
            onClick={() => void handleRequestPersistentStorage()}
            className="min-h-[42px] px-4 rounded-xl border border-[#0B1F3A] bg-slate-50 text-xs font-bold text-[#0B1F3A] hover:bg-slate-100 cursor-pointer shrink-0"
          >
            تفعيل حماية التخزين الدائم
          </button>
        )}
      </section>

      {message && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {tab === 'backup' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-[#C9A227]" />
              <h2 className="text-base font-bold text-[#0B1F3A]">
                تصدير نسخة احتياطية مشفّرة التحقق
              </h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              تصدير جميع الجداول ({DATABASE_SCHEMA_METADATA.length} جدولاً) مع توقيع سلامة{' '}
              <span className="font-mono text-xs font-bold" dir="ltr">
                SHA-256
              </span>{' '}
              ورقم إصدار القاعدة (<span className="font-mono text-xs" dir="ltr">v{CURRENT_DB_VERSION}</span>)، مع ضغط Gzip لتقليل حجم الملف عند الحفظ أو المشاركة.
            </p>
            {canBackup ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleExportCompressed()}
                  className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#C9A227]" />
                  <span>
                    {busy
                      ? 'جارٍ التصدير...'
                      : canGzip
                      ? 'تنزيل نسخة مضغوطة (.json.gz)'
                      : 'تنزيل نسخة احتياطية (.json)'}
                  </span>
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleExportJson()}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تنزيل JSON غير مضغوط</span>
                  </button>

                  {canWebShare && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleShareBackup()}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#C9A227] bg-[#FAF3DC] text-xs font-bold text-[#0B1F3A] hover:bg-[#f3e6be] disabled:opacity-60 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5 text-[#9E7B14]" />
                      <span>مشاركة (واتساب / Drive)</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                <Lock className="w-4 h-4" />
                <span>يتطلب صلاحية "النسخ الاحتياطي"</span>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#0B1F3A]" />
              <h2 className="text-base font-bold text-[#0B1F3A]">استعادة نسخة احتياطية</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              يتم فك الضغط وفحص بصمة{' '}
              <span className="font-mono text-xs font-bold" dir="ltr">
                SHA-256
              </span>{' '}
              وتوافق الإصدار <strong>قبل مسح أي بيانات حالية</strong>، ثم تُنفذ الاستعادة داخل معاملة ذرية (Atomic Transaction) مع ترقية تلقائية للإصدارات الأقدم.
            </p>
            {canBackup ? (
              <label className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#0B1F3A] bg-slate-50 text-[#0B1F3A] text-sm font-bold hover:bg-slate-100 transition-colors cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>اختيار ملف (.json أو .json.gz) للاستعادة</span>
                <input
                  type="file"
                  accept=".json,.gz,application/json,application/gzip"
                  onChange={(e) => void handleFileSelected(e)}
                  className="sr-only"
                />
              </label>
            ) : (
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                <Lock className="w-4 h-4" />
                <span>يتطلب صلاحية "النسخ الاحتياطي"</span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-[#C9A227]" />
              <h2 className="text-base font-bold text-[#0B1F3A]">
                مخطط قاعدة البيانات الكامل (Dexie IndexedDB)
              </h2>
            </div>
            <span className="text-xs font-semibold text-slate-600 tabular-nums">
              الإصدار الحالي: v{CURRENT_DB_VERSION} · {DATABASE_SCHEMA_METADATA.length} جدولاً
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                  <th className="py-2.5 px-3">الجدول</th>
                  <th className="py-2.5 px-3">الوصف</th>
                  <th className="py-2.5 px-3">المجموعة</th>
                  <th className="py-2.5 px-3">العلاقات</th>
                  <th className="py-2.5 px-3">القيود</th>
                  <th className="py-2.5 px-3 text-left">السجلات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DATABASE_SCHEMA_METADATA.map((t) => (
                  <tr key={t.tableName} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono text-xs font-bold text-[#0B1F3A]" dir="ltr">
                      {t.tableName}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{t.arabicTitle}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{t.group}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 font-mono" dir="ltr">
                      {t.relations.join(' | ')}
                    </td>
                    <td className="py-2.5 px-3 text-xs">
                      {t.immutableLedger ? (
                        <span className="font-semibold text-[#9E7B14]">قيد عكسي فقط</span>
                      ) : (
                        <span className="text-slate-500">سجل قياسي</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-left font-bold tabular-nums text-[#0B1F3A]">
                      {countMap.get(t.tableName) ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <h3 className="text-lg font-bold text-[#0B1F3A]">تأكيد استعادة النسخة الاحتياطية</h3>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1.5">
              <p className="font-bold text-slate-800 truncate" dir="ltr">
                {pendingRestore.fileName}
              </p>
              <p className="text-emerald-700 font-bold">
                ✓ بصمة SHA-256 مطابقة وسليمة (
                {pendingRestore.preview.wasCompressed ? 'مضغوط Gzip' : 'JSON'})
              </p>
              <p className="text-slate-600">
                تاريخ النسخة: {formatArabicDateTime(pendingRestore.preview.payload.exportedAt)} ·
                بواسطة: {pendingRestore.preview.payload.exportedBy}
              </p>
              <p className="text-slate-600 tabular-nums">
                إصدار القاعدة: v{pendingRestore.preview.payload.schemaVersion} · إجمالي السجلات:{' '}
                <strong>{pendingRestore.preview.totalRecords}</strong>
              </p>
              {pendingRestore.preview.payload.schemaVersion < CURRENT_DB_VERSION && (
                <p className="text-amber-700 font-semibold">
                  ملاحظة: النسخة من إصدار أقدم (v{pendingRestore.preview.payload.schemaVersion}) وستتم ترقيتها تلقائياً إلى v{CURRENT_DB_VERSION} بعد الاستعادة.
                </p>
              )}
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              سيتم استبدال البيانات المحلية الحالية بمحتويات هذا الملف داخل معاملة آمنة. هل تريد المتابعة؟
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRestore()}
                className="flex-1 min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                {busy ? 'جارٍ الاستعادة...' : 'تأكيد الاستعادة'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingRestore(null)}
                className="flex-1 min-h-[46px] rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
