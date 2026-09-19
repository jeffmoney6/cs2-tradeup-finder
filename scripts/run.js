#!/usr/bin/env node
/**
 * Huvudscript: hämtar priser, kör EV-scanningen över alla collections och skriver
 * resultatet till output/opportunities.json (som dashboarden läser).
 *
 * Användning:
 *   node scripts/run.js            -> hämtar riktiga priser från Skinport
 *   node scripts/run.js --mock     -> använder påhittade priser (för test/demo utan nätverk)
 *
 * Miljövariabler:
 *   SELL_FEE_RATE   (default 0.12)  - avgift vid försäljning av outputen
 *   BUY_DISCOUNT    (default 0)     - antagen rabatt vid köp via buy orders, t.ex 0.03
 *   PRICE_FIELD     (default min_price) - min_price | suggested_price | mean_price
 *   MIN_COVERAGE    (default 0.6)   - minsta andel av outputpoolen som måste ha pris för att räknas med
 */
const fs = require('fs');
const path = require('path');
const { findBestTradeUps } = require('../lib/ev-calculator');
const { fetchSkinportPrices } = require('../lib/price-fetcher');

const COLLECTIONS_PATH = path.join(__dirname, '..', 'data', 'collections.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'output', 'opportunities.json');

function buildMockPriceLookup(collectionsData) {
  // Grovt realistiska prisintervall per raritet, bara för att kunna demonstrera
  // hela flödet utan nätverksåtkomst. INTE riktiga priser.
  const baseByRarity = {
    'Consumer Grade': [0.05, 0.3],
    'Industrial Grade': [0.1, 0.8],
    'Mil-Spec Grade': [0.5, 6],
    Restricted: [2, 20],
    Classified: [8, 60],
    Covert: [25, 400],
  };
  const wearMultiplier = {
    'Factory New': 1.6,
    'Minimal Wear': 1.25,
    'Field-Tested': 1.0,
    'Well-Worn': 0.85,
    'Battle-Scarred': 0.7,
  };
  const prices = new Map();
  let seed = 42; // deterministisk "slump" så körningar går att jämföra
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (const rarities of Object.values(collectionsData)) {
    for (const [rarity, skins] of Object.entries(rarities)) {
      const [lo, hi] = baseByRarity[rarity] || [1, 10];
      for (const skin of skins) {
        const base = lo + rand() * (hi - lo);
        for (const wear of Object.keys(wearMultiplier)) {
          prices.set(`${skin.name} (${wear})`, Number((base * wearMultiplier[wear]).toFixed(2)));
          if (skin.stattrak) {
            prices.set(`StatTrak™ ${skin.name} (${wear})`, Number((base * wearMultiplier[wear] * 4).toFixed(2)));
          }
        }
      }
    }
  }
  return (name) => prices.get(name);
}

async function main() {
  const useMock = process.argv.includes('--mock');
  const collectionsData = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf8'));

  const sellFeeRate = Number(process.env.SELL_FEE_RATE ?? 0.12);
  const buyDiscount = Number(process.env.BUY_DISCOUNT ?? 0);
  const minCoverage = Number(process.env.MIN_COVERAGE ?? 0.6);
  const priceField = process.env.PRICE_FIELD || 'min_price';

  let priceLookup;
  let priceMeta = { source: 'mock', fetchedAt: new Date().toISOString() };

  if (useMock) {
    console.log('Kör med PÅHITTADE priser (--mock) - bara för att verifiera att pipelinen fungerar.');
    priceLookup = buildMockPriceLookup(collectionsData);
  } else {
    console.log('Hämtar riktiga priser från Skinport...');
    const skinport = await fetchSkinportPrices({ field: priceField });
    console.log(`Fick priser för ${skinport.count} items.`);
    priceLookup = skinport.lookup;
    priceMeta = { source: 'skinport', field: priceField, fetchedAt: skinport.fetchedAt, itemCount: skinport.count };
  }

  const results = findBestTradeUps(collectionsData, priceLookup, { sellFeeRate, buyDiscount, minCoverage });

  console.log(`\nHittade ${results.length} kombinationer med tillräcklig prisdata (coverage >= ${minCoverage}).`);
  console.log('\nTopp 10 efter ROI%:');
  for (const r of results.slice(0, 10)) {
    console.log(
      `${r.roiPct?.toFixed(1)}%  |  ${r.collection} (${r.tier}${r.stattrak ? ', StatTrak' : ''})  |  10x ${r.inputSkin} (${r.inputWear}, float ${r.inputFloat})  |  kostnad ${r.cost}  ->  EV netto ${r.evNet}`,
    );
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        params: { sellFeeRate, buyDiscount, minCoverage },
        priceMeta,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nSkrev ${results.length} möjligheter till ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Körningen misslyckades:', err.message);
  console.error(
    '\nOm felet handlar om nätverksåtkomst (fetch failed / ENOTFOUND / 403): detta skript måste' +
      ' köras någonstans med öppen internetåtkomst till Skinport, t.ex via GitHub Actions (se .github/workflows/scan.yml)' +
      ' eller lokalt på din egen dator. Testa gärna "node scripts/run.js --mock" under tiden för att se att resten fungerar.',
  );
  process.exit(1);
});
