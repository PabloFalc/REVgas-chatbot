import { describe, expect, it } from 'vitest';
import { RevgasPaginationSchema } from './pagination';

describe('pagination schema', () => {
  it('pagination sem has_next passa', () => {
    expect(RevgasPaginationSchema.safeParse({ page: 1, count: 1, total_count: 1 }).success).toBe(
      true,
    );
  });
});
