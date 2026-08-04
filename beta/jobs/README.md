# Core job instances

`001.json`–`003.json` are immutable production-relevant runner inputs. Each job binds the raw source, the generated reference-pack JSON, every pack derivative by its declared SHA-256, versioned prompt templates, fixed model route, quality benchmarks and an isolated live output directory.

The runner resolves paths relative to the job file. `path_base: ".."` is explicit because the generated pack stores project-root-relative binding paths.

The live Higgsfield adapter fails closed unless an explicit semantic `qaEvaluator` is configured. This prevents a newly generated image from inheriting approval belonging to the checked-in sample. `--mock` and `--replay` are control-flow tests only and must not write into approved `output/`.
