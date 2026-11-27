import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AdjustInventoryDto {
  @IsUUID('4', { message: 'Choose a product from this store.' })
  productId!: string;

  @IsInt({ message: 'Enter a whole number of units to add or remove.' })
  @Min(-100000, { message: 'You can remove at most 100000 units in one adjustment.' })
  @Max(100000, { message: 'You can add at most 100000 units in one adjustment.' })
  delta!: number;
}
