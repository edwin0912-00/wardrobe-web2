import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../../web/public/post-shoot-mvp.js', import.meta.url), 'utf8');
function client(fetch) {
  const elements = new Map();
  const document = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { disabled: false, classList: { toggle() {} } });
    return elements.get(selector);
  } };
  const context = vm.createContext({ document, fetch, URLSearchParams,
    location: { search: '?look=look-1' }, createThinkingOrb: () => ({ setState() {} }),
    window: { isSecureContext: true }, navigator: { mediaDevices: { getUserMedia() { throw new Error('camera must not be requested'); } } },
    RTCPeerConnection: class {
      connectionState = 'connected';
      addTrack() {}
      async createOffer() { return { sdp: 'test-offer' }; }
      async setLocalDescription() {}
    },
  });
  const prefix = source.slice(source.indexOf('const MODEL_ID'), source.indexOf("$('#reference-upload').addEventListener"));
  vm.runInContext(prefix + '\nglobalThis.check = { ready, startCamera, loadReferenceUrl, signal, state };', context);
  return { ...context.check, elements };
}

test('a selected look cannot request the camera before its reference passes', async () => {
  const view = client(async () => { throw new Error('not requested'); });
  view.ready();
  assert.equal(view.elements.get('#camera-start').disabled, true);
  await assert.rejects(view.startCamera(), /повний перевірений образ/);
  view.state.reference = 'verified-reference';
  view.ready();
  assert.equal(view.elements.get('#camera-start').disabled, false);
});

test('an incomplete Live look explains required garments and never consumes image bytes', async () => {
  const view = client(async () => ({ ok: false, json: async () => ({ code: 'LIVE_REFERENCE_INCOMPLETE_LOOK' }),
    blob() { throw new Error('must not consume error as image'); },
  }));
  await assert.rejects(view.loadReferenceUrl('/reference', 'reference.png', 'READY'), /верх або сукню, низ і взуття/);
  view.ready();
  assert.equal(view.elements.get('#camera-start').disabled, true);
});

test('connection state cannot restore the waiting overlay after a remote track arrives', async () => {
  const view = client(async () => { throw new Error('not requested'); });
  view.state.stream = { getTracks: () => [] };
  view.state.connection = { send() {} };
  await view.signal({ type: 'ice_servers', iceServers: [] });
  view.state.peer.ontrack({ streams: [{ remote: true }] });
  const readyMessage = view.elements.get('#live-status').textContent;
  assert.match(readyMessage, /Real-time Look активний/);
  view.state.peer.onconnectionstatechange();
  assert.equal(view.elements.get('#live-status').textContent, readyMessage);
});
