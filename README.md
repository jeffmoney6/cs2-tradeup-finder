# CS2 Trade-Up Finder

Skannar alla CS2-collections och hittar de trade-up-kombinationer (10 skins -> 1)
som har högst förväntat värde (EV) just nu, baserat på Skinport-priser. Byggd i
samma stil som [skinflip-tracker](https://github.com/jeffmoney6/skinflip-tracker):
ett scanner-script som körs periodiskt via GitHub Actions + en statisk dashboard.

## Hur det fungerar

1. `data/collections.json` innehåller alla collections med sina skins, rariteter
   och float-spann (byggt från [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API)).
2. `scripts/run.js` hämtar aktuella priser från Skinport, testar varje
   collection/raritetsövergång (Mil-Spec→Restricted, Restricted→Classified,
   Classified→Covert) i både vanligt och StatTrak-läge, och räknar ut:
   - **Kostnad**: 10x det billigaste inputskinnet, i den slitagenivå som ger bäst resultat
   - **EV**: förväntat värde av outputen, med rätt float räknat utifrån
     trade-up-formeln (viktat medelvärde av inputfloat, omskalat till varje
     möjlig outputskins eget float-spann)
   - **ROI%**: (EV efter säljavgift − kostnad) / kostnad
3. Resultatet sparas i `output/opportunities.json` och visas i `dashboard/index.html`.

### Varför detta är svårare än arbitraget i skinflip-tracker

Arbitrage (som skinflip-tracker gör) är deterministiskt: köp lågt, sälj högt,
vinsten är i praktiken låst direkt. Trade-ups är sannolikhetsbaserade — du satsar
10 skins och får en slumpmässig skin ur en pool. Ett högt ROI% här betyder alltså
"bra förväntat värde över många försök", inte en garanterad vinst på just den
trade-upen. Räkna med varians: du kan behöva göra samma trade-up flera gånger
för att snittet ska slå in, och du binder kapital i 10 skins samtidigt.

## Kom igång

```bash
npm install    # (inga externa paket behövs egentligen, men kör om ni lägger till nåt)
npm run test         # sanity-check av EV-matematiken (ingen nätåtkomst behövs)
npm run scan:mock    # kör hela flödet med påhittade priser, för att se att allt funkar
npm run scan         # riktig körning mot Skinport (kräver internetåtkomst)
```

Öppna sedan `dashboard/index.html` via en lokal webbserver (fetch funkar inte med
`file://`), t.ex:

```bash
npx serve .
# eller
python3 -m http.server 8080
```

och gå till `/dashboard/index.html`.

## Sätta upp automatisk körning (som skinflip-tracker)

1. Skapa ett nytt repo på GitHub och pusha upp den här mappen.
2. Kör `npm run fetch-data && npm run build-data` en gång lokalt om du vill
   uppdatera skin-databasen (annars används den som redan ligger i `data/`).
3. Gå till **Settings → Pages** i repot och slå på GitHub Pages från roten av
   main-branchen (eller `/docs`-mappen om du hellre vill flytta dashboarden dit).
4. `.github/workflows/scan.yml` kör `npm run scan` var 30:e minut, precis som
   skinflip-tracker, och committar det uppdaterade `output/opportunities.json`
   automatiskt. Inget extra secrets behövs eftersom Skinports pris-API är öppet.

## Justera antaganden

I `scripts/run.js` (eller som miljövariabler i workflow-filen):

- `SELL_FEE_RATE` (default 0.12) — avgift när du säljer outputen
- `BUY_DISCOUNT` (default 0) — hur mycket billigare du räknar med att komma åt
  inputs via buy orders istället för att köpa till lägsta listpris. Sätt t.ex.
  `0.03`–`0.05` om du vet av erfarenhet vad du brukar få för rabatt.
- `PRICE_FIELD` (default `min_price`) — vilket Skinport-pris som används.
  `min_price` ger en försiktig uppskattning; `suggested_price` är mer optimistisk.
- `MIN_COVERAGE` (default 0.6) — hur stor andel av en outputpool som måste ha
  prisdata för att kombinationen ska räknas med (annars blir EV missvisande).

## Kända begränsningar / vad som kan byggas vidare

- **Endast Skinport-priser just nu.** Steam Community Market är hårt
  rate-limitat (~20 anrop/min) så det går inte att skanna hela datasetet mot
  Steam. `lib/price-fetcher.js` har en `fetchSteamPricesSequential`-funktion
  redo att användas för att stickprovskolla de bästa träffarna mot Steam-priser
  innan du faktiskt lägger pengar.
- **Antar 10 identiska inputskins.** Går att mixa olika skins/collections i en
  trade-up för att styra sannolikheten mot en specifik collection, men det blir
  fort ett stort kombinatoriskt sökrum — inte med i v1.
- **Slitagenivå, inte exakt float.** Priserna är per slitagenivå (FN/MW/FT/WW/BS),
  inte per exakt float. Den riktiga "float-manipulation"-editionen av det här
  verktyget skulle leta efter enskilda listningar med extremt låg/hög float
  (via t.ex. CSFloats listnings-API) istället för att anta ett snittpris per
  slitagenivå — det är nästa steg om detta känns värt att bygga vidare på.
- Detta projekt byggdes i en sandbox utan nätverksåtkomst till Skinport/Steam,
  så prisfetchern är skriven mot dokumenterat API-format men aldrig körd mot
  skarpa servrar. Kör `npm run scan` och hör av dig om något strular.
