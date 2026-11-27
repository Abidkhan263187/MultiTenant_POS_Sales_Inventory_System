import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Length(1, 160, { message: 'Product name must be between 1 and 160 characters.' })
  name!: string;

  @IsString()
  @Length(1, 64, { message: 'SKU must be between 1 and 64 characters.' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'SKU can use letters, numbers, hyphens, and underscores only.',
  })
  sku!: string;

  @IsInt({ message: 'Price must be a whole number of paise.' })
  @Min(0, { message: 'Price cannot be negative. Send the price in paise.' })
  @Max(1_000_000, { message: 'Price cannot be more than ₹10000.00.' })
  priceCents!: number;

  @IsInt({ message: 'Opening stock must be a whole number.' })
  @Min(0, { message: 'Opening stock cannot be negative.' })
  @Max(1_000_000, { message: 'Opening stock cannot be more than 1000000.' })
  initialQuantity!: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 160, { message: 'Product name must be between 1 and 160 characters.' })
  name?: string;

  @IsOptional()
  @IsInt({ message: 'Price must be a whole number of paise.' })
  @Min(0, { message: 'Price cannot be negative. Send the price in paise.' })
  @Max(1_000_000, { message: 'Price cannot be more than ₹10000.00.' })
  priceCents?: number;

  @IsOptional()
  @IsBoolean({ message: 'Say whether the product is for sale with true or false.' })
  isActive?: boolean;
}
