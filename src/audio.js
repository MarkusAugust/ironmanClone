'use strict';
// All sound is synthesized with the Web Audio API: engines, effects and chiptune music.

const Sound = (() => {
  let ac = null, master, sfxBus, musicBus, noiseBuf;
  let muted = false;
  try { muted = localStorage.getItem('irondirt.muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = 0.45; musicBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pendingSong) { const s = pendingSong; pendingSong = null; playMusic(s); }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('irondirt.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.02);
  }

  function tone(o) {
    if (!ac) return;
    const t = ac.currentTime + (o.delay || 0);
    const dur = o.dur || 0.1;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + dur);
    const vol = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(o) {
    if (!ac) return;
    const t = ac.currentTime + (o.delay || 0);
    const dur = o.dur || 0.2;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    f.Q.value = o.q || 1;
    const g = ac.createGain();
    const vol = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  const sfx = {
    count() { tone({ freq: 440, dur: 0.25, vol: 0.18 }); },
    go() { tone({ freq: 880, dur: 0.6, vol: 0.2 }); tone({ freq: 1320, dur: 0.6, vol: 0.08 }); },
    select() { tone({ freq: 660, dur: 0.06, vol: 0.12 }); },
    confirm() { tone({ freq: 523, dur: 0.08, vol: 0.14 }); tone({ freq: 784, dur: 0.12, vol: 0.14, delay: 0.07 }); },
    deny() { tone({ freq: 140, dur: 0.18, vol: 0.18, type: 'sawtooth' }); },
    buy() {
      tone({ freq: 1568, dur: 0.07, vol: 0.12 });
      tone({ freq: 2093, dur: 0.18, vol: 0.12, delay: 0.06 });
      noise({ dur: 0.08, vol: 0.06, filter: 'highpass', freq: 5000 });
    },
    crash(power = 1) {
      noise({ dur: 0.25, vol: Math.min(0.35, 0.12 * power + 0.08), freq: 900, freqEnd: 120 });
      tone({ freq: 90, freqEnd: 40, dur: 0.2, vol: 0.2, type: 'sine' });
    },
    bump() { tone({ freq: 120, freqEnd: 60, dur: 0.12, vol: 0.18, type: 'triangle' }); },
    land() { noise({ dur: 0.18, vol: 0.18, freq: 500, freqEnd: 80 }); tone({ freq: 70, freqEnd: 35, dur: 0.18, vol: 0.22, type: 'sine' }); },
    nitro() {
      noise({ dur: 0.9, vol: 0.22, filter: 'bandpass', freq: 600, freqEnd: 3000, q: 2, attack: 0.02 });
      tone({ freq: 90, freqEnd: 220, dur: 0.8, vol: 0.12, type: 'sawtooth' });
    },
    pickup() { [0, 1, 2].forEach(i => tone({ freq: 660 * Math.pow(1.26, i), dur: 0.08, vol: 0.12, delay: i * 0.05 })); },
    money() {
      tone({ freq: 1319, dur: 0.08, vol: 0.12 });
      tone({ freq: 1976, dur: 0.25, vol: 0.12, delay: 0.08 });
    },
    splash() { noise({ dur: 0.3, vol: 0.12, filter: 'bandpass', freq: 1800, freqEnd: 600, q: 0.8 }); },
    lap() { tone({ freq: 988, dur: 0.08, vol: 0.12 }); tone({ freq: 1319, dur: 0.12, vol: 0.12, delay: 0.09 }); },
    finish() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, vol: 0.14, delay: i * 0.1 })); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.22, vol: 0.14, delay: i * 0.16, type: 'triangle' })); },
  };

  // ---- Engine ----
  function createEngine(pan = 0) {
    if (!ac) return { set() {}, stop() {} };
    const o1 = ac.createOscillator(); o1.type = 'sawtooth';
    const o2 = ac.createOscillator(); o2.type = 'square';
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    const g = ac.createGain(); g.gain.value = 0;
    let out = g;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner(); p.pan.value = pan;
      g.connect(p); out = p;
    }
    o1.connect(f); o2.connect(f); f.connect(g); out.connect(sfxBus);
    o1.start(); o2.start();
    let stopped = false;
    return {
      set(speedFrac, throttle, boost) {
        if (stopped) return;
        const t = ac.currentTime;
        const base = 38 + speedFrac * 92 + (boost ? 28 : 0) + throttle * 6;
        o1.frequency.setTargetAtTime(base, t, 0.05);
        o2.frequency.setTargetAtTime(base * 0.502, t, 0.05);
        f.frequency.setTargetAtTime(280 + speedFrac * 900 + throttle * 300 + (boost ? 600 : 0), t, 0.05);
        g.gain.setTargetAtTime(0.03 + throttle * 0.025 + speedFrac * 0.02, t, 0.05);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = ac.currentTime;
        g.gain.setTargetAtTime(0, t, 0.05);
        o1.stop(t + 0.3); o2.stop(t + 0.3);
      },
    };
  }

  // ---- Tire skid: filtered noise that rises with the slide ----
  function createSkid(pan = 0) {
    if (!ac) return { set() {}, stop() {} };
    const src = ac.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5; f.frequency.value = 900;
    const g = ac.createGain(); g.gain.value = 0;
    let out = g;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(f); f.connect(g); out.connect(sfxBus);
    src.start();
    let stopped = false;
    return {
      set(level, pitch = 1) {
        if (stopped) return;
        const t = ac.currentTime;
        g.gain.setTargetAtTime(Math.min(0.09, level * 0.09), t, 0.04);
        f.frequency.setTargetAtTime(700 + 900 * pitch, t, 0.05);
      },
      stop() { if (stopped) return; stopped = true; g.gain.setTargetAtTime(0, ac.currentTime, 0.03); src.stop(ac.currentTime + 0.2); },
    };
  }

  // ---- Music ----
  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  function midi(n) {
    const m = /^([A-G]#?)(-?\d)$/.exec(n);
    return (parseInt(m[2], 10) + 1) * 12 + NOTE[m[1]];
  }
  function mfreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function parse(str) {
    const toks = str.trim().split(/\s+/);
    const ev = [];
    toks.forEach((tk, i) => {
      if (tk === '-') { if (ev.length) ev[ev.length - 1].len++; }
      else if (tk !== '.') ev.push({ step: i, m: midi(tk), len: 1 });
    });
    return { ev, steps: toks.length };
  }

  const SONGS = {
    title: {
      bpm: 150, loop: true,
      lead: 'E4 . G4 A4 B4 - A4 G4  B4 . D5 - B4 A4 G4 .  A4 . C5 - E5 - D5 C5  B4 - G4 - E4 - - . ' +
            'E5 . D5 B4 D5 - B4 A4  G4 . B4 - D5 - B4 .  A4 . F#4 - A4 - D5 -  B4 - A4 - B4 - - .',
      bass: 'E2 . E2 E3 E2 . E2 E3  G2 . G2 G3 G2 . G2 G3  A2 . A2 A3 A2 . A2 A3  E2 . E2 E3 E2 . E2 E3 ' +
            'E2 . E2 E3 E2 . E2 E3  G2 . G2 G3 G2 . G2 G3  D2 . D2 D3 D2 . D2 D3  B1 . B1 B2 B1 . B1 B2',
      drums: 'khshkksh',
    },
    shop: {
      bpm: 116, loop: true,
      lead: 'A4 C#5 E5 A5 E5 C#5 A4 E4  F#4 A4 C#5 F#5 C#5 A4 F#4 C#4  D4 F#4 A4 D5 A4 F#4 D4 A3  E4 G#4 B4 E5 B4 G#4 E4 B3 ' +
            'A4 C#5 E5 A5 E5 C#5 A4 E4  F#4 A4 C#5 F#5 C#5 A4 F#4 C#4  D4 F#4 A4 D5 A4 F#4 D4 F#4  E4 G#4 B4 D5 E5 - - .',
      bass: 'A2 - - - A2 - E2 -  F#2 - - - F#2 - C#2 -  D2 - - - D2 - A1 -  E2 - - - E2 - B1 - ' +
            'A2 - - - A2 - E2 -  F#2 - - - F#2 - C#2 -  D2 - - - D2 - A1 -  E2 - - - E2 - E2 -',
      drums: 'k.h.s.h.',
    },
    win: {
      bpm: 200, loop: false,
      lead: 'C5 E5 G5 C6 - G5 C6 - - - . .',
      bass: 'C3 - - C3 - G2 C3 - - - . .',
      drums: '',
    },
    over: {
      bpm: 120, loop: false,
      lead: 'E5 - D5 - C5 - B4 - A4 - - - - - . .',
      bass: 'A2 - - - F2 - - - E2 - - - A1 - - -',
      drums: '',
    },
  };
  for (const k in SONGS) {
    const s = SONGS[k];
    s.leadP = parse(s.lead);
    s.bassP = parse(s.bass);
    s.steps = Math.max(s.leadP.steps, s.bassP.steps);
  }

  let current = null, step = 0, nextTime = 0, timer = null, pendingSong = null;

  function playMusic(name) {
    if (!ac) { pendingSong = name; return; }
    if (current === SONGS[name] && timer) return;
    stopMusic();
    current = SONGS[name];
    step = 0;
    nextTime = ac.currentTime + 0.05;
    timer = setInterval(schedule, 25);
  }

  function stopMusic() {
    pendingSong = null;
    if (timer) clearInterval(timer);
    timer = null;
    current = null;
  }

  function schedule() {
    if (!current || !ac) return;
    const spb = 60 / current.bpm / 2;
    while (nextTime < ac.currentTime + 0.12) {
      const s = current;
      const st = step;
      for (const e of s.leadP.ev) if (e.step === st) {
        voice(mfreq(e.m), e.len * spb * 0.95, 'square', 0.07, nextTime);
      }
      for (const e of s.bassP.ev) if (e.step === st) {
        voice(mfreq(e.m), e.len * spb * 0.9, 'triangle', 0.16, nextTime);
      }
      if (s.drums) {
        const d = s.drums[st % s.drums.length];
        const delay = nextTime - ac.currentTime;
        if (d === 'k') tone({ freq: 140, freqEnd: 45, dur: 0.12, vol: 0.3, type: 'sine', delay, bus: musicBus });
        if (d === 's') noise({ dur: 0.1, vol: 0.12, filter: 'bandpass', freq: 1800, delay, bus: musicBus });
        if (d === 'h') noise({ dur: 0.03, vol: 0.05, filter: 'highpass', freq: 7000, delay, bus: musicBus });
      }
      nextTime += spb;
      step++;
      if (step >= current.steps) {
        if (current.loop) step = 0;
        else { stopMusic(); return; }
      }
    }
  }

  function voice(freq, dur, type, vol, when) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.setValueAtTime(vol, when + Math.max(0.01, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g); g.connect(musicBus);
    osc.start(when); osc.stop(when + dur + 0.02);
  }

  return {
    init, sfx, createEngine, createSkid,
    playMusic, stopMusic,
    get muted() { return muted; },
    toggleMute() { setMuted(!muted); return muted; },
  };
})();
