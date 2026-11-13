import { z } from "zod";

export type EnableBankingPsuType = "business" | "personal";

export interface MoneyAmount {
  amount: string;
  currency: string;
}

export interface EnableBankingParty {
  name?: string;
}

export interface EnableBankingAspsp {
  auth_methods?: Array<Record<string, unknown>>;
  beta?: boolean;
  bic?: string;
  country: string;
  logo?: string;
  maximum_consent_validity?: number;
  name: string;
  psu_types?: string[];
  required_psu_headers?: string[];
}

export interface EnableBankingAspspListResponse {
  aspsps: EnableBankingAspsp[];
}

export interface EnableBankingApplication {
  active: boolean;
  countries?: string[];
  environment: "PRODUCTION" | "SANDBOX";
  kid: string;
  name: string;
  redirect_urls: string[];
  services?: string[];
}

export interface EnableBankingAuthorizationResponse {
  url: string;
  [key: string]: unknown;
}

export interface EnableBankingSessionAccountReference {
  iban?: string;
  name?: string;
  uid: string;
  stableIdentity?: string;
  details?: EnableBankingAccountDetails;
}

export interface EnableBankingSession {
  access?: { valid_until?: unknown };
  accounts: Array<EnableBankingSessionAccountReference | string>;
  session_id?: string;
  [key: string]: unknown;
}

export const enableBankingAccountDetailsSchema = z.object({
  identification_hash: z.string().trim().min(1).max(512).optional(),
  cash_account_type: z.string().max(20).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});
export type EnableBankingAccountDetails = z.infer<typeof enableBankingAccountDetailsSchema>;

export interface EnableBankingBalance {
  balance_amount: MoneyAmount;
  balance_type?: string;
  last_change_date_time?: string | null;
  name?: string;
  reference_date?: string | null;
}

export interface EnableBankingBalancesResponse {
  balances: EnableBankingBalance[];
}

export interface EnableBankingTransaction {
  bank_transaction_code?: {
    code?: string;
    description?: string | null;
    sub_code?: string | null;
  };
  booking_date?: string | null;
  credit_debit_indicator?: "CRDT" | "DBIT";
  creditor?: EnableBankingParty;
  debtor?: EnableBankingParty;
  entry_reference?: string;
  merchant_category_code?: string;
  note?: string;
  remittance_information?: string[];
  status?: string;
  transaction_amount: MoneyAmount;
  transaction_date?: string | null;
  transaction_id?: string;
  value_date?: string | null;
}

export interface EnableBankingTransactionsResponse {
  continuation_key?: string | null;
  transactions: EnableBankingTransaction[];
}

export interface EnableBankingAccountSnapshot {
  accountId: string;
  stableIdentity?: string;
  unsupportedTransactionRefs?: string[];
  classificationAccountRef?: string;
  balances: EnableBankingBalance[];
  iban?: string;
  name?: string;
  transactions: EnableBankingTransaction[];
}

export interface EnableBankingSessionOverview {
  accounts: EnableBankingAccountSnapshot[];
  session: EnableBankingSession;
}
