export interface ChargeRequest {
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  outcome: 'SUCCESS' | 'FAILED';
}

export interface ChargeResult {
  provider: string;
  status: 'SUCCESS' | 'FAILED';
  providerReference: string;
  failureReason?: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
