import type {SalesInvoiceWithDetails} from '../repositories/salesRepository';
import type {CompanySettingsRecord} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';
import {formatEGP} from '../utils/money';

export type ThermalPaperWidth = '58mm' | '80mm';

export function getThermalWidthPixels(paperWidth: ThermalPaperWidth): number {
  // Standard 203 DPI thermal printer dot widths: 58mm = 384 dots, 80mm = 576 dots
  return paperWidth === '58mm' ? 384 : 576;
}

/**
 * Pure ESC/POS GS v 0 raster command generator (works in both browser Canvas & Node unit tests).
 * Converts RGBA pixels into 1-bit MSB-first monochrome bitmap wrapped with ESC @, GS v 0, feed & cut.
 */
export function bitmapToEscPosRaster(
  width: number,
  height: number,
  rgbaPixels: Uint8ClampedArray,
  threshold = 175
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new Error('أبعاد صورة الإيصال غير صالحة للطباعة الحرارية.');
  }
  const bytesPerRow = Math.ceil(width / 8);
  const imageBytesLength = bytesPerRow * height;

  // Header: ESC @ (2) + ESC a 1 (3) + GS v 0 m xL xH yL yH (8)
  const header = new Uint8Array([
    0x1b,
    0x40, // ESC @ : Initialize printer
    0x1b,
    0x61,
    0x01, // ESC a 1 : Center alignment
    0x1d,
    0x76,
    0x30,
    0x00, // GS v 0, mode = 0 (normal density)
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);

  // Footer: feed 4 lines + partial cut (GS V 66 3)
  const footer = new Uint8Array([
    0x1b,
    0x64,
    0x04, // ESC d 4
    0x1d,
    0x56,
    0x42,
    0x03, // GS V B 3
  ]);

  const output = new Uint8Array(header.length + imageBytesLength + footer.length);
  output.set(header, 0);

  let dstOffset = header.length;
  for (let y = 0; y < height; y += 1) {
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx += 1) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = byteIdx * 8 + bit;
        if (x < width) {
          const pxOffset = (y * width + x) * 4;
          const r = rgbaPixels[pxOffset] ?? 255;
          const g = rgbaPixels[pxOffset + 1] ?? 255;
          const b = rgbaPixels[pxOffset + 2] ?? 255;
          const a = rgbaPixels[pxOffset + 3] ?? 255;
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (a > 128 && luminance < threshold) {
            byteVal |= 0x80 >> bit;
          }
        }
      }
      output[dstOffset] = byteVal;
      dstOffset += 1;
    }
  }

  output.set(footer, header.length + imageBytesLength);
  return output;
}

export function canvasToEscPosRaster(canvas: HTMLCanvasElement, threshold = 175): Uint8Array {
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  if (!ctx) {
    throw new Error('تعذر قراءة بيانات الرسم من Canvas.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return bitmapToEscPosRaster(canvas.width, canvas.height, imageData.data, threshold);
}

async function ensureCairoFontLoaded(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    } catch {
      // ignore font loading timeout offline
    }
  }
}

async function loadOptionalLogo(dataUrl: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!dataUrl || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(null), 1200);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = dataUrl;
  });
}

function wrapArabicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [''];
  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Break overly long token
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawHorizontalDivider(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
  paddingX: number,
  dashed = false
): void {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = dashed ? 1.5 : 2;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(paddingX, y);
  ctx.lineTo(width - paddingX, y);
  ctx.stroke();
  ctx.restore();
}

export async function renderReceiptCanvas(
  details: SalesInvoiceWithDetails,
  settings: CompanySettingsRecord | null,
  overridePaperWidth?: ThermalPaperWidth
): Promise<HTMLCanvasElement> {
  await ensureCairoFontLoaded();
  const paperWidth: ThermalPaperWidth =
    overridePaperWidth ?? settings?.thermalPaperWidth ?? '80mm';
  const width = getThermalWidthPixels(paperWidth);
  const is58 = paperWidth === '58mm';
  const paddingX = is58 ? 12 : 18;
  const contentWidth = width - paddingX * 2;
  const currency = settings?.currencySymbol ?? 'ج.م';

  const baseFontSize = is58 ? 17 : 21;
  const smallFontSize = is58 ? 14 : 18;
  const headerFontSize = is58 ? 22 : 28;
  const totalFontSize = is58 ? 21 : 26;

  const logoImg = await loadOptionalLogo(settings?.logoDataUrl);

  // Measure canvas first to compute exact height
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = width;
  measureCanvas.height = 100;
  const mctx = measureCanvas.getContext('2d')!;
  const fontFamily = '"Cairo", "Tahoma", sans-serif';

  const companyName = settings?.companyName || 'نُخبة البن للتوزيع';
  const {invoice} = details;

  // Compute wrapped item rows
  mctx.font = `700 ${baseFontSize}px ${fontFamily}`;
  const itemColWidth = Math.round(contentWidth * (is58 ? 0.44 : 0.46));

  interface PreparedRow {
    nameLines: string[];
    unitLabel: string;
    qtyText: string;
    priceText: string;
    totalText: string;
    rowHeight: number;
  }

  const lineSpacing = Math.round(baseFontSize * 1.35);
  const smallLineSpacing = Math.round(smallFontSize * 1.35);

  const preparedRows: PreparedRow[] = details.lines.map((l) => {
    mctx.font = `700 ${baseFontSize}px ${fontFamily}`;
    const nameLines = wrapArabicText(mctx, l.itemName, itemColWidth);
    const unitLabel =
      l.conversionFactor > 1 ? `${l.unitName} (×${l.conversionFactor})` : l.unitName;
    const rowHeight = Math.max(
      nameLines.length * lineSpacing + smallLineSpacing + 8,
      lineSpacing * 2
    );
    return {
      nameLines,
      unitLabel,
      qtyText: String(l.line.quantity),
      priceText: (l.line.unitPricePiastres / 100).toFixed(2),
      totalText: (l.line.lineTotalPiastres / 100).toFixed(2),
      rowHeight,
    };
  });

  mctx.font = `600 ${smallFontSize}px ${fontFamily}`;
  const addressLines = settings?.address
    ? wrapArabicText(mctx, settings.address, contentWidth)
    : [];
  const notesLines = invoice.notes
    ? wrapArabicText(mctx, `ملاحظات: ${invoice.notes}`, contentWidth)
    : [];
  const footerLines = settings?.invoiceFooter
    ? wrapArabicText(mctx, settings.invoiceFooter, contentWidth)
    : [];

  // Calculate total vertical height accurately
  let totalHeight = 20;
  if (logoImg) totalHeight += (is58 ? 72 : 90) + 10;
  totalHeight += headerFontSize * 1.4; // company name
  if (settings?.phone) totalHeight += smallLineSpacing;
  totalHeight += addressLines.length * smallLineSpacing;
  if (settings?.taxNumber) totalHeight += smallLineSpacing;
  totalHeight += 18; // divider + gap
  totalHeight += baseFontSize * 1.6; // title "فاتورة مبيعات"
  if (invoice.status === 'reversed') totalHeight += lineSpacing;
  totalHeight += lineSpacing * 4; // invoice#, date, customer, warehouse/payment
  totalHeight += 18; // divider
  totalHeight += lineSpacing + 8; // table header
  for (const r of preparedRows) {
    totalHeight += r.rowHeight + 6;
  }
  totalHeight += 16; // divider
  totalHeight += lineSpacing * 4; // subtotal, paid, remaining (+ discount)
  if (invoice.discountPiastres > 0) totalHeight += lineSpacing;
  totalHeight += totalFontSize * 1.5; // Net total line
  totalHeight += 16;
  totalHeight += notesLines.length * smallLineSpacing;
  if (footerLines.length > 0) {
    totalHeight += 14 + footerLines.length * smallLineSpacing;
  }
  totalHeight += 36; // quiet bottom margin before cut

  // Actual render pass
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.ceil(totalHeight);
  const ctx = canvas.getContext('2d')!;

  // White paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';

  let y = 16;

  // Optional Logo
  if (logoImg) {
    const maxLogoH = is58 ? 68 : 86;
    const maxLogoW = is58 ? 160 : 220;
    const scale = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height, 1);
    const drawW = Math.round(logoImg.width * scale);
    const drawH = Math.round(logoImg.height * scale);
    const drawX = Math.round((width - drawW) / 2);
    ctx.drawImage(logoImg, drawX, y, drawW, drawH);
    y += drawH + 10;
  }

  // Company Header (centered)
  ctx.textAlign = 'center';
  ctx.font = `800 ${headerFontSize}px ${fontFamily}`;
  ctx.fillText(companyName, width / 2, y);
  y += Math.round(headerFontSize * 1.35);

  ctx.font = `600 ${smallFontSize}px ${fontFamily}`;
  if (settings?.phone) {
    ctx.fillText(`هاتف: ${settings.phone}`, width / 2, y);
    y += smallLineSpacing;
  }
  for (const line of addressLines) {
    ctx.fillText(line, width / 2, y);
    y += smallLineSpacing;
  }
  if (settings?.taxNumber) {
    ctx.fillText(`الرقم الضريبي: ${settings.taxNumber}`, width / 2, y);
    y += smallLineSpacing;
  }

  y += 6;
  drawHorizontalDivider(ctx, y, width, paddingX, false);
  y += 12;

  // Title
  ctx.textAlign = 'center';
  ctx.font = `800 ${baseFontSize + 3}px ${fontFamily}`;
  ctx.fillText('فاتورة مبيعات', width / 2, y);
  y += Math.round((baseFontSize + 3) * 1.4);

  if (invoice.status === 'reversed') {
    ctx.font = `800 ${baseFontSize}px ${fontFamily}`;
    ctx.fillText('*** فاتورة ملغاة (قيد عكسي) ***', width / 2, y);
    y += lineSpacing;
  }

  // Key-value metadata helper (RTL: label right, value left)
  const drawMetaPair = (label: string, value: string) => {
    ctx.textAlign = 'right';
    ctx.font = `700 ${smallFontSize}px ${fontFamily}`;
    ctx.fillText(label, width - paddingX, y);
    ctx.textAlign = 'left';
    ctx.font = `600 ${smallFontSize}px ${fontFamily}`;
    ctx.fillText(value, paddingX, y);
    y += smallLineSpacing + 2;
  };

  drawMetaPair('رقم الفاتورة:', invoice.invoiceNumber);
  drawMetaPair('التاريخ:', formatArabicDateTime(invoice.createdAt));
  drawMetaPair('العميل:', details.customerName);
  const payLabel =
    invoice.paymentType === 'cash'
      ? 'نقدي'
      : invoice.paymentType === 'credit'
      ? 'آجل'
      : 'جزئي';
  drawMetaPair('المخزن / السداد:', `${details.warehouseName} · ${payLabel}`);

  y += 6;
  drawHorizontalDivider(ctx, y, width, paddingX, false);
  y += 10;

  // Table Columns X positions (RTL right-to-left)
  // Rightmost: الصنف | then الكمية | then السعر | Leftmost: الإجمالي
  const colRightItem = width - paddingX;
  const colQtyCenter = paddingX + Math.round(contentWidth * (is58 ? 0.5 : 0.48));
  const colPriceCenter = paddingX + Math.round(contentWidth * (is58 ? 0.28 : 0.27));
  const colTotalLeft = paddingX;

  ctx.font = `800 ${smallFontSize}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('الصنف', colRightItem, y);
  ctx.textAlign = 'center';
  ctx.fillText('الكمية', colQtyCenter, y);
  ctx.fillText('السعر', colPriceCenter, y);
  ctx.textAlign = 'left';
  ctx.fillText('الإجمالي', colTotalLeft, y);

  y += smallLineSpacing + 6;
  drawHorizontalDivider(ctx, y, width, paddingX, true);
  y += 8;

  // Rows
  for (const row of preparedRows) {
    const startY = y;
    ctx.textAlign = 'right';
    ctx.font = `700 ${baseFontSize - 1}px ${fontFamily}`;
    let textY = startY;
    for (const nLine of row.nameLines) {
      ctx.fillText(nLine, colRightItem, textY);
      textY += lineSpacing;
    }
    ctx.font = `600 ${smallFontSize - 2}px ${fontFamily}`;
    ctx.fillText(row.unitLabel, colRightItem, textY);

    // Qty, Price, Total aligned with first line
    ctx.font = `700 ${smallFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(row.qtyText, colQtyCenter, startY + 2);
    ctx.fillText(row.priceText, colPriceCenter, startY + 2);
    ctx.textAlign = 'left';
    ctx.font = `800 ${smallFontSize}px ${fontFamily}`;
    ctx.fillText(row.totalText, colTotalLeft, startY + 2);

    y += row.rowHeight;
    drawHorizontalDivider(ctx, y, width, paddingX, true);
    y += 6;
  }

  y += 4;
  drawHorizontalDivider(ctx, y, width, paddingX, false);
  y += 10;

  const drawSummaryLine = (label: string, amountPiastres: number, emphasize = false) => {
    const fontSz = emphasize ? totalFontSize : baseFontSize;
    const weight = emphasize ? 800 : 700;
    ctx.font = `${weight} ${fontSz}px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(label, width - paddingX, y);
    ctx.textAlign = 'left';
    ctx.fillText(formatEGP(amountPiastres, currency), paddingX, y);
    y += Math.round(fontSz * 1.42);
  };

  drawSummaryLine('الإجمالي قبل الخصم:', invoice.subtotalPiastres);
  if (invoice.discountPiastres > 0) {
    drawSummaryLine(
      invoice.discountType === 'percent'
        ? `الخصم (${invoice.discountValue}%):`
        : 'الخصم:',
      invoice.discountPiastres
    );
  }
  drawSummaryLine('صافي الفاتورة:', invoice.totalPiastres, true);
  drawSummaryLine('المدفوع:', invoice.paidPiastres);
  drawSummaryLine('المتبقي على الحساب:', invoice.remainingPiastres);

  if (notesLines.length > 0) {
    y += 6;
    ctx.textAlign = 'right';
    ctx.font = `600 ${smallFontSize}px ${fontFamily}`;
    for (const nLine of notesLines) {
      ctx.fillText(nLine, width - paddingX, y);
      y += smallLineSpacing;
    }
  }

  if (footerLines.length > 0) {
    y += 6;
    drawHorizontalDivider(ctx, y, width, paddingX, true);
    y += 10;
    ctx.textAlign = 'center';
    ctx.font = `600 ${smallFontSize}px ${fontFamily}`;
    for (const fLine of footerLines) {
      ctx.fillText(fLine, width / 2, y);
      y += smallLineSpacing;
    }
  }

  return canvas;
}

export async function renderTestReceiptCanvas(
  settings: CompanySettingsRecord | null,
  overridePaperWidth?: ThermalPaperWidth
): Promise<HTMLCanvasElement> {
  const dummyDetails: SalesInvoiceWithDetails = {
    invoice: {
      id: 'test-receipt',
      invoiceNumber: 'TEST-0001',
      customerId: null,
      warehouseId: 'wh-test',
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotalPiastres: 19500,
      discountType: 'fixed',
      discountValue: 1500,
      discountPiastres: 1500,
      totalPiastres: 18000,
      paidPiastres: 18000,
      remainingPiastres: 0,
      totalCostPiastres: 13000,
      returnedPiastres: 0,
      returnedCostPiastres: 0,
      profitPiastres: 5000,
      paymentType: 'cash',
      paymentMethodId: null,
      status: 'posted',
      reversedById: null,
      reversesId: null,
      amendedFromId: null,
      clientRequestId: null,
      notes: 'طباعة تجريبية للتحقق من وضوح الخط العربي وتنسيق الورق.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'SYSTEM',
    },
    customerName: 'عميل اختبار الطباعة',
    customerPhone: '',
    warehouseName: 'المخزن الرئيسي',
    paymentMethodName: 'نقدي',
    lines: [
      {
        line: {
          id: 'l1',
          invoiceId: 'test-receipt',
          itemId: 'i1',
          unitId: 'u1',
          quantity: 2,
          baseQuantity: 2,
          unitConversionFactor: 1,
          unitPricePiastres: 6500,
          costPricePiastres: 4500,
          discountPiastres: 0,
          returnedBaseQuantity: 0,
          lineTotalPiastres: 13000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'SYSTEM',
        },
        itemName: 'بن تركي محوّج فاخر 250 جم',
        itemSku: 'BN-250',
        unitName: 'قطعة',
        conversionFactor: 1,
      },
      {
        line: {
          id: 'l2',
          invoiceId: 'test-receipt',
          itemId: 'i2',
          unitId: 'u2',
          quantity: 1,
          baseQuantity: 1,
          unitConversionFactor: 1,
          unitPricePiastres: 6500,
          costPricePiastres: 4000,
          discountPiastres: 0,
          returnedBaseQuantity: 0,
          lineTotalPiastres: 6500,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'SYSTEM',
        },
        itemName: 'بن إسبريسو وسط 250 جم',
        itemSku: 'ESP-250',
        unitName: 'قطعة',
        conversionFactor: 1,
      },
    ],
  };

  return renderReceiptCanvas(dummyDetails, settings, overridePaperWidth);
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('تعذر تحويل صورة الفاتورة إلى PNG.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

export async function shareOrDownloadReceiptPng(
  canvas: HTMLCanvasElement,
  filename: string,
  title: string
): Promise<'shared' | 'downloaded'> {
  const blob = await canvasToPngBlob(canvas);
  const file = new File([blob], filename, {type: 'image/png'});

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({files: [file]})
  ) {
    try {
      await navigator.share({
        title,
        text: title,
        files: [file],
      });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('تم إلغاء المشاركة.');
      }
      // Fall back to direct download if Web Share rejects
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
