import { db } from "@/db";
import { categories } from "@/db/schema";
import { asc } from "drizzle-orm";

export const DEFAULT_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Housing & Utilities",
  "Health & Insurance",
  "Shopping & Clothing",
  "Entertainment & Leisure",
  "Transfers",
  "Government & Taxes",
  "Other",
];

// Map parser-specific categories to standard ones
export const CATEGORY_MAP: Record<string, string> = {
  // Old standard categories → consolidated
  "Food & Groceries": "Food & Dining",
  "Restaurants & Cafes": "Food & Dining",
  "Health & Medical": "Health & Insurance",
  Insurance: "Health & Insurance",
  Subscriptions: "Other",
  Education: "Other",
  // Discover
  Merchandise: "Shopping & Clothing",
  Services: "Other",
  "Restaurants/Dining": "Food & Dining",
  Restaurants: "Food & Dining",
  Supermarkets: "Food & Dining",
  "Department Stores": "Shopping & Clothing",
  "Travel/ Entertainment": "Entertainment & Leisure",
  "Payments and Credits": "Transfers",
  "Awards and Rebate Credits": "Other",
  Fees: "Other",
  "Government Services": "Government & Taxes",
  // Max (Hebrew)
  "מזון וצריכה": "Food & Dining",
  "מסעדות, קפה וברים": "Food & Dining",
  "תחבורה ורכבים": "Transportation",
  "רפואה ובתי מרקחת": "Health & Insurance",
  "פנאי, בידור וספורט": "Entertainment & Leisure",
  אופנה: "Shopping & Clothing",
  "קוסמטיקה וטיפוח": "Shopping & Clothing",
  "חשמל ומחשבים": "Shopping & Clothing",
  "העברת כספים": "Transfers",
  שונות: "Other",
  "עירייה וממשלה": "Government & Taxes",
  ביטוח: "Health & Insurance",
  "דלק, חשמל וגז": "Housing & Utilities",
  "טיסות ותיירות": "Entertainment & Leisure",
  "עיצוב הבית": "Shopping & Clothing",
  "ספרים ודפוס": "Other",
  "שירותי תקשורת": "Other",
  // SDFCU
  Transfers: "Transfers",
  "Other Expenses": "Other",
  "Service Charges/Fees": "Other",
  // IBKR
  Dividend: "Other",
  "Credit Interest": "Other",
  "Debit Interest": "Other",
  Withdrawal: "Transfers",
  Deposit: "Transfers",
  "Payment in Lieu": "Other",
};

type CategoryRow = {
  id: number;
  name: string;
  isDefault: number;
  sortOrder: number;
};

let cache: { data: CategoryRow[]; timestamp: number } | null = null;
const CACHE_TTL = 60_000;

export function clearCategoryCache() {
  cache = null;
}

export async function getCategories(): Promise<CategoryRow[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  let rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      isDefault: categories.isDefault,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id));

  // Seed defaults if empty
  if (rows.length === 0) {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      await db.insert(categories).values({
        name: DEFAULT_CATEGORIES[i],
        isDefault: 1,
        sortOrder: i,
      });
    }
    rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        isDefault: categories.isDefault,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
  }

  cache = { data: rows, timestamp: Date.now() };
  return rows;
}

export async function getCategoryNames(): Promise<string[]> {
  const rows = await getCategories();
  return rows.map((r) => r.name);
}

export function getCategoryMap(): Record<string, string> {
  return CATEGORY_MAP;
}
