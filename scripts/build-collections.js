#!/usr/bin/env node
/**
 * Läser den råa skins.json (från ByMykel/CSGO-API) och bygger en kompakt
 * collections-databas som EV-kalkylatorn kan använda:
 *
 * {
 *   "The Spy Tech Collection": {
 *     "Mil-Spec Grade": [ { name, min_float, max_float, stattrak } , ... ],
 *     "Restricted": [...],
 *     "Classified": [...],
 *     "Covert": [...]
 *   },
 *   ...
 * }
 *
 * Regler som filtreras bort (kan inte användas i eller komma ur trade-ups):
 * - Knivar och handskar (Extraordinary rarity, egen pool, droppar aldrig från trade-ups)
 * - Souvenir-skins (får aldrig användas i contracts)
 * - Skins utan collection (case-exklusiva som saknar samlingstillhörighet, t.ex. vissa nyare)
 */
const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '..', 'raw', 'skins.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'collections.json');

const EXCLUDED_CATEGORY_NAMES = new Set(['Knives', 'Gloves']);

// Namn som dyker upp i källdatan men inte är riktiga collections man kan trade-uppa
// inom (specialpriser/pins etc, väldigt få skins, ingen verklig raritetskedja).
const EXCLUDED_COLLECTION_NAMES = new Set(['Limited Edition Item']);

// Endast de "vanliga" raritetsnivåerna deltar i trade-up-kedjan.
const RARITY_ORDER = [
  'Consumer Grade',
  'Industrial Grade',
  'Mil-Spec Grade',
  'Restricted',
  'Classified',
  'Covert',
];

function main() {
  const skins = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));

  const collections = {};

  for (const skin of skins) {
    if (!skin.collections || skin.collections.length === 0) continue;
    // OBS: fältet "souvenir" i denna dataset betyder "kan förekomma som souvenir-variant",
    // inte "detta är en souvenir-post" (souvenir-varianter finns inte som egna poster här).
    // Souvenir-vapen kan ändå aldrig användas i contracts, men eftersom det inte finns
    // separata souvenir-poster att filtrera bort behövs ingen souvenir-filtrering här.
    if (!skin.rarity || !RARITY_ORDER.includes(skin.rarity.name)) continue;
    if (skin.category && EXCLUDED_CATEGORY_NAMES.has(skin.category.name)) continue;
    if (typeof skin.min_float !== 'number' || typeof skin.max_float !== 'number') continue;

    const entry = {
      name: skin.name.replace(/^★\s*/, ''), // stjärnan hör bara till knivar/handskar, men var extra säker
      min_float: skin.min_float,
      max_float: skin.max_float,
      stattrak: !!skin.stattrak,
    };

    for (const coll of skin.collections) {
      const collName = coll.name;
      if (EXCLUDED_COLLECTION_NAMES.has(collName)) continue;
      if (!collections[collName]) collections[collName] = {};
      if (!collections[collName][skin.rarity.name]) collections[collName][skin.rarity.name] = [];
      // undvik dubbletter om samma skin råkar listas i collection flera gånger
      if (!collections[collName][skin.rarity.name].some((s) => s.name === entry.name)) {
        collections[collName][skin.rarity.name].push(entry);
      }
    }
  }

  // Städa bort collections som inte har minst två på varandra följande rariteter
  // (kan då aldrig ge upphov till en trade-up).
  let usableCollections = 0;
  for (const [collName, rarities] of Object.entries(collections)) {
    let hasChain = false;
    for (let i = 0; i < RARITY_ORDER.length - 1; i++) {
      if (rarities[RARITY_ORDER[i]]?.length && rarities[RARITY_ORDER[i + 1]]?.length) {
        hasChain = true;
        break;
      }
    }
    if (hasChain) usableCollections++;
    else delete collections[collName];
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(collections, null, 2));

  console.log(`Klart: ${usableCollections} collections med giltiga trade-up-kedjor skrivna till ${OUT_PATH}`);
}

main();
