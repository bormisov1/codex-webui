'use strict';

// The composer depends on this provider contract, not on SpeechRecognition itself.
// A future API provider can implement the same start/stop/cancel/isActive methods.
// stop() resolves only after final transcripts have been delivered.
(function exposeDictation(root) {
  function createBrowserProvider(callbacks = {}, Recognition = root.SpeechRecognition || root.webkitSpeechRecognition) {
    const { onState = () => {}, onFinal = () => {}, onInterim = () => {}, onError = () => {} } = callbacks;
    let session = null;
    let nextFinalIndex = 0;
    let stopRequested = false;
    let completion = null;
    let stopTimer = null;

    function finish(current, outcome) {
      if (session !== current) return;
      clearTimeout(stopTimer);
      stopTimer = null;
      session = null;
      stopRequested = false;
      onInterim('');
      onState('idle');
      completion.resolve(outcome);
      completion = null;
    }

    function start({ language } = {}) {
      if (!Recognition) throw new Error('Speech recognition is unavailable in this browser.');
      if (session) return false;

      const current = new Recognition();
      session = current;
      completion = {};
      completion.promise = new Promise((resolve) => { completion.resolve = resolve; });
      nextFinalIndex = 0;
      stopRequested = false;
      current.lang = language || root.navigator?.language || 'en-US';
      current.continuous = true;
      current.interimResults = true;
      current.maxAlternatives = 1;
      current.onstart = () => {
        if (session === current) onState(stopRequested ? 'stopping' : 'listening');
      };
      current.onresult = (event) => {
        if (session !== current) return;
        const interim = [];
        for (let index = nextFinalIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = String(result?.[0]?.transcript || '').trim();
          if (result.isFinal) {
            nextFinalIndex = index + 1;
            if (transcript) onFinal(transcript);
          } else if (transcript) {
            interim.push(transcript);
          }
        }
        onInterim(interim.join(' '));
      };
      current.onerror = (event) => {
        if (session !== current) return;
        if (event.error !== 'aborted') onError(event.error || 'unknown');
        finish(current, event.error === 'aborted' ? 'cancelled' : 'error');
        try { current.abort(); } catch { /* The browser may already have ended the session. */ }
      };
      current.onend = () => finish(current, 'ended');
      onState('starting');
      try {
        current.start();
      } catch (error) {
        finish(current, 'error');
        throw error;
      }
      return true;
    }

    function stop() {
      if (!session) return Promise.resolve('ended');
      const current = session;
      const pending = completion.promise;
      if (stopRequested) return pending;
      stopRequested = true;
      onState('stopping');
      stopTimer = setTimeout(() => {
        if (session !== current) return;
        onError('timeout');
        finish(current, 'error');
        try { current.abort(); } catch { /* The browser may already have ended the session. */ }
      }, 15000);
      try {
        current.stop();
      } catch (error) {
        onError(error.message || 'unknown');
        finish(current, 'error');
        try { current.abort(); } catch { /* The browser may already have ended the session. */ }
      }
      return pending;
    }

    function cancel() {
      if (!session) return false;
      const current = session;
      finish(current, 'cancelled');
      try { current.abort(); } catch { /* The browser may already have ended the session. */ }
      return true;
    }

    return { supported: Boolean(Recognition), isActive: () => Boolean(session), start, stop, cancel };
  }

  const api = { createBrowserProvider };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CodexDictation = api;
})(globalThis);
