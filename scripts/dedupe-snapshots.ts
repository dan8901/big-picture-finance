/**
 * Remove duplicate net worth snapshot rows.
 *
 * For each (account_id, snapshot_date) keep the most recently created row
 * (the user's last recorded value for that day) and delete the rest.
 *
 *   npx tsx scripts/dedupe-snapshots.ts          # dry run, prints what would be deleted
 *   npx tsx scripts/dedupe-snapshots.ts --apply  # actually delete
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const apply = process.argv.includes("--apply");

async function main() {
  const victims = await sql`
    select s.id, s.account_id, s.snapshot_date::text as snapshot_date,
           s.balance::text as balance, s.created_at::text as created_at, a.name
    from net_worth_snapshots s
    join accounts a on a.id = s.account_id
    where s.id not in (
      select distinct on (account_id, snapshot_date) id
      from net_worth_snapshots
      order by account_id, snapshot_date, created_at desc, id desc
    )
    order by s.snapshot_date desc, s.account_id, s.created_at`;

  console.log(`${apply ? "Deleting" : "Would delete"} ${victims.length} rows:`);
  console.table(
    victims.map((v) => ({
      id: v.id,
      date: v.snapshot_date,
      account: v.name,
      balance: v.balance,
      created: v.created_at,
    }))
  );

  if (apply && victims.length > 0) {
    const ids = victims.map((v) => v.id as number);
    await sql`delete from net_worth_snapshots where id = any(${ids})`;
    const remaining = await sql`select count(*)::int as n from net_worth_snapshots`;
    console.log(`Deleted ${ids.length}. Remaining rows: ${remaining[0].n}`);
  } else if (!apply) {
    console.log("Dry run only. Re-run with --apply to delete.");
  }
}
main();
