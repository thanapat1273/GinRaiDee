// Loads the dish catalogue and creates the local user. Safe to re-run.
import { pool } from "../src/db.ts";
import { attrVector, dishes } from "../src/catalog.ts";

for (const d of dishes) {
  await pool.query(
    `INSERT INTO dish (id, name_th, name_en, aliases, base, attrs, temp, meals, tags, kcal_min, kcal_max, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET name_th=$2, name_en=$3, aliases=$4, base=$5, attrs=$6, temp=$7,
       meals=$8, tags=$9, kcal_min=$10, kcal_max=$11, embedding=$12`,
    [d.id, d.th, d.en, d.aliases, d.base, d.attrs, d.temp, d.meals, d.tags, d.kcal[0], d.kcal[1], `[${attrVector(d).join(",")}]`],
  );
}
// parents second, once every row exists
for (const d of dishes.filter((d) => d.parent)) {
  await pool.query("UPDATE dish SET parent_id = $2 WHERE id = $1", [d.id, d.parent]);
}

const { rows } = await pool.query("SELECT id FROM app_user LIMIT 1");
if (rows.length === 0) await pool.query("INSERT INTO app_user (display_name) VALUES ('me')");

console.log(`seeded ${dishes.length} dishes`);
await pool.end();
