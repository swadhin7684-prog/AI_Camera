// SentinelX AI Safety Alarm Service - Plays ONLY 1 audio instance with Cross-Window & Tab Mutex
const TAB_ID = typeof window !== 'undefined'
  ? 'tab_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36)
  : 'server';

class SoundService {
  public enabled: boolean = true;
  public volume: number = 0.9;
  public cooldownSeconds: number = 5;
  private alarmAudio: HTMLAudioElement | null = null;
  private isAlarmPlaying: boolean = false;
  private clearViolationTimer: ReturnType<typeof setTimeout> | null = null;
  private isViolationActive: boolean = false;
  private broadcastChannel: BroadcastChannel | null = null;

  constructor() {
    this.initBroadcastChannel();
    this.initAlarmAudio();
    this.setupUserGestureListener();
  }

  // Cross-Tab and Cross-Window Coordinator (ensures only ONE window plays alarm)
  private initBroadcastChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    try {
      this.broadcastChannel = new BroadcastChannel('sentinelx_audio_bus');
      this.broadcastChannel.onmessage = (event) => {
        if (!event?.data) return;
        const { type, sender } = event.data;
        if (sender !== TAB_ID) {
          if (type === 'ALARM_CLAIMED') {
            // Another tab or window is actively playing the alarm: silence this instance!
            if (this.isAlarmPlaying) {
              this.stopAlarmLocal();
            }
          }
        }
      };
    } catch (_) {}
  }

  public initAlarmAudio() {
    if (typeof window === 'undefined') return;
    try {
      // 1. Clean up any previous global audio instance attached to window
      if ((window as any).__sentinelx_singleton_audio) {
        try {
          (window as any).__sentinelx_singleton_audio.pause();
          (window as any).__sentinelx_singleton_audio.currentTime = 0;
        } catch (_) {}
      }

      if (this.alarmAudio) {
        try {
          this.alarmAudio.pause();
          this.alarmAudio.currentTime = 0;
        } catch (_) {}
        this.alarmAudio = null;
      }

      // 2. Create the strictly single audio element pointing to the Alarm folder
      const audio = new Audio('/api/alarm-audio');
      audio.preload = 'auto';
      audio.volume = this.volume;
      audio.loop = true; // Ring smoothly as long as violation persists

      (window as any).__sentinelx_singleton_audio = audio;
      this.alarmAudio = audio;
    } catch (e) {
      console.warn('Failed to initialize alarm Audio element:', e);
    }
  }

  private setupUserGestureListener() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      if (this.alarmAudio) {
        this.alarmAudio.load();
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  public reloadAlarmAudio() {
    this.stopAlarm();
    if (this.alarmAudio) {
      this.alarmAudio.src = `/api/alarm-audio?t=${Date.now()}`;
      this.alarmAudio.load();
    } else {
      this.initAlarmAudio();
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0.05, Math.min(1.0, vol));
    if (this.alarmAudio) {
      this.alarmAudio.volume = this.volume;
    }
  }

  // Cross-tab leadership check: visible tab takes priority
  private canThisTabPlayAudio(): boolean {
    if (typeof document === 'undefined') return true;

    // If this tab is hidden in background and another window/tab is open, let the active one play
    if (document.hidden) {
      try {
        const lastActiveOwner = localStorage.getItem('sentinelx_active_audio_tab');
        const lastPing = parseInt(localStorage.getItem('sentinelx_audio_ping') || '0', 10);
        // If an active foreground tab claimed the audio lease recently, background tab stays quiet
        if (lastActiveOwner && lastActiveOwner !== TAB_ID && Date.now() - lastPing < 3000) {
          return false;
        }
      } catch (_) {}
    }

    return true;
  }

  // Called each frame from telemetry stream
  public notifyViolation(hasViolation: boolean) {
    if (!this.enabled) {
      this.stopAlarm();
      return;
    }

    if (hasViolation) {
      if (this.clearViolationTimer) {
        clearTimeout(this.clearViolationTimer);
        this.clearViolationTimer = null;
      }

      this.isViolationActive = true;

      // Start ringing if not already playing
      if (!this.isAlarmPlaying) {
        this.startAlarm();
      }
    } else {
      // 1.2s grace period to absorb live webcam detection frame-drops
      if (this.isViolationActive && !this.clearViolationTimer) {
        this.clearViolationTimer = setTimeout(() => {
          this.isViolationActive = false;
          this.stopAlarm();
          this.clearViolationTimer = null;
        }, 1200);
      }
    }
  }

  public startAlarm() {
    if (!this.enabled) return;

    // Check cross-tab coordinator: don't double play if another window is already active
    if (!this.canThisTabPlayAudio()) {
      return;
    }

    if (!this.alarmAudio) {
      this.initAlarmAudio();
    }

    if (this.alarmAudio) {
      // If already playing, do NOT call play again to avoid duplicate streams or desync
      if (!this.alarmAudio.paused && this.alarmAudio.currentTime > 0) {
        this.isAlarmPlaying = true;
        return;
      }

      try {
        // Claim audio lease across all tabs & Electron windows
        try {
          localStorage.setItem('sentinelx_active_audio_tab', TAB_ID);
          localStorage.setItem('sentinelx_audio_ping', Date.now().toString());
          this.broadcastChannel?.postMessage({ type: 'ALARM_CLAIMED', sender: TAB_ID });
        } catch (_) {}

        this.alarmAudio.volume = Math.max(0.05, Math.min(1.0, this.volume));
        this.isAlarmPlaying = true;

        const playPromise = this.alarmAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Alarm audio play error:', err);
            this.isAlarmPlaying = false;
          });
        }
      } catch (e) {
        console.warn('Error playing alarm audio:', e);
        this.isAlarmPlaying = false;
      }
    }
  }

  // Local stop only without clearing coordinator
  private stopAlarmLocal() {
    this.isAlarmPlaying = false;
    if (this.alarmAudio) {
      try {
        this.alarmAudio.pause();
        this.alarmAudio.currentTime = 0;
      } catch (_) {}
    }
  }

  // Cuts off and silences the alarm audio immediately
  public stopAlarm() {
    if (this.clearViolationTimer) {
      clearTimeout(this.clearViolationTimer);
      this.clearViolationTimer = null;
    }
    this.isViolationActive = false;
    this.stopAlarmLocal();

    try {
      if (localStorage.getItem('sentinelx_active_audio_tab') === TAB_ID) {
        localStorage.removeItem('sentinelx_active_audio_tab');
      }
    } catch (_) {}
  }

  public testAlarm() {
    this.startAlarm();
    setTimeout(() => {
      this.stopAlarm();
    }, 4500);
  }
}

export const soundService = new SoundService();

