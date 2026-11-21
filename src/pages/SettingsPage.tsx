import {
  AlertTriangle,
  Bluetooth,
  BluetoothConnected,
  Check,
  ImagePlus,
  Lock,
  Printer,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import React, {useEffect, useState} from 'react';
import {BrandLogo} from '../components/BrandLogo';
import {useAuth} from '../context/AuthContext';
import {settingsRepository} from '../repositories/settingsRepository';
import type {ThermalPaperWidth} from '../services/receiptRenderer';
import {printCanvasViaRawBt} from '../services/rawbtPrinter';
import {renderTestReceiptCanvas} from '../services/receiptRenderer';
import {thermalPrinter, type PrinterStatusSnapshot} from '../services/thermalPrinter';

async function fileToResizedDataUrl(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('تعذر قراءة ملف SVG.'));
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 360;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('الملف المحدد ليس صورة صالحة.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.readAsDataURL(file);
  });
}

export const SettingsPage: React.FC = () => {
  const {session, companySettings, can, refreshCompanySettings} = useAuth();
  const canEdit = can('settings.manage');

  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [invoiceFooter, setInvoiceFooter] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [thermalPaperWidth, setThermalPaperWidth] = useState<ThermalPaperWidth>('80mm');
  const [autoPrintAfterSale, setAutoPrintAfterSale] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // BLE Thermal printer controls
  const [printerStatus, setPrinterStatus] = useState<PrinterStatusSnapshot>(() =>
    thermalPrinter.getStatus()
  );
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerMessage, setPrinterMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    return thermalPrinter.subscribe(setPrinterStatus);
  }, []);

  useEffect(() => {
    if (!companySettings) return;
    setCompanyName(companySettings.companyName);
    setPhone(companySettings.phone);
    setAddress(companySettings.address);
    setTaxNumber(companySettings.taxNumber);
    setInvoiceFooter(companySettings.invoiceFooter);
    setLogoDataUrl(companySettings.logoDataUrl);
    setAllowNegativeStock(companySettings.allowNegativeStock);
    setThermalPaperWidth(companySettings.thermalPaperWidth ?? '80mm');
    setAutoPrintAfterSale(Boolean(companySettings.autoPrintAfterSale));
  }, [companySettings]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setLogoDataUrl(dataUrl);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل الشعار.',
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      await settingsRepository.updateCompanySettings(session.user, {
        companyName,
        phone,
        address,
        taxNumber,
        invoiceFooter,
        logoDataUrl,
        allowNegativeStock,
        thermalPaperWidth,
        autoPrintAfterSale,
      });
      await refreshCompanySettings();
      setMessage({type: 'success', text: 'تم حفظ إعدادات الشركة والطابعة محلياً بنجاح.'});
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleScanAndConnect = async () => {
    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      const info = await thermalPrinter.scanAndConnect();
      if (session) {
        await settingsRepository.savePrinterDevicePreference(session.user, {
          savedPrinterId: info.deviceId,
          savedPrinterName: info.deviceName,
        });
        await refreshCompanySettings();
      }
      setPrinterMessage({
        type: 'success',
        text: `تم الاتصال بالطابعة (${info.deviceName}) وحفظها لإعادة الاتصال التلقائي.`,
      });
    } catch (err) {
      setPrinterMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر الاتصال بالطابعة الحرارية.',
      });
    } finally {
      setPrinterBusy(false);
    }
  };

  const handleReconnect = async () => {
    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      const ok = await thermalPrinter.tryAutoReconnect();
      setPrinterMessage(
        ok
          ? {type: 'success', text: 'تمت إعادة الاتصال بالطابعة المحفوظة بنجاح.'}
          : {
              type: 'error',
              text: 'تعذرت إعادة الاتصال التلقائي. تأكد من تشغيل الطابعة أو استخدم "بحث واتصال".',
            }
      );
    } finally {
      setPrinterBusy(false);
    }
  };

  const handleTestPrint = async () => {
    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      await thermalPrinter.printTestReceipt(companySettings, thermalPaperWidth);
      setPrinterMessage({
        type: 'success',
        text: `تم إرسال إيصال الاختبار (${thermalPaperWidth}) إلى الطابعة بنجاح.`,
      });
    } catch (err) {
      setPrinterMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'فشل إرسال طباعة الاختبار.',
      });
    } finally {
      setPrinterBusy(false);
    }
  };

  const handleRawBtTestPrint = async () => {
    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      const canvas = await renderTestReceiptCanvas(companySettings, thermalPaperWidth);
      printCanvasViaRawBt(canvas);
      setPrinterMessage({
        type: 'success',
        text: 'تم إرسال إيصال الاختبار إلى RawBT. اقرن الطابعة في بلوتوث الهاتف أولاً، ثم اخترها داخل RawBT.',
      });
    } catch (err) {
      setPrinterMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر الإرسال إلى RawBT.',
      });
    } finally {
      setPrinterBusy(false);
    }
  };

  const handleForgetPrinter = async () => {
    thermalPrinter.forgetSavedPrinter();
    if (session) {
      await settingsRepository.savePrinterDevicePreference(session.user, {
        savedPrinterId: null,
        savedPrinterName: null,
      });
      await refreshCompanySettings();
    }
    setPrinterMessage({type: 'success', text: 'تم إلغاء ربط الطابعة المحفوظة.'});
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#0B1F3A]">إعدادات الشركة والفاتورة</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تُحفظ البيانات محلياً في IndexedDB وتُستخدم تلقائياً في الفواتير والطباعة الحرارية.
              </p>
            </div>
            {!canEdit && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                <Lock className="w-3.5 h-3.5" />
                للعرض فقط
              </span>
            )}
          </div>

          {message && (
            <div
              role="status"
              className={`mb-4 rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
                message.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}
            >
              {message.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            {/* Logo upload */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="block text-sm font-semibold text-slate-800 mb-3">
                شعار الشركة للفاتورة (اللوجو)
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <BrandLogo logoDataUrl={logoDataUrl} size="lg" />
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                      canEdit
                        ? 'bg-[#0B1F3A] text-white hover:bg-[#133159] cursor-pointer'
                        : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <ImagePlus className="w-4 h-4 text-[#C9A227]" />
                    <span>رفع شعار</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      disabled={!canEdit}
                      onChange={(e) => void handleLogoUpload(e)}
                      className="sr-only"
                    />
                  </label>
                  {logoDataUrl && canEdit && (
                    <button
                      type="button"
                      onClick={() => setLogoDataUrl(null)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>استعادة الافتراضي</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                اسم الشركة
              </label>
              <input
                type="text"
                required
                disabled={!canEdit}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 disabled:bg-slate-100 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  رقم الهاتف
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  disabled={!canEdit}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-left tabular-nums text-slate-900 disabled:bg-slate-100 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  الرقم الضريبي (اختياري)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  disabled={!canEdit}
                  value={taxNumber}
                  onChange={(e) => setTaxNumber(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-left tabular-nums text-slate-900 disabled:bg-slate-100 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                العنوان
              </label>
              <input
                type="text"
                disabled={!canEdit}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 disabled:bg-slate-100 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                تذييل الفاتورة
              </label>
              <textarea
                rows={3}
                disabled={!canEdit}
                value={invoiceFooter}
                onChange={(e) => setInvoiceFooter(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-3.5 text-sm text-slate-900 disabled:bg-slate-100 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
              />
            </div>

            {/* Thermal Paper Size & Auto Print */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  مقاس ورق الطابعة الحرارية
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['58mm', '80mm'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setThermalPaperWidth(w)}
                      className={`min-h-[46px] rounded-xl border text-sm font-bold tabular-nums transition-colors cursor-pointer disabled:opacity-60 ${
                        thermalPaperWidth === w
                          ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {w} ({w === '58mm' ? '384px' : '576px'})
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 cursor-pointer">
                <div>
                  <span className="block text-sm font-semibold text-slate-900">
                    طباعة تلقائية بعد الحفظ
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    إرسال الفاتورة للطابعة فور اعتماد البيع
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={autoPrintAfterSale}
                  onChange={(e) => setAutoPrintAfterSale(e.target.checked)}
                  className="h-5 w-5 accent-[#0B1F3A]"
                />
              </label>
            </div>

            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 cursor-pointer">
              <div>
                <span className="block text-sm font-semibold text-slate-900">
                  السماح بتجاوز رصيد المخزون افتراضياً
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  يتطلب أيضاً صلاحية "تجاوز رصيد المخزون" للمستخدم عند إصدار الفاتورة.
                </span>
              </div>
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
                className="h-5 w-5 accent-[#0B1F3A]"
              />
            </label>

            {canEdit && (
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#133159] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Save className="w-4 h-4 text-[#C9A227]" />
                <span>{saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</span>
              </button>
            )}
          </form>
        </section>

        {/* Live Invoice Preview & BLE Thermal Printer */}
        <aside className="lg:col-span-5 space-y-5">
          {/* BLE Printer Connection Card */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bluetooth className="w-5 h-5 text-[#C9A227]" />
                <h3 className="text-base font-bold text-[#0B1F3A]">
                  الطابعة الحرارية (Web Bluetooth BLE)
                </h3>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                  printerStatus.connectedDeviceName
                    ? 'bg-emerald-50 text-emerald-700'
                    : printerStatus.savedPrinter
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {printerStatus.connectedDeviceName
                  ? 'متصل'
                  : printerStatus.savedPrinter
                  ? 'محفوظة'
                  : 'غير متصل'}
              </span>
            </div>

            {!printerStatus.supported && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <span>
                  المتصفح الحالي لا يدعم Web Bluetooth BLE. للطباعة المباشرة عبر البلوتوث، افتح التطبيق في{' '}
                  <strong>Google Chrome على Android</strong>. يمكنك دائماً الطباعة كـ PDF أو المشاركة كصورة واتساب.
                </span>
              </div>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">الطابعة المتصلة الآن</span>
                <span className="font-bold text-[#0B1F3A]">
                  {printerStatus.connectedDeviceName ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">آخر طابعة محفوظة</span>
                <span className="font-semibold text-slate-800">
                  {printerStatus.savedPrinter?.deviceName ??
                    companySettings?.savedPrinterName ??
                    '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">أسلوب الرسم العربي</span>
                <span className="font-semibold text-slate-800">
                  Canvas RTL (Cairo) ← ESC/POS Raster
                </span>
              </div>
            </div>

            {printerMessage && (
              <div
                role="status"
                className={`rounded-xl px-3 py-2.5 text-xs font-semibold flex items-center gap-2 ${
                  printerMessage.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}
              >
                {printerMessage.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
                <span>{printerMessage.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={printerBusy}
                onClick={() => void handleScanAndConnect()}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] text-white text-xs font-bold hover:bg-[#133159] disabled:opacity-55 cursor-pointer"
              >
                <BluetoothConnected className="w-4 h-4 text-[#C9A227]" />
                <span>{printerBusy ? 'جارٍ البحث...' : 'بحث واتصال بطابعة'}</span>
              </button>

              <button
                type="button"
                disabled={printerBusy}
                onClick={() => void handleTestPrint()}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C9A227] text-[#0B1F3A] text-xs font-extrabold hover:bg-[#DBBA4B] disabled:opacity-55 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>اختبار الطباعة ({thermalPaperWidth})</span>
              </button>

              <button
                type="button"
                disabled={printerBusy}
                onClick={() => void handleRawBtTestPrint()}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#0B1F3A] bg-white text-[#0B1F3A] text-xs font-bold hover:bg-slate-50 disabled:opacity-55 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>اختبار عبر RawBT (بلوتوث عادي)</span>
              </button>

              {(printerStatus.savedPrinter || companySettings?.savedPrinterId) && (
                <>
                  <button
                    type="button"
                    disabled={printerBusy}
                    onClick={() => void handleReconnect()}
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>إعادة الاتصال</span>
                  </button>
                  <button
                    type="button"
                    disabled={printerBusy}
                    onClick={() => void handleForgetPrinter()}
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>نسيان الطابعة</span>
                  </button>
                </>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              ملاحظة فنية مهمة: يعمل Web Bluetooth في Chrome مع الطابعات الداعمة لـ{' '}
              <strong>Bluetooth Low Energy (BLE)</strong>. الطابعات القديمة التي تعمل بـ{' '}
              <strong>Bluetooth Classic (SPP فقط)</strong> لا تظهر في متصفحات الويب، وفي هذه الحالة ثبّت تطبيق <strong>RawBT</strong> من Google Play، واقرن الطابعة من بلوتوث الهاتف، ثم استخدم زر{' '}
              <strong>"طباعة عبر RawBT"</strong>. وتبقى «طباعة / PDF» و«مشاركة صورة» بدائل دائمة.
            </p>
          </section>

          {/* Header/Footer Preview */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-[#0B1F3A] mb-3">
              معاينة ترويسة وتذييل الفاتورة
            </h3>
            <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center bg-slate-50/70">
              <div className="flex justify-center">
                <BrandLogo logoDataUrl={logoDataUrl} size="md" />
              </div>
              <h4 className="mt-3 text-base font-bold text-[#0B1F3A]">
                {companyName || 'اسم الشركة'}
              </h4>
              <p className="mt-1 text-xs text-slate-600">{address || 'العنوان'}</p>
              <p className="mt-0.5 text-xs text-slate-600 tabular-nums" dir="ltr">
                {phone || '01000000000'}
              </p>
              {taxNumber && (
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  الرقم الضريبي: {taxNumber}
                </p>
              )}

              <div className="my-4 border-y border-slate-200 py-3 text-xs text-slate-500 flex justify-between tabular-nums">
                <span>فاتورة مبيعات #INV-0001</span>
                <span>1,250.00 ج.م</span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                {invoiceFooter || 'تذييل الفاتورة'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
