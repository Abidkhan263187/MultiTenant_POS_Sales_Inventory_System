import { hashSaleRequest, mergeSaleItems } from './sale-request.util';

describe('sale request helpers', () => {
  it('merges duplicate products and sorts them', () => {
    const merged = mergeSaleItems([
      { productId: 'b', quantity: 1 },
      { productId: 'a', quantity: 2 },
      { productId: 'b', quantity: 3 },
    ]);
    expect(merged).toEqual([
      { productId: 'a', quantity: 2 },
      { productId: 'b', quantity: 4 },
    ]);
  });

  it('hashes equivalent requests the same way', () => {
    const left = hashSaleRequest(
      [
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 1 },
      ],
      'SUCCESS',
    );
    const right = hashSaleRequest(
      [
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 1 },
      ],
      'SUCCESS',
    );
    const different = hashSaleRequest([{ productId: 'a', quantity: 9 }], 'SUCCESS');
    expect(left).toBe(right);
    expect(left).not.toBe(different);
  });
});
