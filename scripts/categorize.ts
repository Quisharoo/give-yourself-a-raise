/**
 * Bulk-categorize Revolut transactions in Actual using simple payee patterns.
 *
 * Uses only the categories that already exist in the budget. Run repeatedly —
 * idempotent: only touches transactions whose category is null.
 *
 * Edit the RULES table below to extend coverage.
 */

import { config as loadEnv } from "dotenv";
import { join } from "node:path";

loadEnv({ path: ".env.local" });

// Patterns are matched (case-insensitive) against payee_name OR notes.
// First match wins.
const RULES: Array<{ pattern: RegExp; category: string }> = [
  // Internal money movement / investments
  { pattern: /instant access savings/i, category: "Savings" },
  { pattern: /\bto eur\b/i, category: "Savings" },
  { pattern: /trading ?212/i, category: "Savings" },
  { pattern: /trade republic/i, category: "Savings" },

  // Groceries
  { pattern: /lidl|aldi|tesco|super ?valu|centra|spar|dunnes|marks ?& ?spencer/i, category: "Food" },
  { pattern: /applegreen|df stillorgan/i, category: "Food" }, // forecourts (mostly snacks)
  { pattern: /pa mcgraths|talking leaves|sale of proceeds/i, category: "General" },

  // Restaurants / takeaway
  { pattern: /deliveroo|just ?eat|uber ?eats|camile|tasty grub|five guys|mcdonald|boojum|zakura|workday limited|sumup|burger king|copper and straw|brownes of sandymount|apache pizza|mister magpie|justtip/i, category: "Food" },

  // Transport / parking
  { pattern: /freenow|free-now|free now|uber|bolt|leap card|irish rail|lime\*ride|parkingpayments|car park/i, category: "General" },

  // SaaS / subscriptions / hosting / mobile data / domains
  { pattern: /apple\.com|claude\.ai|openrouter|github|hetzner|register365|hp instant ink|cursor|openai|anthropic|vercel|netlify|cloudflare|elevenlabs|1global|render\.com|name-?cheap|fireworks\.ai/i, category: "Bills (Flexible)" },

  // Utilities / fixed bills
  { pattern: /yuno energy|electric ireland|bord g[áa]is|virgin media|eir\b|three\b|vodafone|gas networks/i, category: "Bills" },

  // Fitness / entertainment / events
  { pattern: /flyefit|odeon|netflix|spotify|disney|ticketmaster|mena live events/i, category: "General" },

  // Cash / shoes / clothes / misc retail / online retail / travel / health
  { pattern: /cash at boi|cut and sew|merry cobbler|moco|amazon|amznmktplace|amzn ?mktplace|eurowings|ryanair|aer lingus|dm drogerie|superfoods|holland ?& ?barrett/i, category: "General" },
];

interface Transaction {
  id: string;
  category: string | null;
  payee: string | null;
  notes: string | null;
  imported_payee: string | null;
  amount: number;
  date: string;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env.local`);
  return value;
}

async function main() {
  const accountId = readRequiredEnv("ACTUAL_REVOLUT_ACCOUNT_ID");
  const serverURL = readRequiredEnv("ACTUAL_SERVER_URL");
  const password = readRequiredEnv("ACTUAL_PASSWORD");
  const syncId = readRequiredEnv("ACTUAL_SYNC_ID");
  const startDate = process.env.ACTUAL_CATEGORIZE_START_DATE?.trim() || "1970-01-01";
  const endDate =
    process.env.ACTUAL_CATEGORIZE_END_DATE?.trim() || new Date().toISOString().slice(0, 10);

  const api = await import("@actual-app/api");
  await api.init({
    dataDir: join(process.cwd(), ".local/actual-data"),
    serverURL,
    password,
  });
  await api.downloadBudget(syncId);

  try {
    const cats = await api.getCategories();
    const catByName = new Map<string, string>();
    for (const c of cats) catByName.set(c.name.toLowerCase(), c.id);

    // Validate rule categories exist
    for (const rule of RULES) {
      if (!catByName.has(rule.category.toLowerCase())) {
        throw new Error(`Rule references missing category: ${rule.category}`);
      }
    }

    const txns = (await api.getTransactions(accountId, startDate, endDate)) as Transaction[];
    const uncat = txns.filter((t) => !t.category);
    console.log(`Uncategorized: ${uncat.length} / ${txns.length}`);

    const byCategory: Record<string, number> = {};
    let unmapped = 0;
    const unmappedPayees = new Map<string, number>();

    for (const t of uncat) {
      const haystack = [t.imported_payee, t.notes].filter(Boolean).join(" ");
      const rule = RULES.find((r) => r.pattern.test(haystack));
      if (!rule) {
        unmapped++;
        const key = (t.imported_payee || t.notes || "(none)").trim();
        unmappedPayees.set(key, (unmappedPayees.get(key) || 0) + 1);
        continue;
      }
      const categoryId = catByName.get(rule.category.toLowerCase())!;
      await api.updateTransaction(t.id, { category: categoryId });
      byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    }

    console.log("\nApplied:");
    for (const [name, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(4)}  ${name}`);
    }
    console.log(`\nLeft uncategorized: ${unmapped}`);
    if (unmapped > 0) {
      console.log("Top remaining payees:");
      const sorted = [...unmappedPayees.entries()].sort((a, b) => b[1] - a[1]);
      for (const [name, count] of sorted.slice(0, 20)) {
        console.log(`  ${count.toString().padStart(4)}  ${name}`);
      }
    }

    await api.sync();
  } finally {
    await api.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
