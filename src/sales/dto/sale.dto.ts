import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SaleItemDto {
  @IsUUID('4', { message: 'Choose a product from this store.' })
  productId!: string;

  @IsInt({ message: 'Quantity must be a whole number.' })
  @Min(1, { message: 'Quantity must be at least 1.' })
  @Max(1000, { message: 'Quantity cannot be more than 1000 for one product.' })
  quantity!: number;
}

export class CreateSaleDto {
  @IsArray({ message: 'Add the products for this sale.' })
  @ArrayMinSize(1, { message: 'Add at least one product to the sale.' })
  @ArrayMaxSize(50, { message: 'A sale can include at most 50 products.' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsIn(['SUCCESS', 'FAILED'], { message: 'paymentOutcome must be SUCCESS or FAILED.' })
  paymentOutcome!: 'SUCCESS' | 'FAILED';
}

export class ListSalesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Ask for a whole number of sales, from 1 to 100.' })
  @Min(1, { message: 'Ask for between 1 and 100 sales.' })
  @Max(100, { message: 'Ask for between 1 and 100 sales.' })
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: 'The idempotency key cannot be longer than 128 characters.' })
  idempotencyKey?: string;
}
