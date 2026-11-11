# Spelling and Grammar Check – Adobe Express add-on (LanguageTool)

## Run it
    npm install
    npm run start      # then open Adobe Express > Add-ons > enable "Add-on testing" and connect to the local dev server
    npm run package    # builds a .zip to submit/share

## How it works
- `src/sandbox/code.js` – document sandbox: walks pages → artboards → groups, collects text nodes, applies fixes, selects a node on the canvas.
- `src/index.js` – panel UI: batches text into ≤15 KB chunks, calls `POST https://api.languagetool.org/v2/check`, maps matches back to individual text boxes, and shows fix suggestions.

## Notes
- Free API limits: 20 requests/min, 20 KB/request, 75 KB/min. For heavier use, point `API` at a Premium endpoint or your own LanguageTool server.
- Applying a fix rewrites the whole text box's content, so mixed styling inside one box (e.g. one bold word) may be flattened.
- Language auto-detect prefers en-GB, de-DE, pt-PT, ca-ES variants (edit `preferredVariants` in `index.js`).
- Text leaves the user's machine; mention this in your add-on's privacy policy before publishing.
