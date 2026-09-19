/**
 * Kärnlogik för trade-up-EV. Ren funktion utan I/O -> lätt att testa.
 *
 * Trade-up-mekanik (CS2, dagens regler):
 * - 10 skins av SAMMA raritet (och samma StatTrak-status: antingen 10 vanliga eller 10 StatTrak)
 *   ger 1 slumpmässig skin från nästa raritetsnivå.
 * - Om alla 10 inputs kommer från samma collection dras outputen likformigt (1/N) bland
 *   alla skins i den collectionens nästa raritetsnivå.
 * - Outputens float räknas ut som ett normaliserat medelvärde av inputfloatarna, omskalat
 *   till outputskinnets eget float-spann:
 *     norm = (inputFloat - inputMin) / (inputMax - inputMin)
 *     outputFloat = outputMin + norm * (outputMax - outputMin)
 *   Med 10 identiska inputs (samma skin, samma float) blir normen bara den skinens egna
 *   normaliserade float – det är därför "vilken float du köper in på" är hela hemligheten.
 */

const RARITY_ORDER = [
  'Consumer Grade',
  'Industrial Grade',
  'Mil-Spec Grade',
  'Restricted',
  'Classified',
  'Covert',
];

// Standardgränser för slitage i CS2.
const WEAR_BUCKETS = [
  { wear: 'Factory New', lo: 0.0, hi: 0.07 },
  { wear: 'Minimal Wear', lo: 0.07, hi: 0.15 },
  { wear: 'Field-Tested', lo: 0.15, hi: 0.38 },
  { wear: 'Well-Worn', lo: 0.38, hi: 0.45 },
  { wear: 'Battle-Scarred', lo: 0.45, hi: 1.0 },
];

/** De slitagenivåer som faktiskt existerar för ett givet skin (beskuret till dess min/max_float). */
function wearBucketsForSkin(skin) {
  const out = [];
  for (const b of WEAR_BUCKETS) {
    const lo = Math.max(b.lo, skin.min_float);
    const hi = Math.min(b.hi, skin.max_float);
    if (hi > lo) out.push({ wear: b.wear, lo, hi });
  }
  return out;
}

function normalizedFloat(rawFloat, skin) {
  const range = skin.max_float - skin.min_float;
  if (range <= 0) return 0;
  return (rawFloat - skin.min_float) / range;
}

function floatFromNormalized(norm, skin) {
  return skin.min_float + norm * (skin.max_float - skin.min_float);
}

/** Vilket slitagenamn en given float hamnar i för ett specifikt skin. */
function wearForFloat(float, skin) {
  const buckets = wearBucketsForSkin(skin);
  for (const b of buckets) {
    if (float >= b.lo && float <= b.hi) return b.wear;
  }
  // clamp om float hamnar precis utanför pga flyttalsavrundning
  if (float < buckets[0]?.lo) return buckets[0]?.wear;
  return buckets[buckets.length - 1]?.wear;
}

function marketHashName(skinName, wear, stattrak) {
  return `${stattrak ? 'StatTrak™ ' : ''}${skinName} (${wear})`;
}

/**
 * Utvärderar EN specifik trade-up-kombination (ett visst inputskin, till en viss float)
 * mot ALLA möjliga outputs i collectionen/raritetsnivån.
 *
 * @param {object} params
 * @param {string} params.collection
 * @param {object} params.inputSkin - {name, min_float, max_float, stattrak}
 * @param {number} params.inputFloat - vald float för de 10 identiska inputs
 * @param {object[]} params.outputs - skins i nästa raritetsnivå i samma collection
 * @param {boolean} params.stattrak
 * @param {(marketHashName:string)=>number|undefined} params.priceLookup
 * @param {number} params.sellFeeRate - avgift vid försäljning av outputen, t.ex 0.12
 * @param {number} params.buyDiscount - hur mycket billigare man antas kunna köpa in sig via buy orders, t.ex 0.03
 */
function evaluateCombo({ collection, inputSkin, inputFloat, outputs, stattrak, priceLookup, sellFeeRate, buyDiscount }) {
  const inputWear = wearForFloat(inputFloat, inputSkin);
  const inputPrice = priceLookup(marketHashName(inputSkin.name, inputWear, stattrak));
  if (inputPrice == null) return null;

  const norm = normalizedFloat(inputFloat, inputSkin);
  const cost = 10 * inputPrice * (1 - buyDiscount);

  let sum = 0;
  let found = 0;
  const breakdown = [];
  for (const outSkin of outputs) {
    const outFloat = floatFromNormalized(norm, outSkin);
    const outWear = wearForFloat(outFloat, outSkin);
    const price = priceLookup(marketHashName(outSkin.name, outWear, stattrak));
    breakdown.push({ name: outSkin.name, wear: outWear, float: outFloat, price: price ?? null });
    if (price != null) {
      sum += price;
      found++;
    }
  }
  if (found === 0) return null;

  // Sannolikheten är likformig över ALLA outputs i poolen (även de vi saknar pris för),
  // så vi delar på totala antalet, inte bara de vi hittade pris för - annars överskattar
  // vi EV när data saknas. Om täckningen är dålig flaggar vi det via coverage.
  const evGross = sum / outputs.length;
  const coverage = found / outputs.length;
  const evNet = evGross * (1 - sellFeeRate);
  const profit = evNet - cost;
  const roiPct = cost > 0 ? (profit / cost) * 100 : null;

  return {
    collection,
    stattrak,
    inputSkin: inputSkin.name,
    inputWear,
    inputFloat: Number(inputFloat.toFixed(4)),
    cost: Number(cost.toFixed(2)),
    evGross: Number(evGross.toFixed(2)),
    evNet: Number(evNet.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    roiPct: roiPct != null ? Number(roiPct.toFixed(1)) : null,
    coverage: Number(coverage.toFixed(2)),
    outputCount: outputs.length,
    breakdown,
  };
}

/**
 * Testar ett antal representativa floats (kanterna av varje slitagebucket) för ett
 * inputskin och returnerar den bästa kombinationen. Kanterna räcker eftersom
 * outputfloat är en linjär funktion av inputfloat inom en bucket -> optimum ligger
 * alltid i en kant.
 */
function bestComboForInputSkin({ collection, inputSkin, outputs, stattrak, priceLookup, sellFeeRate, buyDiscount }) {
  let best = null;
  for (const bucket of wearBucketsForSkin(inputSkin)) {
    for (const edge of [bucket.lo, bucket.hi - 1e-6]) {
      const combo = evaluateCombo({ collection, inputSkin, inputFloat: edge, outputs, stattrak, priceLookup, sellFeeRate, buyDiscount });
      if (combo && (!best || combo.roiPct > best.roiPct)) best = combo;
    }
  }
  return best;
}

/**
 * Går igenom ALLA collections och alla raritetsövergångar (Mil-Spec->Restricted,
 * Restricted->Classified, Classified->Covert) i både vanligt och StatTrak-läge,
 * och returnerar de bästa möjligheterna sorterade på ROI%.
 *
 * @param {object} collectionsData - output från build-collections.js
 * @param {(marketHashName:string)=>number|undefined} priceLookup
 * @param {object} [options]
 */
function findBestTradeUps(collectionsData, priceLookup, options = {}) {
  const { sellFeeRate = 0.12, buyDiscount = 0, minCoverage = 0.6, tiers = ['Mil-Spec Grade->Restricted', 'Restricted->Classified', 'Classified->Covert'] } = options;

  const results = [];

  for (const [collection, rarities] of Object.entries(collectionsData)) {
    for (const tier of tiers) {
      const [inputRarity, outputRarity] = tier.split('->');
      const inputs = rarities[inputRarity];
      const outputs = rarities[outputRarity];
      if (!inputs || !outputs || inputs.length === 0 || outputs.length === 0) continue;

      for (const stattrak of [false, true]) {
        const eligibleInputs = stattrak ? inputs.filter((s) => s.stattrak) : inputs;
        const eligibleOutputs = stattrak ? outputs.filter((s) => s.stattrak) : outputs;
        if (eligibleInputs.length === 0 || eligibleOutputs.length === 0) continue;

        for (const inputSkin of eligibleInputs) {
          const combo = bestComboForInputSkin({
            collection,
            inputSkin,
            outputs: eligibleOutputs,
            stattrak,
            priceLookup,
            sellFeeRate,
            buyDiscount,
          });
          if (combo && combo.coverage >= minCoverage) {
            results.push({ tier, ...combo });
          }
        }
      }
    }
  }

  results.sort((a, b) => (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity));
  return results;
}

module.exports = {
  RARITY_ORDER,
  WEAR_BUCKETS,
  wearBucketsForSkin,
  normalizedFloat,
  floatFromNormalized,
  wearForFloat,
  marketHashName,
  evaluateCombo,
  bestComboForInputSkin,
  findBestTradeUps,
};
