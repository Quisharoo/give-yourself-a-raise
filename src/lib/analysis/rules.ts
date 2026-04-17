import type { CategoryKey } from "@/lib/analysis/types";

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  banking_fees: "Banking fees",
  cash_withdrawal: "Cash withdrawals",
  coffee_snacks: "Coffee and snacks",
  delivery: "Delivery",
  eating_out: "Eating out",
  fx_money_movement: "FX money movement",
  grocery: "Groceries",
  health_fitness: "Health and fitness",
  housing: "Housing",
  investment_savings: "Savings and investing",
  shopping_clothing: "Clothing",
  shopping_general: "Shopping",
  subscriptions: "Subscriptions",
  transport: "Transport",
  travel: "Travel",
  uncertain_digital: "Uncertain digital spend",
  uncertain_shopping: "Uncertain shopping",
  uncategorized: "Uncategorized",
  utilities: "Utilities",
};

export const CONTROLLABILITY_SCORES: Record<CategoryKey, number> = {
  banking_fees: 0.15,
  cash_withdrawal: 0.3,
  coffee_snacks: 0.8,
  delivery: 0.95,
  eating_out: 0.85,
  fx_money_movement: 0,
  grocery: 0.35,
  health_fitness: 0.55,
  housing: 0.05,
  investment_savings: 0,
  shopping_clothing: 0.7,
  shopping_general: 0.7,
  subscriptions: 0.65,
  transport: 0.45,
  travel: 0.45,
  uncertain_digital: 0.45,
  uncertain_shopping: 0.45,
  uncategorized: 0.25,
  utilities: 0.1,
};

export const WEALTH_FLOW_KEYWORDS = [
  "instant access savings",
  "trade republic",
  "trading 212",
  "to eur",
  "to usd",
  "to gbp",
  "to aed",
  "from instant access savings",
  "exchanged to",
  "to savings",
  "investment",
];

export const AMBIGUOUS_FAMILIES = [
  "amazon",
  "apple",
  "google",
  "meta",
  "paypal",
  "uber",
];

const RULES: Array<{
  categoryKey: CategoryKey;
  family?: string;
  keywords: string[];
}> = [
  {
    categoryKey: "delivery",
    keywords: ["deliveroo", "ubereats", "uber eats", "just eat", "camile", "dodo pizza"],
  },
  {
    categoryKey: "eating_out",
    keywords: [
      "boojum",
      "burger king",
      "mcdonald",
      "paper cafe",
      "crazy bears",
      "acai spot",
      "leopardstown inn",
      "zakura",
      "carluccios",
      "delish cafe",
      "gourmet food parlour",
      "joe and the juice",
      "kobeya",
      "nawaes",
      "restaurant",
      "cafe",
    ],
  },
  {
    categoryKey: "coffee_snacks",
    keywords: ["centra", "circle k", "applegreen", "spar", "lee's centra"],
  },
  {
    categoryKey: "grocery",
    keywords: [
      "lidl",
      "aldi",
      "tesco",
      "super valu",
      "supervalu",
      "spinneys",
      "dunnes",
      "paperchase",
    ],
  },
  {
    categoryKey: "shopping_clothing",
    keywords: ["cos", "cut and sew", "marks & spencer"],
  },
  {
    categoryKey: "shopping_general",
    keywords: ["sumup", "odeon", "gaiety theatre", "ticketmaster", "dlr ballyogan recycling"],
  },
  {
    categoryKey: "transport",
    family: "uber",
    keywords: ["freenow", "free-now", "careem", "lime", "leap card", "payzone"],
  },
  {
    categoryKey: "travel",
    keywords: ["eurowings", "airport", "mena live events"],
  },
  {
    categoryKey: "health_fitness",
    keywords: ["flyefit"],
  },
  {
    categoryKey: "utilities",
    keywords: ["yuno energy", "virgin media", "moco"],
  },
  {
    categoryKey: "subscriptions",
    keywords: [
      "openai",
      "claude.ai",
      "github",
      "elevenlabs",
      "render.com",
      "hetzner",
      "register365",
      "cloudflare",
      "amazon prime",
      "hp instant ink",
    ],
  },
  {
    categoryKey: "cash_withdrawal",
    keywords: ["cash at", "atm"],
  },
  {
    categoryKey: "housing",
    keywords: ["mortgage", "rent"],
  },
  {
    categoryKey: "banking_fees",
    keywords: ["plan fee", "premium repricing"],
  },
];

export function getRuleCategory(text: string): CategoryKey | null {
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.categoryKey;
    }
  }

  return null;
}

export function detectMerchantFamily(text: string): string | undefined {
  if (text.includes("apple")) {
    return "apple";
  }
  if (text.includes("amazon") || text.includes("amzn")) {
    return "amazon";
  }
  if (text.includes("google")) {
    return "google";
  }
  if (text.includes("meta") || text.includes("facebook")) {
    return "meta";
  }
  if (text.includes("paypal") || text.includes("pay pal")) {
    return "paypal";
  }
  if (text.includes("uber")) {
    return "uber";
  }

  return undefined;
}
