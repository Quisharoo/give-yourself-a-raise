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
}

export interface EnableBankingSession {
  accounts: Array<EnableBankingSessionAccountReference | string>;
  session_id?: string;
  [key: string]: unknown;
}

export interface EnableBankingBalance {
  balance_amount: MoneyAmount;
  balance_type?: string;
  last_change_date_time?: string;
  name?: string;
  reference_date?: string;
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
  booking_date?: string;
  credit_debit_indicator?: "CRDT" | "DBIT";
  creditor?: EnableBankingParty;
  debtor?: EnableBankingParty;
  entry_reference?: string;
  merchant_category_code?: string;
  note?: string;
  remittance_information?: string[];
  status?: string;
  transaction_amount: MoneyAmount;
  transaction_date?: string;
  transaction_id?: string;
  value_date?: string;
}

export interface EnableBankingTransactionsResponse {
  continuation_key?: string | null;
  transactions: EnableBankingTransaction[];
}

export interface EnableBankingAccountSnapshot {
  accountId: string;
  balances: EnableBankingBalance[];
  iban?: string;
  name?: string;
  transactions: EnableBankingTransaction[];
}

export interface EnableBankingSessionOverview {
  accounts: EnableBankingAccountSnapshot[];
  session: EnableBankingSession;
}
