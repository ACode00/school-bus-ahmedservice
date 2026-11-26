const { getSeedConfig, seedSampleData } = require('../../scripts/seed');

describe('local sample seed', () => {
  test('is disabled unless explicitly enabled', async () => {
    expect(getSeedConfig({})).toBeNull();
    await expect(seedSampleData({ env: {}, clients: null, models: null })).resolves.toEqual({ skipped: true });
  });

  test('requires Identity Store user IDs for each demo role', () => {
    expect(() => getSeedConfig({ SEED_SAMPLE_DATA: 'true' })).toThrow('SEED_ADMIN_IDENTITY_STORE_USER_ID');
    expect(getSeedConfig({
      SEED_SAMPLE_DATA: 'true',
      SEED_ADMIN_IDENTITY_STORE_USER_ID: 'admin-id',
      SEED_SUPERVISOR_IDENTITY_STORE_USER_ID: 'supervisor-id',
      SEED_PARENT_IDENTITY_STORE_USER_ID: 'parent-id',
    })).toMatchObject({ admin: { role: 'admin' }, supervisor: { role: 'supervisor' }, parent: { role: 'parent' } });
  });
});
