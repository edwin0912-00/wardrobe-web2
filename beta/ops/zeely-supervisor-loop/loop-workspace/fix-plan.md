# Fix plan

Before evidence: persisted run `c8780403-9adf-43d7-a600-653b751b8a75` reached `GARMENT_CONDITIONING`, then `NEEDS_INPUT` with `DUPLICATE_SLOT` for source indexes `[0,1]`; both VLM observations described the same blue/white pinstriped shirt. Provider generation never started.

Root-cause area: `src/web/garment-passport.js` treated every repeated non-accessory category as two logical garments. Add an explicit strict reference-set partition, validate it fail-closed, condition one logical set once with all ordered views, and retain source provenance.

Verification: targeted grouping/evaluator/run/supervisor tests, contract validation, full `npm test`, then retry the immutable run without re-upload.
