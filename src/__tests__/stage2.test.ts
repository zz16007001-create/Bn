import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {db} from '../db/database';
import {resetMigrationState, runDatabaseMigrations} from '../db/migrations';
import {authRepository} from '../repositories/authRepository';
import {itemRepository} from '../repositories/itemRepository';
import {purchaseRepository} from '../repositories/purchaseRepository';
import {stockMovementRepository} from '../repositories/stockMovementRepository';
import {supplierRepository} from '../repositories/supplierRepository';
import {warehouseRepository} from '../repositories/warehouseRepository';
import type {UserRecord} from '../types/domain';
import {
  computeReversedWeightedAverageCost,
  computeWeightedAverageCost,
  convertToBaseQuantity,
} from '../utils/inventoryMath';

let adminUser: UserRecord;
let defaultWarehouseId: string;

beforeEach(async () => {
  await db.delete();
  resetMigrationState();
  await runDatabaseMigrations();

  const session = await authRepository.createInitialAdmin({
    name: 'مدير الاختبار',
    username: 'admin_test',
    pin: '1234',
    companyName: 'شركة اختبار البن',
  });
  adminUser = session.user;

  const warehouses = await warehouseRepository.listWarehouses();
  defaultWarehouseId = warehouses[0].warehouse.id;
});

describe('1. تحويل الكرتونة إلى قطع وحساب وحدات التعبئة', () => {
  it('يحول الكمية من كرتونة إلى قطع بدقة ويمنع حذف صنف له حركات', async () => {
    expect(convertToBaseQuantity(3, 20)).toBe(60);
    expect(convertToBaseQuantity(5, 24)).toBe(120);

    const created = await itemRepository.createItem(adminUser, {
      name: 'بن 250 جرام',
      sku: 'BN-250',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 6500,
      cartonSalePricePiastres: 125000,
      cartonConversionFactor: 20,
      minStockQty: 20,
      openingStockQty: 40,
      openingWarehouseId: defaultWarehouseId,
    });

    expect(created.cartonUnit?.conversionFactor).toBe(20);
    expect(created.totalStockQty).toBe(40);
    expect(created.hasMovements).toBe(true);

    // Must block deletion when movements exist
    await expect(itemRepository.deleteItem(adminUser, created.item.id)).rejects.toThrow();
  });
});

describe('2. حساب متوسط التكلفة المرجح (Weighted Average Cost)', () => {
  it('يحسب المتوسط المرجح: 100 قطعة بـ50 ثم 100 قطعة بـ60 = 55', () => {
    const newAvg = computeWeightedAverageCost({
      currentStockQty: 100,
      currentAvgCostPiastres: 5000,
      incomingBaseQty: 100,
      incomingUnitCostBasePiastres: 6000,
    });
    expect(newAvg).toBe(5500);

    const unwound = computeReversedWeightedAverageCost({
      stockAfterPurchaseQty: 200,
      avgCostAfterPurchasePiastres: 5500,
      reversedBaseQty: 100,
      reversedUnitCostBasePiastres: 6000,
      previousAvgCostPiastres: 5000,
    });
    expect(unwound).toBe(5000);
  });
});

describe('3. فواتير الشراء، تعديلها، وإلغاؤها بقيود عكسية', () => {
  it('ينفذ الشراء بالكرتونة، يحدث متوسط التكلفة ورصيد المخزون والمورد، ثم يعكسها عند الإلغاء', async () => {
    // 1) إنشاء صنف بـ100 قطعة رصيد افتتاحي بتكلفة 50 ج.م (5000 قرش) ومعامل كرتونة 20 قطعة
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن تركي 250 جم',
      sku: 'BN-250-TRK',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 6500,
      cartonSalePricePiastres: 120000,
      cartonConversionFactor: 20,
      minStockQty: 20,
      openingStockQty: 100,
      openingWarehouseId: defaultWarehouseId,
    });

    const supplier = await supplierRepository.createSupplier(adminUser, {
      name: 'شركة النيل لاستيراد البن',
      phone: '01012345678',
    });

    // 2) شراء 5 كراتين (5 × 20 = 100 قطعة) بسعر 1200 ج.م للكرتونة (= 60 ج.م للقطعة = 6000 قرش)
    // الإجمالي = 6000 ج.م، المدفوع = 2000 ج.م، المتبقي = 4000 ج.م
    const pur = await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      discountPiastres: 0,
      paidPiastres: 200000,
      lines: [
        {
          itemId: itemRes.item.id,
          unitId: itemRes.cartonUnit!.id,
          quantity: 5,
          unitCostPiastres: 120000,
        },
      ],
    });

    expect(pur.invoice.totalPiastres).toBe(600000);
    expect(pur.invoice.remainingPiastres).toBe(400000);
    expect(pur.lines[0].line.baseQuantity).toBe(100);

    // التحقق من المخزون (100 + 100 = 200) ومتوسط التكلفة (55.00 ج.م = 5500 قرش)
    const itemsAfterPur = await itemRepository.listItems();
    expect(itemsAfterPur[0].totalStockQty).toBe(200);
    expect(itemsAfterPur[0].item.costPricePiastres).toBe(5500);

    // التحقق من رصيد المورد (4000 ج.م = 400000 قرش)
    const supsAfterPur = await supplierRepository.listSuppliers();
    expect(supsAfterPur[0].supplier.currentBalancePiastres).toBe(400000);

    // 3) إلغاء فاتورة الشراء بقيد عكسي
    const cancelled = await purchaseRepository.cancelPurchaseInvoice(
      adminUser,
      pur.invoice.id,
      'خطأ في الكمية'
    );
    expect(cancelled.status).toBe('reversed');

    // يجب أن يعود المخزون إلى 100، ومتوسط التكلفة إلى 5000 قرش (50 ج.م)، ورصيد المورد إلى 0
    const itemsAfterCancel = await itemRepository.listItems();
    expect(itemsAfterCancel[0].totalStockQty).toBe(100);
    expect(itemsAfterCancel[0].item.costPricePiastres).toBe(5000);

    const supsAfterCancel = await supplierRepository.listSuppliers();
    expect(supsAfterCancel[0].supplier.currentBalancePiastres).toBe(0);

    // التحقق من تسجيل حركة عكسية غير محذوفة في السجل
    const movements = await stockMovementRepository.listMovements({
      itemId: itemRes.item.id,
    });
    expect(movements.some((m) => m.movement.movementType === 'reversal' && m.movement.quantityDelta === -100)).toBe(true);
  });

  it('يعدّل فاتورة الشراء بقيد عكسي ويعيد حساب المخزون ومتوسط التكلفة وحساب المورد', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن كلاسيك',
      sku: 'BN-CLS',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 6500,
      cartonSalePricePiastres: 120000,
      cartonConversionFactor: 20,
      minStockQty: 10,
      openingStockQty: 100,
      openingWarehouseId: defaultWarehouseId,
    });

    const supplier = await supplierRepository.createSupplier(adminUser, {
      name: 'مورد المحمصة',
    });

    // فاتورة أولى: 5 كراتين (100 قطعة) بسعر 1200 ج.م للكرتونة (60 ج.م للقطعة)
    const original = await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      paidPiastres: 100000,
      lines: [
        {
          itemId: itemRes.item.id,
          unitId: itemRes.cartonUnit!.id,
          quantity: 5,
          unitCostPiastres: 120000,
        },
      ],
    });

    // تعديل الفاتورة إلى: 5 كراتين (100 قطعة) بسعر 1400 ج.م للكرتونة (70 ج.م للقطعة) ودفع 2000 ج.م
    const amended = await purchaseRepository.amendPurchaseInvoice(
      adminUser,
      original.invoice.id,
      {
        supplierId: supplier.id,
        warehouseId: defaultWarehouseId,
        paidPiastres: 200000,
        lines: [
          {
            itemId: itemRes.item.id,
            unitId: itemRes.cartonUnit!.id,
            quantity: 5,
            unitCostPiastres: 140000,
          },
        ],
      }
    );

    expect(amended.invoice.amendedFromId).toBe(original.invoice.id);
    expect(amended.invoice.totalPiastres).toBe(700000);
    expect(amended.invoice.remainingPiastres).toBe(500000);

    // الفاتورة القديمة تحولت إلى reversed
    const allInvoices = await purchaseRepository.listPurchaseInvoices();
    const oldInv = allInvoices.find((i) => i.invoice.id === original.invoice.id);
    expect(oldInv?.invoice.status).toBe('reversed');

    // المخزون = 100 + 100 = 200 قطعة
    // متوسط التكلفة = (100 * 5000 + 100 * 7000) / 200 = 6000 قرش (60 ج.م)
    const itemsAfter = await itemRepository.listItems();
    expect(itemsAfter[0].totalStockQty).toBe(200);
    expect(itemsAfter[0].item.costPricePiastres).toBe(6000);

    // رصيد المورد = 7000 ج.م - 2000 ج.م مدفوع = 5000 ج.م (500000 قرش)
    const supsAfter = await supplierRepository.listSuppliers();
    expect(supsAfter[0].supplier.currentBalancePiastres).toBe(500000);

    // تسجيل دفعة إضافية 1500 ج.م والتحقق من كشف الحساب
    await supplierRepository.recordSupplierPayment(adminUser, {
      supplierId: supplier.id,
      amountPiastres: 150000,
    });

    const statement = await supplierRepository.getSupplierStatement(supplier.id);
    expect(statement.supplier.currentBalancePiastres).toBe(350000);
    expect(statement.entries[statement.entries.length - 1].runningBalancePiastres).toBe(350000);
  });

  it('يدعم التحويل بين المخازن وجرد وتسوية المخزون', async () => {
    const branchWh = await warehouseRepository.createWarehouse(adminUser, {
      code: 'WH-02',
      name: 'مخزن فرع الجيزة',
    });

    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'نسكافيه جولد',
      sku: 'NES-200',
      costPricePiastres: 10000,
      pieceSalePricePiastres: 12000,
      cartonSalePricePiastres: 140000,
      cartonConversionFactor: 12,
      minStockQty: 12,
      openingStockQty: 50,
      openingWarehouseId: defaultWarehouseId,
    });

    await warehouseRepository.transferBetweenWarehouses(adminUser, {
      itemId: itemRes.item.id,
      fromWarehouseId: defaultWarehouseId,
      toWarehouseId: branchWh.id,
      quantityBasePieces: 15,
    });

    const mainBal = await warehouseRepository.getBalancesForWarehouse(defaultWarehouseId);
    const branchBal = await warehouseRepository.getBalancesForWarehouse(branchWh.id);

    expect(mainBal.find((b) => b.item.id === itemRes.item.id)?.quantity).toBe(35);
    expect(branchBal.find((b) => b.item.id === itemRes.item.id)?.quantity).toBe(15);

    // جرد المخزن الفرعي: الفعلي 12 بدلاً من 15 (عجز -3)
    const adj = await stockMovementRepository.recordInventoryAdjustment(adminUser, {
      warehouseId: branchWh.id,
      entries: [{itemId: itemRes.item.id, actualQty: 12}],
    });
    expect(adj.adjustedCount).toBe(1);

    const branchAfterCount = await warehouseRepository.getBalancesForWarehouse(branchWh.id);
    expect(branchAfterCount.find((b) => b.item.id === itemRes.item.id)?.quantity).toBe(12);
  });
});
