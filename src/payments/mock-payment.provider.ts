import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChargeRequest, ChargeResult, PaymentProvider } from './payment-provider';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (request.amountCents < 0) {
      return {
        provider: 'mock',
        status: 'FAILED',
        providerReference: `mock_fail_${request.idempotencyKey}`,
        failureReason: 'Invalid payment amount',
      };
    }

    if (request.outcome === 'FAILED') {
      return {
        provider: 'mock',
        status: 'FAILED',
        providerReference: `mock_fail_${request.idempotencyKey}`,
        failureReason: 'Mock provider declined the payment',
      };
    }

    return {
      provider: 'mock',
      status: 'SUCCESS',
      providerReference: `mock_${randomUUID()}`,
    };
  }
}
