import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
// A small D1-compatible adapter, used only by tests and the disposable local preview.
export function localDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_us.sql', import.meta.url), 'utf8'));
  return {
    close: () => sqlite.close(),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const query = args => ({
        bind: (...values) => query(values),
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
      });
      return query([]);
    },
  };
}
