// Forget everything about the local user (meals, feedback, learned model) but keep dishes and shops.
import { pool } from "../src/db.ts";

await pool.query("TRUNCATE suggestion, feedback, meal_log, taste, user_model");
await pool.query("UPDATE app_user SET onboarded_at = NULL, diet = '{}', persona_id = 'phuean'");
console.log("local user reset: onboarding will show again");
await pool.end();
