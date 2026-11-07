import { describePostgres } from '../../helpers/pg.js';
import { PostgresStore } from '../../../src/store/postgres/store.js';
import { runLedgerStoreContract } from '../contract.js';

// Runs the same checks as the memory store. Skipped, with the reason in its name, unless TEST_DATABASE_URL is set.
describePostgres('PostgresStore contract', (db) => {
  runLedgerStoreContract('LedgerStore checks', {
    make: async () => {
      await db().truncate();
      return new PostgresStore(db().sql);
    }
  });
});
