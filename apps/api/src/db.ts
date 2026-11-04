import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://ginraidee:ginraidee_local@127.0.0.1:5433/ginraidee";

export const pool = new pg.Pool({ connectionString: url, max: 5 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0];
}
