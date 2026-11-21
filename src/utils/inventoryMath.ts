export function convertToBaseQuantity(quantity: number, conversionFactor: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('الكمية يجب أن تكون أكبر من صفر.');
  }
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    throw new Error('معامل التحويل يجب أن يكون أكبر من صفر.');
  }
  const result = Math.round(quantity * conversionFactor);
  if (result <= 0) {
    throw new Error('الكمية بالوحدة الأساسية يجب أن تكون أكبر من صفر.');
  }
  return result;
}

export function computeWeightedAverageCost(params: {
  currentStockQty: number;
  currentAvgCostPiastres: number;
  incomingBaseQty: number;
  incomingUnitCostBasePiastres: number;
}): number {
  const {
    currentStockQty,
    currentAvgCostPiastres,
    incomingBaseQty,
    incomingUnitCostBasePiastres,
  } = params;

  if (incomingBaseQty <= 0) {
    return Math.round(currentAvgCostPiastres);
  }
  if (currentStockQty <= 0) {
    return Math.round(incomingUnitCostBasePiastres);
  }

  const totalQty = currentStockQty + incomingBaseQty;
  const totalValue =
    currentStockQty * currentAvgCostPiastres +
    incomingBaseQty * incomingUnitCostBasePiastres;

  return Math.round(totalValue / totalQty);
}

export function computeReversedWeightedAverageCost(params: {
  stockAfterPurchaseQty: number;
  avgCostAfterPurchasePiastres: number;
  reversedBaseQty: number;
  reversedUnitCostBasePiastres: number;
  previousAvgCostPiastres: number;
}): number {
  const {
    stockAfterPurchaseQty,
    avgCostAfterPurchasePiastres,
    reversedBaseQty,
    reversedUnitCostBasePiastres,
    previousAvgCostPiastres,
  } = params;

  const remainingQty = stockAfterPurchaseQty - reversedBaseQty;
  if (remainingQty <= 0) {
    return Math.round(previousAvgCostPiastres);
  }

  const totalValueAfter = stockAfterPurchaseQty * avgCostAfterPurchasePiastres;
  const reversedValue = reversedBaseQty * reversedUnitCostBasePiastres;
  const remainingValue = totalValueAfter - reversedValue;

  if (remainingValue < 0) {
    return Math.round(previousAvgCostPiastres);
  }

  return Math.round(remainingValue / remainingQty);
}
