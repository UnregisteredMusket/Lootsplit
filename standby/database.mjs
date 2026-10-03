/** D1's interface over libSQL. Atomic batches preserve changes() guards and awards. */
export function d1Database(client) {
  const statements = new WeakMap();
  function result(value) {
    return {
      success: true,
      results: value.rows.map((row) => Object.fromEntries(value.columns.map((key) => [key, row[key]]))),
      meta: { changes: value.rowsAffected, last_row_id: Number(value.lastInsertRowid ?? 0) },
    };
  }
  function prepare(sql, args = []) {
    const query = { sql, args };
    const statement = {
      bind: (...values) => prepare(sql, values),
      async all() { return result(await client.execute(query)); },
      async run() { return result(await client.execute(query)); },
      async first(column) {
        const row = (await statement.all()).results[0];
        return row ? (column === undefined ? row : row[column]) : null;
      },
      async raw(options = {}) {
        const value = await client.execute(query);
        const rows = value.rows.map((row) => value.columns.map((key) => row[key]));
        return options.columnNames ? [value.columns, ...rows] : rows;
      },
    };
    statements.set(statement, query);
    return statement;
  }
  return {
    prepare,
    async exec(sql) {
      const start = performance.now();
      await client.executeMultiple(sql);
      return { count: 0, duration: performance.now() - start };
    },
    async batch(batch) {
      const queries = batch.map((statement) => {
        if (!statements.has(statement)) throw new Error("Foreign database statement");
        return statements.get(statement);
      });
      return (await client.batch(queries, "write")).map(result);
    },
    close: () => client.close(),
  };
}
