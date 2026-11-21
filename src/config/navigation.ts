import type {PermissionKey} from '../types/domain';

export const CURRENT_APP_STAGE = 5;

export interface NavSection {
  path: string;
  titleAr: string;
  shortTitleAr: string;
  group: 'primary' | 'operations' | 'inventory_parties' | 'system';
  iconName:
    | 'home'
    | 'shopping_cart'
    | 'receipt'
    | 'coffee'
    | 'warehouse'
    | 'truck'
    | 'users'
    | 'building'
    | 'banknote'
    | 'wallet_cards'
    | 'vault'
    | 'bar_chart'
    | 'shield_check'
    | 'settings'
    | 'database_backup'
    | 'undo';
  bottomTab?: boolean;
  implementedInStage: number;
  requiredPermission?: PermissionKey;
  relatedTables: string[];
  descriptionAr: string;
}

export const APP_SECTIONS: NavSection[] = [
  {
    path: '/',
    titleAr: 'الرئيسية',
    shortTitleAr: 'الرئيسية',
    group: 'primary',
    iconName: 'home',
    bottomTab: true,
    implementedInStage: 1,
    relatedTables: ['company_settings', 'payment_methods', 'warehouses', 'audit_log'],
    descriptionAr: 'ملخص الأرصدة والجاهزية التشغيلية والوصول السريع للأقسام.',
  },
  {
    path: '/sales',
    titleAr: 'المبيعات',
    shortTitleAr: 'المبيعات',
    group: 'operations',
    iconName: 'shopping_cart',
    bottomTab: true,
    implementedInStage: 3,
    requiredPermission: 'invoice.create',
    relatedTables: ['sales_invoices', 'sales_invoice_lines', 'stock_movements', 'customers'],
    descriptionAr: 'نقطة بيع سريعة للمندوبين وإصدار فواتير الجملة والتجزئة والطباعة.',
  },
  {
    path: '/invoices',
    titleAr: 'الفواتير',
    shortTitleAr: 'الفواتير',
    group: 'operations',
    iconName: 'receipt',
    bottomTab: true,
    implementedInStage: 3,
    relatedTables: ['sales_invoices', 'sales_invoice_lines', 'returns', 'audit_log'],
    descriptionAr: 'استعراض فواتير المبيعات والمرتجعات والقيود العكسية للإلغاء والتعديل.',
  },
  {
    path: '/items',
    titleAr: 'الأصناف',
    shortTitleAr: 'الأصناف',
    group: 'inventory_parties',
    iconName: 'coffee',
    bottomTab: true,
    implementedInStage: 2,
    relatedTables: ['items', 'units', 'stock_movements'],
    descriptionAr: 'دليل أصناف البن والمنتجات الغذائية ووحدات التعبئة والتسعير.',
  },
  {
    path: '/collections',
    titleAr: 'التحصيلات',
    shortTitleAr: 'التحصيلات',
    group: 'operations',
    iconName: 'banknote',
    bottomTab: true,
    implementedInStage: 3,
    requiredPermission: 'collections.manage',
    relatedTables: ['collections', 'customers', 'sales_invoices', 'payment_methods'],
    descriptionAr: 'سندات تحصيل مديونيات العملاء الجزئية والكلية وتحديث أرصدتهم.',
  },
  {
    path: '/returns',
    titleAr: 'مرتجعات المبيعات',
    shortTitleAr: 'المرتجعات',
    group: 'operations',
    iconName: 'undo',
    implementedInStage: 3,
    relatedTables: ['returns', 'return_lines', 'sales_invoices', 'stock_movements'],
    descriptionAr: 'مرتجعات المبيعات الصالحة والتالفة وتعديل الأرباح وأرصدة العملاء.',
  },
  {
    path: '/warehouses',
    titleAr: 'المخازن',
    shortTitleAr: 'المخازن',
    group: 'inventory_parties',
    iconName: 'warehouse',
    implementedInStage: 2,
    relatedTables: ['warehouses', 'stock_movements', 'items'],
    descriptionAr: 'إدارة المخازن والتحويلات بين المخازن والجرد والتسويات المخزنية.',
  },
  {
    path: '/purchases',
    titleAr: 'المشتريات',
    shortTitleAr: 'المشتريات',
    group: 'operations',
    iconName: 'truck',
    implementedInStage: 2,
    relatedTables: ['purchase_invoices', 'purchase_invoice_lines', 'suppliers', 'stock_movements'],
    descriptionAr: 'فواتير الشراء من الموردين وتحديث متوسط التكلفة وأرصدة المخازن.',
  },
  {
    path: '/customers',
    titleAr: 'العملاء',
    shortTitleAr: 'العملاء',
    group: 'inventory_parties',
    iconName: 'users',
    implementedInStage: 3,
    relatedTables: ['customers', 'sales_invoices', 'collections'],
    descriptionAr: 'حسابات العملاء والمقاهي والسوبرماركت وحدود الائتمان وكشف الحساب.',
  },
  {
    path: '/suppliers',
    titleAr: 'الموردون',
    shortTitleAr: 'الموردون',
    group: 'inventory_parties',
    iconName: 'building',
    implementedInStage: 2,
    relatedTables: ['suppliers', 'purchase_invoices', 'payments'],
    descriptionAr: 'دليل موردي البن الأخضر والغذائيات وسندات الصرف وكشف حساب المورد.',
  },
  {
    path: '/expenses',
    titleAr: 'المصروفات',
    shortTitleAr: 'المصروفات',
    group: 'operations',
    iconName: 'wallet_cards',
    implementedInStage: 4,
    requiredPermission: 'expenses.manage',
    relatedTables: ['expenses', 'expense_categories', 'treasury_transactions'],
    descriptionAr: 'تسجيل مصروفات النقل والتشغيل والتغليف وتبويبها حسب التصنيف.',
  },
  {
    path: '/treasury',
    titleAr: 'الخزنة',
    shortTitleAr: 'الخزنة',
    group: 'operations',
    iconName: 'vault',
    implementedInStage: 4,
    relatedTables: ['payment_methods', 'treasury_transactions', 'payments', 'collections'],
    descriptionAr: 'حركة الخزنة الرئيسية والحسابات البنكية والإيداع والسحب الموثق.',
  },
  {
    path: '/reports',
    titleAr: 'التقارير والأرباح',
    shortTitleAr: 'التقارير',
    group: 'system',
    iconName: 'bar_chart',
    implementedInStage: 4,
    requiredPermission: 'reports.profit',
    relatedTables: ['sales_invoices', 'purchase_invoices', 'expenses', 'stock_movements'],
    descriptionAr: 'تقارير المبيعات والأرباح وتكلفة البضاعة وحركة الأصناف والأرصدة وتصدير Excel وPDF.',
  },
  {
    path: '/users',
    titleAr: 'المستخدمون والصلاحيات',
    shortTitleAr: 'المستخدمون',
    group: 'system',
    iconName: 'shield_check',
    implementedInStage: 1,
    requiredPermission: 'users.manage',
    relatedTables: ['users', 'roles', 'audit_log'],
    descriptionAr: 'إدارة حسابات فريق العمل ورموز PIN ومصفوفة الصلاحيات.',
  },
  {
    path: '/settings',
    titleAr: 'الإعدادات',
    shortTitleAr: 'الإعدادات',
    group: 'system',
    iconName: 'settings',
    implementedInStage: 1,
    relatedTables: ['company_settings', 'audit_log'],
    descriptionAr: 'بيانات الشركة واللوجو وتذييل الفاتورة وسياسات المخزون.',
  },
  {
    path: '/backup',
    titleAr: 'النسخ الاحتياطي',
    shortTitleAr: 'النسخ',
    group: 'system',
    iconName: 'database_backup',
    implementedInStage: 1,
    relatedTables: ['schema_migrations', 'audit_log'],
    descriptionAr: 'تصدير واستعادة النسخ الاحتياطية ومراقبة مخطط قاعدة البيانات.',
  },
];

export const BOTTOM_NAV_SECTIONS = APP_SECTIONS.filter((s) => s.bottomTab);
