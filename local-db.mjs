import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

export async function openDatabase(target) {
  const sqlite = new DatabaseSync(target);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  sqlite.exec(await readFile(new URL('./drizzle/0000_workspace.sql', import.meta.url), 'utf8'));
  if (!sqlite.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'username')) {
    sqlite.exec(await readFile(new URL('./drizzle/0001_usernames.sql', import.meta.url), 'utf8'));
  }
  if (!sqlite.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'intake')) {
    sqlite.exec(await readFile(new URL('./drizzle/0002_intake.sql', import.meta.url), 'utf8'));
  }
  sqlite.exec(await readFile(new URL('./auth.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare: sql => ({
      bind: (...args) => ({
        first: async () => sqlite.prepare(sql).get(...args) || null,
        all: async () => ({results: sqlite.prepare(sql).all(...args)}),
        run: () => sqlite.prepare(sql).run(...args),
      }),
    }),
    batch: async statements => {
      sqlite.exec('BEGIN');
      try {
        const items = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return items;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return {DB, close:() => sqlite.close()};
}
