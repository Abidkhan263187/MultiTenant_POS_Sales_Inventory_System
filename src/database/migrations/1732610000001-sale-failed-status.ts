import { MigrationInterface, QueryRunner } from 'typeorm';

export class SaleFailedStatus1732610000001 implements MigrationInterface {
  name = 'SaleFailedStatus1732610000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check`);
    await queryRunner.query(
      `ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check`);
    await queryRunner.query(
      `ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('PENDING', 'COMPLETED'))`,
    );
  }
}
