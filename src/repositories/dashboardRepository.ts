import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  AuditLogRecord,
  PaymentMethodRecord,
  SchemaMigrationRecord,
  UUID,
  WarehouseRecord,
} from '../types/domain';
import {todayISODate} from '../utils/date';
import {withReadTx} from './baseRepository';

export interface LowStockDashboardItem {
  id: UUID;
  name: string;
  sku: string;
  qty: number;
  minStockQty: number;
}

export interface DailyChartPoint {
  date: string;
  label: string;
  salesPiastres: number;
  collectedPiastres: number;
  expensesPiastres: number;
}

export interface DashboardSummary {
  todayDate: string;
  todaySalesPiastres: number;
  todayPurchasesPiastres: number;
  todayCollectedPiastres: number;
  todayExpensesPiastres: number;
  totalCollectedPiastres: number;
  totalCustomerRemainingPiastres: number;
  totalCustomersDebtPiastres: number;
  totalSuppliersPayablePiastres: number;
  totalTreasuryPiastres: number;
  grossProfitPiastres: number;
  netProfitPiastres: number;
  totalExpensesPiastres: number;
  activeWarehousesCount: number;
  activeUsersCount: number;
  itemsCount: number;
  customersCount: number;
  suppliersCount: number;
  salesInvoicesCount: number;
  purchaseInvoicesCount: number;
  auditLogsCount: number;
  latestMigrationVersion: number;
  lowStockItems: LowStockDashboardItem[];
  last7DaysSeries: DailyChartPoint[];
  paymentMethods: PaymentMethodRecord[];
  warehouses: WarehouseRecord[];
  recentAuditLogs: AuditLogRecord[];
  migrations: SchemaMigrationRecord[];
}

function getLastNDatesISO(endIso: string, days: number): string[] {
  const base = new Date(`${endIso}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() - i);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

function shortArabicDayLabel(isoDate: string): string {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate.slice(5);
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'short',
    day: 'numeric',
  }).format(dt);
}

export const dashboardRepository = {
  async getSummary(): Promise<DashboardSummary> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.payment_methods,
        db.warehouses,
        db.users,
        db.items,
        db.customers,
        db.suppliers,
        db.sales_invoices,
        db.purchase_invoices,
        db.collections,
        db.expenses,
        db.stock_movements,
        db.audit_log,
        db.schema_migrations,
      ],
      async () => {
        const [
          paymentMethods,
          warehouses,
          users,
          items,
          customers,
          suppliers,
          salesInvoices,
          purchaseInvoices,
          collections,
          expenses,
          movements,
          auditLogsCount,
          recentAuditLogs,
          migrations,
        ] = await Promise.all([
          db.payment_methods.toArray(),
          db.warehouses.toArray(),
          db.users.toArray(),
          db.items.toArray(),
          db.customers.toArray(),
          db.suppliers.toArray(),
          db.sales_invoices.toArray(),
          db.purchase_invoices.toArray(),
          db.collections.toArray(),
          db.expenses.toArray(),
          db.stock_movements.toArray(),
          db.audit_log.count(),
          db.audit_log.orderBy('createdAt').reverse().limit(8).toArray(),
          db.schema_migrations.orderBy('version').toArray(),
        ]);

        const today = todayISODate();
        const postedSales = salesInvoices.filter((s) => s.status === 'posted');
        const postedPurchases = purchaseInvoices.filter((p) => p.status === 'posted');
        const postedCollections = collections.filter((c) => c.status === 'posted');
        const postedExpenses = expenses.filter((e) => e.status === 'posted');

        let todaySalesPiastres = 0;
        let grossProfitPiastres = 0;
        let totalCustomerRemainingPiastres = 0;
        let todayWalkInCashSales = 0;
        let totalWalkInCashSales = 0;

        for (const inv of postedSales) {
          const netInv = inv.totalPiastres - inv.returnedPiastres;
          const netCogs = inv.totalCostPiastres - inv.returnedCostPiastres;
          grossProfitPiastres += netInv - netCogs;
          totalCustomerRemainingPiastres += inv.remainingPiastres;

          if (inv.invoiceDate === today) {
            todaySalesPiastres += netInv;
            if (!inv.customerId) {
              todayWalkInCashSales += inv.paidPiastres;
            }
          }
          if (!inv.customerId) {
            totalWalkInCashSales += inv.paidPiastres;
          }
        }

        const todayPurchasesPiastres = postedPurchases
          .filter((p) => p.invoiceDate === today)
          .reduce((s, p) => s + (p.totalPiastres - (p.returnedPiastres ?? 0)), 0);

        const todayCollectionsOnly = postedCollections
          .filter((c) => c.collectionDate === today)
          .reduce((s, c) => s + c.amountPiastres, 0);
        const todayCollectedPiastres = todayCollectionsOnly + todayWalkInCashSales;

        const totalCollectedPiastres =
          postedCollections.reduce((s, c) => s + c.amountPiastres, 0) +
          totalWalkInCashSales;

        const totalExpensesPiastres = postedExpenses.reduce(
          (s, e) => s + e.amountPiastres,
          0
        );
        const todayExpensesPiastres = postedExpenses
          .filter((e) => e.expenseDate === today)
          .reduce((s, e) => s + e.amountPiastres, 0);

        const netProfitPiastres = grossProfitPiastres - totalExpensesPiastres;

        const totalCustomersDebtPiastres = customers
          .filter((c) => c.currentBalancePiastres > 0)
          .reduce((s, c) => s + c.currentBalancePiastres, 0);

        const totalSuppliersPayablePiastres = suppliers
          .filter((s) => s.currentBalancePiastres > 0)
          .reduce((sum, s) => sum + s.currentBalancePiastres, 0);

        const totalTreasuryPiastres = paymentMethods
          .filter((pm) => pm.isActive)
          .reduce((sum, pm) => sum + pm.currentBalancePiastres, 0);

        // Low stock items
        const stockByItem = new Map<UUID, number>();
        for (const m of movements) {
          stockByItem.set(m.itemId, (stockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
        }
        const lowStockItems: LowStockDashboardItem[] = items
          .filter((i) => i.isActive)
          .map((i) => ({
            id: i.id,
            name: i.name,
            sku: i.sku,
            qty: stockByItem.get(i.id) ?? 0,
            minStockQty: i.minStockQty,
          }))
          .filter((row) => row.qty <= row.minStockQty)
          .sort((a, b) => a.qty - b.qty);

        // Last 7 days chart series
        const last7Dates = getLastNDatesISO(today, 7);
        const last7DaysSeries: DailyChartPoint[] = last7Dates.map((d) => {
          const daySales = postedSales
            .filter((s) => s.invoiceDate === d)
            .reduce((sum, s) => sum + (s.totalPiastres - s.returnedPiastres), 0);
          const dayWalkIn = postedSales
            .filter((s) => s.invoiceDate === d && !s.customerId)
            .reduce((sum, s) => sum + s.paidPiastres, 0);
          const dayCols = postedCollections
            .filter((c) => c.collectionDate === d)
            .reduce((sum, c) => sum + c.amountPiastres, 0);
          const dayExp = postedExpenses
            .filter((e) => e.expenseDate === d)
            .reduce((sum, e) => sum + e.amountPiastres, 0);
          return {
            date: d,
            label: shortArabicDayLabel(d),
            salesPiastres: daySales,
            collectedPiastres: dayCols + dayWalkIn,
            expensesPiastres: dayExp,
          };
        });

        const activeWarehousesCount = warehouses.filter((w) => w.isActive).length;
        const activeUsersCount = users.filter((u) => u.isActive).length;
        const latestMigrationVersion =
          migrations.length > 0 ? migrations[migrations.length - 1].version : 1;

        return {
          todayDate: today,
          todaySalesPiastres,
          todayPurchasesPiastres,
          todayCollectedPiastres,
          todayExpensesPiastres,
          totalCollectedPiastres,
          totalCustomerRemainingPiastres,
          totalCustomersDebtPiastres,
          totalSuppliersPayablePiastres,
          totalTreasuryPiastres,
          grossProfitPiastres,
          netProfitPiastres,
          totalExpensesPiastres,
          activeWarehousesCount,
          activeUsersCount,
          itemsCount: items.length,
          customersCount: customers.length,
          suppliersCount: suppliers.length,
          salesInvoicesCount: postedSales.length,
          purchaseInvoicesCount: postedPurchases.length,
          auditLogsCount,
          latestMigrationVersion,
          lowStockItems,
          last7DaysSeries,
          paymentMethods,
          warehouses,
          recentAuditLogs,
          migrations,
        };
      }
    );
  },
};
