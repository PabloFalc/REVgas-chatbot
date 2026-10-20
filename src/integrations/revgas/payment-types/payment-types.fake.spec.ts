import { describe, expect, it } from 'vitest';
import { PaymentTypesFake } from './payment-types.fake';

const deal = (id: number, payment_type: string, payment_type_establishment_id?: number) => ({
  id,
  product_id: id,
  suggested_value: 1,
  minimum_value: 1,
  payment_type,
  payment_type_establishment_id,
});

describe('PaymentTypesFake', () => {
  it('list deriva dos acordos quando há dealsSource', async () => {
    const fake = new PaymentTypesFake(async () => [
      deal(1, 'GAS_DO_POVO', 77),
      deal(2, 'GAS_DO_POVO', 77),
      deal(3, 'PIX'),
    ]);
    expect(await fake.list()).toEqual([{ id: 77, payment_type: 'GAS_DO_POVO', status: 'ACTIVE' }]);
    const plain = await new PaymentTypesFake().list();
    expect(plain.map(type => type.payment_type)).toEqual([
      'MONEY',
      'PIX',
      'CARTAO_DE_CREDITO',
      'CARTAO_DE_DEBITO',
    ]);
  });
});
