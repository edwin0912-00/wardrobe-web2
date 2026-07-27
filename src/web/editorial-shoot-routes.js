import { createReadStream } from 'node:fs';
import { isEditorialSha256 } from './editorial-shoot-contract.js';
import {
  EditorialContactSheetError,
  createEditorialContactSheetManifest,
} from './editorial-contact-sheet.js';
import { ProfileError } from './profile-service.js';

const TERMINAL_SHOOT_STATES = new Set(['COMPLETED', 'CANCELLED']);

function sameOriginMutation(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ProfileError(403, 'INVALID_ORIGIN', 'Invalid profile mutation origin');
  }
  const requestHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '')
    .split(',')[0]
    .trim();
  if (!requestHost || originHost !== requestHost) {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
}

function idempotencyKey(request) {
  const value = request.headers['idempotency-key'];
  // The key travels as a header, so "you sent none" and "the one you sent is the wrong
  // length" have to be two different sentences. A client told only that the key must
  // contain between 8 and 256 characters goes looking for it in its JSON payload.
  if (value === undefined) {
    throw new ProfileError(
      422,
      'MISSING_IDEMPOTENCY_KEY',
      'Idempotency-Key request header is required',
    );
  }
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new ProfileError(
      422,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must contain between 8 and 256 characters',
    );
  }
  return value;
}

// An error may only name something the client can actually send. These routes read
// expected_bible_sha256 and expected_output_sha256, but the rejection came from the
// service asserting its own parameters and so named expectedBibleSha256 and
// expectedOutputSha256 — field names the API does not accept. A real client corrected
// exactly what the error named and got the identical error back.
function requiredSha256(body, field) {
  if (!isEditorialSha256(body?.[field])) {
    throw new ProfileError(
      422,
      'INVALID_EXPECTED_SHA256',
      `${field} must be a lowercase SHA-256`,
    );
  }
  return body[field];
}

function requiredMode(body) {
  const modeId = body?.mode_id;
  const modeVersion = body?.mode_version ?? body?.version;
  if (typeof modeId !== 'string' || typeof modeVersion !== 'string') {
    throw new ProfileError(
      422,
      'INVALID_EDITORIAL_MODE',
      'mode_id and mode_version are required',
    );
  }
  return { modeId, modeVersion };
}

function publicShot(shootId, shot) {
  return {
    slot: shot.slot,
    status: shot.status,
    retry_count: shot.retry_count,
    output: shot.output ? {
      sha256: shot.output.sha256,
      receipt_sha256: shot.output.receipt_sha256,
      width: shot.output.width,
      height: shot.output.height,
      media_type: shot.output.media_type,
      image_url: `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/shots/${encodeURIComponent(shot.slot)}/image`,
      download_url: `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/shots/${encodeURIComponent(shot.slot)}/download`,
    } : null,
    qa: shot.attempts.at(-1)?.qa ? {
      decision: shot.attempts.at(-1).qa.decision,
      gates: shot.attempts.at(-1).qa.gates,
      completed_at: shot.attempts.at(-1).qa.completed_at,
    } : null,
    error: shot.error ? {
      code: shot.error.code,
      message: shot.error.message,
    } : null,
  };
}

export function editorialShootView(shoot) {
  if (!shoot) return null;
  const hero = shoot.shots.find((shot) => (
    shot.slot === 'clean_identity_hero' && shot.output
  ));
  const heroBaseUrl = `/api/profile/editorial-shoots/${encodeURIComponent(shoot.shoot_id)}/shots/clean_identity_hero`;
  return {
    shoot_id: shoot.shoot_id,
    look_id: shoot.bindings.approved_look.look_id,
    status: shoot.status,
    phase: shoot.phase,
    message: shoot.message,
    created_at: shoot.created_at,
    updated_at: shoot.updated_at,
    mode: {
      mode_id: shoot.bindings.shoot_bible.mode_id,
      version: shoot.bindings.shoot_bible.mode_version,
      ui_name_uk: shoot.bindings.shoot_bible.title,
      visual_system: shoot.bindings.shoot_bible.visual_system,
    },
    bible: {
      bible_id: shoot.bindings.shoot_bible.bible_id,
      sha256: shoot.bindings.shoot_bible.sha256,
      approval_status: shoot.bible_approval ? 'APPROVED' : 'PENDING',
      url: `/api/profile/editorial-shoots/${encodeURIComponent(shoot.shoot_id)}/bible`,
    },
    hero_approval_status: shoot.hero_approval ? 'APPROVED' : (
      shoot.status === 'HERO_PENDING_APPROVAL' ? 'PENDING' : 'BLOCKED'
    ),
    // approve-hero binds expected_output_sha256, and the only copy of that hash in this
    // response used to sit inside shots[], behind a slot name the client had to know to
    // match. The bible block already carries the hash its own approval binds; a client
    // driving the hero gate from the hero block found nothing to bind and stalled.
    hero_output_sha256: hero ? hero.output.sha256 : null,
    hero_image_url: hero ? `${heroBaseUrl}/image` : null,
    hero_download_url: hero ? `${heroBaseUrl}/download` : null,
    shots: shoot.shots.map((shot) => publicShot(shoot.shoot_id, shot)),
    cancellation: shoot.cancellation ? {
      reason: shoot.cancellation.reason,
      cancelled_at: shoot.cancellation.cancelled_at,
    } : null,
  };
}

async function currentOwnedShoot({
  profiles,
  profileId,
  editorialShootService,
  shootId,
}) {
  const projection = profiles.editorialShootProjection(profileId, shootId);
  if (!projection) return null;
  const shoot = await editorialShootService.getShoot(shootId);
  if (!shoot || shoot.bindings.approved_look.look_id !== projection.look_id) return null;
  profiles.syncEditorialShootProjection(shoot);
  return shoot;
}

export async function registerEditorialShootRoutes(app, {
  editorialShootService,
  profiles,
  profileApi,
  runService,
  presetResolver,
  sceneService,
} = {}) {
  if (!editorialShootService
    || !profiles
    || !profileApi
    || !runService
    || !presetResolver
    || !sceneService) {
    throw new Error(
      'registerEditorialShootRoutes requires editorialShootService, profiles, profileApi, runService, presetResolver and sceneService',
    );
  }

  for (const projection of profiles.editorialShootProjectionRecords()) {
    const shoot = await editorialShootService.getShoot(projection.shoot_id);
    if (shoot?.bindings.approved_look.look_id === projection.look_id) {
      profiles.syncEditorialShootProjection(shoot);
    } else {
      profiles.deleteEditorialShoot(projection.profile_id, projection.shoot_id);
    }
  }
  await profiles.flushDeletionQueue({
    runService,
    sceneService,
    editorialShootService,
  });

  // Three of these POST routes carry a body and two do not, and clients set
  // application/json for all five. Fastify answers a bodyless retry with
  // FST_ERR_CTP_EMPTY_JSON_BODY — a framework code naming no field and no header — and
  // it answers before the handler runs, so an approval that was also missing
  // Idempotency-Key never got to hear about the header. Here an empty JSON body means
  // "no fields", and whatever the route needs is then refused by its own wire name.
  // The parser only delegates, so proto-poisoning and malformed-JSON behaviour stay
  // exactly Fastify's, and it lives in this plugin's own encapsulation, so no other API
  // on the server changes shape.
  await app.register(async (app) => {
    const parseJsonBody = app.getDefaultJsonParser('error', 'error');
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (request, body, done) => {
        if (body === '') {
          done(null, {});
          return;
        }
        parseJsonBody(request, body, done);
      },
    );

    app.get('/api/profile/looks/:lookId/editorial-shoots', async (request, reply) => {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoots = profiles.listEditorialShoots(session.profileId, request.params.lookId);
      if (shoots === null) return reply.code(404).send({ error: 'Look not found' });
      const resolved = [];
      for (const projection of shoots) {
        const shoot = await editorialShootService.getShoot(projection.shoot_id);
        if (shoot?.bindings.approved_look.look_id === request.params.lookId) {
          profiles.syncEditorialShootProjection(shoot);
          resolved.push(editorialShootView(shoot));
        }
      }
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Cookie')
        .send({ editorial_shoots: resolved });
    });

    app.post('/api/profile/looks/:lookId/editorial-shoots', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const approvedLookReference = await profiles.approvedLookReference(
        session.profileId,
        request.params.lookId,
        runService,
      );
      const { modeId, modeVersion } = requiredMode(request.body);
      const key = idempotencyKey(request);
      const shootBible = await presetResolver.compileEditorialShootBible({
        modeId,
        version: modeVersion,
      });
      const shoot = await editorialShootService.createShoot({
        idempotencyKey: key,
        approvedLookReference,
        shootBible,
      });
      profiles.projectEditorialShoot(
        session.profileId,
        request.params.lookId,
        shoot,
      );
      const latest = await editorialShootService.getShoot(shoot.shoot_id);
      if (latest) profiles.syncEditorialShootProjection(latest);
      return reply
        .code(202)
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Cookie')
        .send(editorialShootView(latest ?? shoot));
    });

    app.get('/api/profile/editorial-shoots/:shootId', async (request, reply) => {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoot = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!shoot) return reply.code(404).send({ error: 'Editorial shoot not found' });
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Cookie')
        .send(editorialShootView(shoot));
    });

    app.get('/api/profile/editorial-shoots/:shootId/contact-sheet', async (request, reply) => {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoot = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!shoot) return reply.code(404).send({ error: 'Editorial shoot not found' });
      try {
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('Vary', 'Cookie')
          .send(createEditorialContactSheetManifest(shoot));
      } catch (error) {
        if (error instanceof EditorialContactSheetError) {
          return reply.code(error.statusCode).send({
            error: error.message,
            code: error.code,
          });
        }
        throw error;
      }
    });

    app.get('/api/profile/editorial-shoots/:shootId/bible', async (request, reply) => {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoot = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!shoot) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const bible = await editorialShootService.getShootBible(request.params.shootId);
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Cookie')
        .send({
          sha256: shoot.bindings.shoot_bible.sha256,
          bible,
        });
    });

    app.get('/api/profile/editorial-shoots/:shootId/events', async (request, reply) => {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const projection = profiles.editorialShootProjection(
        session.profileId,
        request.params.shootId,
      );
      if (!projection) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const buffered = [];
      let live = false;
      let closed = false;
      let heartbeat = null;
      let unsubscribe = () => {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
      };
      const send = (value) => {
        if (closed) return;
        reply.raw.write(`event: shoot\ndata: ${JSON.stringify(editorialShootView(value))}\n\n`);
        if (TERMINAL_SHOOT_STATES.has(value.status)) {
          cleanup();
          reply.raw.end();
        }
      };
      const listener = (value) => {
        if (value?.bindings?.approved_look?.look_id !== projection.look_id) return;
        profiles.syncEditorialShootProjection(value);
        if (live) send(value);
        else buffered.push(value);
      };
      unsubscribe = editorialShootService.subscribe(request.params.shootId, listener);
      const snapshot = await editorialShootService.getShoot(request.params.shootId);
      if (!snapshot || snapshot.bindings.approved_look.look_id !== projection.look_id) {
        unsubscribe();
        return reply.code(404).send({ error: 'Editorial shoot not found' });
      }
      profiles.syncEditorialShootProjection(snapshot);
      const setCookie = reply.getHeader('set-cookie');
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'private, no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        Vary: 'Cookie',
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      });
      send(snapshot);
      if (closed) return reply;
      live = true;
      const bufferedTail = buffered.at(-1);
      if (bufferedTail
        && bufferedTail.updated_at >= snapshot.updated_at
        && JSON.stringify(bufferedTail) !== JSON.stringify(snapshot)) {
        send(bufferedTail);
      }
      if (!closed) {
        heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
        request.raw.on('close', cleanup);
      }
      return reply;
    });

    app.post('/api/profile/editorial-shoots/:shootId/approve-bible', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const owned = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!owned) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const key = idempotencyKey(request);
      const expectedBibleSha256 = requiredSha256(request.body, 'expected_bible_sha256');
      const shoot = await editorialShootService.approveBible(request.params.shootId, {
        idempotencyKey: key,
        expectedBibleSha256,
      });
      profiles.syncEditorialShootProjection(shoot);
      return reply.code(202).send(editorialShootView(shoot));
    });

    app.post('/api/profile/editorial-shoots/:shootId/approve-hero', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const owned = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!owned) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const key = idempotencyKey(request);
      const expectedOutputSha256 = requiredSha256(request.body, 'expected_output_sha256');
      const shoot = await editorialShootService.approveHero(request.params.shootId, {
        idempotencyKey: key,
        expectedOutputSha256,
      });
      profiles.syncEditorialShootProjection(shoot);
      return reply.code(202).send(editorialShootView(shoot));
    });

    app.post('/api/profile/editorial-shoots/:shootId/shots/:slot/retry', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const owned = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!owned) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const shoot = await editorialShootService.retryShot(
        request.params.shootId,
        request.params.slot,
        { idempotencyKey: idempotencyKey(request) },
      );
      profiles.syncEditorialShootProjection(shoot);
      return reply.code(202).send(editorialShootView(shoot));
    });

    app.post('/api/profile/editorial-shoots/:shootId/cancel', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const owned = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!owned) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const shoot = await editorialShootService.cancelShoot(
        request.params.shootId,
        'Cancelled by profile owner',
      );
      profiles.syncEditorialShootProjection(shoot);
      return reply.code(202).send(editorialShootView(shoot));
    });

    app.delete('/api/profile/editorial-shoots/:shootId', async (request, reply) => {
      sameOriginMutation(request);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoot = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!shoot) return reply.code(404).send({ error: 'Editorial shoot not found' });
      if (shoot && !TERMINAL_SHOOT_STATES.has(shoot.status)) {
        try {
          await editorialShootService.cancelShoot(
            request.params.shootId,
            'Deleted by profile owner',
          );
        } catch (error) {
          if (error?.code !== 'EDITORIAL_SHOOT_NOT_CANCELLABLE') throw error;
        }
        await editorialShootService.waitForIdle(request.params.shootId);
      }
      profiles.deleteEditorialShoot(session.profileId, request.params.shootId);
      await profiles.flushDeletionQueue({
        runService,
        sceneService,
        editorialShootService,
      });
      return reply.code(204).send();
    });

    async function serveShot(request, reply, disposition) {
      const session = await profileApi.resolveRequestProfile(request, reply);
      const shoot = await currentOwnedShoot({
        profiles,
        profileId: session.profileId,
        editorialShootService,
        shootId: request.params.shootId,
      });
      if (!shoot) return reply.code(404).send({ error: 'Editorial shoot not found' });
      const filename = await editorialShootService.outputFile(
        request.params.shootId,
        request.params.slot,
      );
      if (!filename) return reply.code(404).send({ error: 'Editorial shot image not found' });
      return reply
        .type('image/png')
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Cookie')
        .header('Content-Disposition', `${disposition}; filename="${request.params.slot}.png"`)
        .send(createReadStream(filename));
    }

    app.get('/api/profile/editorial-shoots/:shootId/shots/:slot/image', async (
      request,
      reply,
    ) => serveShot(request, reply, 'inline'));
    app.get('/api/profile/editorial-shoots/:shootId/shots/:slot/download', async (
      request,
      reply,
    ) => serveShot(request, reply, 'attachment'));
  });
}
