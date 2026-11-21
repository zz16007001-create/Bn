import type {SalesInvoiceWithDetails} from '../repositories/salesRepository';
import type {CompanySettingsRecord} from '../types/domain';
import {
  canvasToEscPosRaster,
  renderReceiptCanvas,
  renderTestReceiptCanvas,
  type ThermalPaperWidth,
} from './receiptRenderer';

// Minimal Web Bluetooth TypeScript declarations (avoids external @types package dependency)
interface BleCharacteristic {
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
}

interface BleService {
  getCharacteristics: () => Promise<BleCharacteristic[]>;
}

interface BleRemoteGATTServer {
  connected: boolean;
  connect: () => Promise<BleRemoteGATTServer>;
  disconnect: () => void;
  getPrimaryServices: () => Promise<BleService[]>;
}

interface BleDevice {
  id: string;
  name?: string;
  gatt?: BleRemoteGATTServer;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface BleNavigator {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean;
      filters?: Array<{services?: string[]; namePrefix?: string}>;
      optionalServices?: string[];
    }) => Promise<BleDevice>;
    getDevices?: () => Promise<BleDevice[]>;
  };
}

// Common GATT service UUIDs used by 58mm / 80mm BLE thermal printers
// (Xprinter, Rongta, ZJiang, Hoin, Gprinter, MTP/Sunmi, Nordic UART, ISSC)
export const KNOWN_THERMAL_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

export const SAVED_PRINTER_STORAGE_KEY = 'nukhbat_saved_ble_printer_v1';

export interface SavedPrinterInfo {
  deviceId: string;
  deviceName: string;
  lastConnectedAt: number;
}

export type PrinterConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'printing'
  | 'reconnecting';

export interface PrinterStatusSnapshot {
  supported: boolean;
  state: PrinterConnectionState;
  connectedDeviceName: string | null;
  connectedDeviceId: string | null;
  savedPrinter: SavedPrinterInfo | null;
  lastError: string | null;
}

/**
 * Pure ESC/POS byte chunker for BLE GATT MTU safety (tested in Vitest).
 */
export function chunkEscPosPayload(data: Uint8Array, chunkSize = 100): Uint8Array[] {
  const safeSize = Math.max(20, Math.min(512, Math.floor(chunkSize)));
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += safeSize) {
    chunks.push(data.slice(offset, Math.min(offset + safeSize, data.length)));
  }
  return chunks;
}

export function isWebBluetoothSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as unknown as BleNavigator).bluetooth);
}

export function getSavedPrinterInfo(): SavedPrinterInfo | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVED_PRINTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPrinterInfo;
    if (!parsed?.deviceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePrinterInfoLocal(info: SavedPrinterInfo | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!info) {
      localStorage.removeItem(SAVED_PRINTER_STORAGE_KEY);
    } else {
      localStorage.setItem(SAVED_PRINTER_STORAGE_KEY, JSON.stringify(info));
    }
  } catch {
    // ignore storage errors
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ThermalBlePrinterManager {
  private device: BleDevice | null = null;
  private characteristic: BleCharacteristic | null = null;
  private state: PrinterConnectionState = 'disconnected';
  private lastError: string | null = null;
  private preferredChunkSize = 100;
  private listeners = new Set<(snap: PrinterStatusSnapshot) => void>();

  private handleDisconnected = () => {
    this.characteristic = null;
    this.state = 'disconnected';
    this.lastError = 'انقطع الاتصال بالطابعة الحرارية. سيتم إعادة المحاولة عند الطباعة.';
    this.emit();
  };

  subscribe(listener: (snap: PrinterStatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): PrinterStatusSnapshot {
    return {
      supported: isWebBluetoothSupported(),
      state: this.state,
      connectedDeviceName: this.device?.gatt?.connected ? (this.device.name ?? 'طابعة حرارية') : null,
      connectedDeviceId: this.device?.gatt?.connected ? this.device.id : null,
      savedPrinter: getSavedPrinterInfo(),
      lastError: this.lastError,
    };
  }

  private emit(): void {
    const snap = this.getStatus();
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  private async connectDeviceGatt(device: BleDevice): Promise<BleCharacteristic> {
    if (!device.gatt) {
      throw new Error('الجهاز المختار لا يدعم الاتصال عبر GATT (Web Bluetooth BLE).');
    }

    device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    device.addEventListener('gattserverdisconnected', this.handleDisconnected);

    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const services = await server.getPrimaryServices();

    let writableChar: BleCharacteristic | null = null;
    for (const service of services) {
      const chars = await service.getCharacteristics();
      const preferred = chars.find(
        (c) => c.properties.writeWithoutResponse || c.properties.write
      );
      if (preferred) {
        writableChar = preferred;
        break;
      }
    }

    if (!writableChar) {
      throw new Error(
        'تم الاتصال بالجهاز لكن لم يتم العثور على قناة كتابة BLE متوافقة. تأكد أن الطابعة تدعم Bluetooth Low Energy (BLE) وليس Bluetooth Classic SPP فقط.'
      );
    }

    this.device = device;
    this.characteristic = writableChar;
    this.state = 'connected';
    this.lastError = null;
    this.preferredChunkSize = 100;

    const saved: SavedPrinterInfo = {
      deviceId: device.id,
      deviceName: device.name || 'طابعة حرارية BLE',
      lastConnectedAt: Date.now(),
    };
    savePrinterInfoLocal(saved);
    this.emit();
    return writableChar;
  }

  async scanAndConnect(): Promise<SavedPrinterInfo> {
    const nav = navigator as unknown as BleNavigator;
    if (!nav.bluetooth) {
      const msg =
        'متصفحك الحالي لا يدعم Web Bluetooth. استخدم Google Chrome على Android (أو رابط HTTPS)، أو استخدم بديل طباعة PDF / مشاركة صورة واتساب.';
      this.lastError = msg;
      this.emit();
      throw new Error(msg);
    }

    this.state = 'connecting';
    this.lastError = null;
    this.emit();

    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_THERMAL_PRINTER_SERVICES,
      });
      await this.connectDeviceGatt(device);
      return getSavedPrinterInfo()!;
    } catch (err) {
      this.state = 'disconnected';
      if (err instanceof Error && err.name === 'NotFoundError') {
        this.lastError = 'تم إلغاء البحث عن طابعة بلوتوث.';
      } else {
        this.lastError =
          err instanceof Error
            ? err.message
            : 'تعذر الاتصال بالطابعة الحرارية عبر البلوتوث.';
      }
      this.emit();
      throw new Error(this.lastError);
    }
  }

  async tryAutoReconnect(): Promise<boolean> {
    if (this.device?.gatt?.connected && this.characteristic) {
      this.state = 'connected';
      this.emit();
      return true;
    }

    const nav = navigator as unknown as BleNavigator;
    if (!nav.bluetooth) return false;

    const saved = getSavedPrinterInfo();
    if (!this.device && !saved) return false;

    this.state = 'reconnecting';
    this.lastError = null;
    this.emit();

    try {
      if (this.device) {
        await this.connectDeviceGatt(this.device);
        return true;
      }

      if (typeof nav.bluetooth.getDevices === 'function' && saved) {
        const permittedDevices = await nav.bluetooth.getDevices();
        const match = permittedDevices.find((d) => d.id === saved.deviceId);
        if (match) {
          await this.connectDeviceGatt(match);
          return true;
        }
      }
      this.state = 'disconnected';
      this.emit();
      return false;
    } catch {
      this.state = 'disconnected';
      this.emit();
      return false;
    }
  }

  disconnect(): void {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // ignore
    }
    this.characteristic = null;
    this.state = 'disconnected';
    this.emit();
  }

  forgetSavedPrinter(): void {
    this.disconnect();
    this.device = null;
    savePrinterInfoLocal(null);
    this.lastError = null;
    this.emit();
  }

  private async writeChunk(char: BleCharacteristic, chunk: Uint8Array): Promise<void> {
    const buffer = new Uint8Array(chunk).buffer;
    if (char.properties.writeWithoutResponse && typeof char.writeValueWithoutResponse === 'function') {
      await char.writeValueWithoutResponse(buffer);
    } else if (typeof char.writeValueWithResponse === 'function') {
      await char.writeValueWithResponse(buffer);
    } else if (typeof char.writeValue === 'function') {
      await char.writeValue(buffer);
    } else {
      throw new Error('خاصية الكتابة في الطابعة غير مدعومة.');
    }
  }

  private async ensureConnectedWithRetry(): Promise<BleCharacteristic> {
    if (this.device?.gatt?.connected && this.characteristic) {
      return this.characteristic;
    }
    const reconnected = await this.tryAutoReconnect();
    if (reconnected && this.characteristic) {
      return this.characteristic;
    }
    throw new Error(
      'لا توجد طابعة بلوتوث متصلة حالياً. اضغط "اتصال بطابعة" أو أعد توصيل الطابعة من الإعدادات، أو استخدم خيار PDF / مشاركة صورة.'
    );
  }

  async printEscPosBytes(rawBytes: Uint8Array): Promise<void> {
    let char = await this.ensureConnectedWithRetry();
    this.state = 'printing';
    this.lastError = null;
    this.emit();

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const chunks = chunkEscPosPayload(rawBytes, this.preferredChunkSize);
        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          try {
            await this.writeChunk(char, chunk);
          } catch (writeErr) {
            // If MTU 100 bytes failed, downgrade to safe 20-byte BLE packets & retry remainder
            if (this.preferredChunkSize > 20 && i === 0) {
              this.preferredChunkSize = 20;
              const smaller = chunkEscPosPayload(rawBytes, 20);
              for (const sChunk of smaller) {
                await this.writeChunk(char, sChunk);
                await sleep(14);
              }
              this.state = 'connected';
              this.emit();
              return;
            }
            throw writeErr;
          }
          await sleep(18);
        }

        this.state = 'connected';
        this.emit();
        return;
      } catch (err) {
        if (attempt < maxAttempts) {
          this.state = 'reconnecting';
          this.emit();
          await sleep(350);
          const recovered = await this.tryAutoReconnect();
          if (recovered && this.characteristic) {
            char = this.characteristic;
            continue;
          }
        }
        this.state = 'disconnected';
        this.lastError =
          err instanceof Error
            ? `انقطع الاتصال أثناء الطباعة: ${err.message}`
            : 'انقطع الاتصال بالطابعة أثناء إرسال البيانات.';
        this.emit();
        throw new Error(this.lastError);
      }
    }
  }

  async printCanvas(canvas: HTMLCanvasElement): Promise<void> {
    const bytes = canvasToEscPosRaster(canvas);
    await this.printEscPosBytes(bytes);
  }

  async printTestReceipt(
    settings: CompanySettingsRecord | null,
    paperWidth?: ThermalPaperWidth
  ): Promise<void> {
    const canvas = await renderTestReceiptCanvas(settings, paperWidth);
    await this.printCanvas(canvas);
  }

  async printSalesInvoiceReceipt(
    details: SalesInvoiceWithDetails,
    settings: CompanySettingsRecord | null,
    paperWidth?: ThermalPaperWidth
  ): Promise<void> {
    const canvas = await renderReceiptCanvas(details, settings, paperWidth);
    await this.printCanvas(canvas);
  }
}

export const thermalPrinter = new ThermalBlePrinterManager();
