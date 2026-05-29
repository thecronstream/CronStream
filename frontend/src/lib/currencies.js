/**
 * Supported display currencies and token → USD price helpers.
 *
 * All volume/stats in the app are denominated in USD internally, then
 * converted to the user's preferred display currency.
 *
 * Stablecoins are hardcoded at 1.00 USD.
 * Other ERC-20s would need a price feed — add to TOKEN_USD_PRICES as needed.
 */

// All locales use 'en-US' number formatting so decimals are always displayed
// with a period (25.79) not a comma (25,79). The comma convention is
// continental-European (de-DE, fr-FR) — not British or American.
// Fintech apps consistently use period-as-decimal regardless of currency symbol.
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$',  name: 'US Dollar',        locale: 'en-US' },
  { code: 'EUR', symbol: '€',  name: 'Euro',             locale: 'en-US' },
  { code: 'GBP', symbol: '£',  name: 'British Pound',    locale: 'en-GB' },
  { code: 'NGN', symbol: '₦',  name: 'Nigerian Naira',   locale: 'en-US' },
  { code: 'JPY', symbol: '¥',  name: 'Japanese Yen',     locale: 'en-US' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar',  locale: 'en-US' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar',locale: 'en-US' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc',      locale: 'en-US' },
  { code: 'INR', symbol: '₹',  name: 'Indian Rupee',     locale: 'en-US' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real',   locale: 'en-US' },
];

export const DEFAULT_CURRENCY = 'USD';

/**
 * Token address → price in USD.
 * Stablecoins are pegged to $1. Other tokens should be fetched from a price
 * oracle (see useTokenPrices hook).
 */
export const STABLECOIN_USD_PRICE = {
  // Arbitrum Sepolia USDC
  '0x75faf114eafb1bDbe2F0316DF893fd58CE46AA4d': 1.0,
  // CronStream testnet token — 1 CRM = $1
  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1': 1.0,
};

/** Returns true if the token is a known stablecoin (~$1). */
export function isStablecoin(tokenAddress) {
  if (!tokenAddress) return false;
  return Object.prototype.hasOwnProperty.call(
    STABLECOIN_USD_PRICE,
    tokenAddress.toLowerCase()
      ? tokenAddress
      : tokenAddress,
  ) || Object.keys(STABLECOIN_USD_PRICE).some(
    k => k.toLowerCase() === tokenAddress.toLowerCase()
  );
}

/** Best-effort USD price for a token. Returns null if unknown (needs live feed). */
export function tokenUsdPrice(tokenAddress) {
  if (!tokenAddress) return null;
  const key = Object.keys(STABLECOIN_USD_PRICE).find(
    k => k.toLowerCase() === tokenAddress.toLowerCase()
  );
  return key ? STABLECOIN_USD_PRICE[key] : null;
}

/**
 * Format a number in a given currency with proper locale formatting.
 * @param {number} usdAmount  — amount already converted to target currency
 * @param {string} currencyCode — e.g. 'USD', 'EUR'
 * @param {object} options
 * @param {boolean} options.compact — use compact notation (1.2K, 3.4M)
 */
export function formatCurrency(amount, currencyCode = 'USD', { compact = false, decimals } = {}) {
  const meta = SUPPORTED_CURRENCIES.find(c => c.code === currencyCode) ?? SUPPORTED_CURRENCIES[0];
  try {
    const opts = {
      style:    'currency',
      currency: currencyCode,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 2 } : {}),
      ...(decimals != null ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}),
    };
    return new Intl.NumberFormat(meta.locale, opts).format(amount);
  } catch {
    // Fallback for unsupported locale/currency combos
    const dp = decimals ?? (currencyCode === 'JPY' ? 0 : 2);
    return `${meta.symbol}${amount.toFixed(dp)}`;
  }
}
