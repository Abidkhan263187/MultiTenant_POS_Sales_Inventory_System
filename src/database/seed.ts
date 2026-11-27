import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '../common/enums';
import { Inventory, Merchant, Product, Store, User } from './entities';
import { DEMO_PASSWORD, DEMO_USERS, IDS } from './ids';

export async function seed(dataSource: DataSource): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await dataSource.transaction(async (manager) => {
    await manager.query(`
      TRUNCATE TABLE
        payments,
        sale_items,
        sales,
        inventory,
        products,
        users,
        stores,
        merchants
      RESTART IDENTITY CASCADE
    `);

    await manager.save(Merchant, [
      { id: IDS.merchantA, name: 'Abid' },
      { id: IDS.merchantB, name: 'Swazei' },
    ]);

    await manager.save(Store, [
      { id: IDS.store1, merchantId: IDS.merchantA, name: 'Abid Cafe, Connaught Place' },
      { id: IDS.store2, merchantId: IDS.merchantA, name: 'Abid Cafe, Select Citywalk' },
      { id: IDS.store3, merchantId: IDS.merchantB, name: 'Swazei Bakes, IGI Airport' },
    ]);

    await manager.save(User, [
      user(IDS.userAdminA, IDS.merchantA, null, DEMO_USERS.adminA, 'Abid', Role.MERCHANT_ADMIN, passwordHash),
      user(
        IDS.userManager1,
        IDS.merchantA,
        IDS.store1,
        DEMO_USERS.managerStore1,
        'Connaught Place Manager',
        Role.STORE_MANAGER,
        passwordHash,
      ),
      user(
        IDS.userCashier1,
        IDS.merchantA,
        IDS.store1,
        DEMO_USERS.cashierStore1,
        'Connaught Place Cashier',
        Role.CASHIER,
        passwordHash,
      ),
      user(
        IDS.userCashier2,
        IDS.merchantA,
        IDS.store2,
        DEMO_USERS.cashierStore2,
        'Select Citywalk Cashier',
        Role.CASHIER,
        passwordHash,
      ),
      user(IDS.userAdminB, IDS.merchantB, null, DEMO_USERS.adminB, 'Swazei', Role.MERCHANT_ADMIN, passwordHash),
      user(
        IDS.userCashier3,
        IDS.merchantB,
        IDS.store3,
        DEMO_USERS.cashierStore3,
        'IGI Airport Cashier',
        Role.CASHIER,
        passwordHash,
      ),
    ]);

    await manager.save(Product, [
      product(IDS.productCoffee, IDS.store1, 'AMERICANO', 'Americano', 3000),
      product(IDS.productTea, IDS.store1, 'MASALA-CHAI', 'Masala Chai', 2000),
      product(IDS.productSamosa, IDS.store1, 'VEG-SAMOSA', 'Veg Samosa', 2500),
      product(IDS.productCroissant, IDS.store1, 'BUTTER-CROISSANT', 'Butter Croissant', 8000),
      product(IDS.productMuffin, IDS.store2, 'CHOCO-MUFFIN', 'Chocolate Muffin', 4500),
      product(IDS.productColdCoffee, IDS.store2, 'COLD-COFFEE', 'Cold Coffee', 9000),
      product(IDS.productSandwich, IDS.store3, 'GRILLED-SANDWICH', 'Grilled Vegetable Sandwich', 12000),
      product(IDS.productFilterCoffee, IDS.store3, 'FILTER-COFFEE', 'Filter Coffee', 4000),
    ]);

    await manager.save(Inventory, [
      stock(IDS.store1, IDS.productCoffee, 50),
      stock(IDS.store1, IDS.productTea, 5),
      stock(IDS.store1, IDS.productSamosa, 40),
      stock(IDS.store1, IDS.productCroissant, 24),
      stock(IDS.store2, IDS.productMuffin, 30),
      stock(IDS.store2, IDS.productColdCoffee, 18),
      stock(IDS.store3, IDS.productSandwich, 15),
      stock(IDS.store3, IDS.productFilterCoffee, 20),
    ]);
  });

  console.log('Demo data reset.');
  console.log('Abid: Abid Cafe, Connaught Place and Abid Cafe, Select Citywalk');
  console.log('Swazei: Swazei Bakes, IGI Airport');
  console.log(`Password for every user: ${DEMO_PASSWORD}`);
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
