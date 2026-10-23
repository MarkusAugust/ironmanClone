'use strict';
// Computer drivers. Skill 0..1 controls line choice, braking and nitro use.

class AIDriver {
  constructor(skill, boss = false) {
    this.skill = skill;
    this.boss = boss;
    this.phase = Math.random() * 10;
    this.stuckT = 0;
    this.reverseT = 0;
    this.nitroCd = 2 + Math.random() * 3;
    this.wobble = 0;
  }

  control(dt, truck, track, time) {
    const N = track.N;
    const f = truck.forward;
    const ctl = { steer: 0, gas: true, brake: false, nitro: false };

    // recover from being stuck against a wall
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      ctl.gas = false; ctl.brake = true;
      ctl.steer = this.reverseSteer;
      return ctl;
    }

    const lookPx = 16 + Math.max(0, f) * 0.3;
    const la = Math.max(4, Math.round(lookPx / track.sp));
    const ti = (truck.idx + la) % N;
    const fi = (truck.idx + la * 3) % N;
    const tA = Math.atan2(track.ty[ti], track.tx[ti]);
    const tB = Math.atan2(track.ty[fi], track.tx[fi]);
    const bend = wrapAngle(tB - tA);

    // lane: inside of upcoming bends for skilled drivers, drifting lanes otherwise
    const maxLane = track.halfW - 8;
    const drift = Math.sin(time * 0.35 + this.phase) * maxLane * 0.7;
    const inside = Math.sign(bend) * Math.min(maxLane, Math.abs(bend) * 14);
    const lane = drift * (1 - this.skill) + inside * this.skill;
    const px = track.cx[ti] - track.ty[ti] * lane;
    const py = track.cy[ti] + track.tx[ti] * lane;

    const want = Math.atan2(py - truck.y, px - truck.x);
    let diff = wrapAngle(want - truck.h);
    this.wobble += (Math.random() - 0.5) * dt * 6;
    this.wobble *= Math.exp(-dt * 2);
    diff += this.wobble * (1 - this.skill) * 0.6;
    ctl.steer = Math.max(-1, Math.min(1, diff * 3));

    const top = truck.topSpeed;
    const sharp = Math.abs(bend);
    if (Math.abs(diff) > 0.65 && f > top * 0.55) ctl.gas = false;
    if (Math.abs(diff) > 1.3 && f > 35) { ctl.gas = false; ctl.brake = true; }
    const cornerLimit = top * (1.15 - sharp * (0.5 - this.skill * 0.18));
    if (f > cornerLimit) ctl.gas = false;

    // nitro on straights
    this.nitroCd -= dt;
    if (truck.nitros > 0 && this.nitroCd <= 0 && truck.nitroT <= 0 && f > 45 && sharp < 0.3 && Math.abs(diff) < 0.2) {
      if (Math.random() < 0.3 + this.skill * 0.6) ctl.nitro = true;
      this.nitroCd = 2.5 + Math.random() * (5 - this.skill * 3);
    }

    // stuck detection: barely moved over the last second
    this.checkT = (this.checkT || 0) + dt;
    if (this.checkT >= 0.5) {
      const moved = this.lastX == null ? 99 : Math.hypot(truck.x - this.lastX, truck.y - this.lastY);
      this.lastX = truck.x; this.lastY = truck.y; this.checkT = 0;
      this.stuckT = moved < 5 ? this.stuckT + 0.5 : 0;
    }
    if (this.stuckT >= 1) {
      this.stuckT = 0;
      this.reverseT = 0.6 + Math.random() * 0.3;
      this.reverseSteer = -Math.sign(diff || 1);
    }
    return ctl;
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
