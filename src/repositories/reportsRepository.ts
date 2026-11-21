import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  CustomerRecord,
  ItemRecord,
  SupplierRecord,
  UUID,
} from '../types/domain';
import {withReadTx} from './baseRepository';

export interface ReportFilter {
  dateFrom?: string;
  dateTo?: string;
  itemId?: UUID;
  customerId?: UUID;
  supplierId?: UUID;
  search?: string;
  groupBy?: 'daily' | 'weekly' | 'monthly';
}

export interface SalesInvoiceProfitRow {
  invoiceId: UUID;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  paymentType: 'cash' | 'credit' | 'partial';
  grossSalesPiastres: number;
  returnedPiastres: number;
  netSalesPiastres: number;
  paidAtSalePiastres: number;
  remainingPiastres: number;
  cogsPiastres: number;
  grossProfitPiastres: number;
}

export interface PeriodSalesBucket {
  periodKey: string;
  invoicesCount: number;
  netSalesPiastres: number;
  paidAtSalePiastres: number;
  cogsPiastres: number;
  grossProfitPiastres: number;
}

export interface TopSellingItemRow {
  itemId: UUID;
  itemName: string;
  itemSku: string;
  netBaseQtySold: number;
  netRevenuePiastres: number;
  netCogsPiastres: number;
  grossProfitPiastres: number;
}

export interface PurchaseSummaryRow {
  invoiceId: UUID;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  netPurchasesPiastres: number;
  paidPiastres: number;
  remainingPiastres: number;
}

export interface LowStockItemRow {
  item: ItemRecord;
  currentStockQty: number;
}

export interface ReportStockMovementRow {
  id: UUID;
  createdAt: number;
  date: string;
  itemName: string;
  itemSku: string;
  warehouseName: string;
  movementType: string;
  quantityDelta: number;
  unitCostPiastres: number;
  notes: string;
}

export interface ReportTreasuryRow {
  id: UUID;
  transactionNumber: string;
  transactionDate: string;
  paymentMethodName: string;
  direction: 'in' | 'out';
  sourceType: string;
  amountPiastres: number;
  balanceAfterPiastres: number;
  notes: string;
}

export interface ReportsBundle {
  kpis: {
    grossSalesPiastres: number;
    salesReturnsPiastres: number;
    netSalesPiastres: number;
    totalCollectedPiastres: number;
    customerRemainingOnInvoicesPiastres: number;
    totalCogsPiastres: number;
    grossProfitPiastres: number;
    totalExpensesPiastres: number;
    netProfitPiastres: number;
    totalPurchasesPiastres: number;
    totalTreasuryBalancePiastres: number;
    totalCustomersDebtPiastres: number;
    totalSuppliersPayablePiastres: number;
  };
  salesByPeriod: PeriodSalesBucket[];
  invoiceProfits: SalesInvoiceProfitRow[];
  purchases: PurchaseSummaryRow[];
  topSellingItems: TopSellingItemRow[];
  lowStockItems: LowStockItemRow[];
  stockMovements: ReportStockMovementRow[];
  customersWithDebt: CustomerRecord[];
  suppliersWithPayable: SupplierRecord[];
  expensesByCategory: Array<{categoryName: string; totalPiastres: number; count: number}>;
  treasurySummary: {
    openingPiastres: number;
    totalInPiastres: number;
    totalOutPiastres: number;
    currentBalancePiastres: number;
  };
  treasuryTransactions: ReportTreasuryRow[];
}

function toWeekKey(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  const day = dt.getUTCDay();
  const diff = (day + 1) % 7; // Week starts Saturday in Egypt
  dt.setUTCDate(dt.getUTCDate() - diff);
  return `أسبوع ${dt.toISOString().slice(0, 10)}`;
}

function inDateRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export const reportsRepository = {
  async generateReports(filter?: ReportFilter): Promise<ReportsBundle> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.sales_invoices,
        db.sales_invoice_lines,
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.collections,
        db.expenses,
        db.expense_categories,
        db.items,
        db.customers,
        db.suppliers,
        db.warehouses,
        db.stock_movements,
        db.payment_methods,
        db.treasury_transactions,
      ],
      async () => {
        const [
          salesInvoices,
          salesLines,
          purchaseInvoices,
          purchaseLines,
          collections,
          expenses,
          expenseCategories,
          items,
          customers,
          suppliers,
          warehouses,
          movements,
          paymentMethods,
          treasuryTxs,
        ] = await Promise.all([
          db.sales_invoices.toArray(),
          db.sales_invoice_lines.toArray(),
          db.purchase_invoices.toArray(),
          db.purchase_invoice_lines.toArray(),
          db.collections.toArray(),
          db.expenses.toArray(),
          db.expense_categories.toArray(),
          db.items.toArray(),
          db.customers.toArray(),
          db.suppliers.toArray(),
          db.warehouses.toArray(),
          db.stock_movements.toArray(),
          db.payment_methods.toArray(),
          db.treasury_transactions.toArray(),
        ]);

        const custMap = new Map(customers.map((c) => [c.id, c]));
        const supMap = new Map(suppliers.map((s) => [s.id, s]));
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const whMap = new Map(warehouses.map((w) => [w.id, w]));
        const pmMap = new Map(paymentMethods.map((p) => [p.id, p]));
        const catMap = new Map(expenseCategories.map((c) => [c.id, c]));

        const searchLower = filter?.search?.trim().toLowerCase() ?? '';
        const groupBy = filter?.groupBy ?? 'daily';

        const salesLinesByInv = new Map<UUID, typeof salesLines>();
        for (const l of salesLines) {
          const arr = salesLinesByInv.get(l.invoiceId) ?? [];
          arr.push(l);
          salesLinesByInv.set(l.invoiceId, arr);
        }

        const purLinesByInv = new Map<UUID, typeof purchaseLines>();
        for (const l of purchaseLines) {
          const arr = purLinesByInv.get(l.invoiceId) ?? [];
          arr.push(l);
          purLinesByInv.set(l.invoiceId, arr);
        }

        // Filter posted sales invoices
        const filteredSales = salesInvoices
          .filter((inv) => {
            if (inv.status !== 'posted') return false;
            if (!inDateRange(inv.invoiceDate, filter?.dateFrom, filter?.dateTo)) return false;
            if (filter?.customerId && inv.customerId !== filter.customerId) return false;
            if (filter?.itemId) {
              const invLines = salesLinesByInv.get(inv.id) ?? [];
              if (!invLines.some((l) => l.itemId === filter.itemId)) return false;
            }
            if (searchLower) {
              const custName = inv.customerId
                ? (custMap.get(inv.customerId)?.name ?? '').toLowerCase()
                : 'عميل نقدي';
              if (
                !inv.invoiceNumber.toLowerCase().includes(searchLower) &&
                !custName.includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => b.createdAt - a.createdAt);

        let grossSalesPiastres = 0;
        let salesReturnsPiastres = 0;
        let totalCogsPiastres = 0;
        let customerRemainingOnInvoicesPiastres = 0;

        const periodMap = new Map<string, PeriodSalesBucket>();
        const invoiceProfits: SalesInvoiceProfitRow[] = [];
        const topItemMap = new Map<UUID, TopSellingItemRow>();

        for (const inv of filteredSales) {
          const netSales = inv.totalPiastres - inv.returnedPiastres;
          const netCogs = inv.totalCostPiastres - inv.returnedCostPiastres;
          const grossProfit = netSales - netCogs;

          grossSalesPiastres += inv.totalPiastres;
          salesReturnsPiastres += inv.returnedPiastres;
          totalCogsPiastres += netCogs;
          customerRemainingOnInvoicesPiastres += inv.remainingPiastres;

          const custName = inv.customerId
            ? custMap.get(inv.customerId)?.name ?? 'عميل غير معروف'
            : 'عميل نقدي مباشر';

          invoiceProfits.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            customerName: custName,
            paymentType: inv.paymentType,
            grossSalesPiastres: inv.totalPiastres,
            returnedPiastres: inv.returnedPiastres,
            netSalesPiastres: netSales,
            paidAtSalePiastres: inv.paidPiastres,
            remainingPiastres: inv.remainingPiastres,
            cogsPiastres: netCogs,
            grossProfitPiastres: grossProfit,
          });

          const pKey =
            groupBy === 'monthly'
              ? inv.invoiceDate.slice(0, 7)
              : groupBy === 'weekly'
              ? toWeekKey(inv.invoiceDate)
              : inv.invoiceDate;
          const bucket = periodMap.get(pKey) ?? {
            periodKey: pKey,
            invoicesCount: 0,
            netSalesPiastres: 0,
            paidAtSalePiastres: 0,
            cogsPiastres: 0,
            grossProfitPiastres: 0,
          };
          bucket.invoicesCount += 1;
          bucket.netSalesPiastres += netSales;
          bucket.paidAtSalePiastres += inv.paidPiastres;
          bucket.cogsPiastres += netCogs;
          bucket.grossProfitPiastres += grossProfit;
          periodMap.set(pKey, bucket);

          // Top selling items (adjusted by invoice discount ratio and returns)
          const invLines = salesLinesByInv.get(inv.id) ?? [];
          const discountRatio =
            inv.subtotalPiastres > 0 ? inv.totalPiastres / inv.subtotalPiastres : 1;
          for (const l of invLines) {
            if (filter?.itemId && l.itemId !== filter.itemId) continue;
            const netBaseQty = Math.max(0, l.baseQuantity - (l.returnedBaseQuantity ?? 0));
            const soldRatio = l.baseQuantity > 0 ? netBaseQty / l.baseQuantity : 0;
            const netLineRevenue = Math.round(
              l.lineTotalPiastres * soldRatio * discountRatio
            );
            const netLineCogs = netBaseQty * l.costPricePiastres;
            const item = itemMap.get(l.itemId);
            const existing = topItemMap.get(l.itemId) ?? {
              itemId: l.itemId,
              itemName: item?.name ?? 'صنف محذوف',
              itemSku: item?.sku ?? '-',
              netBaseQtySold: 0,
              netRevenuePiastres: 0,
              netCogsPiastres: 0,
              grossProfitPiastres: 0,
            };
            existing.netBaseQtySold += netBaseQty;
            existing.netRevenuePiastres += netLineRevenue;
            existing.netCogsPiastres += netLineCogs;
            existing.grossProfitPiastres += netLineRevenue - netLineCogs;
            topItemMap.set(l.itemId, existing);
          }
        }

        // Collections in period (actual cash collected: customer collections + walk-in cash sales)
        const filteredCollections = collections.filter((c) => {
          if (c.status !== 'posted') return false;
          if (!inDateRange(c.collectionDate, filter?.dateFrom, filter?.dateTo)) return false;
          if (filter?.customerId && c.customerId !== filter.customerId) return false;
          return true;
        });
        const walkInCashSalesPiastres = filteredSales
          .filter((inv) => !inv.customerId)
          .reduce((s, inv) => s + inv.paidPiastres, 0);
        const totalCollectedPiastres =
          filteredCollections.reduce((s, c) => s + c.amountPiastres, 0) +
          walkInCashSalesPiastres;

        // Purchases in period
        const filteredPurchases = purchaseInvoices
          .filter((p) => {
            if (p.status !== 'posted') return false;
            if (!inDateRange(p.invoiceDate, filter?.dateFrom, filter?.dateTo)) return false;
            if (filter?.supplierId && p.supplierId !== filter.supplierId) return false;
            if (filter?.itemId) {
              const pLines = purLinesByInv.get(p.id) ?? [];
              if (!pLines.some((l) => l.itemId === filter.itemId)) return false;
            }
            if (searchLower) {
              const supName = (supMap.get(p.supplierId)?.name ?? '').toLowerCase();
              if (
                !p.invoiceNumber.toLowerCase().includes(searchLower) &&
                !supName.includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => b.createdAt - a.createdAt);

        const purchases: PurchaseSummaryRow[] = filteredPurchases.map((p) => ({
          invoiceId: p.id,
          invoiceNumber: p.invoiceNumber,
          invoiceDate: p.invoiceDate,
          supplierName: supMap.get(p.supplierId)?.name ?? 'مورد غير معروف',
          netPurchasesPiastres: p.totalPiastres - (p.returnedPiastres ?? 0),
          paidPiastres: p.paidPiastres,
          remainingPiastres: p.remainingPiastres,
        }));
        const totalPurchasesPiastres = purchases.reduce(
          (s, p) => s + p.netPurchasesPiastres,
          0
        );

        // Expenses in period
        const filteredExpenses = expenses.filter(
          (e) =>
            e.status === 'posted' &&
            inDateRange(e.expenseDate, filter?.dateFrom, filter?.dateTo)
        );
        const totalExpensesPiastres = filteredExpenses.reduce(
          (s, e) => s + e.amountPiastres,
          0
        );
        const expCatAgg = new Map<
          string,
          {categoryName: string; totalPiastres: number; count: number}
        >();
        for (const e of filteredExpenses) {
          const catName = catMap.get(e.categoryId)?.name ?? 'أخرى';
          const curr = expCatAgg.get(e.categoryId) ?? {
            categoryName: catName,
            totalPiastres: 0,
            count: 0,
          };
          curr.totalPiastres += e.amountPiastres;
          curr.count += 1;
          expCatAgg.set(e.categoryId, curr);
        }

        // Stock levels & low stock items
        const stockByItem = new Map<UUID, number>();
        for (const m of movements) {
          stockByItem.set(m.itemId, (stockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
        }
        const lowStockItems: LowStockItemRow[] = items
          .filter((i) => i.isActive)
          .map((item) => ({
            item,
            currentStockQty: stockByItem.get(item.id) ?? 0,
          }))
          .filter((r) => r.currentStockQty <= r.item.minStockQty)
          .sort((a, b) => a.currentStockQty - b.currentStockQty);

        // Customers debt & Suppliers payable
        const customersWithDebt = customers
          .filter((c) => c.currentBalancePiastres !== 0)
          .sort((a, b) => b.currentBalancePiastres - a.currentBalancePiastres);
        const totalCustomersDebtPiastres = customers
          .filter((c) => c.currentBalancePiastres > 0)
          .reduce((s, c) => s + c.currentBalancePiastres, 0);

        const suppliersWithPayable = suppliers
          .filter((s) => s.currentBalancePiastres !== 0)
          .sort((a, b) => b.currentBalancePiastres - a.currentBalancePiastres);
        const totalSuppliersPayablePiastres = suppliers
          .filter((s) => s.currentBalancePiastres > 0)
          .reduce((s, sup) => s + sup.currentBalancePiastres, 0);

        // Treasury summary (in period + live balance)
        let openingPiastres = 0;
        let totalInPiastres = 0;
        let totalOutPiastres = 0;
        for (const tx of treasuryTxs) {
          if (!inDateRange(tx.transactionDate, filter?.dateFrom, filter?.dateTo)) continue;
          if (tx.sourceType === 'opening') {
            openingPiastres += tx.direction === 'in' ? tx.amountPiastres : -tx.amountPiastres;
          } else if (tx.direction === 'in') {
            totalInPiastres += tx.amountPiastres;
          } else {
            totalOutPiastres += tx.amountPiastres;
          }
        }
        const totalTreasuryBalancePiastres = paymentMethods
          .filter((pm) => pm.isActive)
          .reduce((s, pm) => s + pm.currentBalancePiastres, 0);

        const netSalesPiastres = grossSalesPiastres - salesReturnsPiastres;
        const grossProfitPiastres = netSalesPiastres - totalCogsPiastres;
        const netProfitPiastres = grossProfitPiastres - totalExpensesPiastres;

        // Filtered stock movements report
        const stockMovementsReport: ReportStockMovementRow[] = movements
          .map((m) => {
            const isoDate = new Date(m.createdAt).toISOString().slice(0, 10);
            const item = itemMap.get(m.itemId);
            return {
              id: m.id,
              createdAt: m.createdAt,
              date: isoDate,
              itemId: m.itemId,
              itemName: item?.name ?? 'صنف محذوف',
              itemSku: item?.sku ?? '-',
              warehouseName: whMap.get(m.warehouseId)?.name ?? 'المخزن',
              movementType: m.movementType,
              quantityDelta: m.quantityDelta,
              unitCostPiastres: m.unitCostPiastres,
              notes: m.notes,
            };
          })
          .filter((row) => {
            if (!inDateRange(row.date, filter?.dateFrom, filter?.dateTo)) return false;
            if (filter?.itemId && row.itemId !== filter.itemId) return false;
            if (searchLower) {
              if (
                !row.itemName.toLowerCase().includes(searchLower) &&
                !row.itemSku.toLowerCase().includes(searchLower) &&
                !row.notes.toLowerCase().includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 250)
          .map(({itemId: _omit, ...rest}) => rest);

        // Filtered treasury movements report
        const treasuryTransactionsReport: ReportTreasuryRow[] = treasuryTxs
          .filter((tx) => {
            if (!inDateRange(tx.transactionDate, filter?.dateFrom, filter?.dateTo)) return false;
            if (searchLower) {
              if (
                !tx.transactionNumber.toLowerCase().includes(searchLower) &&
                !tx.notes.toLowerCase().includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((tx) => ({
            id: tx.id,
            transactionNumber: tx.transactionNumber,
            transactionDate: tx.transactionDate,
            paymentMethodName: pmMap.get(tx.paymentMethodId)?.name ?? 'الخزنة',
            direction: tx.direction,
            sourceType: tx.sourceType,
            amountPiastres: tx.amountPiastres,
            balanceAfterPiastres: tx.balanceAfterPiastres,
            notes: tx.notes,
          }));

        return {
          kpis: {
            grossSalesPiastres,
            salesReturnsPiastres,
            netSalesPiastres,
            totalCollectedPiastres,
            customerRemainingOnInvoicesPiastres,
            totalCogsPiastres,
            grossProfitPiastres,
            totalExpensesPiastres,
            netProfitPiastres,
            totalPurchasesPiastres,
            totalTreasuryBalancePiastres,
            totalCustomersDebtPiastres,
            totalSuppliersPayablePiastres,
          },
          salesByPeriod: Array.from(periodMap.values()).sort((a, b) =>
            b.periodKey.localeCompare(a.periodKey)
          ),
          invoiceProfits,
          purchases,
          topSellingItems: Array.from(topItemMap.values()).sort(
            (a, b) => b.netRevenuePiastres - a.netRevenuePiastres
          ),
          lowStockItems,
          stockMovements: stockMovementsReport,
          customersWithDebt,
          suppliersWithPayable,
          expensesByCategory: Array.from(expCatAgg.values()).sort(
            (a, b) => b.totalPiastres - a.totalPiastres
          ),
          treasurySummary: {
            openingPiastres,
            totalInPiastres,
            totalOutPiastres,
            currentBalancePiastres: totalTreasuryBalancePiastres,
          },
          treasuryTransactions: treasuryTransactionsReport,
        };
      }
    );
  },
};
