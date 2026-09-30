const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/;
const SCALE = 4n;
const UNITS_PER_WHOLE = 10n ** SCALE;

export type MinorDigits = 0 | 2 | 3;

export interface CurrencyInfo {
  code: string;
  minorDigits: MinorDigits;
  name: string;
}

export const SUPPORTED_CURRENCIES: Record<string, CurrencyInfo> = {
  // 2 decimal places (standard commerce)
  USD: { code: "USD", minorDigits: 2, name: "US Dollar" },
  EUR: { code: "EUR", minorDigits: 2, name: "Euro" },
  GBP: { code: "GBP", minorDigits: 2, name: "British Pound" },
  ZAR: { code: "ZAR", minorDigits: 2, name: "South African Rand" },
  CAD: { code: "CAD", minorDigits: 2, name: "Canadian Dollar" },
  AUD: { code: "AUD", minorDigits: 2, name: "Australian Dollar" },
  NZD: { code: "NZD", minorDigits: 2, name: "New Zealand Dollar" },
  SGD: { code: "SGD", minorDigits: 2, name: "Singapore Dollar" },
  HKD: { code: "HKD", minorDigits: 2, name: "Hong Kong Dollar" },
  CHF: { code: "CHF", minorDigits: 2, name: "Swiss Franc" },
  SEK: { code: "SEK", minorDigits: 2, name: "Swedish Krona" },
  NOK: { code: "NOK", minorDigits: 2, name: "Norwegian Krone" },
  DKK: { code: "DKK", minorDigits: 2, name: "Danish Krone" },
  PLN: { code: "PLN", minorDigits: 2, name: "Polish Zloty" },
  ILS: { code: "ILS", minorDigits: 2, name: "Israeli New Shekel" },
  INR: { code: "INR", minorDigits: 2, name: "Indian Rupee" },
  MXN: { code: "MXN", minorDigits: 2, name: "Mexican Peso" },
  BRL: { code: "BRL", minorDigits: 2, name: "Brazilian Real" },

  // 0 decimal places (zero-decimal currencies)
  JPY: { code: "JPY", minorDigits: 0, name: "Japanese Yen" },
  KRW: { code: "KRW", minorDigits: 0, name: "South Korean Won" },
  VND: { code: "VND", minorDigits: 0, name: "Vietnamese Dong" },
  CLP: { code: "CLP", minorDigits: 0, name: "Chilean Peso" },
  ISK: { code: "ISK", minorDigits: 0, name: "Icelandic Krona" },

  // 3 decimal places (three-decimal currencies)
  BHD: { code: "BHD", minorDigits: 3, name: "Bahraini Dinar" },
  KWD: { code: "KWD", minorDigits: 3, name: "Kuwaiti Dinar" },
  OMR: { code: "OMR", minorDigits: 3, name: "Omani Rial" },
  JOD: { code: "JOD", minorDigits: 3, name: "Jordanian Dinar" },
  TND: { code: "TND", minorDigits: 3, name: "Tunisian Dinar" },
};

export function validateCurrency(code: string): CurrencyInfo {
  if (typeof code !== "string" || code.length !== 3) {
    throw new TypeError(`Invalid currency code: expected 3-letter ISO code, got '${code}'`);
  }
  const upper = code.toUpperCase();
  const info = SUPPORTED_CURRENCIES[upper];
  if (!info) {
    throw new RangeError(`Unsupported currency '${code}'. Must be an approved ISO currency.`);
  }
  return info;
}

/**
 * Enforces that all items or lines in a transaction share the exact same currency.
 * In v1, mixed-currency operations without conversion are strictly rejected.
 */
export function assertSingleCurrency(currencies: string[]): string {
  if (currencies.length === 0) {
    throw new RangeError("At least one currency must be provided");
  }
  const first = validateCurrency(currencies[0]!).code;
  for (let i = 1; i < currencies.length; i++) {
    const current = validateCurrency(currencies[i]!).code;
    if (current !== first) {
      throw new RangeError(
        `Mixed-currency transaction rejected: found '${current}' and '${first}'. v1 requires uniform currency.`,
      );
    }
  }
  return first;
}

export function parseMoney(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new RangeError("Money must be a plain decimal with at most four places");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const whole = unsigned.split(".")[0]!;
  const fractional = (match[1] ?? "").padEnd(Number(SCALE), "0");
  const units = BigInt(whole) * UNITS_PER_WHOLE + BigInt(fractional);
  return negative ? -units : units;
}

export function formatMoney(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const fraction = String(absolute % UNITS_PER_WHOLE).padStart(Number(SCALE), "0");
  return `${sign}${absolute / UNITS_PER_WHOLE}.${fraction}`;
}

export function requireNonnegative(value: string, label: string): bigint {
  const units = parseMoney(value);
  if (units < 0n) {
    throw new RangeError(`${label} must be nonnegative`);
  }
  return units;
}

export function requirePositive(value: string, label: string): bigint {
  const units = parseMoney(value);
  if (units <= 0n) {
    throw new RangeError(`${label} must be positive`);
  }
  return units;
}

export function quantizeMoney(units: bigint, minorDigits: MinorDigits): bigint {
  if (minorDigits !== 0 && minorDigits !== 2 && minorDigits !== 3) {
    throw new RangeError("Currency precision must be 0, 2 or 3 decimal places");
  }
  const quantum = 10n ** BigInt(Number(SCALE) - minorDigits);
  const magnitude = units < 0n ? -units : units;
  const rounded = ((magnitude + quantum / 2n) / quantum) * quantum;
  return units < 0n ? -rounded : rounded;
}

/**
 * Quantizes a money decimal string to the standard decimal places of the given currency.
 */
export function quantizeForCurrency(amount: string | bigint, currencyCode: string): string {
  const info = validateCurrency(currencyCode);
  const units = typeof amount === "string" ? parseMoney(amount) : amount;
  const quantized = quantizeMoney(units, info.minorDigits);
  return formatMoney(quantized);
}

/**
 * Formats a money amount with currency display precision (e.g. 0 decimals for JPY, 2 for USD, 3 for BHD).
 */
export function formatDisplayCurrency(units: bigint, currencyCode: string): string {
  const info = validateCurrency(currencyCode);
  const quantized = quantizeMoney(units, info.minorDigits);
  const formatted4 = formatMoney(quantized);
  if (info.minorDigits === 0) {
    return formatted4.split(".")[0]!;
  }
  const [whole, frac] = formatted4.split(".") as [string, string];
  return `${whole}.${frac.slice(0, info.minorDigits)}`;
}
