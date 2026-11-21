import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {CURRENT_DB_VERSION, db} from '../db/database';
import {resetMigrationState, runDatabaseMigrations} from '../db/migrations';
import {auditRepository} from '../repositories/auditRepository';
import {authRepository} from '../repositories/authRepository';
import {
  backupRepository,
  computeTablesChecksum,
  decodeAndVerifyBackup,
} from '../repositories/backupRepository';
import {collectionRepository} from '../repositories/collectionRepository';
import {customerRepository} from '../repositories/customerRepository';
import {expenseRepository} from '../repositories/expenseRepository';
import {itemRepository} from '../repositories/itemRepository';
import {purchaseRepository} from '../repositories/purchaseRepository';
import {purchaseReturnRepository} from '../repositories/purchaseReturnRepository';
import {reportsRepository} from '../repositories/reportsRepository';
import {salesRepository} from '../repositories/salesRepository';
import {salesReturnRepository} from '../repositories/salesReturnRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import {supplierRepository} from '../repositories/supplierRepository';
import {treasuryRepository} from '../repositories/treasuryRepository';
import {warehouseRepository} from '../repositories/warehouseRepository';
import {
  bitmapToEscPosRaster,
  getThermalWidthPixels,
} from '../services/receiptRenderer';
import {chunkEscPosPayload} from '../services/thermalPrinter';
import type {UserRecord} from '../types/domain';

let adminUser: UserRecord;
let salesUser: UserRecord;
let defaultWarehouseId: string;
let defaultMethodId: string;

beforeEach(async () => {
  await db.delete();
  resetMigrationState();
  await runDatabaseMigrations();

  const session = await authRepository.createInitialAdmin({
    name: 'مدير الاختبار الشامل',
    username: 'admin_stage5',
    pin: '1234',
    companyName: 'شركة نُخبة البن للتوزيع',
  });
  adminUser = session.user;

  const roles = await authRepository.listRoles();
  const salesRole = roles.find((r) => r.code === 'sales')!;
  salesUser = await authRepository.createUser(adminUser, {
    name: 'مندوب مبيعات',
    username: 'sales_stage5',
    pin: '5678',
    roleId: salesRole.id,
  });

  const warehouses = await warehouseRepository.listWarehouses();
  defaultWarehouseId = warehouses[0].warehouse.id;

  const tSummary = await treasuryRepository.getSummary();
  defaultMethodId = tSummary.paymentMethods[0].id;
});

describe('1. الاختبار الشامل لدورة العمل الكاملة (شراء -> بيع -> تحصيل -> مصروف -> مرتجعات -> خزنة -> تقارير)', () => {
  it('تطابق أرصدة المخازن والخزنة ومديونية العملاء ومستحقات الموردين والتقارير المالية بدقة 100%', async () => {
    // 1. رصيد افتتاحي للخزنة: 10,000 ج.م
    await treasuryRepository.recordOpeningBalance(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 1000000,
      notes: 'رأس مال افتتاحي',
    });

    // 2. إنشاء صنف وعميل ومورد
    const coffee = await itemRepository.createItem(adminUser, {
      name: 'بن كولومبي محمص 250 جم',
      sku: 'COL-250',
      costPricePiastres: 0,
      pieceSalePricePiastres: 10000, // 100 ج.م
      cartonSalePricePiastres: 95000, // 950 ج.م للكرتونة (10 قطع)
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 0,
    });
    const supplier = await supplierRepository.createSupplier(adminUser, {
      name: 'مورد المحمصة الذهبية',
    });
    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'سوبر ماركت الهدى',
      creditLimitPiastres: 1000000,
    });

    // 3. فاتورة شراء: 50 قطعة × 60 ج.م = 3,000 ج.م (مدفوع 1,000، متبقي للمورد 2,000)
    const purchase = await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      paidPiastres: 100000,
      paymentMethodId: defaultMethodId,
      lines: [
        {
          itemId: coffee.item.id,
          unitId: coffee.baseUnit.id,
          quantity: 50,
          unitCostPiastres: 6000,
        },
      ],
    });
    expect(purchase.invoice.totalPiastres).toBe(300000);

    // 4. بيع نقدي مباشر: 1 كرتونة (10 قطع) = 950 ج.م نقداً
    const cashSale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: null,
      warehouseId: defaultWarehouseId,
      paymentType: 'cash',
      paymentMethodId: defaultMethodId,
      lines: [
        {
          itemId: coffee.item.id,
          unitId: coffee.cartonUnit!.id,
          quantity: 1,
        },
      ],
    });
    expect(cashSale.invoice.totalPiastres).toBe(95000);

    // 5. بيع آجل جزئي للعميل: 15 قطعة × 100 ج.م = 1,500 ج.م، مدفوع 500، متبقي 1,000
    const creditSale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'partial',
      paidPiastres: 50000,
      paymentMethodId: defaultMethodId,
      lines: [
        {
          itemId: coffee.item.id,
          unitId: coffee.baseUnit.id,
          quantity: 15,
        },
      ],
    });
    expect(creditSale.invoice.remainingPiastres).toBe(100000);

    // 6. تحصيل 600 ج.م من العميل -> متبقي على العميل 400 ج.م
    await collectionRepository.recordCollection(adminUser, {
      customerId: customer.id,
      amountPiastres: 60000,
      paymentMethodId: defaultMethodId,
      notes: 'دفعة تحصيل ميداني',
    });

    // 7. مصروف وقود: 200 ج.م
    const cats = await expenseRepository.listCategories();
    await expenseRepository.createExpense(adminUser, {
      categoryId: cats[0].id,
      paymentMethodId: defaultMethodId,
      amountPiastres: 20000,
      description: 'بنزين سيارة التوزيع',
    });

    // 8. مرتجع مبيعات (2 قطعة صالحة من الفاتورة الجزئية خصماً من حساب العميل = 200 ج.م)
    // متبقي على العميل يصبح 400 - 200 = 200 ج.م
    await salesReturnRepository.createSalesReturn(adminUser, {
      salesInvoiceId: creditSale.invoice.id,
      refundMode: 'customer_credit',
      reason: 'زيادة عن الطلب',
      lines: [
        {
          salesInvoiceLineId: creditSale.lines[0].line.id,
          quantity: 2,
          condition: 'good',
        },
      ],
    });

    // 9. مرتجع مشتريات (5 قطع × 60 ج.م = 300 ج.م خصماً من مستحقات المورد)
    // متبقي للمورد يصبح 2,000 - 300 = 1,700 ج.م
    await purchaseReturnRepository.createPurchaseReturn(adminUser, {
      purchaseInvoiceId: purchase.invoice.id,
      refundMode: 'supplier_credit',
      reason: 'تلف تغليف خارجي',
      lines: [
        {
          purchaseInvoiceLineId: purchase.lines[0].line.id,
          quantity: 5,
        },
      ],
    });

    // التحقق النهائي من الأرصدة:
    // المخزون: 50 (شراء) - 10 (بيع نقدي) - 15 (بيع عميل) + 2 (مرتجع مبيعات) - 5 (مرتجع مشتريات) = 22 قطعة
    const allItems = await itemRepository.listItems({status: 'all'});
    const coffeeRow = allItems.find((i) => i.item.id === coffee.item.id)!;
    expect(coffeeRow.totalStockQty).toBe(22);

    // الخزنة: 10,000 (افتتاحي) - 1,000 (مدفوع شراء) + 950 (بيع نقدي) + 500 (بيع عميل) + 600 (تحصيل) - 200 (مصروف) = 10,850 ج.م
    const tSummary = await treasuryRepository.getSummary(defaultMethodId);
    expect(tSummary.computedBalancePiastres).toBe(1085000);
    expect(tSummary.methodsBalancePiastres).toBe(1085000);

    const refreshedCustomer = await db.customers.get(customer.id);
    expect(refreshedCustomer?.currentBalancePiastres).toBe(20000); // 200 ج.م

    const refreshedSupplier = await db.suppliers.get(supplier.id);
    expect(refreshedSupplier?.currentBalancePiastres).toBe(170000); // 1,700 ج.م

    // التقارير:
    // صافي المبيعات = 950 + (1,500 - 200) = 2,250 ج.م (225,000 قرش)
    // صافي تكلفة البضاعة المباعة = (10 + 15 - 2) * 60 = 23 * 60 = 1,380 ج.م (138,000 قرش)
    // مجمل الربح = 2,250 - 1,380 = 870 ج.م (87,000 قرش)
    // صافي الربح = 870 - 200 (مصروف) = 670 ج.م (67,000 قرش)
    const report = await reportsRepository.generateReports();
    expect(report.kpis.netSalesPiastres).toBe(225000);
    expect(report.kpis.totalCogsPiastres).toBe(138000);
    expect(report.kpis.grossProfitPiastres).toBe(87000);
    expect(report.kpis.netProfitPiastres).toBe(67000);
    expect(report.kpis.totalCustomersDebtPiastres).toBe(20000);
    expect(report.kpis.totalSuppliersPayablePiastres).toBe(170000);
  });
});

describe('2. النسخ الاحتياطي المضغوط والتحقق من سلامة SHA-256 والاستعادة الآمنة', () => {
  it('يرفض الملف التالف أو المعدل قبل مسح القاعدة، ويستعيد النسخة المضغوطة والنسخ الأقدم بنجاح', async () => {
    const item = await itemRepository.createItem(adminUser, {
      name: 'بن اختبار النسخ',
      sku: 'BKP-1',
      costPricePiastres: 4000,
      pieceSalePricePiastres: 7000,
      cartonSalePricePiastres: 70000,
      cartonConversionFactor: 10,
      minStockQty: 2,
      openingStockQty: 30,
    });

    // تصدير مضغوط + JSON والتحقق من تحديث lastBackupAt
    const compressedRes = await backupRepository.exportCompressedBackup(adminUser);
    expect(compressedRes.payload.formatVersion).toBe(2);
    expect(compressedRes.payload.schemaVersion).toBe(CURRENT_DB_VERSION);
    expect(compressedRes.payload.checksum).toHaveLength(64);
    expect(compressedRes.bytes.length).toBeGreaterThan(20);

    const settingsAfterExport = await settingsRepository.getCompanySettings();
    expect(settingsAfterExport.lastBackupAt).toBe(compressedRes.payload.exportedAt);

    // 1) التلاعب ببيانات النسخة دون تحديث checksum -> يجب رفضها قبل مسح القاعدة!
    const tampered = structuredClone(compressedRes.payload);
    (tampered.tables.items as Array<{name: string}>)[0].name = 'تم العبث به';
    await expect(
      backupRepository.restoreFullBackup(adminUser, JSON.stringify(tampered))
    ).rejects.toThrow(/SHA-256/);

    // التأكد أن القاعدة الحالية لم تتأثر بالملف التالف
    const untouched = await db.items.get(item.item.id);
    expect(untouched?.name).toBe('بن اختبار النسخ');

    // 2) رفض إصدار قاعدة بيانات أحدث من الحالي
    const futureSchema = structuredClone(compressedRes.payload);
    futureSchema.schemaVersion = CURRENT_DB_VERSION + 3;
    await expect(
      decodeAndVerifyBackup(JSON.stringify(futureSchema))
    ).rejects.toThrow(/غير متوافق/);

    // 3) مسح القاعدة بالكامل واستعادة النسخة المضغوطة (.json.gz)
    await db.items.clear();
    expect(await db.items.count()).toBe(0);

    const restoredPreview = await backupRepository.restoreFullBackup(
      adminUser,
      compressedRes.bytes
    );
    expect(restoredPreview.checksumValid).toBe(true);
    expect(restoredPreview.wasCompressed).toBe(compressedRes.compressed);

    const restoredItem = await db.items.get(item.item.id);
    expect(restoredItem?.name).toBe('بن اختبار النسخ');

    // 4) استعادة نسخة بإصدار أقدم (v4) يتم ترقيتها تلقائياً إلى الإصدار الحالي
    const v4Payload = structuredClone(compressedRes.payload);
    v4Payload.schemaVersion = 4;
    v4Payload.tables.schema_migrations = (
      v4Payload.tables.schema_migrations as Array<{version: number}>
    ).filter((m) => m.version <= 4);
    v4Payload.checksum = await computeTablesChecksum(v4Payload.tables);

    await backupRepository.restoreFullBackup(adminUser, JSON.stringify(v4Payload));
    const appliedMigrations = await db.schema_migrations.toArray();
    expect(appliedMigrations.some((m) => m.version === CURRENT_DB_VERSION)).toBe(true);
  });
});

describe('3. إنفاذ الصلاحيات على مستوى المستودعات (Repositories)', () => {
  it('يمنع مندوب المبيعات من العمليات المقيدة إدارياً ومالياً ومخزنياً', async () => {
    const supplier = await supplierRepository.createSupplier(adminUser, {name: 'مورد مقيد'});
    const wh2 = await warehouseRepository.createWarehouse(adminUser, {
      code: 'WH-02',
      name: 'مخزن السيارة',
    });
    const item = await itemRepository.createItem(adminUser, {
      name: 'صنف مقيد',
      sku: 'SEC-1',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 8000,
      cartonSalePricePiastres: 80000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 5,
      openingWarehouseId: defaultWarehouseId,
    });

    // منع إنشاء فاتورة شراء بدون موافقة / أو حسب صلاحيات الدور (المندوب لا يملك صلاحية؟
    // انتبه: المندوب يملك invoice.create، لذا نسحب منه الصلاحية أولاً ونختبر!)
    const roles = await authRepository.listRoles();
    const salesRole = roles.find((r) => r.code === 'sales')!;
    await authRepository.updateRolePermissions(adminUser, salesRole.id, []);

    await expect(
      purchaseRepository.createPurchaseInvoice(salesUser, {
        supplierId: supplier.id,
        warehouseId: defaultWarehouseId,
        paidPiastres: 0,
        lines: [
          {
            itemId: item.item.id,
            unitId: item.baseUnit.id,
            quantity: 5,
            unitCostPiastres: 5000,
          },
        ],
      })
    ).rejects.toThrow();

    await expect(
      authRepository.createUser(salesUser, {
        name: 'محاولة',
        username: 'hack_u',
        pin: '1111',
        roleId: salesRole.id,
      })
    ).rejects.toThrow();

    await expect(
      settingsRepository.updateCompanySettings(salesUser, {companyName: 'اسم غير مصرح'})
    ).rejects.toThrow();

    await expect(backupRepository.exportFullBackup(salesUser)).rejects.toThrow();

    await expect(auditRepository.listAuditLogs(salesUser)).rejects.toThrow();

    await expect(
      warehouseRepository.transferBetweenWarehouses(salesUser, {
        itemId: item.item.id,
        fromWarehouseId: defaultWarehouseId,
        toWarehouseId: wh2.id,
        quantityBasePieces: 100, // يتجاوز 5
        allowStockOverride: true,
      })
    ).rejects.toThrow();

    await expect(
      salesRepository.createOrPostSalesInvoice(salesUser, {
        customerId: null,
        warehouseId: defaultWarehouseId,
        paymentType: 'cash',
        paymentMethodId: defaultMethodId,
        discountType: 'fixed',
        discountValue: 500,
        lines: [
          {
            itemId: item.item.id,
            unitId: item.baseUnit.id,
            quantity: 1,
            unitPricePiastres: 6000,
          },
        ],
      })
    ).rejects.toThrow();
  });
});

describe('4. سجل المراجعة والتفاصيل قبل وبعد التعديل (Audit Before/After Diffs)', () => {
  it('يوثق التغييرات قبل وبعد التعديل ويدعم التصفية ولا يسجل رمز PIN أبداً', async () => {
    const item = await itemRepository.createItem(adminUser, {
      name: 'بن قبل التعديل',
      sku: 'AUD-1',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 8000,
      cartonSalePricePiastres: 80000,
      cartonConversionFactor: 10,
      minStockQty: 5,
    });

    await itemRepository.updateItem(adminUser, item.item.id, {
      name: 'بن بعد التعديل',
      sku: 'AUD-1',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 9500,
      cartonSalePricePiastres: 90000,
      cartonConversionFactor: 10,
      minStockQty: 5,
    });

    await settingsRepository.updateCompanySettings(adminUser, {
      thermalPaperWidth: '58mm',
      autoPrintAfterSale: false,
    });

    await authRepository.resetUserPin(adminUser, salesUser.id, '9988');

    const itemLogs = await auditRepository.listAuditLogs(adminUser, {
      action: 'update',
      entityType: 'items',
    });
    expect(itemLogs.length).toBeGreaterThanOrEqual(1);
    expect(itemLogs[0].details.before?.name).toBe('بن قبل التعديل');
    expect(itemLogs[0].details.after?.name).toBe('بن بعد التعديل');
    expect(itemLogs[0].details.after?.retailPricePiastres).toBe(9500);

    const settingsLogs = await auditRepository.listAuditLogs(adminUser, {
      action: 'settings_update',
      entityType: 'company_settings',
    });
    expect(settingsLogs.length).toBeGreaterThanOrEqual(1);
    expect(settingsLogs[0].details.after?.thermalPaperWidth).toBe('58mm');
    expect(settingsLogs[0].details.after?.autoPrintAfterSale).toBe(false);

    // التأكد من عدم تخزين رمز PIN النصي في سجل المراجعة
    const allLogs = await auditRepository.listAuditLogs(adminUser, {limit: 100});
    for (const log of allLogs) {
      expect(log.record.detailsJson).not.toContain('9988');
      expect(log.record.summary).not.toContain('9988');
    }
  });
});

describe('5. الطباعة الحرارية: تحويل الصورة لـ ESC/POS Raster وتقسيم حزم BLE', () => {
  it('يولد ترويسة GS v 0 وترميز MSB لورق 58mm/80mm ويقسم البيانات لحزم آمنة', () => {
    expect(getThermalWidthPixels('58mm')).toBe(384);
    expect(getThermalWidthPixels('80mm')).toBe(576);

    // صورة اختبارية بعرض 16 بكسل (2 بايت لكل صف) وارتفاع صف واحد
    // أول بكسل أسود (RGBA: 0,0,0,255) والباقي أبيض (255,255,255,255)
    const width = 16;
    const height = 1;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    rgba[0] = 0;
    rgba[1] = 0;
    rgba[2] = 0;
    rgba[3] = 255;

    const escpos = bitmapToEscPosRaster(width, height, rgba);
    // ESC @ (0x1B 0x40), ESC a 1 (0x1B 0x61 0x01), GS v 0 0 (0x1D 0x76 0x30 0x00)
    expect(Array.from(escpos.slice(0, 9))).toEqual([
      0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00,
    ]);
    // xL=2, xH=0, yL=1, yH=0
    expect(Array.from(escpos.slice(9, 13))).toEqual([2, 0, 1, 0]);
    // أول بايت للبيانات: MSB bit (0x80) أسود
    expect(escpos[13]).toBe(0x80);
    expect(escpos[14]).toBe(0x00);
    // نهاية الإيصال: أمر القطع الجزئي (GS V B 3)
    expect(Array.from(escpos.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x03]);

    // تقسيم الحزم لـ BLE
    const payload = new Uint8Array(245).fill(0xaa);
    const chunks = chunkEscPosPayload(payload, 100);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(100);
    expect(chunks[1].length).toBe(100);
    expect(chunks[2].length).toBe(45);
  });
});
