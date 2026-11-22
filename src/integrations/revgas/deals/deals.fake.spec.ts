import { describe, expect, it } from 'vitest';
import { DealsFake } from './deals.fake';

describe('DealsFake', () => {
  it('listAll filtra como list', async () => {
    const fake = new DealsFake();
    const all = await fake.listAll({ tag_id: 3519 });
    expect(all).toHaveLength(1);
    const page = await fake.list({ payment_type: 'PIX' });
    expect(page.data.every(item => item.payment_type === 'PIX')).toBe(true);
  });
});
