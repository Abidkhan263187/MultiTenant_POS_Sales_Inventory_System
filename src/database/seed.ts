import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '../common/enums';
import { Inventory, Merchant, Product, Store, User } from './entities';
import { DEMO_PASSWORD, DEMO_USERS, IDS } from './ids';

export async function seed(dataSource: DataSource): Promise<void> {
  const users = dataSource.getRepository(User);
  const alreadySeeded = await users.findOne({ where: { email: DEMO_USERS.adminA } });
  if (alreadySeeded) {
    console.log('Seed data already present. Skipping.');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await dataSource.transaction(async (manager) => {
    await manager.save(Merchant, [
      { id: IDS.merchantA, name: 'Merchant A' },
      { id: IDS.merchantB, name: 'Merchant B' },
    ]);

    await manager.save(Store, [
      { id: IDS.store1, merchantId: IDS.merchantA, name: 'Store 1 - Downtown' },
      { id: IDS.store2, merchantId: IDS.merchantA, name: 'Store 2 - Mall' },
      { id: IDS.store3, merchantId: IDS.merchantB, name: 'Store 3 - Airport' },
    ]);

    await manager.save(User, [
      user(IDS.userAdminA, IDS.merchantA, null, DEMO_USERS.adminA, 'Merchant A Admin', Role.MERCHANT_ADMIN, passwordHash),
      user(IDS.userManager1, IDS.merchantA, IDS.store1, DEMO_USERS.managerStore1, 'Store 1 Manager', Role.STORE_MANAGER, passwordHash),
      user(IDS.userCashier1, IDS.merchantA, IDS.store1, DEMO_USERS.cashierStore1, 'Store 1 Cashier', Role.CASHIER, passwordHash),
      user(IDS.userCashier2, IDS.merchantA, IDS.store2, DEMO_USERS.cashierStore2, 'Store 2 Cashier', Role.CASHIER, passwordHash),
      user(IDS.userAdminB, IDS.merchantB, null, DEMO_USERS.adminB, 'Merchant B Admin', Role.MERCHANT_ADMIN, passwordHash),
      user(IDS.userCashier3, IDS.merchantB, IDS.store3, DEMO_USERS.cashierStore3, 'Store 3 Cashier', Role.CASHIER, passwordHash),
    ]);

    await manager.save(Product, [
      product(IDS.productCoffee, IDS.store1, 'AMERICANO', 'Americano', 3000),
      product(IDS.productTea, IDS.store1, 'TEA', 'Masala Tea', 2000),
      product(IDS.productMuffin, IDS.store2, 'MUFFIN', 'Muffin', 4500),
      product(IDS.productSandwich, IDS.store3, 'SANDWICH', 'Sandwich', 8000),
    ]);

    await manager.save(Inventory, [
      stock(IDS.store1, IDS.productCoffee, 50),
      stock(IDS.store1, IDS.productTea, 5),
      stock(IDS.store2, IDS.productMuffin, 30),
      stock(IDS.store3, IDS.productSandwich, 15),
    ]);
  });

  console.log('Seed complete.');
  console.log(`Demo password for every user: ${DEMO_PASSWORD}`);
}

function user(
  id: string,
  merchantId: string,
  storeId: string | null,
  email: string,
  fullName: string,
  role: Role,
  passwordHash: string,
): Partial<User> {
  return { id, merchantId, storeId, email, fullName, role, passwordHash };
}

function product(id: string, storeId: string, sku: string, name: string, priceCents: number): Partial<Product> {
  return { id, storeId, sku, name, priceCents, isActive: true };
}

function stock(storeId: string, productId: string, quantityOnHand: number): Partial<Inventory> {
  return { storeId, productId, quantityOnHand };
}
