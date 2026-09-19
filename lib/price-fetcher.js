/**
 * Hämtar aktuella priser för CS2-items.
 *
 * OBS: Skinport och Steam är blockerade i det sandbox-nätverk som byggde det här
 * projektet (organisationens brandvägg tillåter bara npm/pypi/github m.fl). Koden
 * här är skriven mot dokumenterade/kända API-format men har INTE kunnat testköras
 * mot riktiga servrar under utvecklingen. Kör den i GitHub Actions (som
 * skinflip-tracker redan gör) eller lokalt på din egen dator där nätverket är öppet,
 * och hör av dig om något fältnamn har ändrats sedan detta skrevs.
 *
 * Skinport (huvudkälla): ett enda anrop ger priser för ALLA items -> snabbt och
 * skonsamt. https://docs.skinport.com/#tag/Items/paths/~1v1~1items/get
 *
 * Steam Community Market (valfri, sekundär): måste anropas per item och är hårt
 * rate-limitad (~20 anrop/minut innan 429). Används bara för att stickprovskolla
 * toppmöjligheterna, inte för hela scanningen.
 */

const SKINPORT_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=EUR';
const STEAM_PRICEOVERVIEW_URL = 'https://steamcommunity.com/market/priceoverview/';

/**
 * @param {object} [opts]
 * @param {'min_price'|'suggested_price'|'mean_price'} [opts.field] - vilket Skinport-fält som ska användas som pris.
 * @returns {Promise<{ lookup: (marketHashName:string)=>number|undefined, raw: object[], fetchedAt: string }>}
 */
async function fetchSkinportPrices(opts = {}) {
  const field = opts.field || 'min_price';
  const res = await fetch(SKINPORT_URL, {
    headers: {
      // Skinports CDN kräver att klienten annonserar komprimeringsstöd, annars 406.
      'Accept-Encoding': 'br, gzip, deflate',
      Accept: 'application/json',
      'User-Agent': 'cs2-tradeup-finder/1.0 (+personligt projekt)',
    },
  });
  if (!res.ok) {
    throw new Error(`Skinport svarade ${res.status} ${res.statusText}`);
  }
  const items = await res.json();
  const map = new Map();
  for (const item of items) {
    const price = item[field];
    if (typeof price === 'number' && price > 0) {
      map.set(item.market_hash_name, price);
    }
  }
  return {
    lookup: (name) => map.get(name),
    raw: items,
    fetchedAt: new Date().toISOString(),
    count: map.size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hämtar Steam-priser för en lista med market_hash_name, sekventiellt med paus
 * mellan varje anrop för att undvika 429. Tänkt att användas på en liten mängd
 * (t.ex. de 20 bästa möjligheterna enligt Skinport-scanningen), inte hela datasetet.
 *
 * @param {string[]} names
 * @param {object} [opts]
 * @param {number} [opts.currency] - Steams valutakod, 3 = EUR, 1 = USD, 46 = SEK
 * @param {number} [opts.delayMs] - paus mellan anrop
 */
async function fetchSteamPricesSequential(names, opts = {}) {
  const currency = opts.currency ?? 3;
  const delayMs = opts.delayMs ?? 3000;
  const results = new Map();

  for (const name of names) {
    const url = `${STEAM_PRICEOVERVIEW_URL}?appid=730&currency=${currency}&market_hash_name=${encodeURIComponent(name)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'cs2-tradeup-finder/1.0' } });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.lowest_price) {
          results.set(name, parseSteamPrice(data.lowest_price));
        }
      } else if (res.status === 429) {
        console.warn(`Steam rate-limit (429) på "${name}", hoppar över resten.`);
        break;
      }
    } catch (err) {
      console.warn(`Steam-fetch misslyckades för "${name}":`, err.message);
    }
    await sleep(delayMs);
  }
  return results;
}

/** Steam returnerar priser som lokaliserade strängar, t.ex "12,34€" eller "$12.34". */
function parseSteamPrice(str) {
  const cleaned = str.replace(/[^0-9.,]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

module.exports = {
  fetchSkinportPrices,
  fetchSteamPricesSequential,
  parseSteamPrice,
};
