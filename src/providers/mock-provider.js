// Valid 3x3 opaque sRGB RGB PNG, used only by an explicitly selected mock provider.
// Its white border and dark center make it suitable for decode and white-normalization tests.
export const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQImWP4DwMM////19DQgLIgAABtzRhhmlbJTQAAAABJRU5ErkJggg==',
  'base64',
);

function scripted(script, operation, context, fallback) {
  const handler = script?.[operation];
  if (typeof handler === 'function') return handler(context);
  if (Array.isArray(handler)) {
    if (handler.length === 0) throw new Error(`Mock script exhausted for ${operation}`);
    const next = handler.shift();
    if (next instanceof Error) throw next;
    return structuredClone(next);
  }
  if (handler !== undefined) return structuredClone(handler);
  return fallback();
}

export class MockProvider {
  constructor({ script = {}, image = MOCK_PNG } = {}) {
    this.script = script;
    this.image = image;
    this.calls = [];
  }

  async condition(context) {
    this.calls.push({ operation: 'condition', context });
    return scripted(this.script, 'condition', context, async () => {
      if (context.role === 'identity' || context.source?.path) {
        return {
          reference: { path: context.source.path },
          extension: context.source.extension ?? '.bin',
          mediaType: context.source.mediaType ?? 'application/octet-stream',
          facts: { role: context.role, conditioned: true },
          risks: [],
        };
      }
      return {
        facts: { role: context.role, conditioned: true, text: context.source?.text },
        risks: [],
      };
    });
  }

  async generate(context) {
    this.calls.push({ operation: 'generate', context });
    return scripted(this.script, 'generate', context, () => ({
      image: this.image,
      extension: '.png',
      mediaType: 'image/png',
      metadata: {
        mock: true,
        model: context.model,
        model_name: context.model_name,
        job_set_type: context.job_set_type,
      },
    }));
  }

  async qa(context) {
    this.calls.push({ operation: 'qa', context });
    return scripted(this.script, 'qa', context, () => ({
      decision: 'PASS',
      checks: [{ name: 'MOCK', pass: true }],
      defects: [],
      reason: 'Explicit mock provider auto-pass',
    }));
  }
}
