import Dexie, {type Table} from 'dexie';
import type {
  AuditLogRecord,
  CollectionRecord,
  CompanySettingsRecord,
  CustomerRecord,
  ExpenseCategoryRecord,
  ExpenseRecord,
  ItemRecord,
  PaymentMethodRecord,
  PaymentRecord,
  PurchaseInvoiceLineRecord,
  PurchaseInvoiceRecord,
  ReturnLineRecord,
  ReturnRecord,
  RoleRecord,
  SalesInvoiceLineRecord,
  SalesInvoiceRecord,
  SchemaMigrationRecord,
  StockMovementRecord,
  SupplierRecord,
  TreasuryClosingRecord,
  TreasuryTransactionRecord,
  UnitPackagingRecord,
  UserRecord,
  WarehouseRecord,
} from '../types/domain';

export const CURRENT_DB_VERSION = 5;

export class NukhbatAlBonnDB extends Dexie {
  users!: Table<UserRecord, string>;
  roles!: Table<RoleRecord, string>;
  items!: Table<ItemRecord, string>;
  units!: Table<UnitPackagingRecord, string>;
  warehouses!: Table<WarehouseRecord, string>;
  stock_movements!: Table<StockMovementRecord, string>;
  customers!: Table<CustomerRecord, string>;
  suppliers!: Table<SupplierRecord, string>;
  sales_invoices!: Table<SalesInvoiceRecord, string>;
  sales_invoice_lines!: Table<SalesInvoiceLineRecord, string>;
  purchase_invoices!: Table<PurchaseInvoiceRecord, string>;
  purchase_invoice_lines!: Table<PurchaseInvoiceLineRecord, string>;
  returns!: Table<ReturnRecord, string>;
  return_lines!: Table<ReturnLineRecord, string>;
  collections!: Table<CollectionRecord, string>;
  payments!: Table<PaymentRecord, string>;
  expense_categories!: Table<ExpenseCategoryRecord, string>;
  expenses!: Table<ExpenseRecord, string>;
  payment_methods!: Table<PaymentMethodRecord, string>;
  treasury_transactions!: Table<TreasuryTransactionRecord, string>;
  treasury_closings!: Table<TreasuryClosingRecord, string>;
  company_settings!: Table<CompanySettingsRecord, string>;
  audit_log!: Table<AuditLogRecord, string>;
  schema_migrations!: Table<SchemaMigrationRecord, string>;

  constructor(dbName = 'nukhbat_albonn_dist_db') {
    super(dbName);

    const v1Stores = {
      users: 'id, &username, name, roleId, isActive, createdAt',
      roles: 'id, &code, nameAr',
      items: 'id, &sku, barcode, name, category, isActive, createdAt',
      units: 'id, itemId, barcode, isBase',
      warehouses: 'id, &code, name, isDefault, isActive',
      stock_movements: 'id, itemId, warehouseId, [itemId+warehouseId], movementType, referenceId, createdAt',
      customers: 'id, &code, name, phone, area, isActive, createdAt',
      suppliers: 'id, &code, name, phone, isActive, createdAt',
      sales_invoices: 'id, &invoiceNumber, customerId, warehouseId, invoiceDate, status, createdAt',
      sales_invoice_lines: 'id, invoiceId, itemId, unitId',
      purchase_invoices: 'id, &invoiceNumber, supplierId, warehouseId, invoiceDate, status, createdAt',
      purchase_invoice_lines: 'id, invoiceId, itemId, unitId',
      returns: 'id, &returnNumber, returnType, referenceInvoiceId, partyId, status, createdAt',
      collections: 'id, &receiptNumber, customerId, invoiceId, paymentMethodId, collectionDate, status, createdAt',
      payments: 'id, &voucherNumber, supplierId, purchaseInvoiceId, paymentMethodId, paymentDate, status, createdAt',
      expense_categories: 'id, &code, name, isActive',
      expenses: 'id, &voucherNumber, categoryId, paymentMethodId, expenseDate, status, createdAt',
      payment_methods: 'id, &code, name, type, isDefault, isActive',
      treasury_transactions: 'id, &transactionNumber, paymentMethodId, direction, sourceType, sourceId, createdAt',
      company_settings: 'id, companyName',
      audit_log: 'id, actorUserId, action, entityType, entityId, createdAt',
      schema_migrations: 'id, &version, appliedAt',
    };

    const v2Stores = {
      ...v1Stores,
      units: 'id, itemId, [itemId+isBase], barcode, isBase',
      stock_movements:
        'id, itemId, warehouseId, [itemId+warehouseId], movementType, referenceType, referenceId, createdAt',
    };

    const v3Stores = {
      ...v2Stores,
      sales_invoices:
        'id, &invoiceNumber, customerId, warehouseId, invoiceDate, status, clientRequestId, createdAt',
      collections:
        'id, &receiptNumber, customerId, invoiceId, paymentMethodId, collectionDate, status, clientRequestId, createdAt',
      return_lines: 'id, returnId, salesInvoiceLineId, itemId, condition',
    };

    const v4Stores = {
      ...v3Stores,
      return_lines: 'id, returnId, salesInvoiceLineId, purchaseInvoiceLineId, itemId, condition',
      expenses: 'id, &voucherNumber, categoryId, paymentMethodId, expenseDate, status, clientRequestId, createdAt',
      treasury_transactions:
        'id, &transactionNumber, &idempotencyKey, paymentMethodId, direction, sourceType, sourceId, transactionDate, createdAt',
      treasury_closings: 'id, &closingNumber, paymentMethodId, closingDate, createdAt',
    };

    this.version(1).stores(v1Stores);
    this.version(2).stores(v2Stores);
    this.version(3).stores(v3Stores);
    this.version(4).stores(v4Stores);
    this.version(5).stores({
      ...v4Stores,
      audit_log: 'id, actorUserId, action, entityType, entityId, createdAt',
    });
  }
}

export const db = new NukhbatAlBonnDB();
