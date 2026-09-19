#!/usr/bin/env node
/**
 * Enkel sanity-check av EV-kalkylatorn med påhittade priser (ingen nätverksåtkomst behövs).
 * Kör: node scripts/test-ev-calculator.js
 */
const assert = require('assert');
const {
  evaluateCombo,
  wearForFloat,
  normalizedFloat,
  floatFromNormalized,
} = require('../lib/ev-calculator');

// --- Test 1: float/wear-matematik ---
const skinFullRange = { name: 'Test Full', min_float: 0, max_float: 1, stattrak: false };
assert.strictEqual(wearForFloat(0.03, skinFullRange), 'Factory New');
assert.strictEqual(wearForFloat(0.2, skinFullRange), 'Field-Tested');
assert.strictEqual(wearForFloat(0.9, skinFullRange), 'Battle-Scarred');
assert.strictEqual(normalizedFloat(0.5, skinFullRange), 0.5);
assert.strictEqual(floatFromNormalized(0.5, skinFullRange), 0.5);

const narrowSkin = { name: 'Test Narrow', min_float: 0.06, max_float: 0.5, stattrak: false };
assert.strictEqual(normalizedFloat(0.06, narrowSkin), 0);
assert.strictEqual(normalizedFloat(0.5, narrowSkin), 1);
console.log('OK: float/wear-hjälpfunktioner');

// --- Test 2: evaluateCombo räknar rätt på ett litet påhittat exempel ---
// Collection: 1 inputskin "A" (fullt spann), 2 outputskins "B" (0-0.5) och "C" (0.5-1)
const inputSkin = { name: 'A', min_float: 0, max_float: 1, stattrak: false };
const outputs = [
  { name: 'B', min_float: 0, max_float: 0.5, stattrak: false },
  { name: 'C', min_float: 0.5, max_float: 1, stattrak: false },
];

// Fejkade priser (marketHashName -> pris)
const prices = {
  'A (Factory New)': 2,
  'B (Factory New)': 30,
  'C (Battle-Scarred)': 4,
};
const priceLookup = (name) => prices[name];

// Input-float 0 -> norm 0 -> A är Factory New (kostnad 10*2=20)
// B: outFloat = 0 + 0*0.5 = 0 -> Factory New -> pris 30
// C: outFloat = 0.5 + 0*0.5 = 0.5 -> Battle-Scarred -> pris 4
// evGross = (30+4)/2 = 17, ingen avgift/rabatt -> evNet=17*(1-0.12)=14.96
// profit = 14.96 - 20 = -5.04, roi = -25.2%
const combo = evaluateCombo({
  collection: 'TestCollection',
  inputSkin,
  inputFloat: 0,
  outputs,
  stattrak: false,
  priceLookup,
  sellFeeRate: 0.12,
  buyDiscount: 0,
});

assert.strictEqual(combo.cost, 20);
assert.strictEqual(combo.evGross, 17);
assert.strictEqual(combo.evNet, Number((17 * 0.88).toFixed(2)));
assert.strictEqual(combo.profit, Number((14.96 - 20).toFixed(2)));
assert.strictEqual(combo.coverage, 1);
console.log('OK: evaluateCombo bas-räkning stämmer ->', combo);

// --- Test 3: coverage < 1 när priser saknas, och EV räknas ändå ut korrekt (delar på ALLA outputs) ---
const pricesPartial = { 'A (Factory New)': 2, 'B (Factory New)': 30 }; // C saknas
const combo2 = evaluateCombo({
  collection: 'TestCollection',
  inputSkin,
  inputFloat: 0,
  outputs,
  stattrak: false,
  priceLookup: (n) => pricesPartial[n],
  sellFeeRate: 0,
  buyDiscount: 0,
});
assert.strictEqual(combo2.coverage, 0.5);
assert.strictEqual(combo2.evGross, 15); // (30+0 hittade)/2 outputs = 15, inte 30/1
console.log('OK: coverage och EV med saknade priser stämmer ->', combo2);

console.log('\nAlla tester godkända.');
