import {
  Bluetooth,
  BluetoothConnected,
  Check,
  Printer,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import type {SalesInvoiceWithDetails} from '../repositories/salesRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import {
  renderReceiptCanvas,
  shareOrDownloadReceiptPng,
  type ThermalPaperWidth,
} from '../services/receiptRenderer';
import {
  printCanvasViaRawBt,
  setPreferredPrintMethod,
} from '../services/rawbtPrinter';
import {
  thermalPrinter,
  type PrinterStatusSnapshot,
} from '../services/thermalPrinter';
import type {CompanySettingsRecord} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';
import {formatEGP} from '../utils/money';

interface InvoicePrintModalProps {
  details: SalesInvoiceWithDetails;
  companySettings: CompanySettingsRecord | null;
  autoPrintOnOpen?: boolean;
  onClose: () => void;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({
  details,
  companySettings,
  autoPrintOnOpen = false,
  onClose,
}) => {
  const {session, refreshCompanySettings} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const {invoice} = details;

  const [previewMode, setPreviewMode] = useState<'thermal' | 'a4'>('thermal');
  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>(
    companySettings?.thermalPaperWidth ?? '80mm'
  );
  const [printerStatus, setPrinterStatus] = useState<PrinterStatusSnapshot>(() =>
    thermalPrinter.getStatus()
  );
  const [busyAction, setBusyAction] = useState<'ble' | 'connect' | 'share' | 'rawbt' | null>(null);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);
  const [thermalPreviewUrl, setThermalPreviewUrl] = useState<string | null>(null);
  const autoPrintedRef = useRef(false);

  useEffect(() => {
    return thermalPrinter.subscribe(setPrinterStatus);
  }, []);

  // Render live Canvas thermal receipt preview matching paperWidth (58mm / 80mm)
  useEffect(() => {
    let cancelled = false;
    void renderReceiptCanvas(details, companySettings, paperWidth)
      .then((canvas) => {
        if (!cancelled) {
          setThermalPreviewUrl(canvas.toDataURL('image/png'));
        }
      })
      .catch(() => {
        // Keep A4 fallback visible if canvas unsupported
      });
    return () => {
      cancelled = true;
    };
  }, [details, companySettings, paperWidth]);

  const handleConnectPrinter = useCallback(async () => {
    setFeedback(null);
    setBusyAction('connect');
    try {
      const info = await thermalPrinter.scanAndConnect();
      if (session) {
        await settingsRepository.savePrinterDevicePreference(session.user, {
          savedPrinterId: info.deviceId,
          savedPrinterName: info.deviceName,
        });
        await refreshCompanySettings();
      }
      setFeedback({
        type: 'success',
        text: `تم الاتصال بالطابعة (${info.deviceName}) وحفظها للطباعة السريعة.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر الاتصال بالطابعة.',
      });
    } finally {
      setBusyAction(null);
    }
  }, [session, refreshCompanySettings]);

  const handleBlePrint = useCallback(async () => {
    setFeedback(null);
    setBusyAction('ble');
    try {
      if (!printerStatus.connectedDeviceId && printerStatus.savedPrinter) {
        await thermalPrinter.tryAutoReconnect();
      }
      await thermalPrinter.printSalesInvoiceReceipt(details, companySettings, paperWidth);
      setPreferredPrintMethod('ble');
      setFeedback({
        type: 'success',
        text: `تمت طباعة الفاتورة ${invoice.invoiceNumber} على الطابعة الحرارية (${paperWidth}) بنجاح.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذرت الطباعة الحرارية.',
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    printerStatus.connectedDeviceId,
    printerStatus.savedPrinter,
    details,
    companySettings,
    paperWidth,
    invoice.invoiceNumber,
  ]);

  // Optional auto-print on save
  useEffect(() => {
    if (!autoPrintOnOpen || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    if (!printerStatus.supported) return;
    if (!printerStatus.connectedDeviceId && !printerStatus.savedPrinter) return;
    void handleBlePrint();
  }, [
    autoPrintOnOpen,
    printerStatus.supported,
    printerStatus.connectedDeviceId,
    printerStatus.savedPrinter,
    handleBlePrint,
  ]);

  const handleRawBtPrint = async () => {
    setFeedback(null);
    setBusyAction('rawbt');
    try {
      const canvas = await renderReceiptCanvas(details, companySettings, paperWidth);
      printCanvasViaRawBt(canvas);
      setFeedback({
        type: 'success',
        text: 'تم إرسال الفاتورة إلى تطبيق RawBT. اختر الطابعة داخل RawBT إن طُلب منك (أول مرة فقط).',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر الإرسال إلى RawBT.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleShareImage = async () => {
    setFeedback(null);
    setBusyAction('share');
    try {
      const canvas = await renderReceiptCanvas(details, companySettings, paperWidth);
      const outcome = await shareOrDownloadReceiptPng(
        canvas,
        `receipt-${invoice.invoiceNumber}.png`,
        `فاتورة مبيعات ${invoice.invoiceNumber} - ${details.customerName}`
      );
      setFeedback({
        type: 'success',
        text:
          outcome === 'shared'
            ? 'تمت مشاركة صورة الفاتورة بنجاح.'
            : 'تم حفظ الفاتورة كصورة PNG لإرسالها عبر واتساب.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذرت مشاركة الفاتورة كصورة.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5 backdrop-blur-xs overflow-y-auto print:bg-white print:p-0 print:block">
      <div className="print-only-container w-full max-w-2xl rounded-2xl bg-white p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[94vh] overflow-y-auto">
        {/* Non-print top toolbar */}
        <div className="no-print space-y-3 pb-4 mb-4 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#0B1F3A]">
                طباعة ومشاركة الفاتورة ({invoice.invoiceNumber})
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {printerStatus.connectedDeviceName ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                    <BluetoothConnected className="w-3.5 h-3.5" />
                    <span>متصل: {printerStatus.connectedDeviceName}</span>
                  </span>
                ) : printerStatus.savedPrinter ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                    <Bluetooth className="w-3.5 h-3.5" />
                    <span>محفوظة: {printerStatus.savedPrinter.deviceName} (ستتم إعادة الاتصال تلقائياً)</span>
                  </span>
                ) : (
                  <span className="text-slate-500">لم يتم ربط طابعة BLE بعد</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleBlePrint()}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-xs sm:text-sm font-bold text-white hover:bg-[#133159] disabled:opacity-55 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-[#C9A227]" />
              <span>
                {busyAction === 'ble' ? 'جارٍ الإرسال للطابعة...' : `طباعة حرارية (${paperWidth})`}
              </span>
            </button>

            {!printerStatus.connectedDeviceId && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectPrinter()}
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#0B1F3A] bg-white px-3.5 text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 disabled:opacity-55 cursor-pointer"
              >
                {busyAction === 'connect' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Bluetooth className="w-4 h-4 text-[#9E7B14]" />
                )}
                <span>اتصال بطابعة BLE</span>
              </button>
            )}

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleRawBtPrint()}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#0B1F3A] bg-white px-3.5 text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 disabled:opacity-55 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-[#9E7B14]" />
              <span>{busyAction === 'rawbt' ? 'جارٍ الإرسال...' : 'طباعة عبر RawBT (بلوتوث عادي)'}</span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleShareImage()}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#C9A227] px-3.5 text-xs sm:text-sm font-extrabold text-[#0B1F3A] hover:bg-[#DBBA4B] disabled:opacity-55 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>{busyAction === 'share' ? 'جارٍ التجهيز...' : 'مشاركة صورة / واتساب'}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
          </div>

          {/* Paper width + Preview switch */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setPreviewMode('thermal')}
                className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                  previewMode === 'thermal' ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
                }`}
              >
                معاينة حرارية (صورة Cairo RTL)
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('a4')}
                className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                  previewMode === 'a4' ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
                }`}
              >
                معاينة PDF القياسية
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
              {(['58mm', '80mm'] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPaperWidth(w)}
                  className={`px-2.5 py-1 rounded-lg font-bold tabular-nums cursor-pointer ${
                    paperWidth === w ? 'bg-[#C9A227] text-[#0B1F3A]' : 'text-slate-600'
                  }`}
                >
                  ورق {w}
                </button>
              ))}
            </div>
          </div>

          {feedback && (
            <div
              role="status"
              className={`rounded-xl px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}
            >
              {feedback.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>

        {/* Thermal Raster Image Preview (Hidden in Print if user selects PDF/A4, shown cleanly in modal) */}
        {previewMode === 'thermal' && (
          <div className="no-print flex justify-center bg-slate-100 rounded-xl p-4 border border-slate-200">
            {thermalPreviewUrl ? (
              <img
                src={thermalPreviewUrl}
                alt={`معاينة حرارية ${paperWidth}`}
                style={{width: paperWidth === '58mm' ? '280px' : '360px'}}
                className="max-w-full bg-white shadow-md rounded-lg border border-slate-300"
              />
            ) : (
              <p className="text-xs text-slate-500 py-8">جارٍ تجهيز معاينة الإيصال الحراري...</p>
            )}
          </div>
        )}

        {/* Printable HTML Invoice Content (Always used for window.print PDF fallback, and visible when A4 mode active) */}
        <div className={`${previewMode === 'thermal' ? 'hidden print:block' : 'block'} space-y-4 text-slate-900`}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-[#0B1F3A] pb-4">
            <div className="flex items-center gap-3">
              {companySettings?.logoDataUrl && (
                <img
                  src={companySettings.logoDataUrl}
                  alt="شعار الشركة"
                  className="w-14 h-14 object-contain rounded-xl border border-slate-200 bg-white p-1"
                />
              )}
              <div>
                <h2 className="text-lg font-extrabold text-[#0B1F3A]">
                  {companySettings?.companyName ?? 'نُخبة البن للتوزيع'}
                </h2>
                {companySettings?.phone && (
                  <p className="text-xs text-slate-600 tabular-nums" dir="ltr">
                    {companySettings.phone}
                  </p>
                )}
                {companySettings?.address && (
                  <p className="text-xs text-slate-600">{companySettings.address}</p>
                )}
                {companySettings?.taxNumber && (
                  <p className="text-[11px] text-slate-500">
                    الرقم الضريبي: {companySettings.taxNumber}
                  </p>
                )}
              </div>
            </div>

            <div className="text-left">
              <div className="text-xs font-bold text-slate-500">فاتورة مبيعات</div>
              <div className="text-base font-extrabold text-[#0B1F3A] font-mono" dir="ltr">
                {invoice.invoiceNumber}
              </div>
              <div className="text-xs text-slate-600 tabular-nums mt-0.5">
                {invoice.invoiceDate}
              </div>
              {invoice.status === 'reversed' && (
                <div className="mt-1 text-xs font-bold text-red-700">ملغاة (قيد عكسي)</div>
              )}
              {invoice.status === 'draft' && (
                <div className="mt-1 text-xs font-bold text-amber-700">مسودة</div>
              )}
            </div>
          </div>

          {/* Customer & Warehouse Metadata */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs">
            <div>
              <span className="text-slate-500 block">العميل</span>
              <span className="font-bold text-[#0B1F3A]">{details.customerName}</span>
              {details.customerPhone && (
                <span className="block text-slate-600 tabular-nums" dir="ltr">
                  {details.customerPhone}
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500 block">المخزن وطريقة الدفع</span>
              <span className="font-bold text-slate-800">{details.warehouseName}</span>
              <span className="block text-slate-600">
                {invoice.paymentType === 'cash'
                  ? 'نقدي'
                  : invoice.paymentType === 'credit'
                  ? 'آجل'
                  : 'سداد جزئي'}{' '}
                · {details.paymentMethodName}
              </span>
            </div>
          </div>

          {/* Lines Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs sm:text-sm border-collapse">
              <thead className="bg-[#0B1F3A] text-white text-right text-xs">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">الصنف</th>
                  <th className="p-2.5">الوحدة</th>
                  <th className="p-2.5">الكمية</th>
                  <th className="p-2.5">السعر</th>
                  <th className="p-2.5">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {details.lines.map((l, idx) => (
                  <tr key={l.line.id}>
                    <td className="p-2.5 tabular-nums text-slate-500">{idx + 1}</td>
                    <td className="p-2.5">
                      <div className="font-bold text-slate-900">{l.itemName}</div>
                      <div className="text-[11px] text-slate-500 font-mono" dir="ltr">
                        {l.itemSku}
                      </div>
                    </td>
                    <td className="p-2.5 text-slate-700">
                      {l.unitName}
                      {l.conversionFactor > 1 && (
                        <span className="block text-[10px] text-slate-500">
                          ×{l.conversionFactor} قطعة
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-bold tabular-nums">{l.line.quantity}</td>
                    <td className="p-2.5 tabular-nums">
                      {formatEGP(l.line.unitPricePiastres, currency)}
                    </td>
                    <td className="p-2.5 font-bold text-[#0B1F3A] tabular-nums">
                      {formatEGP(l.line.lineTotalPiastres, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="text-xs text-slate-600 space-y-1">
              {invoice.notes && (
                <div>
                  <span className="font-bold text-slate-800">ملاحظات: </span>
                  <span>{invoice.notes}</span>
                </div>
              )}
              <div className="text-[11px] text-slate-500">
                تاريخ الإصدار: {formatArabicDateTime(invoice.createdAt)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">الإجمالي قبل الخصم</span>
                <span className="font-semibold tabular-nums">
                  {formatEGP(invoice.subtotalPiastres, currency)}
                </span>
              </div>
              {invoice.discountPiastres > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>
                    الخصم{' '}
                    {invoice.discountType === 'percent' ? `(${invoice.discountValue}%)` : ''}
                  </span>
                  <span className="font-semibold tabular-nums">
                    - {formatEGP(invoice.discountPiastres, currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm font-extrabold text-[#0B1F3A] pt-1.5 border-t border-slate-200">
                <span>صافي الفاتورة</span>
                <span className="tabular-nums">{formatEGP(invoice.totalPiastres, currency)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>المدفوع</span>
                <span className="font-bold tabular-nums">
                  {formatEGP(invoice.paidPiastres, currency)}
                </span>
              </div>
              <div className="flex justify-between text-red-700">
                <span>المتبقي على الحساب</span>
                <span className="font-bold tabular-nums">
                  {formatEGP(invoice.remainingPiastres, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          {companySettings?.invoiceFooter && (
            <div className="border-t border-slate-200 pt-3 text-center text-xs text-slate-600">
              {companySettings.invoiceFooter}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
