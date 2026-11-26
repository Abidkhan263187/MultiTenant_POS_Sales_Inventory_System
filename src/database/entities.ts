import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role, SaleStatus } from '../common/enums';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 160 })
  name!: string;

  @OneToMany(() => Store, (store) => store.merchant)
  stores!: Store[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  merchantId!: string;

  @ManyToOne(() => Merchant, (merchant) => merchant.stores)
  @JoinColumn({ name: 'merchant_id' })
  merchant!: Merchant;

  @Column({ length: 160 })
  name!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  merchantId!: string;

  @ManyToOne(() => Merchant)
  @JoinColumn({ name: 'merchant_id' })
  merchant!: Merchant;

  @Column({ type: 'uuid', nullable: true })
  storeId!: string | null;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store | null;

  @Column({ length: 255, unique: true })
  email!: string;

  @Column({ length: 255 })
  passwordHash!: string;

  @Column({ length: 160 })
  fullName!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @Column({ length: 64 })
  sku!: string;

  @Column({ length: 160 })
  name!: string;

  @Column({ type: 'int' })
  priceCents!: number;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @Column('uuid')
  productId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'int' })
  quantityOnHand!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => SaleItem, (item) => item.sale)
  items!: SaleItem[];

  @Column({ length: 128 })
  idempotencyKey!: string;

  @Column({ length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: SaleStatus;

  @Column({ type: 'int' })
  totalCents!: number;

  @Column({ length: 3, default: 'INR' })
  currency!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sale_items')
export class SaleItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  saleId!: string;

  @ManyToOne(() => Sale, (sale) => sale.items)
  @JoinColumn({ name: 'sale_id' })
  sale!: Sale;

  @Column('uuid')
  productId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ length: 64 })
  sku!: string;

  @Column({ length: 160 })
  productName!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int' })
  unitPriceCents!: number;

  @Column({ type: 'int' })
  lineTotalCents!: number;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  saleId!: string;

  @OneToOne(() => Sale)
  @JoinColumn({ name: 'sale_id' })
  sale!: Sale;

  @Column({ length: 32 })
  provider!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'SUCCESS' | 'FAILED';

  @Column({ type: 'int' })
  amountCents!: number;

  @Column({ length: 128 })
  providerReference!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

export const entities = [Merchant, Store, User, Product, Inventory, Sale, SaleItem, Payment];
