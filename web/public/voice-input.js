// Voice input for the look description field.
//
// Behaviour, exactly as ruled by the operator on 2026-07-27:
// 1. While the user speaks, interim transcripts land in the field LIVE — the
//    text appears as the words are spoken, not after.
// 2. When the speech ends and the transcript has been committed into the
//    field, there is NO automatic Enter.
// 3. For five seconds after that commit, one short tap of the SAME button is
//    treated as Enter (form submit) — and only under those conditions. A tap
//    outside the window starts a new dictation instead; editing the field by
//    hand cancels the window.
//
// Recognition is the browser's own Web Speech API: no server, no key, no paid
// call, nothing leaves the page beyond what the browser itself does. Browsers
// without the API never see the button.

export const TAP_ENTER_WINDOW_MS = 5000;

// The whole decision table lives here as a pure machine so it can be tested
// without a DOM or a microphone. Every method returns the ACTION the caller
// must perform: 'start' | 'stop' | 'submit' | 'none'.
export function createVoiceMachine({ windowMs = TAP_ENTER_WINDOW_MS, now = Date.now } = {}) {
  let state = 'IDLE'; // IDLE | LISTENING | ARMED
  let armedAt = 0;

  return {
    state() {
      // The window expires by time alone; report reality even between events.
      if (state === 'ARMED' && now() - armedAt > windowMs) state = 'IDLE';
      return state;
    },
    tap() {
      const current = this.state();
      if (current === 'IDLE') { state = 'LISTENING'; return 'start'; }
      if (current === 'LISTENING') return 'stop';
      // ARMED and inside the window — this is the Enter the ruling describes.
      state = 'IDLE';
      return 'submit';
    },
    // Recognition ended. It arms the window only when the session actually
    // committed text — an empty session (no speech, permission denied, error)
    // must not turn the next tap into a surprise submit.
    ended(committedText) {
      if (state !== 'LISTENING') return 'none';
      if (committedText) { state = 'ARMED'; armedAt = now(); return 'armed'; }
      state = 'IDLE';
      return 'none';
    },
    // A keystroke in the field means the user is editing; the tap must not
    // submit a text they are mid-change on.
    userEdited() {
      if (state === 'ARMED') state = 'IDLE';
      return 'none';
    },
  };
}

function init() {
  const field = document.querySelector('#outfit-text');
  const button = document.querySelector('#voice-input-button');
  const form = document.querySelector('#run-form');
  if (!field || !button || !form) return;
  const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  if (!Recognition) return; // unsupported browser: the button stays hidden

  button.hidden = false;
  const machine = createVoiceMachine();
  let recognition = null;
  let base = '';
  let committed = '';
  let disarmTimer = null;

  const paint = () => {
    const state = machine.state();
    button.classList.toggle('listening', state === 'LISTENING');
    button.classList.toggle('armed', state === 'ARMED');
    button.setAttribute('aria-pressed', String(state === 'LISTENING'));
    button.textContent = state === 'ARMED' ? '↵' : '🎙';
    button.title = state === 'LISTENING'
      ? 'Говори — текст зʼявляється в полі. Тап — зупинити.'
      : state === 'ARMED'
        ? 'Тап протягом 5 с — надіслати (Enter)'
        : 'Надиктувати опис образу';
  };

  const render = (interim) => {
    field.value = base + committed + interim;
    // The draft autosave listens on the form; a silent value change would be
    // lost on reload, so the update must look like typing.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const start = () => {
    recognition = new Recognition();
    recognition.lang = document.documentElement.lang === 'uk' ? 'uk-UA' : (navigator.language || 'uk-UA');
    recognition.interimResults = true;
    recognition.continuous = true;
    base = field.value.trim() ? `${field.value.replace(/\s+$/, '')} ` : '';
    committed = '';
    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (const result of event.results) {
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      committed = final;
      render(interim);
    };
    recognition.onend = () => {
      recognition = null;
      render('');
      machine.ended(committed.trim().length > 0);
      paint();
      clearTimeout(disarmTimer);
      // paint() reads expiry lazily; the timer only refreshes the visual when
      // the window lapses with no tap.
      disarmTimer = setTimeout(paint, TAP_ENTER_WINDOW_MS + 50);
    };
    recognition.onerror = () => { committed = ''; };
    recognition.start();
  };

  button.addEventListener('click', () => {
    const action = machine.tap();
    if (action === 'start') start();
    else if (action === 'stop' && recognition) recognition.stop();
    else if (action === 'submit') form.requestSubmit();
    paint();
  });

  // Hand edits cancel the tap-Enter window (ruling: "лише при цих умовах").
  field.addEventListener('keydown', () => { machine.userEdited(); paint(); });

  paint();
}

if (typeof document !== 'undefined' && document.querySelector) init();
