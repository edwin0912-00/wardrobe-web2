/*
 * A small presentation-neutral WebRTC session over beta's short-lived Live token.
 * It contains no DOM, copy or visual assumptions: the mirror owns those.  The server
 * remains the authority for the selected app, duration and every credential.
 */
import falModule from '../vendor/fal-client.js';

const fal = falModule?.fal ?? falModule?.default?.fal;
const LIVE_PROMPT = 'Replace only the current clothing with the outfit from the reference image. Preserve the person face, identity, hair, skin, body shape, pose and hands. Preserve the existing room, background, camera angle and lighting. Do not modify anything except the clothing.';

function messageType(value) {
  return String(value?.type ?? '').toLowerCase().replaceAll('_', '');
}

function asError(value, fallback = 'LIVE_CONNECTION_FAILED') {
  return value instanceof Error ? value : new Error(String(value || fallback));
}

export async function startRealtimeLook({
  bridge,
  stream,
  onRemoteStream = () => {},
  onState = () => {},
  onError = () => {},
} = {}) {
  if (!bridge || typeof bridge.state !== 'function' || typeof bridge.startLive !== 'function') {
    throw new TypeError('Live requires a CinematicUiBridge');
  }
  if (!stream?.getTracks || !fal?.realtime?.connect) throw new Error('LIVE_UNAVAILABLE');
  const state = bridge.state();
  const capability = state.liveCapability;
  const app = String(capability?.app ?? capability?.default_app ?? '');
  const seconds = Number(capability?.consent?.maximum_session_seconds);
  if (!app || !Number.isFinite(seconds) || seconds <= 0 || capability?.paid_live_ready !== true) {
    throw new Error('LIVE_UNAVAILABLE');
  }
  if (typeof bridge.loadLiveReference !== 'function') throw new Error('LIVE_REFERENCE_UNAVAILABLE');

  const referenceImage = await bridge.loadLiveReference();
  let peer = null;
  let connection = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { peer?.close(); } catch {}
    try { connection?.close(); } catch {}
    peer = null;
    connection = null;
  };

  const fail = (error) => {
    if (stopped) return;
    onError(asError(error));
    stop();
  };

  async function signal(result) {
    if (stopped) return;
    const type = messageType(result);
    if (type === 'iceservers' || Array.isArray(result?.iceservers) ||
        Array.isArray(result?.iceServers) || Array.isArray(result?.ice_servers)) {
      if (peer) return;
      const servers = result.iceservers || result.iceServers || result.ice_servers || [];
      peer = new RTCPeerConnection({ iceServers: servers });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => onRemoteStream(event.streams[0] || new MediaStream([event.track]));
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === 'failed') fail(new Error('LIVE_CONNECTION_FAILED'));
        else if (peer?.connectionState === 'connected') onState({ phase: 'active', seconds });
      };
      peer.onicecandidate = (event) => {
        if (event.candidate && !stopped) connection?.send({ type: 'icecandidate', candidate: event.candidate.toJSON() });
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      connection?.send({ type: 'offer', sdp: offer.sdp });
      return;
    }
    if (type === 'answer' || (result?.sdp && peer?.localDescription)) {
      await peer?.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      return;
    }
    if ((type === 'icecandidate' || (result?.candidate && !result?.sdp)) && peer) {
      await peer.addIceCandidate(new RTCIceCandidate(result.candidate));
      return;
    }
    if (result?.error || type === 'error' || ((type === 'promptack' || type === 'setimageack') && result.success === false)) {
      throw new Error(result.error || 'LIVE_CONNECTION_FAILED');
    }
  }

  onState({ phase: 'connecting', seconds });
  connection = fal.realtime.connect(app, {
    connectionKey: `wardrobe-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    throttleInterval: 0,
    tokenExpirationSeconds: 10,
    tokenProvider: () => bridge.startLive({ privacyConsent: true, costAcknowledged: true }),
    onResult: (result) => { void signal(result).catch(fail); },
    onError: fail,
  });
  connection.send({ prompt: LIVE_PROMPT, reference_image_url: referenceImage, enable_prompt_expansion: false });
  return { stop, seconds };
}
