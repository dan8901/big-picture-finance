// Migration: update Pepper transaction descriptions, merchant_categories,
// and exclusion_rules to match the new pdfjs-dist parser output.

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const PEPPER_ACCOUNT_ID = 13;

// Old description → New description
const MAPPINGS: [string, string][] = [
  [`בנה"פ BITהעברה ב`, `בנה"פ BIT העברה ב`],
  [`לאנץ בוקס -גיל שורץ`, `לאנץ בוקס - גיל שורץ`],
  [`מש -קר בע"מ`, `מש - קר בע"מ`],
  [`אונ' בר אילן -שכר לימוד באינט`, `אונ' בר אילן - שכר לימוד באינט`],
  [`בורקס יוון ( )בע"מ`, `בורקס יוון )( בע"מ`],
  [`אשל YELLOW /פז`, `אשל / YELLOWפז`],
  [`תבליני הדור השלישי בע"מ -ר"ג`, `תבליני הדור השלישי בע"מ - ר"ג`],
  [`קפה לנדוור השחם ,פ"ת`, `קפה לנדוור השחם, פ"ת`],
  [`מאץ' ריטייל H&Mאיילון`, `מאץ' ריטייל H&M איילון`],
  [`העברה ב BITבנה"פ`, `העברה ב BIT בנה"פ`],
  [`אונ' בר אילן -שכר לימוד`, `אונ' בר אילן - שכר לימוד`],
  [`WOK 2 WOKהרצליה -`, `WOK 2 WOK הרצליה -`],
  [`פז /YELLOWעבדת`, `פזYELLOW/ עבדת`],
  [`ספרינט מוטורוס בע"מ -שדה`, `ספרינט מוטורוס בע"מ - שדה`],
  [`פמינה -נוף הגליל-גמא`, `פמינה - נוף הגליל-גמא`],
  [`תמנון -ויטה רמת גן-גמא`, `תמנון - ויטה רמת גן-גמא`],
  [`מיננה -איילון`, `מיננה - איילון`],
  [`בני הכיכר 48בע"מ`, `בני הכיכר 48 בע"מ`],
  [`פז YELLOW /איצטדיון פתח ת`, `פז/ YELLOW איצטדיון פתח ת`],
  [`עגלה של קפה -בית הראשונים`, `עגלה של קפה- בית הראשונים`],
  [`H&Mגלילות`, `H&M גלילות`],
  [`מרקט 2גו אווטלט הרצליה`, `מרקט 2 גו אווטלט הרצליה`],
  [`אמ.בי .בורגר הרצליה בע"מ`, `אמ.בי. בורגר הרצליה בע"מ`],
  [`MOSH BEACHהחוף של מוש`, `MOSH BEACH החוף של מוש`],
  [`כרמים (ב"ש)`, `כרמים )ב"ש(`],
  [`זיו רובין -טימבר`, `זיו רובין- טימבר`],
  [`reservedאיילון`, `reserved איילון`],
];

async function main() {
  let txTotal = 0;
  let mcTotal = 0;
  let erTotal = 0;

  for (const [oldDesc, newDesc] of MAPPINGS) {
    // 1. Update transactions (Pepper account only)
    const txResult = await sql`
      UPDATE transactions
      SET description = ${newDesc}
      WHERE account_id = ${PEPPER_ACCOUNT_ID}
        AND description = ${oldDesc}
    `;
    const txCount = (txResult as any).length ?? (txResult as any).count ?? 0;

    // 2. Update merchant_categories (stored as lowercase trimmed)
    const oldKey = oldDesc.toLowerCase().trim();
    const newKey = newDesc.toLowerCase().trim();
    // Check if new key already exists
    const existingMc = await sql`SELECT 1 FROM merchant_categories WHERE merchant_name = ${newKey} LIMIT 1`;
    if (existingMc.length > 0) {
      // New key exists — just delete the old one
      await sql`DELETE FROM merchant_categories WHERE merchant_name = ${oldKey}`;
    } else {
      await sql`UPDATE merchant_categories SET merchant_name = ${newKey} WHERE merchant_name = ${oldKey}`;
    }

    // 3. Update exclusion_rules (Pepper account)
    const existingEr = await sql`
      SELECT 1 FROM exclusion_rules
      WHERE account_id = ${PEPPER_ACCOUNT_ID} AND description = ${newKey} LIMIT 1
    `;
    if (existingEr.length > 0) {
      await sql`DELETE FROM exclusion_rules WHERE account_id = ${PEPPER_ACCOUNT_ID} AND description = ${oldKey}`;
    } else {
      await sql`
        UPDATE exclusion_rules SET description = ${newKey}
        WHERE account_id = ${PEPPER_ACCOUNT_ID} AND description = ${oldKey}
      `;
    }

    if (txCount > 0) {
      console.log(`${oldDesc} → ${newDesc} (${txCount} txns)`);
    }
  }

  // Verify: re-count transactions by checking for any remaining old descriptions
  for (const [oldDesc] of MAPPINGS) {
    const remaining = await sql`
      SELECT count(*) as cnt FROM transactions
      WHERE account_id = ${PEPPER_ACCOUNT_ID} AND description = ${oldDesc}
    `;
    if (Number(remaining[0].cnt) > 0) {
      console.log(`WARNING: ${remaining[0].cnt} transactions still have old description: ${oldDesc}`);
    }
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
