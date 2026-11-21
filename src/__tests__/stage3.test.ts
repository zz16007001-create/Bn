import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {db} from '../db/database';
import {resetMigrationState, runDatabaseMigrations} from '../db/migrations';
import {authRepository} from '../repositories/authRepository';
import {collectionRepository} from '../repositories/collectionRepository';
import {customerRepository} from '../repositories/customerRepository';
import {itemRepository} from '../repositories/itemRepository';
import {salesRepository} from '../repositories/salesRepository';
import {salesReturnRepository} from '../repositories/salesReturnRepository';
import {stockMovementRepository} from '../repositories/stockMovementRepository';
import {warehouseRepository} from '../repositories/warehouseRepository';
import type {UserRecord} from '../types/domain';

let adminUser: UserRecord;
let salesUser: UserRecord;
let defaultWarehouseId: string;

beforeEach(async () => {
  await db.delete();
  resetMigrationState();
  await runDatabaseMigrations();

  const session = await authRepository.createInitialAdmin({
    name: 'مدير الاختبار',
    username: 'admin_test',
    pin: '1234',
    companyName: 'شركة نُخبة البن',
  });
  adminUser = session.user;

  const roles = await authRepository.listRoles();
  const salesRole = roles.find((r) => r.code === 'sales')!;
  salesUser = await authRepository.createUser(adminUser, {
    name: 'مندوب المبيعات',
    username: 'sales_rep',
    pin: '5678',
    roleId: salesRole.id,
  });

  const warehouses = await warehouseRepository.listWarehouses();
  defaultWarehouseId = warehouses[0].warehouse.id;
});

describe('1. فاتورة البيع النقدية والبيع بالكرتونة والربح', () => {
  it('ينفذ فاتورة نقدية، ويخصم 20 قطعة عند بيع كرتونة، ويسجل التكلفة والربح بدقة', async () => {
    // تكلفة القطعة 50 ج.م (5000 قرش)، سعر القطعة 70 ج.م (7000 قرش)، الكرتونة = 20 قطعة بـ 1300 ج.م (130000 قرش)
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن 250 جرام',
      sku: 'BN-250',
      costPricePiastres: 5000,
      pieceSalePricePiastres: 7000,
      cartonSalePricePiastres: 130000,
      cartonConversionFactor: 20,
      minStockQty: 10,
      openingStockQty: 50,
      openingWarehouseId: defaultWarehouseId,
    });

    // بيع 1 كرتونة نقدياً (بدون عميل / عميل نقدي مباشر)
    const sale = await salesRepository.createOrPostSalesInvoice(salesUser, {
      customerId: null,
      warehouseId: defaultWarehouseId,
      paymentType: 'cash',
      lines: [
        {
          itemId: itemRes.item.id,
          unitId: itemRes.cartonUnit!.id,
          quantity: 1,
        },
      ],
    });

    expect(sale.invoice.invoiceNumber).toBe('INV-0001');
    expect(sale.invoice.status).toBe('posted');
    expect(sale.invoice.totalPiastres).toBe(130000);
    expect(sale.invoice.paidPiastres).toBe(130000);
    expect(sale.invoice.remainingPiastres).toBe(0);
    expect(sale.lines[0].line.baseQuantity).toBe(20);
    expect(sale.lines[0].line.costPricePiastres).toBe(5000);
    // التكلفة = 20 * 5000 = 100000 قرش (1000 ج.م)، الربح = 130000 - 100000 = 30000 قرش (300 ج.م)
    expect(sale.invoice.totalCostPiastres).toBe(100000);
    expect(sale.invoice.profitPiastres).toBe(30000);

    // المخزون المتاح بعد بيع 1 كرتونة = 50 - 20 = 30 قطعة
    const itemsAfter = await itemRepository.listItems();
    expect(itemsAfter[0].totalStockQty).toBe(30);
  });
});

describe('2. الفاتورة الآجلة والجزئية والتحصيلات وكشف حساب العميل', () => {
  it('ينشئ فاتورة بـ 1000 ج.م ودفع 400 ج.م فتصبح مديونية العميل 600 ج.م، ثم يحصل الباقي ويمنع الزيادة دون تأكيد', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن وسط 500 جرام',
      sku: 'BN-500',
      costPricePiastres: 8000,
      pieceSalePricePiastres: 10000, // 100 ج.م للقطعة
      cartonSalePricePiastres: 100000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 30,
      openingWarehouseId: defaultWarehouseId,
    });

    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'مقهى الأندلس',
      phone: '01099887766',
      area: 'المعادي',
    });

    // فاتورة بـ 10 قطع × 100 ج.م = 1000 ج.م (100000 قرش)، مدفوع 400 ج.م (40000 قرش)
    const sale = await salesRepository.createOrPostSalesInvoice(salesUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'partial',
      paidPiastres: 40000,
      lines: [
        {
          itemId: itemRes.item.id,
          unitId: itemRes.baseUnit.id,
          quantity: 10,
        },
      ],
    });

    expect(sale.invoice.totalPiastres).toBe(100000);
    expect(sale.invoice.paidPiastres).toBe(40000);
    expect(sale.invoice.remainingPiastres).toBe(60000);

    let custList = await customerRepository.listCustomers();
    expect(custList[0].customer.currentBalancePiastres).toBe(60000);

    // منع التحصيل بأكثر من المديونية (650 ج.م > 600 ج.م) دون تأكيد
    await expect(
      collectionRepository.recordCollection(salesUser, {
        customerId: customer.id,
        amountPiastres: 65000,
      })
    ).rejects.toThrow();

    // تحصيل جزئي 250 ج.م (25000 قرش)
    await collectionRepository.recordCollection(salesUser, {
      customerId: customer.id,
      amountPiastres: 25000,
      invoiceId: sale.invoice.id,
    });

    const statement = await customerRepository.getCustomerStatement(customer.id);
    expect(statement.customer.currentBalancePiastres).toBe(35000);
    expect(statement.entries[statement.entries.length - 1].runningBalancePiastres).toBe(35000);

    // تحصيل أكبر من المديونية مع تأكيد الفائض كرصيد دائن (400 ج.م مقابل 350 ج.م -> رصيد -50 ج.م)
    await collectionRepository.recordCollection(salesUser, {
      customerId: customer.id,
      amountPiastres: 40000,
      allowCreditExcess: true,
    });
    custList = await customerRepository.listCustomers();
    expect(custList[0].customer.currentBalancePiastres).toBe(-5000);
  });
});

describe('3. الصلاحيات: منع تجاوز المخزون ومنع تغيير السعر', () => {
  it('يمنع المندوب من البيع بكمية أكبر من المتاح أو تغيير السعر، ويسمح للمدير بصلاحياته', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'اسبريسو فاخر',
      sku: 'ESP-1',
      costPricePiastres: 10000,
      pieceSalePricePiastres: 15000,
      cartonSalePricePiastres: 150000,
      cartonConversionFactor: 10,
      minStockQty: 2,
      openingStockQty: 5,
      openingWarehouseId: defaultWarehouseId,
    });

    // المندوب يحاول بيع 8 قطع والمتاح 5 فقط -> مرفوض
    await expect(
      salesRepository.createOrPostSalesInvoice(salesUser, {
        customerId: null,
        warehouseId: defaultWarehouseId,
        paymentType: 'cash',
        lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 8}],
      })
    ).rejects.toThrow();

    // المندوب يحاول تغيير السعر -> مرفوض
    await expect(
      salesRepository.createOrPostSalesInvoice(salesUser, {
        customerId: null,
        warehouseId: defaultWarehouseId,
        paymentType: 'cash',
        lines: [
          {
            itemId: itemRes.item.id,
            unitId: itemRes.baseUnit.id,
            quantity: 2,
            unitPricePiastres: 12000,
          },
        ],
      })
    ).rejects.toThrow();

    // المدير يملك stock.override و price.override -> ينجح
    const overrideSale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: null,
      warehouseId: defaultWarehouseId,
      paymentType: 'cash',
      lines: [
        {
          itemId: itemRes.item.id,
          unitId: itemRes.baseUnit.id,
          quantity: 8,
          unitPricePiastres: 14000,
        },
      ],
    });
    expect(overrideSale.invoice.totalPiastres).toBe(112000);
    const itemsAfter = await itemRepository.listItems();
    expect(itemsAfter[0].totalStockQty).toBe(-3);
  });
});

describe('4. المسودات، تعديل الفاتورة، والإلغاء بقيود عكسية', () => {
  it('يحفظ مسودة دون المساس بالمخزون، ثم يعتمدها، ثم يعدّلها ويلغيها بقيود عكسية كاملة', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن حبشي',
      sku: 'ETH-1',
      costPricePiastres: 6000,
      pieceSalePricePiastres: 9000,
      cartonSalePricePiastres: 90000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 40,
      openingWarehouseId: defaultWarehouseId,
    });

    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'سوبرماركت النور',
    });

    // 1) حفظ مسودة 10 قطع
    const draft = await salesRepository.saveDraftSalesInvoice(adminUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'credit',
      lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 10}],
    });
    expect(draft.invoice.status).toBe('draft');
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(40);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(0);

    // 2) اعتماد المسودة
    const posted = await salesRepository.createOrPostSalesInvoice(
      adminUser,
      {
        customerId: customer.id,
        warehouseId: defaultWarehouseId,
        paymentType: 'partial',
        paidPiastres: 30000,
        lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 10}],
      },
      {draftId: draft.invoice.id}
    );
    expect(posted.invoice.status).toBe('posted');
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(30);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(60000);

    // 3) تعديل الفاتورة إلى 5 قطع بدلاً من 10 ودفع 150 ج.م (15000 قرش)
    const amended = await salesRepository.amendSalesInvoice(adminUser, posted.invoice.id, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'partial',
      paidPiastres: 15000,
      lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 5}],
    });
    expect(amended.invoice.amendedFromId).toBe(posted.invoice.id);
    expect(amended.invoice.totalPiastres).toBe(45000);
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(35);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(30000);

    // 4) إلغاء الفاتورة المعدلة بقيد عكسي
    const cancelled = await salesRepository.cancelSalesInvoice(
      adminUser,
      amended.invoice.id,
      'إلغاء العميل'
    );
    expect(cancelled.status).toBe('reversed');
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(40);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(0);

    const movements = await stockMovementRepository.listMovements({itemId: itemRes.item.id});
    expect(movements.some((m) => m.movement.movementType === 'reversal')).toBe(true);
  });
});

describe('5. مرتجعات المبيعات الجزئية (صالحة vs تالفة) وتأثيرها على المخزون والربح', () => {
  it('يرجع بضاعة صالحة للمخزن وتالفة دون إرجاعها للمخزن، ويمنع تجاوز الكمية المباعة، ويحدث الربح', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن كولومبي',
      sku: 'COL-1',
      costPricePiastres: 5000, // 50 ج.م
      pieceSalePricePiastres: 8000, // 80 ج.م
      cartonSalePricePiastres: 80000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 20,
      openingWarehouseId: defaultWarehouseId,
    });

    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'كافيه رويال',
    });

    // بيع 5 قطع بـ 400 ج.م (تكلفة 250 ج.م، ربح 150 ج.م) على الحساب
    const sale = await salesRepository.createOrPostSalesInvoice(adminUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'credit',
      lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 5}],
    });
    expect(sale.invoice.profitPiastres).toBe(15000);
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(15);

    const lineId = sale.lines[0].line.id;

    // 1) مرتجع جزئي: 2 قطعة صالحة -> تعود للمخزن (15 + 2 = 17)، تخصم 160 ج.م من العميل (400 - 160 = 240)
    // الربح الجديد = (400 - 160) - (250 - 100) = 240 - 150 = 90 ج.م (9000 قرش)
    await salesReturnRepository.createSalesReturn(adminUser, {
      salesInvoiceId: sale.invoice.id,
      refundMode: 'customer_credit',
      reason: 'طلب زائد',
      lines: [{salesInvoiceLineId: lineId, quantity: 2, condition: 'good'}],
    });

    expect((await itemRepository.listItems())[0].totalStockQty).toBe(17);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(24000);
    let updatedInv = await salesRepository.getSalesInvoiceDetails(sale.invoice.id);
    expect(updatedInv.invoice.profitPiastres).toBe(9000);

    // 2) مرتجع 1 قطعة تالفة -> لا تعود للمخزن (يبقى 17)، تخصم 80 ج.م من العميل (240 - 80 = 160)
    // الربح الجديد = (400 - 240) - (250 - 100) = 160 - 150 = 10 ج.م (1000 قرش) لأنه خسر تكلفة القطعة التالفة
    await salesReturnRepository.createSalesReturn(adminUser, {
      salesInvoiceId: sale.invoice.id,
      refundMode: 'customer_credit',
      reason: 'تلف تغليف',
      lines: [{salesInvoiceLineId: lineId, quantity: 1, condition: 'damaged'}],
    });

    expect((await itemRepository.listItems())[0].totalStockQty).toBe(17);
    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(16000);
    updatedInv = await salesRepository.getSalesInvoiceDetails(sale.invoice.id);
    expect(updatedInv.invoice.profitPiastres).toBe(1000);

    // 3) محاولة إرجاع 3 قطع بينما المتبقي القابل للإرجاع = 5 - 3 = 2 فقط -> مرفوض
    await expect(
      salesReturnRepository.createSalesReturn(adminUser, {
        salesInvoiceId: sale.invoice.id,
        refundMode: 'customer_credit',
        lines: [{salesInvoiceLineId: lineId, quantity: 3, condition: 'good'}],
      })
    ).rejects.toThrow();
  });
});

describe('6. منع تكرار الحفظ عند الضغط مرتين (Idempotency)', () => {
  it('يرفض حفظ نفس الفاتورة أو نفس التحصيل مرتين بنفس clientRequestId', async () => {
    const itemRes = await itemRepository.createItem(adminUser, {
      name: 'بن برازيلي',
      sku: 'BRZ-1',
      costPricePiastres: 4000,
      pieceSalePricePiastres: 6000,
      cartonSalePricePiastres: 60000,
      cartonConversionFactor: 10,
      minStockQty: 5,
      openingStockQty: 20,
      openingWarehouseId: defaultWarehouseId,
    });

    const customer = await customerRepository.createCustomer(adminUser, {
      name: 'مقهى الشرق',
    });

    const invoiceReqId = 'req-invoice-001';
    await salesRepository.createOrPostSalesInvoice(salesUser, {
      customerId: customer.id,
      warehouseId: defaultWarehouseId,
      paymentType: 'credit',
      clientRequestId: invoiceReqId,
      lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 5}],
    });

    // الضغط مرة ثانية بنفس clientRequestId
    await expect(
      salesRepository.createOrPostSalesInvoice(salesUser, {
        customerId: customer.id,
        warehouseId: defaultWarehouseId,
        paymentType: 'credit',
        clientRequestId: invoiceReqId,
        lines: [{itemId: itemRes.item.id, unitId: itemRes.baseUnit.id, quantity: 5}],
      })
    ).rejects.toThrow();

    expect((await salesRepository.listSalesInvoices()).length).toBe(1);
    expect((await itemRepository.listItems())[0].totalStockQty).toBe(15);

    const colReqId = 'req-col-001';
    await collectionRepository.recordCollection(salesUser, {
      customerId: customer.id,
      amountPiastres: 10000,
      clientRequestId: colReqId,
    });

    await expect(
      collectionRepository.recordCollection(salesUser, {
        customerId: customer.id,
        amountPiastres: 10000,
        clientRequestId: colReqId,
      })
    ).rejects.toThrow();

    expect((await customerRepository.listCustomers())[0].customer.currentBalancePiastres).toBe(20000);
  });
});
