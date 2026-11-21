import {canvasToEscPosRaster} from './receiptRenderer';

/**
 * طباعة عبر تطبيق RawBT (أندرويد) للطابعات الحرارية التي تعمل بـ Bluetooth Classic (SPP)
 * والتي لا يمكن للمتصفح الاتصال بها مباشرة. نفس بايتات ESC/POS المستخدمة في BLE تُرسل
 * إلى RawBT عبر Android Intent، ثم يرسلها RawBT إلى الطابعة المقترنة في بلوتوث الهاتف.
 */

export const RAWBT_PACKAGE = 'ru.a402d.RawBTprinter';
export const RAWBT_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter';

export const PRINT_METHOD_STORAGE_KEY = 'nukhbat_print_method_v1';
export type PrintMethod = 'ble' | 'rawbt';

export function getPreferredPrintMethod(): PrintMethod {
  try {
    if (typeof localStorage === 'undefined') return 'ble';
    return localStorage.getItem(PRINT_METHOD_STORAGE_KEY) === 'rawbt' ? 'rawbt' : 'ble';
  } catch {
    return 'ble';
  }
}

export function setPreferredPrintMethod(method: PrintMethod): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PRINT_METHOD_STORAGE_KEY, method);
  } catch {
    // ignore storage errors
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * يبني رابط Intent لتطبيق RawBT. إن لم يكن التطبيق مثبتاً يفتح Chrome صفحته في Google Play.
 */
export function buildRawBtIntentUrl(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    throw new Error('لا توجد بيانات للطباعة.');
  }
  const fallback = encodeURIComponent(RAWBT_PLAY_STORE_URL);
  return (
    `intent:base64,${bytesToBase64(bytes)}` +
    `#Intent;scheme=RawBT;package=${RAWBT_PACKAGE};S.browser_fallback_url=${fallback};end;`
  );
}

export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

/**
 * يجب استدعاؤها مباشرة من نقرة المستخدم (متصفح Chrome يمنع Intent بدون نقرة).
 */
export function printCanvasViaRawBt(canvas: HTMLCanvasElement): void {
  if (!isAndroidDevice()) {
    throw new Error(
      'الطباعة عبر RawBT تعمل على هواتف أندرويد فقط. استخدم «طباعة / PDF» أو «مشاركة صورة» على هذا الجهاز.'
    );
  }
  const bytes = canvasToEscPosRaster(canvas);
  window.location.href = buildRawBtIntentUrl(bytes);
  setPreferredPrintMethod('rawbt');
}
