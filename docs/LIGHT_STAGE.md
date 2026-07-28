# Light Stage

`web/public/light-stage.js` is a portable, presentation-only component. It accepts an approved master image on a white background and renders a black-and-gold stage using a local alpha derivative.

The master input, approved-look hash, item locks, QA receipt, scenes, photo shoots and videos are never changed. The derivative is created in browser memory and must not be used as a generation input.

Integration:

```js
import { mountLightStage } from '/light-stage.js';
await mountLightStage(element, { imageUrl: approvedMasterUrl, alt: 'Approved look' });
```

The component removes only near-white pixels that are connected to the image edge. If a master lacks a clean white edge or canvas access is blocked by CORS, do not show the stage; show the original master instead. Never silently use a generative fallback.
