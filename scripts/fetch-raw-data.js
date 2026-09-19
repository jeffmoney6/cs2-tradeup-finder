#!/usr/bin/env node
/**
 * Laddar ner rådata om alla CS2-skins (namn, collection, raritet, float-spann) från
 * det öppna community-projektet ByMykel/CSGO-API. Körs bara när man vill uppdatera
 * skin-databasen (t.ex. när ett nytt case/collection släpps) - inte vid varje scan.
 *
 * Användning: node scripts/fetch-raw-data.js
 * Kör sedan: npm run build-data
 */
const fs = require('fs');
const path = require('path');

const URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json';
const OUT = path.join(__dirname, '..', 'raw', 'skins.json');

async function main() {
  console.log('Hämtar skin-databas från ByMykel/CSGO-API...');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Kunde inte hämta data: ${res.status}`);
  const data = await res.json();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`Klart: ${data.length} skins sparade till ${OUT}`);
  console.log('Kör nu: npm run build-data');
}

main().catch((err) => {
  console.error('Misslyckades:', err.message);
  process.exit(1);
});
