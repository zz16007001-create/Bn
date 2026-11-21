import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {db} from '../db/database';
import {resetMigrationState, runDatabaseMigrations} from '../db/migrations';
import {authRepository} from '../repositories/authRepository';
import {collectionRepository} from '../repositories/collectionRepository';
import {customerRepository} from '../repositories/customerRepository';
import {dashboardRepository} from '../repositories/dashboardRepository';
import {expenseRepository} from '../repositories/expenseRepository';
import {itemRepository} from '../repositories/itemRepository';
import {purchaseRepository} from '../repositories/purchaseRepository';
import {purchaseReturnRepository} from '../repositories/purchaseReturnRepository';
import {reportsRepository} from '../repositories/reportsRepository';
import {salesRepository} from '../repositories/salesRepository';
import {supplierRepository} from '../repositories/supplierRepository';
import {
  postTreasuryMovementTx,
  treasuryRepository,
} from '../repositories/treasuryRepository';
import {warehouseRepository} from '../repositories/warehouseRepository';
import {withWriteTx} from '../repositories/baseRepository';
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
    name: 'مدير الاختبار',
    username: 'admin_stage4',
    pin: '1234',
    companyName: 'شركة نُخبة البن',
  });
  adminUser = session.user;

  const roles = await authRepository.listRoles();
  const salesRole = roles.find((r) => r.code === 'sales')!;
  salesUser = await authRepository.createUser(adminUser, {
    name: 'مندوب المبيعات',
    username: 'sales_stage4',
    pin: '5678',
    roleId: salesRole.id,
  });

  const warehouses = await warehouseRepository.listWarehouses();
  defaultWarehouseId = warehouses[0].warehouse.id;

  const tSummary = await treasuryRepository.getSummary();
  defaultMethodId = tSummary.paymentMethods[0].id;
});

describe('1. الخزنة ومعادلة الرصيد ومنع التكرار والسحب المقيد', () => {
  it('تلتزم الخزنة بمعادلة (الافتتاحي + المقبوضات − المدفوعات) وتمنع السحب بدون صلاحية وتتحقق من الإقفال اليومي', async () => {
    await treasuryRepository.recordOpeningBalance(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 500000, // 5000 ج.م
      notes: 'رصيد بداية النشاط',
    });

    await treasuryRepository.recordManualDeposit(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 150000, // 1500 ج.م
      notes: 'تمويل إضافي',
    });

    // مندوب المبيعات لا يملك صلاحية treasury.withdraw
    await expect(
      treasuryRepository.recordManualWithdrawal(salesUser, {
        paymentMethodId: defaultMethodId,
        amountPiastres: 50000,
        notes: 'محاولة سحب غير مصرح بها',
      })
    ).rejects.toThrow();

    await treasuryRepository.recordManualWithdrawal(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 100000, // 1000 ج.م
      notes: 'سحب مالك',
    });

    const summary = await treasuryRepository.getSummary(defaultMethodId);
    expect(summary.openingPiastres).toBe(500000);
    expect(summary.totalInPiastres).toBe(150000);
    expect(summary.totalOutPiastres).toBe(100000);
    expect(summary.computedBalancePiastres).toBe(550000); // 5000 + 1500 - 1000
    expect(summary.methodsBalancePiastres).toBe(550000);

    // منع تكرار حركة الخزنة بنفس idempotencyKey
    await expect(
      withWriteTx([db.treasury_transactions, db.payment_methods], async () => {
        await postTreasuryMovementTx({
          actor: adminUser,
          paymentMethodId: defaultMethodId,
          direction: 'in',
          amountPiastres: 10000,
          sourceType: 'deposit',
          sourceId: 'doc-1',
          idempotencyKey: 'dup-key-1',
          notes: 'حركة أولى',
        });
        await postTreasuryMovementTx({
          actor: adminUser,
          paymentMethodId: defaultMethodId,
          direction: 'in',
          amountPiastres: 10000,
          sourceType: 'deposit',
          sourceId: 'doc-1',
          idempotencyKey: 'dup-key-1',
          notes: 'حركة مكررة',
        });
      })
    ).rejects.toThrow();

    // إقفال يومي مع عجز 50 ج.م
    const closing = await treasuryRepository.recordDailyClosing(adminUser, {
      paymentMethodId: defaultMethodId,
      closingDate: new Date().toISOString().slice(0, 10),
      actualCountedPiastres: 545000,
      notes: 'عجز طفيف',
    });
    expect(closing.expectedBalancePiastres).toBe(550000);
    expect(closing.variancePiastres).toBe(-5000);
  });
});

describe('2. قاعدة الخزنة: تسجيل المدفوع فعلياً فقط وعدم دخول الفاتورة الآجلة', () => {
  it('فاتورة 1000 دفع العميل 400 = مبيعات 1000، مقبوضات 400، مديونية 600، والخزنة تزيد 400 فقط', async () => {
    await treasuryRepository.recordOpeningBalance(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 100000, // 1000 ج.م افتتاحي
    });

    const item = await itemRepository.createItem(adminUser, {
      name: 'بن إسبريسو',
      sku: 'ESP-1',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 10000, // 100 ج.م للقطعة
      cartonSalePricePiastres: 100000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 50,
      openingWarehouseId: defaultWarehouseId,
    });

    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'كافيه الوسط',
      creditLimitPiastres: 500000,
    });

    // فاتورة بـ 1000 ج.م مدفوع منها 400 ج.م فقط
    const sale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'partial',
      paidPiastres: 40000, // 400 ج.م
      paymentMethodId: defaultMethodId,
      lines: [{itemId: item.item.id, unitId: item.baseUnit.id, quantity: 10}],
    });

    expect(sale.invoice.totalPiastres).toBe(100000);
    expect(sale.invoice.paidPiastres).toBe(40000);
    expect(sale.invoice.remainingPiastres).toBe(60000);

    // الخزنة زادت بـ 400 ج.م فقط (1000 + 400 = 1400 ج.م)
    const afterPartial = await treasuryRepository.getSummary(defaultMethodId);
    expect(afterPartial.computedBalancePiastres).toBe(140000);

    // فاتورة آجلة بالكامل (500 ج.م، مدفوع 0) لا تدخل الخزنة
    const creditSale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'credit',
      paidPiastres: 0,
      lines: [{itemId: item.item.id, unitId: item.baseUnit.id, quantity: 5}],
    });
    expect(creditSale.invoice.totalPiastres).toBe(50000);

    const afterCredit = await treasuryRepository.getSummary(defaultMethodId);
    expect(afterCredit.computedBalancePiastres).toBe(140000);

    const updatedCustomer = await db.customers.get(customer.id);
    expect(updatedCustomer?.currentBalancePiastres).toBe(110000); // 600 + 500 = 1100 ج.م

    // تحصيل 600 ج.م يرفع الخزنة إلى 2000 ج.م ويخفض المديونية إلى 500 ج.م
    await collectionRepository.recordCollection(adminUser, {
      customerId: customer.id,
      amountPiastres: 60000,
      paymentMethodId: defaultMethodId,
    });
    const afterCol = await treasuryRepository.getSummary(defaultMethodId);
    expect(afterCol.computedBalancePiastres).toBe(200000);

    // إلغاء الفاتورة الجزئية يعكس الـ 400 ج.م من الخزنة
    await salesRepository.cancelSalesInvoice(adminUser, sale.invoice.id, 'إلغاء اختباري');
    const afterCancel = await treasuryRepository.getSummary(defaultMethodId);
    expect(afterCancel.computedBalancePiastres).toBe(160000);
  });
});

describe('3. المصروفات وتصنيفاتها والخصم من الخزنة والقيد العكسي', () => {
  it('توجد التصنيفات الافتراضية وتخصم المصروفات من الخزنة وتنعكس عند التعديل والإلغاء', async () => {
    const cats = await expenseRepository.listCategories();
    const catNames = cats.map((c) => c.name);
    expect(catNames).toEqual(
      expect.arrayContaining(['النقل', 'الوقود', 'العمالة', 'الإيجار', 'الكهرباء', 'الصيانة', 'أخرى'])
    );

    const newCat = await expenseRepository.createCategory(adminUser, 'تغليف ودعاية');
    expect(newCat.name).toBe('تغليف ودعاية');

    await treasuryRepository.recordOpeningBalance(adminUser, {
      paymentMethodId: defaultMethodId,
      amountPiastres: 100000, // 1000 ج.م
    });

    const exp = await expenseRepository.createExpense(adminUser, {
      categoryId: newCat.id,
      paymentMethodId: defaultMethodId,
      amountPiastres: 25000, // 250 ج.م
      description: 'طباعة أكياس بن',
    });

    let tSum = await treasuryRepository.getSummary(defaultMethodId);
    expect(tSum.computedBalancePiastres).toBe(75000); // 1000 - 250

    // تعديل المصروف إلى 150 ج.م بقيد عكسي
    const amended = await expenseRepository.amendExpense(adminUser, exp.expense.id, {
      categoryId: newCat.id,
      paymentMethodId: defaultMethodId,
      amountPiastres: 15000,
      description: 'طباعة أكياس بن بعد التعديل',
    });
    tSum = await treasuryRepository.getSummary(defaultMethodId);
    expect(tSum.computedBalancePiastres).toBe(85000); // 1000 - 150

    // إلغاء المصروف يعيد الـ 150 ج.م كاملة للخزنة
    await expenseRepository.cancelExpense(adminUser, amended.expense.id);
    tSum = await treasuryRepository.getSummary(defaultMethodId);
    expect(tSum.computedBalancePiastres).toBe(100000);
  });
});

describe('4. مرتجعات المشتريات (تخفيض مستحقات المورد أو استرداد نقدي للخزنة)', () => {
  it('يخصم المرتجع من المخزون ويمنع تجاوز المشترى ويخفض المورد أو يضيف للخزنة', async () => {
    const supplier = await supplierRepository.createSupplier(adminUser, {name: 'مورد البن الأول'});
    const item = await itemRepository.createItem(adminUser, {
      name: 'بن برازيلي',
      sku: 'BRA-1',
      costPricePiastres: 0,
      pieceSalePricePiastres: 9000,
      cartonSalePricePiastres: 90000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 0,
    });

    // شراء 20 قطعة × 50 ج.م = 1000 ج.م (مدفوع 400، متبقي للمورد 600)
    const pur = await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      paidPiastres: 40000,
      paymentMethodId: defaultMethodId,
      lines: [
        {
          itemId: item.item.id,
          unitId: item.baseUnit.id,
          quantity: 20,
          unitCostPiastres: 5000,
        },
      ],
    });

    const lineId = pur.lines[0].line.id;

    // رفض إرجاع كمية أكبر من المشترى (25 > 20)
    await expect(
      purchaseReturnRepository.createPurchaseReturn(adminUser, {
        purchaseInvoiceId: pur.invoice.id,
        refundMode: 'supplier_credit',
        lines: [{purchaseInvoiceLineId: lineId, quantity: 25}],
      })
    ).rejects.toThrow();

    // إرجاع 4 قطع (200 ج.م) كتخفيض مستحقات المورد
    await purchaseReturnRepository.createPurchaseReturn(adminUser, {
      purchaseInvoiceId: pur.invoice.id,
      refundMode: 'supplier_credit',
      reason: 'عبوات مثقوبة',
      lines: [{purchaseInvoiceLineId: lineId, quantity: 4}],
    });

    let sup = await db.suppliers.get(supplier.id);
    expect(sup?.currentBalancePiastres).toBe(40000); // 600 - 200 = 400 ج.م

    // إرجاع 6 قطع (300 ج.م) باسترداد نقدي إلى الخزنة
    const tBefore = await treasuryRepository.getSummary(defaultMethodId);
    await purchaseReturnRepository.createPurchaseReturn(adminUser, {
      purchaseInvoiceId: pur.invoice.id,
      refundMode: 'cash_refund',
      paymentMethodId: defaultMethodId,
      reason: 'استرداد نقدي',
      lines: [{purchaseInvoiceLineId: lineId, quantity: 6}],
    });
    const tAfter = await treasuryRepository.getSummary(defaultMethodId);
    expect(tAfter.computedBalancePiastres - tBefore.computedBalancePiastres).toBe(30000);

    // المخزون المتبقي = 20 - 4 - 6 = 10 قطع
    const listedItems = await itemRepository.listItems({status: 'all'});
    const stock = listedItems.find((i) => i.item.id === item.item.id)?.totalStockQty;
    expect(stock).toBe(10);
  });
});

describe('5. معادلة متوسط التكلفة المرجح والتقارير والأرباح (100@50 + 100@60)', () => {
  it('يحسب: 100@50 + 100@60 = 55؛ بيع 10@80 -> مبيعات 800، تكلفة 550، مجمل ربح 250، وصافي ربح بعد المصروف 150', async () => {
    const supplier = await supplierRepository.createSupplier(adminUser, {name: 'مورد الجملة'});
    const item = await itemRepository.createItem(adminUser, {
      name: 'بن وسط مخصوص',
      sku: 'COF-SPEC',
      costPricePiastres: 0,
      pieceSalePricePiastres: 8000, // 80 ج.م
      cartonSalePricePiastres: 80000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 0,
    });

    // دفعة 1: 100 قطعة بسعر 50 ج.م
    await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      paidPiastres: 0,
      lines: [
        {
          itemId: item.item.id,
          unitId: item.baseUnit.id,
          quantity: 100,
          unitCostPiastres: 5000,
        },
      ],
    });

    // دفعة 2: 100 قطعة بسعر 60 ج.م
    await purchaseRepository.createPurchaseInvoice(adminUser, {
      supplierId: supplier.id,
      warehouseId: defaultWarehouseId,
      paidPiastres: 0,
      lines: [
        {
          itemId: item.item.id,
          unitId: item.baseUnit.id,
          quantity: 100,
          unitCostPiastres: 6000,
        },
      ],
    });

    const refreshedItem = await db.items.get(item.item.id);
    expect(refreshedItem?.costPricePiastres).toBe(5500); // 55 ج.م

    // بيع 10 قطع بسعر 80 ج.م نقداً
    await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: null,
      warehouseId: defaultWarehouseId,
      paymentType: 'cash',
      paymentMethodId: defaultMethodId,
      lines: [{itemId: item.item.id, unitId: item.baseUnit.id, quantity: 10}],
    });

    // مصروف تشغيل 100 ج.م
    const cats = await expenseRepository.listCategories();
    await expenseRepository.createExpense(adminUser, {
      categoryId: cats[0].id,
      paymentMethodId: defaultMethodId,
      amountPiastres: 10000, // 100 ج.م
      description: 'مصروف توصيل',
    });

    const reports = await reportsRepository.generateReports();
    expect(reports.kpis.netSalesPiastres).toBe(80000); // 800 ج.م
    expect(reports.kpis.totalCollectedPiastres).toBe(80000); // 800 ج.م (نقدي مباشر)
    expect(reports.kpis.totalCogsPiastres).toBe(55000); // 550 ج.م
    expect(reports.kpis.grossProfitPiastres).toBe(25000); // 250 ج.م
    expect(reports.kpis.totalExpensesPiastres).toBe(10000); // 100 ج.م
    expect(reports.kpis.netProfitPiastres).toBe(15000); // 150 ج.م

    const dash = await dashboardRepository.getSummary();
    expect(dash.todaySalesPiastres).toBe(80000);
    expect(dash.todayCollectedPiastres).toBe(80000);
    expect(dash.grossProfitPiastres).toBe(25000);
    expect(dash.netProfitPiastres).toBe(15000);
    expect(dash.last7DaysSeries.length).toBe(7);
  });
});
