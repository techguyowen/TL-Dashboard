/**
 * TL Auction Tracker - Web Audio API Sound Synthesizer
 * Generates rich harmonic alerts with zero external audio assets or latency.
 */

let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      globalAudioCtx = new AudioContextClass();
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
}

/**
 * Discovery Alert: Elegant dual-harmonic chime (C5 -> E5).
 */
function playDiscoveryChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);       // C5
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.18); // E5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1046.50, now);     // C6 overtone
    osc2.frequency.exponentialRampToValueAtTime(1318.50, now + 0.18);

    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.68);
    osc2.stop(now + 0.68);
  } catch (err) {
    console.warn('[AUDIO ENGINE] Discovery chime error:', err);
  }
}

/**
 * Sniping Alert: Urgent 3-pulse arpeggio (G5 -> A5 -> C6).
 */
function playSnipingChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [783.99, 880.00, 1046.50]; // G5, A5, C6
    
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteTime = now + (idx * 0.10);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.34);
    });
  } catch (err) {
    console.warn('[AUDIO ENGINE] Sniping chime error:', err);
  }
}

/**
 * Success Alert: Soft confirmation chime (E5 -> G5).
 */
function playSuccessChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, now);
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.52);
  } catch (err) {
    console.warn('[AUDIO ENGINE] Success chime error:', err);
  }
}

/**
 * Sound effect preview tester for Settings modal.
 */
function previewSoundEffect(type) {
  if (type === 'discovery') {
    playDiscoveryChime();
  } else if (type === 'sniping') {
    playSnipingChime();
  } else {
    playSuccessChime();
  }
}
