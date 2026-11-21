export type UUID = string;

export interface BaseRecord {
  id: UUID;
  createdAt: number;
  updatedAt: number;
  createdBy: UUID;
}

export type RoleCode = 'admin' | 'sales' | 'warehouse' | 'accountant';

export type PermissionKey =
  | 'invoice.create'
  | 'invoice.edit'
  | 'invoice.cancel'
  | 'price.override'
  | 'discount.apply'
  | 'stock.override'
  | 'collections.manage'
  | 'expenses.manage'
  | 'treasury.withdraw'
  | 'reports.profit'
  | 'users.manage'
  | 'settings.manage'
  | 'backup.manage';

export interface PermissionDefinition {
  key: PermissionKey;
  labelAr: string;
  descriptionAr: string;
  groupAr: string;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'invoice.create',
    labelAr: 'إنشاء فواتير',
    descriptionAr: 'إصدار فواتير مبيعات ومشتريات جديدة',
    groupAr: 'الفواتير والمبيعات',
  },
  {
    key: 'invoice.edit',
    labelAr: 'تعديل فواتير',
    descriptionAr: 'تعديل الفواتير عبر قيود عكسية موثقة',
    groupAr: 'الفواتير والمبيعات',
  },
  {
    key: 'invoice.cancel',
    labelAr: 'إلغاء فواتير',
    descriptionAr: 'إلغاء فواتير معتمدة بقيد عكسي كامل',
    groupAr: 'الفواتير والمبيعات',
  },
  {
    key: 'price.override',
    labelAr: 'تغيير الأسعار',
    descriptionAr: 'تعديل سعر الصنف يدوياً أثناء البيع',
    groupAr: 'الأسعار والخصومات',
  },
  {
    key: 'discount.apply',
    labelAr: 'تطبيق الخصومات',
    descriptionAr: 'منح خصومات على الفاتورة أو البنود',
    groupAr: 'الأسعار والخصومات',
  },
  {
    key: 'stock.override',
    labelAr: 'تجاوز رصيد المخزون',
    descriptionAr: 'السماح بالصرف أو التسوية عند نقص الرصيد',
    groupAr: 'المخزون',
  },
  {
    key: 'collections.manage',
    labelAr: 'التحصيلات',
    descriptionAr: 'تسجيل سندات التحصيل من العملاء',
    groupAr: 'المالية والخزنة',
  },
  {
    key: 'expenses.manage',
    labelAr: 'المصروفات',
    descriptionAr: 'تسجيل ومراجعة مصروفات التشغيل والتوزيع',
    groupAr: 'المالية والخزنة',
  },
  {
    key: 'treasury.withdraw',
    labelAr: 'السحب من الخزنة',
    descriptionAr: 'إجراء حركات سحب أو تحويل من الخزنة',
    groupAr: 'المالية والخزنة',
  },
  {
    key: 'reports.profit',
    labelAr: 'عرض الأرباح',
    descriptionAr: 'الاطلاع على هوامش الربح والتكلفة وصافي الدخل',
    groupAr: 'التقارير والإدارة',
  },
  {
    key: 'users.manage',
    labelAr: 'إدارة المستخدمين',
    descriptionAr: 'إضافة المستخدمين وتعديل الأدوار والصلاحيات',
    groupAr: 'التقارير والإدارة',
  },
  {
    key: 'settings.manage',
    labelAr: 'إعدادات الشركة',
    descriptionAr: 'تحديث بيانات الشركة واللوجو وسياسات الفاتورة',
    groupAr: 'التقارير والإدارة',
  },
  {
    key: 'backup.manage',
    labelAr: 'النسخ الاحتياطي',
    descriptionAr: 'تصدير واستعادة النسخ الاحتياطية لقاعدة البيانات',
    groupAr: 'التقارير والإدارة',
  },
];

export interface RoleRecord extends BaseRecord {
  code: RoleCode;
  nameAr: string;
  descriptionAr: string;
  permissions: PermissionKey[];
  isSystem: boolean;
}

export interface UserRecord extends BaseRecord {
  name: string;
  username: string;
  pinHash: string;
  pinSalt: string;
  roleId: UUID;
  isActive: boolean;
  lastLoginAt: number | null;
}

export interface ItemRecord extends BaseRecord {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  baseUnitId: UUID;
  costPricePiastres: number;
  wholesalePricePiastres: number;
  retailPricePiastres: number;
  minStockQty: number;
  imageDataUrl: string | null;
  isActive: boolean;
}

export interface UnitPackagingRecord extends BaseRecord {
  itemId: UUID;
  name: string;
  conversionFactor: number;
  barcode: string;
  salePricePiastres: number;
  isBase: boolean;
}

export interface WarehouseRecord extends BaseRecord {
  code: string;
  name: string;
  location: string;
  isDefault: boolean;
  isActive: boolean;
}

export type StockMovementType =
  | 'opening'
  | 'purchase_in'
  | 'sale_out'
  | 'return_in'
  | 'return_out'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment'
  | 'shortage'
  | 'surplus'
  | 'reversal';

export interface StockMovementRecord extends BaseRecord {
  itemId: UUID;
  warehouseId: UUID;
  movementType: StockMovementType;
  quantityDelta: number;
  unitCostPiastres: number;
  referenceType: string;
  referenceId: UUID;
  notes: string;
  reversesId: UUID | null;
}

export interface CustomerRecord extends BaseRecord {
  code: string;
  name: string;
  phone: string;
  address: string;
  area: string;
  notes: string;
  creditLimitPiastres: number;
  currentBalancePiastres: number;
  isActive: boolean;
}

export interface SupplierRecord extends BaseRecord {
  code: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  currentBalancePiastres: number;
  isActive: boolean;
}

export type FinancialStatus = 'posted' | 'reversed';
export type SalesInvoiceStatus = 'draft' | 'posted' | 'reversed';

export interface SalesInvoiceRecord extends BaseRecord {
  invoiceNumber: string;
  customerId: UUID | null;
  warehouseId: UUID;
  invoiceDate: string;
  subtotalPiastres: number;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  discountPiastres: number;
  totalPiastres: number;
  paidPiastres: number;
  remainingPiastres: number;
  totalCostPiastres: number;
  returnedPiastres: number;
  returnedCostPiastres: number;
  profitPiastres: number;
  paymentType: 'cash' | 'credit' | 'partial';
  paymentMethodId: UUID | null;
  status: SalesInvoiceStatus;
  reversedById: UUID | null;
  reversesId: UUID | null;
  amendedFromId: UUID | null;
  clientRequestId: string | null;
  notes: string;
}

export interface SalesInvoiceLineRecord extends BaseRecord {
  invoiceId: UUID;
  itemId: UUID;
  unitId: UUID;
  quantity: number;
  baseQuantity: number;
  unitConversionFactor: number;
  unitPricePiastres: number;
  costPricePiastres: number;
  discountPiastres: number;
  returnedBaseQuantity: number;
  lineTotalPiastres: number;
}

export interface PurchaseInvoiceRecord extends BaseRecord {
  invoiceNumber: string;
  supplierId: UUID;
  warehouseId: UUID;
  invoiceDate: string;
  subtotalPiastres: number;
  discountPiastres: number;
  totalPiastres: number;
  paidPiastres: number;
  remainingPiastres: number;
  status: FinancialStatus;
  reversedById: UUID | null;
  reversesId: UUID | null;
  amendedFromId: UUID | null;
  returnedPiastres: number;
  paymentMethodId: UUID | null;
  treasuryTransactionId: UUID | null;
  notes: string;
}

export interface PurchaseInvoiceLineRecord extends BaseRecord {
  invoiceId: UUID;
  itemId: UUID;
  unitId: UUID;
  quantity: number;
  baseQuantity: number;
  unitCostPiastres: number;
  unitCostBasePiastres: number;
  previousAvgCostPiastres: number;
  returnedBaseQuantity: number;
  lineTotalPiastres: number;
}

export interface ReturnRecord extends BaseRecord {
  returnNumber: string;
  returnType: 'sales_return' | 'purchase_return';
  referenceInvoiceId: UUID;
  partyId: UUID | null;
  warehouseId: UUID;
  returnDate: string;
  totalPiastres: number;
  returnedCostPiastres: number;
  refundMode: 'cash' | 'customer_credit' | 'supplier_credit' | 'cash_refund';
  reason: string;
  status: FinancialStatus;
  reversesId: UUID | null;
  notes: string;
}

export interface ReturnLineRecord extends BaseRecord {
  returnId: UUID;
  salesInvoiceLineId: UUID | null;
  purchaseInvoiceLineId: UUID | null;
  itemId: UUID;
  unitId: UUID;
  quantity: number;
  baseQuantity: number;
  unitPricePiastres: number;
  costPricePiastres: number;
  condition: 'good' | 'damaged';
  lineTotalPiastres: number;
}

export interface CollectionRecord extends BaseRecord {
  receiptNumber: string;
  customerId: UUID;
  invoiceId: UUID | null;
  paymentMethodId: UUID;
  amountPiastres: number;
  collectionDate: string;
  status: FinancialStatus;
  reversedById: UUID | null;
  reversesId: UUID | null;
  isInvoiceInitialCollection: boolean;
  creditExcessConfirmed: boolean;
  clientRequestId: string | null;
  notes: string;
}

export interface PaymentRecord extends BaseRecord {
  voucherNumber: string;
  supplierId: UUID;
  purchaseInvoiceId: UUID | null;
  paymentMethodId: UUID;
  amountPiastres: number;
  paymentDate: string;
  status: FinancialStatus;
  reversedById: UUID | null;
  reversesId: UUID | null;
  isInvoiceInitialPayment: boolean;
  treasuryTransactionId: UUID | null;
  notes: string;
}

export interface ExpenseCategoryRecord extends BaseRecord {
  code: string;
  name: string;
  isActive: boolean;
}

export interface ExpenseRecord extends BaseRecord {
  voucherNumber: string;
  categoryId: UUID;
  paymentMethodId: UUID;
  amountPiastres: number;
  expenseDate: string;
  description: string;
  status: FinancialStatus;
  reversedById: UUID | null;
  reversesId: UUID | null;
  amendedFromId: UUID | null;
  treasuryTransactionId: UUID | null;
  clientRequestId: string | null;
}

export interface PaymentMethodRecord extends BaseRecord {
  code: string;
  name: string;
  type: 'cash_box' | 'bank' | 'wallet';
  currentBalancePiastres: number;
  isDefault: boolean;
  isActive: boolean;
}

export type TreasurySourceType =
  | 'opening'
  | 'collection'
  | 'payment'
  | 'expense'
  | 'sales_cash'
  | 'purchase_cash'
  | 'sales_return_cash'
  | 'purchase_return'
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'reversal';

export interface TreasuryTransactionRecord extends BaseRecord {
  transactionNumber: string;
  paymentMethodId: UUID;
  direction: 'in' | 'out';
  amountPiastres: number;
  balanceAfterPiastres: number;
  sourceType: TreasurySourceType;
  sourceId: UUID;
  transactionDate: string;
  idempotencyKey: string;
  notes: string;
  reversesId: UUID | null;
}

export interface TreasuryClosingRecord extends BaseRecord {
  closingNumber: string;
  closingDate: string;
  paymentMethodId: UUID;
  openingBalancePiastres: number;
  totalInPiastres: number;
  totalOutPiastres: number;
  expectedBalancePiastres: number;
  actualCountedPiastres: number;
  variancePiastres: number;
  closedByName: string;
  notes: string;
}

export interface CompanySettingsRecord extends BaseRecord {
  companyName: string;
  phone: string;
  address: string;
  logoDataUrl: string | null;
  invoiceFooter: string;
  taxNumber: string;
  currencySymbol: string;
  allowNegativeStock: boolean;
  thermalPaperWidth: '58mm' | '80mm';
  autoPrintAfterSale: boolean;
  savedPrinterId: string | null;
  savedPrinterName: string | null;
  lastBackupAt: number | null;
}

export interface AuditDiffDetails {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'reverse'
  | 'login'
  | 'logout'
  | 'settings_update'
  | 'migration'
  | 'backup_export'
  | 'backup_import';

export interface AuditLogRecord extends BaseRecord {
  actorUserId: UUID;
  actorName: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  detailsJson: string;
}

export interface SchemaMigrationRecord extends BaseRecord {
  version: number;
  name: string;
  appliedAt: number;
}

export interface AuthenticatedSession {
  user: UserRecord;
  role: RoleRecord;
  permissions: Set<PermissionKey>;
}
