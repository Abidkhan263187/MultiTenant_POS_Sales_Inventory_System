import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AdjustInventoryDto {
  @IsUUID('4')
  productId!: string;

  @IsInt()
  @Min(-100000)
  @Max(100000)
  delta!: number;
}
