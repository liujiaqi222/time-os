let audio: AudioContext | null = null;
const reminded = new Set<string>();
export function unlockTimerSound() {
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  } catch {
    /* Audio is auxiliary; timer state never depends on permission. */
  }
}
export function remindPhaseOnce(id: string, enabled: boolean) {
  if (reminded.has(id)) return;
  reminded.add(id);
  try {
    const key = `timeos:phase-reminded:${id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* Storage can be unavailable; in-memory deduplication remains. */
  }
  if (!enabled || !audio || audio.state !== "running") return;
  try {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.5);
  } catch {
    /* Blocked sound must not block the phase. */
  }
}
