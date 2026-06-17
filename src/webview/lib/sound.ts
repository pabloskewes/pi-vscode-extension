import type { CompletionSound } from '../../shared/protocol';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

function playTone(ctx: AudioContext, frequency: number, duration: number, gain: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const now = ctx.currentTime;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, now);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

export function playCompletionSound(sound: CompletionSound): void {
  if (sound === 'off') return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const play = () => {
    if (sound === 'chime') {
      playTone(ctx, 880, 0.15, 0.15);
      playTone(ctx, 1100, 0.2, 0.12);
    } else {
      playTone(ctx, 880, 0.12, 0.08);
    }
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}
