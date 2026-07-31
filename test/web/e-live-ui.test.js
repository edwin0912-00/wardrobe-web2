import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [indexSource, appSource, liveHtml, liveClient] = await Promise.all([
  readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/post-shoot-mvp.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/post-shoot-mvp.js', import.meta.url), 'utf8'),
]);

test('saved-look E-Live CTA opens one full-viewport surface with real capability state', () => {
  assert.match(indexSource, /id="profile-look-live"[^>]*disabled/);
  assert.match(indexSource, /id="profile-look-live-state"/);
  assert.doesNotMatch(indexSource, /id="profile-live-frame"/);
  assert.doesNotMatch(indexSource, /title="Live примірка вибраного образу"/);
  assert.match(appSource, /\/api\/post-shoot\/realtime-look-capability\?look_id=/);
  assert.match(appSource, /payload\?\.launch\?\.presentation === 'FULL_VIEWPORT'/);
  assert.match(appSource, /payload\?\.consent\?\.privacy_required === true/);
  assert.match(appSource, /payload\?\.consent\?\.cost_required === true/);
  assert.match(appSource, /launchUrl\.searchParams\.set\('return', 'profile'\)/);
});

test('camera cannot start before explicit privacy consent', () => {
  assert.match(liveHtml, /id="privacy-gate-consent"/);
  assert.match(liveHtml, /id="privacy-consent"/);
  assert.match(liveHtml, /id="cost-consent"/);
  assert.match(liveHtml, /id="privacy-continue"[^>]*disabled/);
  assert.match(liveHtml, /id="camera-start"[^>]*disabled/);
  const consentGate = liveClient.indexOf("if (!$('#privacy-consent').checked)");
  const mediaRequest = liveClient.indexOf('navigator.mediaDevices.getUserMedia');
  assert.ok(consentGate >= 0 && mediaRequest > consentGate);
  assert.match(liveClient, /\$\('#privacy-consent'\)\.checked = true/);
  assert.match(liveClient, /\$\('#privacy-gate'\)\.classList\.add\('hidden'\)/);
});

test('saved look uses the verified Live reference and paid start remains separately confirmed', () => {
  assert.match(liveClient, /\/api\/profile\/looks\/\$\{encodeURIComponent\(lookId\)\}\/live-reference\.png/);
  assert.match(liveClient, /id="cost-consent"|cost-consent/);
  assert.match(liveClient, /privacy_consent: true/);
  assert.match(liveClient, /look_id: selectedLookId/);
  assert.match(liveClient, /cost_acknowledged: true/);
});

test('close, Escape and pagehide tear down camera without hidden recording', () => {
  assert.match(liveHtml, /data-live-close/);
  assert.match(liveClient, /document\.querySelectorAll\('\[data-live-close\]'\)/);
  assert.match(liveClient, /event\.key !== 'Escape'/);
  assert.match(liveClient, /window\.addEventListener\('pagehide'/);
  assert.match(liveClient, /state\.stream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(liveClient, /\$\('#camera'\)\.srcObject = null/);
  assert.doesNotMatch(liveClient, /MediaRecorder|captureStream|toBlob|toDataURL/);
  assert.match(appSource, /LIVE_RETURN_FOCUS_KEY/);
  assert.match(appSource, /document\.querySelector\('#profile-look-live'\)\?\.focus/);
});
