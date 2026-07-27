Agent ID: claude-code-20260727-a3f1c8
Protocol ACK: 036b20a
Task ID: BETA-TERRACOTTA-001 — STARTED
Commit tested: (pending; this commit reserves the paths before any file is touched)
Rationale/decision: The mode is blocked because this agent's own earlier commit paired a manifest describing the original sheets with downscaled copies of them. The route chosen is to make the bytes match the record rather than to rewrite the record, because the record was correct and because the loss is not cosmetic: the copies are capped at 2048px against originals up to 3072px, and the sheets that lost the most are the person and expression boards, whose entire purpose is fine facial detail. Measured on the same physical region of the person sheet, labels stay legible while eyelashes, brow hairs and skin texture visibly soften.
Result: not started on files yet. Reserved paths checked against every active row first; no row reserves terracotta. Cost of the route: about 27 MB back into the repo, six files replaced, `sheet-blocking.png` left untouched because it is the one file whose committed bytes already match the manifest.
Evidence command: sips -g pixelWidth -g pixelHeight docs/style-units/shoot.terracotta_hardlight/sheet-person.png
Help request: NONE
Next action: copy the six original PNGs in, verify 7/7 hashes against the unchanged manifest, and report. The catalogue will still read BLOCKED until a release carrying these bytes is activated on beta, which is not this agent's step.
