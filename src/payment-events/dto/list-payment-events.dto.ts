import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListPaymentEventsQueryDto {
  @IsOptional()
  @IsIn(['SUCCESS', 'FAILED'], { message: 'paymentStatus must be SUCCESS or FAILED.' })
  paymentStatus?: 'SUCCESS' | 'FAILED';

  @IsOptional()
  @IsUUID('4', { message: 'Choose a staff member from this business.' })
  userId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Choose a product from this store.' })
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Ask for a whole number of records, from 1 to 100.' })
  @Min(1, { message: 'Ask for between 1 and 100 records.' })
  @Max(100, { message: 'Ask for between 1 and 100 records.' })
  limit?: number;
}
