const { getSeedConfig, seedSampleData } = require('../../scripts/seed');

describe('local sample seed', () => {
  test('is disabled unless explicitly enabled', async () => {
    expect(getSeedConfig({})).toBeNull();
    await expect(seedSampleData({ env: {}, clients: null, models: null })).resolves.toEqual({ skipped: true });
  });

  test('requires email and local passwords for each sample role', () => {
    expect(() => getSeedConfig({ SEED_SAMPLE_DATA: 'true' })).toThrow('SEED_ADMIN_EMAIL');
    expect(getSeedConfig({
      SEED_SAMPLE_DATA: 'true',
      SEED_ADMIN_EMAIL: 'admin@example.test', SEED_ADMIN_PASSWORD: 'admin-password',
      SEED_SUPERVISOR_EMAIL: 'supervisor@example.test', SEED_SUPERVISOR_PASSWORD: 'supervisor-password',
      SEED_PARENT_EMAIL: 'parent@example.test', SEED_PARENT_PASSWORD: 'parent-password',
    })).toMatchObject({ admin: { role: 'admin' }, supervisor: { role: 'supervisor' }, parent: { role: 'parent' } });
  });
});
