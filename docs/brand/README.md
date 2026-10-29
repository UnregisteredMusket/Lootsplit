# Lootsplitter brand set

The owner's mascot brand set (2026-10-23), made with ChatGPT image generation from the owner's draft. These are the masters; the website uses resized copies in `public/brand/`.

| File | Use |
| --- | --- |
| `01-mascot-chase-2048.png` | Mascot illustration (kobold stealing the coin, fighter chasing). Home page maker's note, social posts. Upscaled from a 1254 px source; not a vector. |
| `02-kobold-icon-1024.png` | Small mark, transparent. Website header logo and loader. |
| `03-kobold-icon-navy-circle-1024.png` | Small mark on a navy circle. Favicon and structured-data logo. |
| `04-kobold-icon-parchment-1024.png` | One-colour parchment mark for dark backgrounds, notification icons and widgets. |
| `05-wordmark-gold.png` | Gold serif wordmark. Not used on the site, which sets "Lootsplitter" as live Cormorant text. |

Derived layers: `public/brand/chase-adventurer.webp` and `public/brand/chase-kobold.webp` (640 × 460, WebP with alpha, about 40 KB each) are the two figures of `01` cut apart for the large-campaign loading screen (`src/components/campaign-loading.tsx`). Both keep the master's full canvas (cropped to the art plus 8 px), so stacked at rest they are the mascot. The cut is by connected shapes: the adventurer and the kobold are separate shapes in the master; the three motion lines and loose specks go with the nearest figure (the lines with the kobold).

Palette: navy #0C1424 / #0A111E, parchment #F3E9D2 / #FBF5E6, gold #DFBB78, deep gold #6D5A35, dark text #1D1622, rust #7C3224.

Still to do: the Android launcher icon (adaptive icon: foreground from `02`, navy background) and widget icons ship with the next Android release. They need a version bump, so they are not part of the website change.

AI-generated artwork generally cannot be registered for copyright in the US; the name and marks can still be used as trademarks.
