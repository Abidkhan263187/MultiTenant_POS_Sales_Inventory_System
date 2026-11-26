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
  @Length(1, 160)
  name!: string;

  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  sku!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceCents!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  initialQuantity!: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
