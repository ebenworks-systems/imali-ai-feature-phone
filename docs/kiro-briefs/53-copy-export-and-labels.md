You are working in this repository, the Imali AI feature-phone ledger. Read the steering files in .kiro/steering/ (product.md has just been corrected) and the browser-phone spec first. This is a wording fix in the page and two docs; do not change how anything works.

1. The export is not imported anywhere yet. No version of Imali AI reads this file today, so no text may say Imali AI can import it, imports it or will import it. Say what is true: the ledger exports every record as one JSON file in an open format, documented in docs/export-format.md, so the books go with the owner. Change:
   - public/index.html, step 5 of "Try it in one minute": "press Export to download the records Imali AI can import" becomes "press Export to download every record as a JSON file".
   - docs/judges.md, step 5: drop "This is the file Imali AI can import." and say instead that the file holds every record in the format docs/export-format.md describes.
   - docs/export-format.md: the overview says the format lets an owner take every record to a smartphone app, with no claim that any app imports it; the "Questions?" section drops the claim and the link to imali.ai, which is not Imali AI's site and must never be linked. If the doc names Imali AI's site at all, it is https://imali-ai.ebenworks.co.

2. No public page or guide labels the demo as invented, fictional or not real. The data stays invented (that rule in product.md does not change); only the labels go. Change:
   - public/index.html: remove the note "Everything here is invented demo data." under the ledger card buttons, and its style rule if nothing else uses it.
   - docs/judges.md: remove "Everything on it is invented demo data." from the opening, and where it says a new demo shop has "invented records", say it already has records (or a week of records) instead.
   Update any test, requirement or task in the browser-phone spec that expects the removed note or the old step 5 wording, and add a ticked task for this change.

Do not change README.md, docs/built-with-kiro.md, anything in docs/kiro-briefs/ or anything in .kiro/steering/. Run `npm run typecheck`, `npx vitest run --maxWorkers=4`, `npm run check:screens` and `npm run build`, fix anything that fails, and end with the files you changed and the test count. Do not run git commit.
