import { createHash } from 'crypto';

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export function mergeSaleItems(items: SaleLineInput[]): SaleLineInput[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

export function hashSaleRequest(items: SaleLineInput[], paymentOutcome: string): string {
  const payload = JSON.stringify({ items, paymentOutcome });
  return createHash('sha256').update(payload).digest('hex');
}
