# XST Graphic — site

Static site (no build step). `index.html` + `styles.css` + `scene.js`, assets under `assets/`.

## Local preview
```
node serve.mjs
```
Serves at http://localhost:3000.

## Deploy to Vercel
Push this repo to GitHub, then import it in Vercel. No framework preset needed — leave Build Command empty and set Output Directory to `.` (root), since this is plain static HTML/CSS/JS.
