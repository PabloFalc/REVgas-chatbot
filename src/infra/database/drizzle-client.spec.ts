import { describe, expect, it } from 'vitest';
import { closeDatabasePool, db } from './drizzle-client';

describe('closeDatabasePool', () => {
  it('encerra o pool do módulo e pode ser chamado de novo', async () => {
    expect(db.$client.ended).toBe(false);
    await closeDatabasePool();
    expect(db.$client.ended).toBe(true);
    await expect(closeDatabasePool()).resolves.toBeUndefined();
  });
});
