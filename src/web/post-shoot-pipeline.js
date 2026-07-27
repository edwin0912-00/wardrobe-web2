import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const defaultRoot = path.resolve(import.meta.dirname, '..', '..');

export async function loadPostShootPipeline({ projectRoot = defaultRoot } = {}) {
  const [schemaText, pipelineText] = await Promise.all([
    readFile(path.join(projectRoot, 'schemas', 'post-shoot-pipeline.schema.json'), 'utf8'),
    readFile(path.join(projectRoot, 'config', 'post-shoot-pipeline.json'), 'utf8'),
  ]);
  const schema = JSON.parse(schemaText);
  const pipeline = JSON.parse(pipelineText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(pipeline)) {
    const detail = validate.errors.map((item) => `${item.instancePath || '/'} ${item.message}`).join('; ');
    throw new Error(`Invalid post-shoot pipeline: ${detail}`);
  }
  assertGraph(pipeline);
  return structuredClone(pipeline);
}

export function assertGraph(pipeline) {
  const ids = pipeline.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Post-shoot node ids must be unique');
  const known = new Set(ids);
  for (const node of pipeline.nodes) {
    for (const target of node.next) {
      if (!known.has(target)) throw new Error(`Post-shoot node ${node.id} targets missing node ${target}`);
    }
  }
  for (const mode of pipeline.modes) {
    for (const nodeId of mode.nodes) {
      if (!known.has(nodeId)) throw new Error(`Mode ${mode.id} references missing node ${nodeId}`);
    }
  }
  const live = pipeline.modes.find((mode) => mode.id === 'live_webcam');
  if (!live?.billable || live.price_usd_per_second !== 0.04 || live.max_session_seconds !== 5) {
    throw new Error('Lucy live mode must expose price and a hard session ceiling');
  }
  return true;
}

export function publicPostShootPipeline(pipeline) {
  return {
    schema_version: pipeline.schema_version,
    pipeline_id: pipeline.pipeline_id,
    source_contract: pipeline.source_contract,
    modes: pipeline.modes,
    nodes: pipeline.nodes,
    provider_ready: false,
  };
}
