import { readFile } from 'node:fs/promises';
import { editorialBlockingReference } from './editorial-blocking-reference.js';
import {
  EDITORIAL_QA_GATES,
  sha256,
} from './editorial-shoot-contract.js';

const TERMINAL_SCENE_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function abortError() {
  const error = new Error('Editorial shot execution cancelled');
  error.name = 'AbortError';
  return error;
}

function sceneIdForIdempotencyKey(idempotencyKey) {
  return `scene_${sha256(idempotencyKey).slice(0, 48)}`;
}

function exactGates(gates) {
  if (!Array.isArray(gates) || gates.length !== EDITORIAL_QA_GATES.length) {
    throw new Error('SceneService did not return all nine editorial QA gates');
  }
  return EDITORIAL_QA_GATES.map((id, index) => {
    const gate = gates[index];
    if (gate?.id !== id || !['PASS', 'FAIL'].includes(gate.decision)) {
      throw new Error(`SceneService editorial QA gate ${id} is invalid`);
    }
    return {
      id,
      decision: gate.decision,
      evidence: String(gate.evidence ?? `${id} evidence unavailable`).slice(0, 2_000),
      defects: Array.isArray(gate.defects)
        ? gate.defects.map((defect) => String(defect).slice(0, 300)).slice(0, 30)
        : [],
    };
  });
}

/**
 * Production bridge from EditorialShootService to the existing SceneService.
 * SceneService remains the only image generator, nine-gate judge and output
 * integrity authority. This adapter only compiles the immutable per-shot
 * SceneSpec and binds the resulting receipt back to the ShootBible hashes.
 */
export class EditorialSceneExecutor {
  constructor({ sceneService, presetResolver }) {
    if (!sceneService?.createScene
      || !sceneService?.verifiedExecutionResult
      || !sceneService?.outputFile) {
      throw new Error('EditorialSceneExecutor requires a production SceneService');
    }
    if (!presetResolver?.editorialShotPresetReference) {
      throw new Error('EditorialSceneExecutor requires an editorial preset resolver');
    }
    this.sceneService = sceneService;
    this.presetResolver = presetResolver;
  }

  /**
   * The image anchors this shot conditions on, over and above its approved look.
   *
   * The blocking diagram is static per slot, so every shoot gets the same six. The
   * hero frame only exists for the five shots that follow the hero, and it is our own
   * output from this very shoot — which is what makes it usable at all where an
   * environment plate is not: the plate is the human approval preview and the
   * compiled environment facts forbid reconstructing one, while a frame the shoot has
   * already rendered and had approved is the reality the remaining five are supposed
   * to be standing in. Without it each of the six invented its own version of the
   * place and continuity was only ever hash-checked, never conditioned.
   */
  async #shotAnchors(context) {
    // This is a diagram for this exact slot, not a mood board: its hash-bound
    // numbers are verified against the slot's camera/framing lock before it is
    // attached. Create Universe's style sheets deliberately do not control a body
    // pose, so omitting this only made the provider infer the pose from prose.
    // The anchor controls geometry only; identity, hair, outfit and style remain
    // governed by their separate immutable inputs.
    const anchors = [await editorialBlockingReference({ shotSpec: context.shot_spec })];
    const hero = context.hero_output;
    if (hero) {
      const filename = await this.outputFile({
        resourceId: hero.resource_id,
        expectedSha256: hero.sha256,
        expectedReceiptSha256: hero.receipt_sha256,
      });
      // A series shot cannot honestly claim continuity with a frame it cannot read,
      // and the alternative — generate anyway and record the omission — spends a paid
      // generation on the one thing the shoot exists to deliver. The hero frame is
      // immutable and never pruned, so this is a real fault, not a fallback.
      if (!filename) {
        throw new Error('Approved editorial hero frame is unavailable for continuity conditioning');
      }
      anchors.push({
        role: 'hero_continuity_anchor',
        reference_id: `hero.${hero.resource_id}`,
        media_type: 'image/png',
        sha256: hero.sha256,
        data: await readFile(filename),
      });
    }
    return anchors;
  }

  async executeShot(context) {
    if (context.signal?.aborted) throw abortError();
    const expectedSceneId = sceneIdForIdempotencyKey(context.idempotency_key);
    // A resumed parent attempt may be recovering from a failure that happened
    // after SceneService had already completed and persisted the paid child
    // generation. Re-open that immutable execution before recompiling current
    // preset inputs: release metadata may have evolved since the original job,
    // while its deterministic address and verified receipt remain authoritative.
    let scene = context.reuse_existing_execution
      ? await this.sceneService.getScene(expectedSceneId)
      : null;
    if (!scene) {
      const presetReference = await this.presetResolver.editorialShotPresetReference({
        modeId: context.shoot_bible.mode_id,
        version: context.shoot_bible.mode_version,
        shotSpec: context.shot_spec,
      });
      const shotAnchorReferences = await this.#shotAnchors(context);
      scene = await this.sceneService.createScene({
        idempotencyKey: context.idempotency_key,
        approvedLookReference: context.approved_look,
        presetReference,
        shotAnchorReferences,
      });
    }
    if (scene.scene_id !== expectedSceneId) {
      throw new Error('SceneService returned a non-deterministic editorial execution id');
    }

    let cancellation = null;
    const cancel = () => {
      cancellation ??= Promise.resolve()
        .then(async () => {
          const current = await this.sceneService.getScene(expectedSceneId);
          if (current && !TERMINAL_SCENE_STATES.has(current.status)) {
            await this.sceneService.cancelScene(
              expectedSceneId,
              'Parent editorial shoot was cancelled',
            );
          }
        })
        .catch(() => undefined);
    };
    context.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (context.signal?.aborted) cancel();
      scene = await this.sceneService.waitForIdle(expectedSceneId);
      if (context.signal?.aborted || scene?.status === 'CANCELLED') {
        await cancellation;
        throw abortError();
      }
      if (!scene || !['COMPLETED', 'FAILED'].includes(scene.status)) {
        throw new Error('SceneService editorial execution did not reach a terminal QA state');
      }
      const evidence = await this.sceneService.verifiedExecutionResult(expectedSceneId);
      if (!evidence || !['PASS', 'FAIL'].includes(evidence.decision)) {
        throw new Error('SceneService editorial execution evidence is unavailable');
      }
      const gates = exactGates(evidence.gates);
      const reviewerId = String(evidence.reviewer?.id ?? 'scene_qa_router')
        .replaceAll(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 128);
      return {
        decision: evidence.decision,
        execution_id: expectedSceneId,
        output: evidence.output,
        qa: {
          decision: evidence.decision,
          candidate_sha256: evidence.candidate_sha256,
          approved_look_sha256: context.approved_look.image_sha256,
          bible_sha256: context.shoot_bible.sha256,
          shot_spec_sha256: context.shot_spec_sha256,
          gates,
          reviewer: {
            id: reviewerId || 'scene_qa_router',
            version: String(evidence.reviewer?.version ?? 'scene-qa-router-v1').slice(0, 200),
            request_id: `editorial_review_${sha256([
              expectedSceneId,
              evidence.candidate_sha256,
              context.shot_spec_sha256,
            ].join(':')).slice(0, 48)}`,
          },
          completed_at: evidence.completed_at,
        },
      };
    } finally {
      context.signal?.removeEventListener('abort', cancel);
    }
  }

  async outputFile({
    resourceId,
    expectedSha256,
    expectedReceiptSha256,
  }) {
    const scene = await this.sceneService.getScene(resourceId);
    if (!scene
      || scene.status !== 'COMPLETED'
      || scene.output?.sha256 !== expectedSha256
      || scene.output?.qa_receipt_sha256 !== expectedReceiptSha256) {
      return null;
    }
    const filename = await this.sceneService.outputFile(resourceId, 'scene.png');
    if (!filename) return null;
    const bytes = await readFile(filename);
    if (sha256(bytes) !== expectedSha256) return null;
    return filename;
  }

  async deleteExecution({
    executionId = null,
    idempotencyKey = null,
  }) {
    const sceneId = executionId ?? (
      idempotencyKey ? sceneIdForIdempotencyKey(idempotencyKey) : null
    );
    if (!sceneId) return false;
    let scene = await this.sceneService.getScene(sceneId);
    if (!scene) return false;
    if (!TERMINAL_SCENE_STATES.has(scene.status)) {
      try {
        await this.sceneService.cancelScene(sceneId, 'Editorial shoot resource deleted');
      } catch (error) {
        if (error?.code !== 'SCENE_NOT_CANCELLABLE') throw error;
      }
      scene = await this.sceneService.waitForIdle(sceneId);
    }
    if (!scene || !TERMINAL_SCENE_STATES.has(scene.status)) {
      throw new Error('Editorial child scene did not stop before deletion');
    }
    return this.sceneService.deleteScene(sceneId);
  }
}

export function editorialSceneIdForIdempotencyKey(idempotencyKey) {
  return sceneIdForIdempotencyKey(idempotencyKey);
}
