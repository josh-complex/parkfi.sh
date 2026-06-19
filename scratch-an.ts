import { sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
const slug = "hollywood-studios";
const m = await db.execute<{ id: string; timezone: string }>(
  sql`SELECT id, timezone FROM parks WHERE slug=${slug}`,
);
const pid = Number(m.rows[0].id);
const tz = m.rows[0].timezone;
const land = await db.execute(sql`
  SELECT m.land, avg(q.wait_min)::int avg_wait, max(q.wait_min) peak, count(DISTINCT a.id) rides
  FROM queue_obs q JOIN attractions a ON a.id=q.attraction_id JOIN attraction_meta m ON m.attraction_id=a.id
  WHERE a.park_id=${pid} AND q.queue_type=1 AND q.wait_min IS NOT NULL AND m.land IS NOT NULL
    AND q.observed_at>=now()-INTERVAL '7 days' GROUP BY m.land ORDER BY avg_wait DESC`);
console.log("byLand:", land.rows.length, land.rows.slice(0, 3));
const rhythm = await db.execute(sql`
  SELECT extract(hour FROM q.observed_at AT TIME ZONE ${tz})::int h, avg(q.wait_min)::int avg_wait
  FROM queue_obs q JOIN attractions a ON a.id=q.attraction_id
  WHERE a.park_id=${pid} AND q.queue_type=1 AND q.wait_min IS NOT NULL AND q.observed_at>=now()-INTERVAL '14 days'
  GROUP BY h ORDER BY h`);
console.log("rhythm hours:", rhythm.rows.length, "sample:", rhythm.rows.slice(8, 12));
const heat = await db.execute(sql`
  SELECT count(DISTINCT (q.observed_at AT TIME ZONE ${tz})::date) days, count(*) cells FROM (
    SELECT (q.observed_at AT TIME ZONE ${tz})::date d, extract(hour FROM q.observed_at AT TIME ZONE ${tz})::int h
    FROM queue_obs q JOIN attractions a ON a.id=q.attraction_id
    WHERE a.park_id=${pid} AND q.queue_type=1 AND q.wait_min IS NOT NULL AND q.observed_at>=now()-INTERVAL '14 days'
    GROUP BY d,h) q`);
console.log("heatmap:", heat.rows[0]);
const sc = await db.execute(sql`
  SELECT a.name, avg(q.wait_min)::numeric(10,1) avg_wait, coalesce(stddev_pop(q.wait_min),0)::numeric(10,1) vol, max(q.wait_min) peak, count(*) n
  FROM queue_obs q JOIN attractions a ON a.id=q.attraction_id
  WHERE a.park_id=${pid} AND q.queue_type=1 AND q.wait_min IS NOT NULL AND a.active=true AND q.observed_at>=now()-INTERVAL '7 days'
  GROUP BY a.id,a.name HAVING count(*)>5 ORDER BY avg_wait DESC LIMIT 4`);
console.log("scatter:", sc.rows);
const act = await db.execute(sql`
  SELECT time_bucket('1 hour'::interval,q.observed_at) b, count(DISTINCT q.attraction_id) rides, avg(q.wait_min)::int avg_wait
  FROM queue_obs q JOIN attractions a ON a.id=q.attraction_id WHERE a.park_id=${pid} AND q.queue_type=1 AND q.observed_at>=now()-INTERVAL '7 days'
  GROUP BY b ORDER BY b DESC LIMIT 3`);
console.log("activity (recent):", act.rows);
process.exit(0);
