
// ╔══════════════════════════════════════════════════════════════╗
// ║  main.js                                                     ║
// ║  Contains: S15 animation loop, S16 input handlers,           ║
// ║            S17 audio feedback, S18 console commands,         ║
// ║            S19 bootstrap                                     ║
// ║  This is the entry point — index.html should load this file  ║
// ╚══════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════╗
// ║  CUT 4 — START OF game.js                                    ║
// ║  Contains: S11 global state, S12 game engine, S13 persistence║
// ║  Ends before: S14 CANVAS & VISUAL HELPERS (cut 5)            ║
// ╚══════════════════════════════════════════════════════════════╝

// ─────────────────────────────────────────────────────────────
// SECTION 11 — GLOBAL STATE
// ─────────────────────────────────────────────────────────────
const SAVE_KEY      = 'm1d1sl0p2_save';
const TIMER_PRESETS = GAME_CONFIG.timing.timerPresets;
const SCALE_CHORD_QUALITIES = {
  major:      ['major','minor','minor','major','major','minor','dim'],
  minor:      ['minor','dim','major','minor','minor','major','major'],
  dorian:     ['minor','minor','major','major','minor','dim','major'],
  phrygian:   ['minor','major','major','minor','dim','major','minor'],
  lydian:     ['major','major','minor','dim','major','minor','minor'],
  mixolydian: ['major','minor','dim','major','minor','minor','major'],
};
const SCALE_DIFF_MAP = [1,2,3,1,1,2,3];

let gameMode         = 'practice';
let gamePhase        = 'hint';
let currentChallenge = null;
let challengeDeck    = [];
let gameKeyPool      = null;
let gameKeyLabel     = '';
let phaseStart       = 0;
let playPhaseStart   = 0;
let phrasePeakNotes  = 0;
let phraseMatched    = false;
let feedbackAlpha    = 0;
let levelupAlpha     = 0;
let challengeTimerSecs = GAME_CONFIG.timing.defaultTimer;

const particles      = [];
let synthGlowAlpha   = 0;
let synthGlowH       = 0;
let synthRippleBoxes = [];
let screenRipples    = [];
let bpm = 0, clockTimes = [], pulseCount = 0, lastPulseTime = 0;
let useMidiClock = false;
let internalBpm = 120, internalBpmActive = false, _tapTimes = [];
let detectedLabel = '', detectedHue = 0, labelFade = 0;

let score        = 0;
let levelIdx     = 0;
let streakCount  = 0;  // consecutive hits toward next streak level (0–3; resets at 4)
let streakLevels = 0;  // earned streak levels (0–4); reaching 5 triggers level up

let keyboardAlpha = 1;             // fades 0↔1 on keyboard show/hide
let earTraining  = false;          // ear training mode active
let selectedMode = 'coop';         // 'play' | 'ear' | 'coop' | 'competitive' | 'tennis'
let remoteScore  = 0;              // opponent score in competitive/tennis modes
let roundsPlayed = 0;              // competitive: shared round counter for level advance
let lockedOut      = false;        // competitive: host locked out this round
let remoteLockedOut = false;       // competitive: client locked out this round
let idleTimeouts = 0;             // consecutive no-attempt timeouts; auto-pauses at 10

let _wrongPenaltyGiven = false;   // once per challenge
let _bonusExtPCs       = new Set(); // extension PCs set at triggerSuccess
let _bonusPentPCs      = new Set(); // pentatonic PCs set at triggerSuccess
let _bonusExtGiven     = false;
let _bonusPentGiven    = false;

const activeNotes = new Map();
const remoteNotes = new Map(); // notes held by the remote co-op player
let hintNotes     = [];
let kbOctave      = 4;
let kbHeld        = new Map();
let mouseX = 0, mouseY = 0;
let panelDrag = null;
let knobDrag  = null;

let midiLearnMode  = false;
let midiLearnParam = null;
const midiCCMap    = {};

function currentLevel() { return GAME_CONFIG.levels[levelIdx]; }

function buildKbMapFull() {
  const b = kbOctave * 12;
  return {
    'a':b+0,  'w':b+1,  's':b+2,  'e':b+3,  'd':b+4,
    'f':b+5,  't':b+6,  'g':b+7,  'y':b+8,  'h':b+9,
    'u':b+10, 'j':b+11, 'k':b+12, 'o':b+13, 'l':b+14,
    'p':b+15, ';':b+16, "'":b+17,
  };
}
let kbMap = buildKbMapFull();

function buildKeyPool(root, scaleName) {
  const qualities = SCALE_CHORD_QUALITIES[scaleName] ?? SCALE_CHORD_QUALITIES.major;
  const scale = Scale.get(`${root} ${scaleName}`);
  const notes = scale.notes?.length >= 7 ? scale.notes : Scale.get(`${root} major`).notes;
  if (!notes || notes.length < 7) return null;
  const pool = [];
  notes.slice(0,7).forEach((note, i) => {
    const q = qualities[i];
    let sym, display;
    if (q === 'major')  { sym = note;         display = `${note} major`; }
    else if (q === 'minor') { sym = `${note}m`; display = `${note} minor`; }
    else                    { sym = `${note}dim`; display = `${note} dim`; }
    const chord = Chord.get(sym);
    if (!chord.notes || chord.notes.length < 3) return;
    pool.push({ display, notes: chord.notes, diff: SCALE_DIFF_MAP[i] ?? 2 });
  });
  return pool.length >= 3 ? pool : null;
}

function shuffle(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}
// ╔══════════════════════════════════════════════════════════════╗
// ║  CUT 5 — START OF visuals.js                                 ║
// ║  Contains: S14 canvas & visual helpers, S20 flower of life   ║
// ║  Ends before: S15 ANIMATION LOOP (cut 6)                     ║
// ╚══════════════════════════════════════════════════════════════╝

// ─────────────────────────────────────────────────────────────
// SECTION 14 — CANVAS & VISUAL HELPERS
// ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const patchCanvas = document.getElementById('pc');
const patchCtx    = patchCanvas.getContext('2d');
let controlsBarPos = 'below'; // 'below' | 'above' | 'top'
let kbRiseOffset   = 46;     // extra px added to sY so keyboard clears controls bar

function resizeCanvas() {
  canvas.width = patchCanvas.width = window.innerWidth;
  canvas.height = patchCanvas.height = window.innerHeight;
  setControlsPos(controlsBarPos);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const statusEl        = document.getElementById('status');
const bpmEl           = document.getElementById('bpm');
const modeBtnEl       = document.getElementById('mode-btn');
const earBtnEl        = null; // removed — EAR is now a mode option in the mode panel
const shopBtnEl       = document.getElementById('shop-btn');
const hudEl           = document.getElementById('hud');
const scoreValEl      = document.getElementById('score-val');
const levelValEl      = document.getElementById('level-val');
const streakValEl     = document.getElementById('streak-val');
const challengeEl     = document.getElementById('challenge');
const challengeNameEl = document.getElementById('challenge-name');
const hintLabelEl     = document.getElementById('hint-label');
const timerBarEl      = document.getElementById('challenge-timer-bar');
const timerFillEl     = document.getElementById('challenge-timer-fill');
const timerSecsEl     = document.getElementById('challenge-timer-secs');
const levelupEl       = document.getElementById('levelup');
const labelEl         = document.getElementById('label');
const feedbackEl      = document.getElementById('feedback');
const notesEl         = document.getElementById('notes');
const midiLearnBtnEl  = document.getElementById('midi-learn-btn');

// Particles
function spawnRing(midi, velocity) {
  const pos = notePos(midi);
  particles.push({ type:'ring', x:pos.x, y:pos.y, r:6+velocity/20, maxR:30+velocity*0.6, speed:1+velocity/80, alpha:1, h:hue(midi) });
}

let lastBurstChord = '';
let chordBurstStrength = 1.0;

function spawnChordBurst(h, ox, oy, strength=1, sparks=true) {
  const cx=ox??canvas.width/2, cy=oy??canvas.height/2;
  const a = 0.9 * strength;
  [0,8,18].forEach(off=>particles.push({ type:'burst-ring', x:cx, y:cy, r:10+off, maxR:320*strength, speed:5-off*.15, alpha:a, lineWidth:2.5-off*.06, h }));
  if (sparks) {
    const count = Math.round(60 * strength);
    for (let i=0;i<count;i++) {
      const angle=Math.random()*Math.PI*2, fast=Math.random()>0.4;
      const speed=fast?4+Math.random()*6:1.5+Math.random()*3;
      particles.push({ type:'spark', x:cx, y:cy, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, r:fast?2+Math.random()*2:4+Math.random()*4, alpha:.9, decay:fast?.018+Math.random()*.01:.008+Math.random()*.006, h:h+(Math.random()-.5)*40 });
    }
  }
  for (const midi of activeNotes.keys()) {
    const pos=notePos(midi);
    particles.push({ type:'burst-ring', x:pos.x, y:pos.y, r:8, maxR:80*strength, speed:3, alpha:0.8*strength, lineWidth:1.5, h:hue(midi) });
  }
}

function spawnSynthHit(h) {
  synthGlowH=h; synthGlowAlpha=0.9;
  const boxes=[...document.querySelectorAll('#panels-container .panel-box.unlocked')];
  const scx=window.innerWidth/2, scy=window.innerHeight/2;
  boxes.sort((a,b)=>{
    const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
    return Math.hypot(ra.left+ra.width/2-scx,ra.top+ra.height/2-scy)-Math.hypot(rb.left+rb.width/2-scx,rb.top+rb.height/2-scy);
  });
  synthRippleBoxes=boxes.map((box,i)=>({ rect:box.getBoundingClientRect(), startTime:performance.now()+i*55, h }));
  boxes.forEach((box,i)=>{ box.style.setProperty('--ph',h); box.classList.remove('chord-hit'); setTimeout(()=>box.classList.add('chord-hit'),i*55); });
  screenRipples.push({ startTime:performance.now(), h, cx:scx, cy:scy });
  const cont=document.getElementById('panels-container');
  if (cont&&boxes.length) {
    const r=cont.getBoundingClientRect();
    for (let i=0;i<32;i++) {
      const angle=Math.random()*Math.PI*2, speed=0.6+Math.random()*3.2;
      particles.push({ type:'synth-spark', x:r.left+10+Math.random()*(r.width-20), y:r.top+10+Math.random()*(r.height-20), vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed-0.4, r:0.7+Math.random()*2.2, alpha:0.7+Math.random()*0.25, decay:0.011+Math.random()*0.014, h:h+(Math.random()-.5)*60 });
    }
  }
}

// Draw functions
function drawCable(c2d, sx, sy, ex, ey, h, alpha, px, py) {
  const horiz=Math.abs(ex-sx)>Math.abs(ey-sy), dist=Math.hypot(ex-sx,ey-sy);
  const sag=Math.max(20,Math.min(dist*0.32,88));
  let cp1x,cp1y,cp2x,cp2y;
  if (horiz) { cp1x=sx+(ex-sx)*0.25+px*0.6; cp1y=sy+sag+py*0.6; cp2x=sx+(ex-sx)*0.75+px*0.6; cp2y=ey+sag+py*0.6; }
  else { const bow=Math.max(18,dist*0.22); cp1x=sx+bow+px*0.6; cp1y=sy+(ey-sy)*0.38+py*0.6; cp2x=ex+bow+px*0.6; cp2y=sy+(ey-sy)*0.62+py*0.6; }
  c2d.save(); c2d.lineCap='round';
  [[8,alpha*0.16,`hsla(${h},68%,58%`],[3.5,alpha*0.35,`hsla(${h},62%,45%`],[1.0,alpha*0.85,`hsla(${h},82%,72%`]].forEach(([lw,a,col])=>{
    c2d.beginPath(); c2d.moveTo(sx,sy); c2d.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,ex,ey);
    c2d.strokeStyle=`${col},${a})`; c2d.lineWidth=lw; c2d.stroke();
  });
  c2d.restore();
}

function drawJack(c2d, x, y, h, plugged, alpha) {
  c2d.save();
  c2d.beginPath(); c2d.arc(x,y,7,0,Math.PI*2);
  c2d.fillStyle=`rgba(18,20,24,${alpha*0.94})`; c2d.strokeStyle='rgba(255,255,255,0.24)'; c2d.lineWidth=1; c2d.fill(); c2d.stroke();
  c2d.beginPath(); c2d.arc(x,y,5,0,Math.PI*2); c2d.strokeStyle='rgba(255,255,255,0.09)'; c2d.lineWidth=0.7; c2d.stroke();
  c2d.beginPath(); c2d.arc(x,y,3.5,0,Math.PI*2);
  c2d.fillStyle=plugged?`hsla(${h},55%,30%,${alpha})`:`rgba(2,2,4,${alpha})`; c2d.fill();
  if (plugged) { c2d.beginPath(); c2d.arc(x-1,y-1.2,1.3,0,Math.PI*2); c2d.fillStyle=`hsla(${h},80%,76%,${alpha*0.52})`; c2d.fill(); }
  else { c2d.beginPath(); c2d.arc(x,y,3.5,0,Math.PI*2); c2d.strokeStyle='rgba(255,255,255,0.07)'; c2d.lineWidth=0.8; c2d.stroke(); }
  c2d.restore();
}

function drawCvCable(c2d, sx, sy, ex, ey, px, py) {
  const horiz = Math.abs(ex-sx) > Math.abs(ey-sy), dist = Math.hypot(ex-sx, ey-sy);
  const sag = Math.max(10, Math.min(dist*0.18, 44));
  let cp1x, cp1y, cp2x, cp2y;
  if (horiz) { cp1x=sx+(ex-sx)*0.25+px*0.4; cp1y=sy+sag+py*0.4; cp2x=sx+(ex-sx)*0.75+px*0.4; cp2y=ey+sag+py*0.4; }
  else { const bow=Math.max(10,dist*0.14); cp1x=sx+bow+px*0.4; cp1y=sy+(ey-sy)*0.38+py*0.4; cp2x=ex+bow+px*0.4; cp2y=sy+(ey-sy)*0.62+py*0.4; }
  c2d.save(); c2d.lineCap='round';
  c2d.beginPath(); c2d.moveTo(sx,sy); c2d.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,ex,ey);
  c2d.strokeStyle='rgba(255,185,55,0.14)'; c2d.lineWidth=3.5; c2d.stroke();
  c2d.beginPath(); c2d.moveTo(sx,sy); c2d.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,ex,ey);
  c2d.strokeStyle='rgba(255,200,80,0.82)'; c2d.lineWidth=1.1; c2d.stroke();
  c2d.restore();
}

function drawCvJack(c2d, x, y, plugged, alpha) {
  const s = 6;
  c2d.save();
  c2d.beginPath(); c2d.rect(x-s, y-s, s*2, s*2);
  c2d.fillStyle=`rgba(14,12,8,${alpha*0.94})`; c2d.strokeStyle=`rgba(255,185,55,0.32)`; c2d.lineWidth=1; c2d.fill(); c2d.stroke();
  c2d.beginPath(); c2d.rect(x-s+1, y-s+1, (s-1)*2, (s-1)*2);
  c2d.strokeStyle='rgba(255,200,80,0.09)'; c2d.lineWidth=0.7; c2d.stroke();
  const is = 3.5;
  c2d.beginPath(); c2d.rect(x-is, y-is, is*2, is*2);
  c2d.fillStyle=plugged?`rgba(255,180,45,${alpha*0.72})`:`rgba(4,3,2,${alpha})`; c2d.fill();
  if (plugged) { c2d.beginPath(); c2d.rect(x-1.5, y-2.2, 3, 2); c2d.fillStyle=`rgba(255,230,120,${alpha*0.5})`; c2d.fill(); }
  c2d.restore();
}

function drawKnob(canvasEl, value01, focused) {
  if (!canvasEl) return;
  const kc=canvasEl.getContext('2d'), w=canvasEl.width, h=canvasEl.height, cx=w/2, cy=h/2, r=w*0.33;
  kc.clearRect(0,0,w,h);
  const START=Math.PI*0.75, RANGE=Math.PI*1.5, aH=detectedHue||200;
  kc.beginPath(); kc.arc(cx,cy,r,START,START+RANGE); kc.strokeStyle='rgba(255,255,255,0.18)'; kc.lineWidth=2.5; kc.lineCap='round'; kc.stroke();
  if (value01>0.001) { kc.beginPath(); kc.arc(cx,cy,r,START,START+value01*RANGE); kc.strokeStyle=focused?`hsl(${aH},85%,72%)`:`hsla(${aH},72%,72%,0.82)`; kc.lineWidth=2.5; kc.lineCap='round'; kc.stroke(); }
  const a=START+value01*RANGE;
  kc.beginPath(); kc.arc(cx+Math.cos(a)*(r-1),cy+Math.sin(a)*(r-1),2.5,0,Math.PI*2);
  kc.fillStyle=focused?`hsl(${aH},85%,85%)`:`hsla(${aH},65%,88%,0.85)`; kc.fill();
  if (focused) { kc.beginPath(); kc.arc(cx,cy,r+6,0,Math.PI*2); kc.strokeStyle=`hsla(${aH},80%,65%,0.3)`; kc.lineWidth=1; kc.stroke(); }
}

function drawFader(canvasEl, value01, focused) {
  if (!canvasEl) return;
  const fc=canvasEl.getContext('2d'), w=canvasEl.width, h=canvasEl.height, cx=w/2;
  fc.clearRect(0,0,w,h);
  const aH=detectedHue||200, padV=7, tBot=h-padV, tH=tBot-padV;
  const tY=tBot-value01*tH;
  fc.beginPath(); fc.moveTo(cx,padV); fc.lineTo(cx,tBot); fc.strokeStyle='rgba(255,255,255,0.18)'; fc.lineWidth=2; fc.lineCap='round'; fc.stroke();
  if (value01>0.005) { fc.beginPath(); fc.moveTo(cx,tY); fc.lineTo(cx,tBot); fc.strokeStyle=focused?`hsl(${aH},85%,72%)`:`hsla(${aH},72%,72%,0.82)`; fc.lineWidth=2; fc.lineCap='round'; fc.stroke(); }
  fc.beginPath(); fc.roundRect(cx-(w-2)/2,tY-3,w-2,6,2);
  fc.fillStyle=focused?`hsl(${aH},80%,78%)`:'rgba(225,225,225,0.72)'; fc.fill();
}

function drawWavePreview(canvasEl, type, param1) {
  if (!canvasEl) return;
  const c2=canvasEl.getContext('2d'), w=canvasEl.width, h=canvasEl.height, mid=h/2;
  c2.clearRect(0,0,w,h); c2.strokeStyle='rgba(255,255,255,0.7)'; c2.lineWidth=1.5; c2.lineJoin='round'; c2.beginPath();
  for (let x=0;x<=w;x++) {
    const t=x/w; let y;
    switch(type) {
      case 'sine':     { y=Math.sin(t*Math.PI*2); const f=param1??0; if(f>0){let yf=y*(1+f*3.5);while(Math.abs(yf)>1)yf=Math.sign(yf)*2-yf;y=yf;} break; }
      case 'sawtooth': { y=1-2*t; const d=param1??0; if(d>0)y=Math.tanh(y*(1+d*4))/Math.tanh(1+d*4); break; }
      case 'triangle': { const s=Math.max(.01,Math.min(.99,param1??.5)); y=t<s?(t/s)*2-1:1-((t-s)/(1-s))*2; break; }
      case 'square':   { y=t<(param1??0.5)?1:-1; break; }
      case 'sub':      { y=t<0.5?0.6:-0.6; break; }
      case 'noise':    { y=Math.sin(t*71.3)*Math.cos(t*127.7)*Math.sin(t*43.1); break; }
      default:         { y=0; }
    }
    x===0?c2.moveTo(x,mid-y*(mid-3)):c2.lineTo(x,mid-y*(mid-3));
  }
  c2.stroke();
}

function drawSynthGlow() {
  if (synthGlowAlpha<=0) return;
  const cont=document.getElementById('panels-container');
  if (!cont||!cont.firstElementChild) return;
  const rect=cont.getBoundingClientRect();
  if (rect.width===0) return;
  const cx=rect.left+rect.width*0.5, cy=rect.top+rect.height*0.5, r=Math.hypot(rect.width,rect.height)*0.72;
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,`hsla(${synthGlowH},75%,52%,${synthGlowAlpha*0.22})`);
  g.addColorStop(0.5,`hsla(${synthGlowH},65%,45%,${synthGlowAlpha*0.08})`);
  g.addColorStop(1,'transparent');
  ctx.fillStyle=g; ctx.fillRect(rect.left-12,rect.top-12,rect.width+24,rect.height+24);
  synthGlowAlpha-=0.0035;
}

function drawSynthRipples() {
  const now=performance.now();
  synthRippleBoxes=synthRippleBoxes.filter(rb=>{
    const t=(now-rb.startTime)/2200; if(t<0)return true; if(t>1)return false;
    const env=t<0.12?t/0.12:Math.pow(1-(t-0.12)/0.88,1.1);
    const a=env*(0.55+0.45*Math.sin(t*Math.PI*5));
    const {rect:rr}=rb;
    ctx.save(); ctx.beginPath(); ctx.roundRect(rr.left,rr.top,rr.width,rr.height,8);
    ctx.strokeStyle=`hsla(${rb.h},85%,72%,${a*0.85})`; ctx.lineWidth=2;
    ctx.shadowColor=`hsla(${rb.h},85%,70%,${a*0.7})`; ctx.shadowBlur=20;
    ctx.stroke(); ctx.shadowBlur=0; ctx.restore(); return true;
  });
  if (showScreenRipples) screenRipples=screenRipples.filter(sr=>{
    const t=(now-sr.startTime)/3400; if(t>1)return false;
    const maxR=Math.hypot(canvas.width,canvas.height)*0.68;
    for (let ring=0;ring<3;ring++) {
      const rt=t-ring*0.13; if(rt<=0||rt>1)continue;
      const env=rt<0.1?rt/0.1:Math.pow(1-(rt-0.1)/0.9,1.6);
      ctx.beginPath(); ctx.arc(sr.cx,sr.cy,rt*maxR,0,Math.PI*2);
      ctx.strokeStyle=`hsla(${sr.h},80%,68%,${env*(1-ring*0.26)*0.17})`; ctx.lineWidth=11-ring*3; ctx.stroke();
    }
    return true;
  });
}

function drawCenterGlow() {
  if (!activeNotes.size) return;
  const cx=canvas.width/2, cy=canvas.height/2;
  const h=detectedLabel?detectedHue:hue(Math.min(...activeNotes.keys()));
  const r=60+activeNotes.size*20;
  const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  grad.addColorStop(0,`hsla(${h},80%,55%,${Math.min(activeNotes.size*.13,.4)})`);
  grad.addColorStop(1,'transparent');
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill();
}

function drawPolygon() {
  if (activeNotes.size<2) return;
  const pos=[...activeNotes.keys()].map(notePos), h=detectedLabel?detectedHue:hue([...activeNotes.keys()][0]);
  ctx.strokeStyle=`hsla(${h},85%,65%,${detectedLabel?0.5:0.18})`; ctx.lineWidth=1.2;
  for (let i=0;i<pos.length;i++) for (let j=i+1;j<pos.length;j++) { ctx.beginPath(); ctx.moveTo(pos[i].x,pos[i].y); ctx.lineTo(pos[j].x,pos[j].y); ctx.stroke(); }
}

function drawHintNotes() {
  if (!hintNotes.length) return;
  const now=performance.now();
  for (const hn of hintNotes) {
    if (hn.alpha<=0) continue;
    const pos=notePos(hn.midi), pulse=Math.sin(now/380)*3, h=hue(hn.midi);
    ctx.shadowColor=`hsla(${h},90%,70%,${hn.alpha})`; ctx.shadowBlur=22;
    ctx.beginPath(); ctx.arc(pos.x,pos.y,15+pulse,0,Math.PI*2); ctx.strokeStyle=`hsla(${h},90%,72%,${hn.alpha*.85})`; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.arc(pos.x,pos.y,5,0,Math.PI*2); ctx.fillStyle=`hsla(${h},90%,80%,${hn.alpha*.55})`; ctx.fill();
    ctx.shadowBlur=0;
  }
}

function drawActiveNotes() {
  const now=performance.now();
  for (const [midi,note] of activeNotes) {
    const pos=notePos(midi), pulse=Math.sin((now-note.startTime)/180)*3, h=hue(midi);
    ctx.shadowColor=`hsl(${h},90%,70%)`; ctx.shadowBlur=24;
    ctx.beginPath(); ctx.arc(pos.x,pos.y,9+pulse,0,Math.PI*2); ctx.fillStyle=`hsl(${h},90%,68%)`; ctx.fill();
    ctx.shadowBlur=0;
  }
}

function drawParticles() {
  for (let i=particles.length-1;i>=0;i--) {
    const p=particles[i];
    if (p.type==='burst-ring') {
      p.r+=p.speed; p.alpha-=0.012;
      if (p.alpha<=0||p.r>=p.maxR){particles.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.strokeStyle=`hsla(${p.h},90%,70%,${p.alpha})`; ctx.lineWidth=p.lineWidth; ctx.stroke();
    } else if (p.type==='ring') {
      p.r+=p.speed; p.alpha-=0.018;
      if (p.alpha<=0||p.r>=p.maxR){particles.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.strokeStyle=`hsla(${p.h},90%,68%,${p.alpha})`; ctx.lineWidth=1.5; ctx.stroke();
    } else if (p.type==='spark'||p.type==='synth-spark') {
      p.x+=p.vx; p.y+=p.vy; p.vx*=0.94; p.vy*=0.94; p.alpha-=p.decay??0.025;
      if (p.alpha<=0){particles.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`hsla(${p.h},90%,70%,${p.alpha})`; ctx.fill();
    }
  }
}

function drawKeyboard(kCtx) {
  const WP=[0,2,4,5,7,9,11], W2B={0:1,2:3,5:6,7:8,9:10};
  const maxW=Math.min(canvas.width-60,720), NW=14, NO=2;
  const kW=maxW/NW, kH=kW*4, bW=kW*0.58, bH=kH*0.60;
  const sX=(canvas.width-maxW)/2, sY=canvas.height-kH-14-kbRiseOffset;
  const _hintsOn = showKeyGuides && !earTraining && gameMode==='play' && currentChallenge && (gamePhase==='hint'||gamePhase==='play');
  const cPCs = new Set(_hintsOn ? noteInputSystem.hintsFor(currentChallenge.notes).map(m => m%12) : []);
  const aPCs=new Set([...activeNotes.keys()].map(m=>m%12));
  const rPCs=new Set([...remoteNotes.keys()].map(m=>m%12));
  const fS=Math.max(8,Math.round(kW*0.3)), bfS=Math.max(6,Math.round(bW*0.42));
  const lS=Math.max(7,Math.round(kW*0.25)), blS=Math.max(6,Math.round(bW*0.34));
  const k2l={}; for(const [k,v] of Object.entries(kbMap)) k2l[v]=k===';'?';':k.toUpperCase();
  if (FX.keyGuides) { kCtx.save(); kCtx.font='13px monospace'; kCtx.textAlign='left'; kCtx.fillStyle='rgba(255,255,255,0.30)'; kCtx.fillText(`Z ◄  C${kbOctave}  ► X`,sX,sY-10); kCtx.restore(); }
  let wi=0;
  for (let oct=0;oct<NO;oct++) for (const pc of WP) {
    const x=sX+wi*kW, m=(kbOctave+oct)*12+pc;
    kCtx.beginPath(); kCtx.rect(x+0.5,sY,kW-1,kH);
    kCtx.fillStyle=aPCs.has(pc)?`hsla(${hue(m)},75%,55%,0.45)`:rPCs.has(pc)?'hsla(185,75%,55%,0.45)':cPCs.has(pc)?`hsla(${hue(m)},65%,22%,0.9)`:pc===0?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.05)';
    kCtx.fill(); kCtx.strokeStyle='rgba(255,255,255,0.1)'; kCtx.lineWidth=0.5; kCtx.stroke();
    const lb=k2l[m]; if(lb && FX.keyGuides){kCtx.font=`${lS}px monospace`;kCtx.textAlign='center';kCtx.fillStyle=(aPCs.has(pc)||rPCs.has(pc))?'rgba(0,0,0,0.55)':'rgba(255,255,255,0.30)';kCtx.fillText(lb,x+kW/2,sY+lS+3);}
    if(aPCs.has(pc)||rPCs.has(pc)||cPCs.has(pc)){kCtx.font=`bold ${fS}px monospace`;kCtx.textAlign='center';kCtx.fillStyle=aPCs.has(pc)?`hsl(${hue(m)},90%,88%)`:rPCs.has(pc)?'hsl(185,90%,88%)':`hsla(${hue(m)},85%,70%,0.9)`;kCtx.fillText(NOTE_NAMES[pc],x+kW/2,sY+kH-7);}
    wi++;
  }
  wi=0;
  for (let oct=0;oct<NO;oct++) for (const pc of WP) {
    if (pc in W2B) {
      const bPc=W2B[pc], m=(kbOctave+oct)*12+bPc, bx=sX+(wi+1)*kW-bW/2;
      kCtx.beginPath(); kCtx.rect(bx,sY,bW,bH);
      kCtx.fillStyle=aPCs.has(bPc)?`hsla(${hue(m)},75%,48%,0.45)`:rPCs.has(bPc)?'hsla(185,75%,48%,0.45)':cPCs.has(bPc)?`hsla(${hue(m)},65%,18%,1)`:'rgb(12,12,12)';
      kCtx.fill(); kCtx.strokeStyle='rgba(255,255,255,0.08)'; kCtx.lineWidth=0.5; kCtx.stroke();
      const lb=k2l[m]; if(lb && FX.keyGuides){kCtx.font=`${blS}px monospace`;kCtx.textAlign='center';kCtx.fillStyle=(aPCs.has(bPc)||rPCs.has(bPc))?'rgba(0,0,0,0.5)':'rgba(255,255,255,0.38)';kCtx.fillText(lb,bx+bW/2,sY+blS+4);}
      if(aPCs.has(bPc)||rPCs.has(bPc)||cPCs.has(bPc)){kCtx.font=`bold ${bfS}px monospace`;kCtx.textAlign='center';kCtx.fillStyle=aPCs.has(bPc)?`hsl(${hue(m)},90%,88%)`:rPCs.has(bPc)?'hsl(185,90%,88%)':`hsla(${hue(m)},85%,70%,0.9)`;kCtx.fillText(NOTE_NAMES[bPc],bx+bW/2,sY+bH-5);}
    }
    wi++;
  }
}

function getKeyAtPos(px, py) {
  const WP=[0,2,4,5,7,9,11], W2B={0:1,2:3,5:6,7:8,9:10};
  const maxW=Math.min(canvas.width-60,720), kW=maxW/14, kH=kW*4, bW=kW*0.58, bH=kH*0.60;
  const sX=(canvas.width-maxW)/2, sY=canvas.height-kH-14-kbRiseOffset;
  if (py<sY||py>sY+kH||px<sX||px>sX+maxW) return null;
  let wi=0;
  for (let oct=0;oct<2;oct++) for (const pc of WP) {
    if (pc in W2B) { const bx=sX+(wi+1)*kW-bW/2; if(py<sY+bH&&px>=bx&&px<bx+bW) return (kbOctave+oct)*12+W2B[pc]; }
    wi++;
  }
  wi=0;
  for (let oct=0;oct<2;oct++) for (const pc of WP) {
    const x=sX+wi*kW; if(px>=x&&px<x+kW) return (kbOctave+oct)*12+pc; wi++;
  }
  return null;
}

function drawLabel() {
  if (!detectedLabel) { labelEl.style.opacity=0; return; }
  labelEl.style.opacity=Math.max(0,labelFade);
  labelEl.style.color=`hsl(${detectedHue},85%,72%)`;
  labelEl.style.textShadow=`0 0 28px hsl(${detectedHue},85%,72%)`;
  labelEl.textContent=detectedLabel;
  labelFade-=0.004;
}

function drawAudioOut() {
  const cx=patchCanvas.width/2, cy=patchCanvas.height/2;
  const patched = registry.patchesTo('audio-out-0').length > 0;
  patchCtx.save();
  patchCtx.font='bold 8px monospace'; patchCtx.textAlign='center';
  patchCtx.fillStyle=`rgba(255,255,255,${patched?0.45:0.18})`;
  patchCtx.fillText('OUT', cx, cy+26);
  patchCtx.restore();
}

// ─────────────────────────────────────────────────────────────
// SECTION 12 — GAME ENGINE
// ─────────────────────────────────────────────────────────────
class GameEngine {
  constructor(registry, config) {
    this.registry = registry;
    this.config   = config;
  }

  get score()  { return score; }
  set score(v) { score = v; }

  startGame() {
    const root  = document.getElementById('key-root').value;
    const scale = document.getElementById('key-scale').value;
    gameKeyPool  = buildKeyPool(root, scale) ?? CHORD_POOL;
    gameKeyLabel = `${root} ${scale}`;
    gameMode     = 'play';
    challengeDeck = [];
    streakCount = 0; streakLevels = 0; idleTimeouts = 0;
    lockedOut = false; remoteLockedOut = false;
    if (_isCompetitive() && multiplayer.isConnected) {
      remoteScore = 0; roundsPlayed = 0;
      _updateRemoteScore();
    }

    modeBtnEl.textContent = 'PAUSE'; modeBtnEl.classList.add('active');
    hudEl.style.display = 'block';

    challengeEl.style.display = 'block';
    challengeNameEl.textContent = gameKeyLabel.toUpperCase();
    challengeNameEl.style.color = `hsl(${rootHue(root)},85%,72%)`;
    challengeNameEl.style.textShadow = `0 0 28px hsl(${rootHue(root)},85%,62%)`;
    hintLabelEl.textContent = 'key set — good luck';

    spawnChordBurst(rootHue(root));
    spawnSynthHit(rootHue(root));
    setTimeout(() => { if (gameMode === 'play') this.startNextChallenge(); }, 1200);
  }

  stopGame() {
    gameMode = 'practice';
    earTraining = false;
    currentChallenge = null;
    hintNotes = [];
    multiplayer.send('GAME_MODE', { mode: 'practice' });
    challengeEl.style.display = 'none';
    timerBarEl.style.display = 'none';
    timerSecsEl.style.display = 'none';
    modeBtnEl.textContent = 'PLAY'; modeBtnEl.classList.remove('active');
  }

  startNextChallenge() {
    if (gameMode !== 'play') return;
    if (challengeDeck.length === 0) this._buildDeck();
    if (currentChallenge && challengeDeck.length > 1 &&
        challengeDeck[0].display === currentChallenge.display) {
      const j = 1+Math.floor(Math.random()*(challengeDeck.length-1));
      [challengeDeck[0],challengeDeck[j]] = [challengeDeck[j],challengeDeck[0]];
    }
    const chord = challengeDeck.shift();
    currentChallenge = { ...chord, h: rootHue(chord.display) };
    phrasePeakNotes  = 0;
    phraseMatched    = false;
    _wrongPenaltyGiven = false;
    _bonusExtGiven     = false;
    _bonusPentGiven    = false;
    gamePhase        = 'hint';
    phaseStart       = performance.now();

    challengeEl.style.display = 'block';
    if (earTraining) {
      challengeNameEl.textContent = '?';
      challengeNameEl.style.color = 'rgba(255,255,255,0.35)';
      challengeNameEl.style.textShadow = 'none';
      challengeNameEl.style.cursor = 'pointer';
      hintLabelEl.textContent = 'tap ♪ to replay';
      hintNotes = [];
      setTimeout(() => playEarTrainingChord(chord.notes), 100);
    } else {
      challengeNameEl.textContent = chord.display;
      challengeNameEl.style.color = `hsl(${currentChallenge.h},85%,72%)`;
      challengeNameEl.style.textShadow = `0 0 28px hsl(${currentChallenge.h},85%,62%)`;
      challengeNameEl.style.cursor = '';
      hintLabelEl.textContent = 'watch the ring';
      hintNotes = chord.notes.map(pc => ({ midi: pcToMidi(normPc(pc)), alpha: 0 }));
    }
    challengeNameEl.style.opacity = '1';
    timerBarEl.style.display = 'none';
    timerSecsEl.style.display = 'none';
    multiplayer.send('CHALLENGE', { display: chord.display, notes: chord.notes, earTraining });
  }

  _buildDeck() {
    const maxDiff = currentLevel().maxDiff;
    let src = (gameKeyPool || CHORD_POOL).filter(c => c.diff <= maxDiff);
    // At high levels, supplement scale key pool with hard chords from CHORD_POOL
    if (gameKeyPool && maxDiff >= 6) {
      const hard = CHORD_POOL.filter(c => c.diff >= 6 && c.diff <= maxDiff);
      src = [...src, ...hard];
    }
    const groups = [];
    for (let d = 1; d <= maxDiff; d++) {
      const g = [...src.filter(c => c.diff === d)];
      shuffle(g); groups.push(...g);
    }
    challengeDeck = groups.length ? groups : [...src];
    if (!challengeDeck.length) { challengeDeck = [...CHORD_POOL]; shuffle(challengeDeck); }
  }

  checkSuccess() {
    if (gameMode !== 'play' || gamePhase !== 'play' || !currentChallenge) return;
    const required = currentChallenge.notes.map(normPc);

    if (_isCompetitive() && multiplayer.isConnected) {
      const localPCs  = new Set([...activeNotes.keys()].map(m => normPc(midiToPitchClass(m))));
      const remotePCs = new Set([...remoteNotes.keys()].map(m => normPc(midiToPitchClass(m))));
      if (!lockedOut       && required.every(pc => localPCs.has(pc)))  { this.triggerSuccess('host');   return; }
      if (!remoteLockedOut && required.every(pc => remotePCs.has(pc))) { this.triggerSuccess('client'); return; }
      // Wrong chord → lockout for the offending side
      if (!_wrongPenaltyGiven) {
        const wrongLocal  = !lockedOut       && localPCs.size  >= required.length && !required.every(pc => localPCs.has(pc));
        const wrongRemote = !remoteLockedOut && remotePCs.size >= required.length && !required.every(pc => remotePCs.has(pc));
        if (wrongLocal || wrongRemote) {
          _wrongPenaltyGiven = true;
          const cfg = this.config.competitive;
          if (wrongLocal) {
            lockedOut = true;
            hintLabelEl.textContent = 'wrong — locked out';
            feedbackEl.textContent = '✗'; feedbackEl.style.color = '#ff4040';
            feedbackEl.style.textShadow = '0 0 20px #ff2020'; feedbackAlpha = 0.8;
            setTimeout(() => { lockedOut = false; if (gamePhase === 'play') hintLabelEl.textContent = ''; }, cfg.lockoutMs);
          }
          if (wrongRemote) {
            remoteLockedOut = true;
            multiplayer.send('LOCKOUT', { ms: cfg.lockoutMs });
            setTimeout(() => { remoteLockedOut = false; }, cfg.lockoutMs);
          }
        }
      }
      return;
    }

    // Co-op / solo
    const played = new Set([...activeNotes.keys(), ...remoteNotes.keys()].map(m => normPc(midiToPitchClass(m))));
    if (required.every(pc => played.has(pc))) { this.triggerSuccess(); return; }
    if (!_wrongPenaltyGiven && played.size >= required.length) {
      _wrongPenaltyGiven = true;
      const pen = this.config.scoring.wrongChordPenalty;
      score = Math.max(0, score - pen);
      scoreValEl.textContent = score.toLocaleString();
      feedbackEl.textContent = `-${pen}`;
      feedbackEl.style.color = '#ff6060';
      feedbackEl.style.textShadow = '0 0 20px #ff2020';
      feedbackAlpha = 0.8;
    }
  }

  triggerSuccess(winner = null) {
    if (gamePhase === 'success') return;
    gamePhase  = 'success';
    phaseStart = performance.now();
    phraseMatched = true;
    timerBarEl.style.display = 'none';
    timerSecsEl.style.display = 'none';

    idleTimeouts = 0;
    const _rootPos = notePos(pcToMidi(normPc(currentChallenge.notes[0]??'C')));
    const _chordId = currentChallenge.display.match(/^[A-G][#b]?/)?.[0] ?? currentChallenge.display;
    const _newChord = _chordId !== lastBurstChord;
    if (_newChord) { lastBurstChord = _chordId; chordBurstStrength = 1.0; }
    else           { chordBurstStrength = Math.max(0.08, chordBurstStrength * 0.55); }
    playSuccessSound(currentChallenge.notes);

    if (_isCompetitive() && multiplayer.isConnected) {
      this._addScoreCompetitive(winner);
      const iWon = winner === 'host';
      if (iWon) {
        spawnChordBurst(currentChallenge.h, _rootPos.x, _rootPos.y, chordBurstStrength, true);
        if (_newChord) spawnSynthHit(currentChallenge.h);
        feedbackEl.textContent      = `✓ you got it`;
        feedbackEl.style.color      = `hsl(${currentChallenge.h},85%,75%)`;
        feedbackEl.style.textShadow = `0 0 40px hsl(${currentChallenge.h},85%,60%)`;
      } else {
        feedbackEl.textContent      = `✗ they got it`;
        feedbackEl.style.color      = '#ff6060';
        feedbackEl.style.textShadow = '0 0 20px #ff2020';
      }
      feedbackAlpha = 1;
      multiplayer.send('SUCCESS', { display: currentChallenge.display, h: currentChallenge.h, winner });
      setTimeout(() => { if (gameMode === 'play') this.startNextChallenge(); }, 1500);
    } else {
      // Capture extension/pentatonic targets for the bonus window (solo/co-op only)
      _bonusExtPCs  = new Set(chordExtensionPCs(currentChallenge.notes));
      _bonusPentPCs = new Set(pentatonicPCs(currentChallenge.notes[0]));
      this._addScore();
      spawnChordBurst(currentChallenge.h, _rootPos.x, _rootPos.y, chordBurstStrength, true);
      if (_newChord) spawnSynthHit(currentChallenge.h);
      feedbackEl.textContent   = earTraining ? `✓  ${currentChallenge.display}` : '✓';
      feedbackEl.style.color   = `hsl(${currentChallenge.h},85%,75%)`;
      feedbackEl.style.textShadow = `0 0 40px hsl(${currentChallenge.h},85%,60%)`;
      feedbackAlpha = 1;
      multiplayer.send('SUCCESS', { display: currentChallenge.display, h: currentChallenge.h });
      setTimeout(() => { if (gameMode === 'play') this.startNextChallenge(); }, 2000);
    }
  }

  triggerFail(reason = 'miss') {
    if (gamePhase !== 'play') return;
    gamePhase  = 'fail';
    phaseStart = performance.now();
    timerBarEl.style.display = 'none';
    timerSecsEl.style.display = 'none';

    if (_isCompetitive() && multiplayer.isConnected) {
      // Competitive timeout = draw, no score change, clear lockouts
      lockedOut = false; remoteLockedOut = false;
      if (reason === 'timeout') {
        roundsPlayed++;
        if (roundsPlayed % GAME_CONFIG.competitive.roundsPerLevel === 0) this._doLevelUp(false);
        multiplayer.send('SCORE_UPDATE', { hostScore: score, clientScore: remoteScore, levelIdx, roundsPlayed });
      }
      playFailSound();
      feedbackEl.textContent      = 'draw';
      feedbackEl.style.color      = 'rgba(255,255,255,0.4)';
      feedbackEl.style.textShadow = 'none';
      feedbackAlpha = 0.8;
      challengeNameEl.style.opacity = '0.35';
      multiplayer.send('FAIL', { display: currentChallenge?.display ?? '', draw: true });
      setTimeout(() => { if (gameMode === 'play' && gamePhase === 'fail') this.startNextChallenge(); }, 1200);
      return;
    }

    streakCount = 0;
    if (streakLevels > 0) streakLevels--;
    this._updateStreakDisplay();
    if (reason === 'timeout') {
      const pen = this.config.scoring.timeoutPenalty;
      score = Math.max(0, score - pen);
      scoreValEl.textContent = score.toLocaleString();
      if (phrasePeakNotes === 0) {
        idleTimeouts++;
        if (idleTimeouts >= 10) {
          setTimeout(() => { gameEngine.stopGame(); consolePrint('auto-paused — you seem to be away', 8000); }, 600);
          return;
        }
      } else {
        idleTimeouts = 0;
      }
    }

    playFailSound();
    feedbackEl.textContent   = earTraining ? `✗  ${currentChallenge.display}` : '✗';
    feedbackEl.style.color   = '#ff4040';
    feedbackEl.style.textShadow = '0 0 30px #ff2020';
    feedbackAlpha = 1;
    challengeNameEl.style.opacity = '0.35';
    multiplayer.send('FAIL', { display: currentChallenge?.display ?? '' });
    setTimeout(() => { if (gameMode === 'play' && gamePhase === 'fail') this.startNextChallenge(); }, 1500);
  }

  _addScore() {
    const cfg = this.config.scoring;
    let pts = cfg.basePoints;
    if (challengeTimerSecs > 0) {
      const frac = Math.max(0, 1-(performance.now()-playPhaseStart)/(challengeTimerSecs*1000));
      pts += Math.round(cfg.timeBonusMax * frac);
    }
    streakCount++;
    if (streakCount >= 4) {
      streakCount = 0;
      streakLevels++;
      triggerStreakFlash(streakLevels);
      if (streakLevels >= 5) {
        streakLevels = 0;
        this._doLevelUp(true);
      }
    }
    pts += streakLevels * cfg.streakBonusPerHit;
    if (earTraining) pts = Math.round(pts * 1.5);
    score += pts;
    scoreValEl.textContent = score.toLocaleString();
    this._updateStreakDisplay();
    saveState();
    multiplayer.send('SCORE_UPDATE', { score, levelIdx, streakCount, streakLevels });
  }

  _addScoreCompetitive(winner) {
    const cfg = this.config.scoring;
    let pts = cfg.basePoints;
    if (challengeTimerSecs > 0) {
      const frac = Math.max(0, 1 - (performance.now() - playPhaseStart) / (challengeTimerSecs * 1000));
      pts += Math.round(cfg.timeBonusMax * frac);
    }
    lockedOut = false; remoteLockedOut = false;
    roundsPlayed++;
    if (winner === 'host')   { score += pts; scoreValEl.textContent = score.toLocaleString(); }
    if (winner === 'client') { remoteScore += pts; }
    _updateRemoteScore();
    if (roundsPlayed % GAME_CONFIG.competitive.roundsPerLevel === 0) this._doLevelUp(false);
    saveState();
    multiplayer.send('SCORE_UPDATE', { hostScore: score, clientScore: remoteScore, levelIdx, roundsPlayed });
  }

  _doLevelUp(streakTriggered = false) {
    const levels = this.config.levels;
    if (levelIdx >= levels.length - 1) return;
    levelIdx++;
    const lv = levels[levelIdx];
    const t = lv.paramUnlock;
    if (t && registry.countByType(t) === 0) { registry.addModule(t); audioGraph.ensure(); }
    levelValEl.textContent = lv.label;
    this._flashLevelUp(streakTriggered);
    if (levelIdx >= 1) shopBtnEl.classList.remove('locked');
    if (levelIdx >= 9) _unlockEarMode();
    if (streakTriggered) {
      setTimeout(() => {
        if (gameMode === 'play') {
          gameEngine.stopGame();
          consolePrint('▲ level up — take a moment. visit the shop.', 10000);
        }
      }, 2500);
    }
  }

  _updateStreakDisplay() {
    if (streakLevels === 0 && streakCount === 0) { streakValEl.style.opacity = '0'; return; }
    const pips = '▮'.repeat(streakCount) + '▯'.repeat(4 - streakCount);
    const h = streakLevels < 2 ? 120 : streakLevels < 4 ? 42 : 0;
    streakValEl.textContent = streakLevels > 0 ? `×${streakLevels}  ${pips}` : pips;
    streakValEl.style.color = `hsl(${h},75%,62%)`;
    streakValEl.style.opacity = '1';
    streakValEl.classList.remove('pop');
    requestAnimationFrame(() => streakValEl.classList.add('pop'));
  }

  checkBonusNote(midi) {
    const pc = midi % 12;
    const cfg = this.config.scoring;
    let gained = 0;
    if (!_bonusExtGiven && _bonusExtPCs.has(pc)) {
      _bonusExtGiven = true;
      gained += cfg.extensionBonus;
    }
    if (!_bonusPentGiven && _bonusPentPCs.has(pc)) {
      _bonusPentGiven = true;
      gained += cfg.pentatonicBonus;
    }
    if (gained > 0) {
      score += gained;
      scoreValEl.textContent = score.toLocaleString();
      feedbackEl.textContent = `+${gained}`;
      feedbackEl.style.color = `hsl(${currentChallenge?.h ?? 180},85%,75%)`;
      feedbackEl.style.textShadow = `0 0 30px hsl(${currentChallenge?.h ?? 180},85%,60%)`;
      feedbackAlpha = 0.9;
      saveState();
    }
  }

  _flashLevelUp(big = false) {
    const lv = this.config.levels[levelIdx];
    levelupEl.textContent = lv?.label.toUpperCase() ?? `LEVEL ${levelIdx+1}`;
    levelupAlpha = 1;
    levelupEl.style.opacity = '1';
    levelupEl.style.transform = 'translate(-50%,-50%) scale(1)';
    spawnChordBurst(200);
    triggerPhosphorFlash();
    if (big) { setTimeout(triggerPhosphorFlash, 180); setTimeout(triggerPhosphorFlash, 360); }
    playLevelUpSound();
  }

  update() {
    if (gameMode !== 'play') return;
    const elapsed = performance.now() - phaseStart;

    if (gamePhase === 'hint') {
      const hintMs = earTraining ? Math.max(currentLevel().hintMs, 2500) : currentLevel().hintMs;
      const t = Math.min(elapsed/hintMs, 1);
      const a = t < 0.25 ? t/0.25 : t < 0.65 ? 1 : 1-(t-0.65)/0.35;
      hintNotes.forEach(h => h.alpha = Math.max(0, a));
      if (elapsed >= hintMs) {
        gamePhase      = 'play';
        phaseStart     = performance.now();
        playPhaseStart = phaseStart;
        hintNotes      = [];
        challengeNameEl.style.opacity = '0.5';
        hintLabelEl.textContent = '';
        timerBarEl.style.display  = 'block';
        timerSecsEl.style.display = 'block';
      }
    }

    if (gamePhase === 'play' && challengeTimerSecs > 0) {
      const frac = Math.max(0, 1-(performance.now()-playPhaseStart)/(challengeTimerSecs*1000));
      timerFillEl.style.width = `${frac*100}%`;
      timerFillEl.style.background = `hsl(${Math.round(frac*120)},75%,55%)`;
      if (frac <= 0) this.triggerFail('timeout');
    }

    if (levelupAlpha > 0) {
      levelupAlpha -= 0.008;
      levelupEl.style.opacity = Math.max(0, levelupAlpha);
      const sc = 1+(1-levelupAlpha)*0.4;
      levelupEl.style.transform = `translate(-50%,-50%) scale(${sc})`;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 13 — PERSISTENCE
// ─────────────────────────────────────────────────────────────
function saveState() {
  const data = {
    score, levelIdx, streakCount, streakLevels,
    controlsBarPos, useMidiClock, internalBpm, internalBpmActive,
    fx: { ...FX },
    modules: [...registry.modules.values()].filter(m=>m.type!=='audio-out').map(m => ({ type:m.type, params:{...m.params} })),
    patches: registry.patches,
    panelPositions: [...uiRenderer.panelMap.entries()].map(([id,el]) => ({
      id, left: parseInt(el.style.left) || 0, top: parseInt(el.style.top) || 0,
    })),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    score        = data.score        ?? 0;
    levelIdx     = Math.min(data.levelIdx ?? 0, GAME_CONFIG.levels.length-1);
    streakCount  = data.streakCount  ?? 0;
    streakLevels = data.streakLevels ?? (data.streak ? Math.min(Math.floor(data.streak / 4), 4) : 0);
    if (data.controlsBarPos) controlsBarPos = data.controlsBarPos;
    if (data.useMidiClock !== undefined) useMidiClock = data.useMidiClock;
    if (data.internalBpm) { internalBpm = data.internalBpm; internalBpmActive = data.internalBpmActive ?? false; }
    if (internalBpmActive) bpmEl.textContent = `${internalBpm} bpm`;
    if (data.fx) Object.assign(FX, data.fx);
    scoreValEl.textContent = score.toLocaleString();
    levelValEl.textContent = GAME_CONFIG.levels[levelIdx]?.label ?? 'LEVEL 1';
    hudEl.style.display = 'block';

    // Pre-populate saved positions so _positionPanel places panels correctly on creation
    if (data.panelPositions?.length) {
      data.panelPositions.forEach(({ id, left, top }) => {
        uiRenderer.positions[id] = { left: parseInt(left), top: parseInt(top) };
      });
    }

    if (data.modules?.length) {
      data.modules.forEach(m => { if (m.type === 'audio-out') return; try { registry.addModule(m.type, m.params); } catch(e) {} });
      if (data.patches?.length) {
        data.patches.forEach(p => { try { registry.addPatch(p.fromId, p.fromPort, p.toId, p.toPort); } catch(e) {} });
      }
      // Migrate old saves: add explicit downstream patches for modules that relied on implicit routing
      const _envM  = registry.getModulesByType('env')[0];
      const _filtM = registry.getModulesByType('filter')[0];
      const _fxM   = registry.getModulesByType('fx')[0];
      // OSCs with no outgoing patch → wire to ENV if it exists
      if (_envM) {
        registry.getOscModules().forEach(m => {
          if (m.type !== 'osc-noise' && registry.patchesFrom(m.id).length === 0)
            registry.addPatch(m.id, 'audio', _envM.id, registry.nextInputPort(_envM.id));
        });
      }
      // ENV with no outgoing patch → wire to FILTER or audio-out
      if (_envM && registry.patchesFrom(_envM.id).length === 0) {
        if (_filtM) registry.addPatch(_envM.id, 'env', _filtM.id, registry.nextInputPort(_filtM.id));
        else        registry.addPatch(_envM.id, 'env', 'audio-out-0', 'in');
      }
      // FILTER with no outgoing patch → wire to FX or audio-out
      if (_filtM && registry.patchesFrom(_filtM.id).length === 0) {
        if (_fxM) registry.addPatch(_filtM.id, 'audio', _fxM.id, registry.nextInputPort(_fxM.id));
        else      registry.addPatch(_filtM.id, 'audio', 'audio-out-0', 'in');
      }
      // FX with no outgoing patch → wire to audio-out
      if (_fxM && registry.patchesFrom(_fxM.id).length === 0)
        registry.addPatch(_fxM.id, 'audio', 'audio-out-0', 'in');
    }

    // Clear cable physics so springs initialise from correct jack positions
    patchSystem.cablePhysics.clear();
    if (levelIdx >= 1) shopBtnEl.classList.remove('locked');
    if (levelIdx >= 9) _unlockEarMode();
    return true;
  } catch(e) { return false; }
}
// ─────────────────────────────────────────────────────────────
// SECTION 20 — FLOWER OF LIFE VISUAL SYSTEM
// ─────────────────────────────────────────────────────────────
const FOL_RINGS = 5;
let folScale = 1.6; // user-adjustable via 'fol <n>' command

function folBoundR() {
  const kH  = (Math.min(canvas.width - 60, 720) / 14) * 4; // keyboard height
  const pad = 16;
  return Math.min(
    canvas.width  / 2 - pad,
    canvas.height / 2 - kH - 14 - kbRiseOffset - pad,  // clear keyboard bottom
    canvas.height / 2 - 60              // clear top HUD
  ) * folScale;
}
function folBaseR() { return folBoundR() / 3; }
function effectiveBpm() {
  if (useMidiClock && bpm > 0) return bpm;
  return internalBpmActive ? internalBpm : 120;
}
function folBeatMs()  { return 60000 / effectiveBpm(); }

function folNodePos(fifthsIdx, ring) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const angle = (fifthsIdx / 12) * Math.PI * 2 - Math.PI / 2;
  const r = folBaseR() * ring;
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

// State
let folCrossRipples   = [];   // { x, y, startTime, h } — intersection pulses
const folActiveCrossings = new Set(); // 'midiA-midiB' pairs currently intersecting
let folPhosphorAlpha  = 0;    // level-up bounded form flash
let folNodeLabelStart = -Infinity; // timestamp for node name flash command
let folStreakAlpha     = 0;    // streak infinite-tile flash
const folNoteState    = new Map(); // midi → { strikeTimes:[], lastBeat, hops:[] }

// Segment-segment intersection (returns point or null)
function lineSegIntersect(x1,y1,x2,y2, x3,y3,x4,y4) {
  const d = (x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;
  const u = -((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/d;
  return (t>0&&t<1&&u>0&&u<1) ? {x:x1+t*(x2-x1), y:y1+t*(y2-y1)} : null;
}

// Compute extension PCs for a known chord spec (same intervals as getHarmonicHops).
function chordExtensionPCs(notes) {
  const pcs = notes.map(n => NOTE_NAMES.indexOf(normPc(n)));
  const rootPC = pcs[0];
  if (rootPC < 0) return [];
  const ivl = pc => ((pc - rootPC + 12) % 12);
  const has = i => pcs.some(pc => ivl(pc) === i);
  const result = [];
  const add = (...ss) => ss.forEach(s => result.push((rootPC + s + 120) % 12));
  if      (has(4) && has(7) && !has(10) && !has(11)) add(11, 10, 2, 9);   // major triad → maj7, m7, 9, 6
  else if (has(4) && has(7) && has(10))               add(2, 9, 1, 6);    // dom7 → 9, 13, b9, #11
  else if (has(4) && has(7) && has(11))               add(2, 6, 9);       // maj7 → 9, #11, 13
  else if (has(3) && has(7) && !has(10))              add(10, 2, 9);      // minor triad → m7, 9, M6
  else if (has(3) && has(7))                          add(2, 5);          // minor 7 → 9, 11
  else if (has(2) && has(7))                          add(4, 10, 11);     // sus2 → 3, m7, maj7
  else if (has(5) && has(7))                          add(3, 4, 10);      // sus4 → 3, M3, m7
  return result;
}

// Pentatonic PCs rooted on a note name.
function pentatonicPCs(rootNote) {
  const rootPC = NOTE_NAMES.indexOf(normPc(rootNote));
  if (rootPC < 0) return [];
  return [0, 2, 4, 7, 9].map(i => (rootPC + i) % 12);
}

// Return preferred hop fifths-positions based on harmonic context.
// Suggests chord extensions: triad→7th, 7th→9th, etc., or pentatonic.
function getHarmonicHops(targetFi) {
  if (activeNotes.size < 2) return [];
  const activePCs   = new Set([...activeNotes.keys()].map(m => m % 12));
  const activeFis   = new Set([...activePCs].map(pc => (pc * 7) % 12));
  const rootStr     = detectedLabel?.match(/^[A-G][#b]?/)?.[0] ?? '';
  const rootPC      = NOTE_NAMES.indexOf(ENHARMONIC[rootStr] ?? rootStr); // -1 if unknown
  const preferred   = []; // chromatic PCs to suggest

  if (rootPC >= 0) {
    const ivl  = pc => ((pc - rootPC + 12) % 12);
    const has  = i  => [...activePCs].some(pc => ivl(pc) === i);
    const add  = (...semitones) => semitones.forEach(s => preferred.push((rootPC + s + 120) % 12));

    if (has(4) && has(7)) {
      if      (!has(10) && !has(11)) add(11, 10, 2, 9);   // major triad  → maj7, m7, 9, 6
      else if (has(10))              add(2, 9, 1, 6);       // dom7         → 9, 13, b9, #11
      else if (has(11))              add(2, 6, 9);          // maj7         → 9, #11, 13
    } else if (has(3) && has(7)) {
      if (!has(10))                  add(10, 2, 9);         // minor triad  → m7, 9, M6
      else                           add(2, 5);             // minor 7      → 9, 11
    } else if (has(2) && has(7)) {
      add(4, 10, 11);                                       // sus2         → 3, m7, maj7
    } else if (has(5) && has(7)) {
      add(3, 4, 10);                                        // sus4         → 3, M3, m7
    }
  }

  // Supplement / fallback: pentatonic of the bolt's own root note
  if (preferred.length < 2) {
    const boltPC = (targetFi * 7) % 12;
    [0, 2, 4, 7, 9].forEach(i => preferred.push((boltPC + i) % 12));
  }

  // Convert to fifths positions, dedupe, exclude already-active notes
  return [...new Set(preferred.map(pc => (pc * 7) % 12))].filter(f => !activeFis.has(f));
}

// Pick 0-2 nearby ring-1 nodes to route the bolt through (node-hopping).
// Prefers harmonically meaningful extensions over random adjacency.
function computeHops(fi, chaos) {
  if (!chaos || Math.random() >= chaos * 0.38) return [];
  const preferred = getHarmonicHops(fi);
  const numHops   = chaos > 0.55 && Math.random() < 0.45 ? 2 : 1;
  const hops = []; let curFi = fi;

  for (let i = 0; i < numHops; i++) {
    let hopFi;
    // 70% chance: pick from harmonically preferred nodes within angular reach
    if (preferred.length > 0 && Math.random() < 0.70) {
      const reachable = preferred.filter(pfi => {
        const dist = Math.min(Math.abs(pfi - curFi), 12 - Math.abs(pfi - curFi));
        return dist >= 1 && dist <= 4;
      });
      if (reachable.length > 0) hopFi = reachable[Math.floor(Math.random() * reachable.length)];
    }
    // Fallback: random adjacent
    if (hopFi === undefined) {
      const sign  = Math.random() < 0.5 ? 1 : -1;
      const delta = 1 + (chaos > 0.65 && Math.random() < 0.35 ? 1 : 0);
      hopFi = (curFi + sign * delta + 12) % 12;
    }
    if (hopFi !== fi) { hops.push(folNodePos(hopFi, 1)); curFi = hopFi; }
  }
  return hops;
}

function onNoteOnFlower(midi) {
  const now = performance.now();
  const h = hue(midi), fi = fifthsPos(midi);
  const baseR = folBaseR(), boundR = folBoundR(), beatMs = folBeatMs();
  if (!folNoteState.has(midi)) folNoteState.set(midi, { strikeTimes: [], lastBeat: -1, hops: [] });
  const state = folNoteState.get(midi);
  state.hops = computeHops(fi, folChaos());
  state.strikeTimes.push(now);
}

function onNoteOffFlower(midi) {
  folNoteState.delete(midi);
  for (const key of folActiveCrossings)
    if (key.startsWith(midi+'-') || key.endsWith('-'+midi)) folActiveCrossings.delete(key);
}

function triggerPhosphorFlash() {
  folPhosphorAlpha = 1.0;
}

function triggerStreakFlash(level = 1) {
  // Brightness scales with streak level: lvl1=0.40, lvl2=0.55, lvl3=0.70, lvl4=0.85
  folStreakAlpha = Math.min(1, 0.25 + level * 0.15);
}

function drawFlowerBackground() {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = folBaseR(), boundR = folBoundR();
  const dy   = r * Math.sqrt(3) / 2;
  // Cover full screen for infinite tile
  const maxR = Math.hypot(canvas.width, canvas.height) / 2 + r;
  const rows = Math.ceil(maxR / dy) + 1;
  const cols = Math.ceil(maxR / r)  + 1;

  ctx.save();

  // ── 1. INFINITE TILE — always faint, flares on streak ──────
  const isStreak = folStreakAlpha > 0;
  // Neon flicker: compound sine that strengthens mid-fade and dies away at the tail
  const now2 = performance.now();
  const streakFlicker = isStreak
    ? 1 + folStreakAlpha * 0.18 * Math.sin(now2 / 72 + Math.cos(now2 / 153) * 2.1)
    : 1;
  const streakV = Math.pow(folStreakAlpha, 1.6) * streakFlicker;
  // Crossfade colour and line weight smoothly — blend over bottom 30% of alpha
  const colorBlend = Math.min(1, folStreakAlpha / 0.30);
  const r0=98,  g0=55,  b0=182; // deep violet at rest
  const r1=210, g1=235, b1=255; // electric white-blue on streak
  const rC=Math.round(r0+(r1-r0)*colorBlend), gC=Math.round(g0+(g1-g0)*colorBlend), bC=Math.round(b0+(b1-b0)*colorBlend);
  const tileA = 0.030 + streakV * 0.20;
  ctx.strokeStyle = `rgba(${rC},${gC},${bC},${tileA})`;
  ctx.lineWidth   = 0.48 + 0.42 * colorBlend;
  for (let row = -rows; row <= rows; row++) {
    const xOff = (row & 1) ? r / 2 : 0;
    const y    = row * dy;
    for (let col = -cols; col <= cols; col++) {
      ctx.beginPath();
      ctx.arc(cx + col * r + xOff, cy + y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Streak texture: node sparkles at intersections + soft radial shimmer
  if (isStreak) {
    const sparkA = streakV * 0.45;
    for (let ring = 1; ring <= FOL_RINGS + 2; ring++) {
      for (let fi = 0; fi < 12; fi++) {
        const np = folNodePos(fi, ring);
        if (np.x < -r || np.x > canvas.width + r || np.y < -r || np.y > canvas.height + r) continue;
        ctx.beginPath();
        ctx.arc(np.x, np.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,240,255,${sparkA})`;
        ctx.fill();
      }
    }
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.65);
    sg.addColorStop(0, `rgba(190,215,255,${streakV * 0.09})`);
    sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // Slow decay — long neon tail (~7s from full)
  if (folStreakAlpha > 0.002) folStreakAlpha *= 0.980; else folStreakAlpha = 0;

  // ── 2. BOUNDED FORM — level-up phosphor only ───────────────
  if (folPhosphorAlpha > 0) {
    // Clip to bounding circle — interior blazes white/violet
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = `rgba(255,248,255,${folPhosphorAlpha * 0.42})`;
    ctx.lineWidth   = 1.3;
    for (let row = -rows; row <= rows; row++) {
      const xOff = (row & 1) ? r / 2 : 0;
      const y    = row * dy;
      for (let col = -cols; col <= cols; col++) {
        const x = col * r + xOff;
        if (Math.hypot(x, y) > boundR + r) continue;
        ctx.beginPath();
        ctx.arc(cx + x, cy + y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore(); // removes clip

    // Bounding circle ring blazes
    ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(210,170,255,${folPhosphorAlpha * 0.9})`;
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = `rgba(180,110,255,${folPhosphorAlpha * 0.7})`;
    ctx.shadowBlur  = 22;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Radial violet bloom
    const flashA = Math.pow(folPhosphorAlpha, 2.2) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, boundR);
    g.addColorStop(0,   `rgba(230,200,255,${flashA})`);
    g.addColorStop(0.5, `rgba(140,75,255,${folPhosphorAlpha * 0.07})`);
    g.addColorStop(1,   'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2); ctx.fill();

    folPhosphorAlpha = Math.max(0, folPhosphorAlpha - 0.006);
  } else {
    // Bounding circle — nearly invisible at rest
    ctx.beginPath(); ctx.arc(cx, cy, boundR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(110,65,175,0.05)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  ctx.restore();
}

function drawFlowerNodes() {
  const now = performance.now();
  const boundR = folBoundR(), baseR = folBaseR();
  for (let ring = 1; ring <= FOL_RINGS; ring++) {
    if (ring * baseR > boundR + 20) break;
    const dotR = Math.max(0.8, 2.6 - ring * 0.38);
    for (let fi = 0; fi < 12; fi++) {
      const pos      = folNodePos(fi, ring);
      const isActive = [...activeNotes.keys()].some(m => fifthsPos(m) === fi);
      const isHint   = ring === 1 && hintNotes.some(hn => fifthsPos(hn.midi) === fi && hn.alpha > 0);
      if (isActive) {
        const h     = fi * 30;
        const pulse = 0.62 + 0.38 * Math.sin(now / 155 + ring * 0.85 + fi * 0.55);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotR * 2.4 * pulse, 0, Math.PI * 2);
        ctx.fillStyle  = `hsla(${h},90%,78%,${0.88 / ring})`;
        ctx.shadowColor = `hsla(${h},90%,72%,0.65)`;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (isHint) {
        const h = fi * 30;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotR * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${h},82%,66%,0.38)`;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(118,75,200,${0.16 / ring})`;
        ctx.fill();
      }
    }
  }
}

function drawNodeLabels() {
  const age = performance.now() - folNodeLabelStart;
  if (age > 2000) return;
  const alpha = Math.pow(1 - age / 2000, 1.6);
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let fi = 0; fi < 12; fi++) {
    const pos  = folNodePos(fi, 1);
    const h    = fi * 30;
    const name = NOTE_NAMES[(fi * 7) % 12];
    // Offset label outward from centre so it clears the node dot
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const dx = pos.x - cx, dy = pos.y - cy;
    const len = Math.hypot(dx, dy);
    const lx = pos.x + (dx / len) * 14;
    const ly = pos.y + (dy / len) * 14;
    ctx.shadowColor  = `hsla(${h},90%,65%,${alpha})`;
    ctx.shadowBlur   = 10;
    ctx.fillStyle    = `hsla(${h},90%,82%,${alpha})`;
    ctx.fillText(name, lx, ly);
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function folChaos() {
  return Math.min(1.0, (levelIdx || 0) / 15);
}

// Recursive midpoint displacement — generates jagged lightning points.
// branches array collects side-bolts; pass null to suppress branching.
function folLightningSubdivide(x1, y1, x2, y2, disp, depth, pts, branches) {
  if (depth === 0 || Math.hypot(x2-x1, y2-y1) < 4) { pts.push([x2, y2]); return; }
  const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx, dy);
  const px = -dy/len, py = dx/len;                         // perpendicular unit
  const offset = (Math.random()-0.5) * disp * len * 0.55;
  const nx = (x1+x2)/2 + px*offset, ny = (y1+y2)/2 + py*offset;
  // Branch: probability and length grow with displacement (chaos)
  if (branches && disp > 0.12 && depth >= 2 && Math.random() < disp * 0.32) {
    const bLen  = len * (0.22 + Math.random() * 0.45) * disp;
    const bSign = Math.random() < 0.5 ? 1 : -1;
    const bAng  = bSign * (0.28 + Math.random() * 0.65) * Math.PI * 0.5;
    const cos = Math.cos(bAng), sin = Math.sin(bAng);
    const bx = nx + (cos*dx/len - sin*dy/len) * bLen;
    const by = ny + (sin*dx/len + cos*dy/len) * bLen;
    const bPts = [[nx, ny]];
    folLightningSubdivide(nx, ny, bx, by, disp * 0.52, depth-2, bPts, null);
    branches.push({ pts: bPts, relDepth: depth });
  }
  folLightningSubdivide(x1, y1, nx, ny, disp*0.62, depth-1, pts, branches);
  folLightningSubdivide(nx, ny, x2, y2, disp*0.62, depth-1, pts, branches);
}

function folStrokePath(pts, h, coreAlpha, width, flicker) {
  if (pts.length < 2) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const buildPath = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); };
  buildPath(); ctx.strokeStyle=`hsla(${h},80%,65%,${coreAlpha*0.07*flicker})`; ctx.lineWidth=width*15; ctx.stroke();
  buildPath(); ctx.strokeStyle=`hsla(${h},88%,72%,${coreAlpha*0.25*flicker})`; ctx.lineWidth=width*3.8; ctx.stroke();
  buildPath(); ctx.strokeStyle=`hsla(${h},96%,93%,${coreAlpha*0.70*flicker})`; ctx.lineWidth=width*0.88; ctx.stroke();
  ctx.restore();
}

function drawFlowerLightning() {
  const now    = performance.now();
  const cx     = canvas.width/2, cy = canvas.height/2;
  const boundR = folBoundR(), beatMs = folBeatMs();
  const chaos  = folChaos();
  const depth  = 2 + Math.floor(chaos * 3.5);
  const ring1R = folBaseR();
  const boltData = []; // collect for intersection pass

  for (const [midi] of activeNotes) {
    const state = folNoteState.get(midi);
    if (!state?.strikeTimes.length) continue;
    const fi    = fifthsPos(midi);
    const h     = hue(midi);
    const age   = now - state.strikeTimes.at(-1);
    const front = Math.min(age / (beatMs * 0.5) * boundR, boundR);
    const flicker = (0.55+0.45*Math.sin(now/52+midi*2.1))*(0.75+0.25*Math.sin(now/19+fi*1.7));
    const angle = (fi/12)*Math.PI*2 - Math.PI/2;
    const ex = cx + Math.cos(angle)*front, ey = cy + Math.sin(angle)*front;

    // Waypoints: center → [intermediate nodes] → target
    const wps = [[cx, cy]];
    if (front >= ring1R * 0.8) {
      for (const hop of (state.hops || [])) wps.push([hop.x, hop.y]);
    }
    wps.push([ex, ey]);
    boltData.push({ wps, h, midi });

    // Build jagged path through waypoints
    const allPts = [[cx, cy]];
    for (let w = 1; w < wps.length; w++) {
      const seg = [wps[w-1]];
      folLightningSubdivide(wps[w-1][0],wps[w-1][1], wps[w][0],wps[w][1], chaos*0.38, depth, seg, null);
      allPts.push(...seg.slice(1));
    }
    folStrokePath(allPts, h, 1.0, 1, flicker);
  }

  // Detect waypoint-segment intersections — fire ripple once per note pair, only on genuine angle crossings
  const minDistFromCenter = ring1R * 0.25;
  const minSinAngle = 0.28; // ~16 degrees — filters near-parallel and single-line pass-throughs
  for (let a = 0; a < boltData.length-1; a++) {
    for (let b = a+1; b < boltData.length; b++) {
      const mA = boltData[a].midi, mB = boltData[b].midi;
      const key = Math.min(mA,mB) + '-' + Math.max(mA,mB);
      if (folActiveCrossings.has(key)) continue; // already fired for this pair while both notes held
      const wA = boltData[a].wps, wB = boltData[b].wps;
      outer: for (let i = 0; i < wA.length-1; i++) {
        for (let j = 0; j < wB.length-1; j++) {
          const pt = lineSegIntersect(wA[i][0],wA[i][1],wA[i+1][0],wA[i+1][1], wB[j][0],wB[j][1],wB[j+1][0],wB[j+1][1]);
          if (!pt || Math.hypot(pt.x-cx, pt.y-cy) < minDistFromCenter) continue;
          // Angle check — skip if segments are nearly parallel
          const dxA=wA[i+1][0]-wA[i][0], dyA=wA[i+1][1]-wA[i][1];
          const dxB=wB[j+1][0]-wB[j][0], dyB=wB[j+1][1]-wB[j][1];
          const sinAngle = Math.abs(dxA*dyB - dyA*dxB) / (Math.hypot(dxA,dyA) * Math.hypot(dxB,dyB));
          if (sinAngle < minSinAngle) continue;
          folCrossRipples.push({ x:pt.x, y:pt.y, startTime:now, h:(boltData[a].h+boltData[b].h)/2 });
          folActiveCrossings.add(key);
          break outer;
        }
      }
    }
  }
}

function drawFlowerPlasmaArc() {
  if (!activeNotes.size) return;
  const now = performance.now();
  const cx = canvas.width/2, cy = canvas.height/2;
  const boundR = folBoundR(), beatMs = folBeatMs();

  for (const [midi] of activeNotes) {
    const state = folNoteState.get(midi);
    if (!state?.strikeTimes.length) continue;
    const fi      = fifthsPos(midi);
    const h       = hue(midi);
    const age     = now - state.strikeTimes.at(-1);
    const reach   = Math.min(age / (beatMs * 0.5), 1);
    if (reach < 0.55) continue;

    const intensity    = Math.pow((reach - 0.55) / 0.45, 1.4);
    const contactAngle = (fi / 12) * Math.PI * 2 - Math.PI / 2;
    const flicker      = (0.55 + 0.45 * Math.sin(now/41  + midi*1.9))
                       * (0.75 + 0.25 * Math.sin(now/19  + fi*2.7));
    const maxSpread    = (0.55 + 0.20 * Math.sin(now/310 + midi*0.7)) * intensity;

    ctx.save();
    ctx.lineCap = 'round';

    // Layers: widest/dimmest outer glow → narrow bright core → hot contact point
    const layers = [
      { s: 1.00, w: 28,  a: 0.07 },
      { s: 0.72, w: 12,  a: 0.16 },
      { s: 0.45, w:  5,  a: 0.38 },
      { s: 0.22, w:  2,  a: 0.72 },
      { s: 0.06, w:  3,  a: 0.95 },  // hot-spot — near-white
    ];

    for (const l of layers) {
      const spread = maxSpread * l.s;
      ctx.beginPath();
      ctx.arc(cx, cy, boundR, contactAngle - spread, contactAngle + spread);
      ctx.strokeStyle = l.s < 0.1
        ? `rgba(255,255,255,${intensity * flicker * l.a})`
        : `hsla(${h},88%,72%,${intensity * flicker * l.a})`;
      ctx.lineWidth = l.w;
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawFlowerRipples() {
  const now = performance.now();
  // Cross-ripples: single bright pulse where two bolts meet
  for (let i = folCrossRipples.length-1; i >= 0; i--) {
    const cr  = folCrossRipples[i];
    const age = now - cr.startTime;
    if (age > 900) { folCrossRipples.splice(i, 1); continue; }
    const t = age / 900;
    const r = t * folBaseR() * 0.75;
    const a = Math.pow(1 - t, 1.8) * 0.75;
    ctx.beginPath(); ctx.arc(cr.x, cr.y, r, 0, Math.PI*2);
    ctx.strokeStyle = `hsla(${cr.h},90%,88%,${a})`;
    ctx.lineWidth   = 2.2;
    ctx.shadowColor = `hsla(${cr.h},90%,80%,${a*0.6})`;
    ctx.shadowBlur  = 12;
    ctx.stroke(); ctx.shadowBlur = 0;
  }
}

function updateFlowerPulse() {
  const now = performance.now(), beatMs = folBeatMs();
  const baseR = folBaseR(), boundR = folBoundR();
  for (const [midi, note] of activeNotes) {
    const state = folNoteState.get(midi);
    if (!state) continue;
    const beat = Math.floor((now - note.startTime) / beatMs);
    if (beat <= state.lastBeat) continue;
    state.lastBeat = beat;
    // New beat: pick fresh routing, re-fire strike (no ripples — those fire once on initial strike only)
    const fi = fifthsPos(midi), h = hue(midi);
    state.hops = computeHops(fi, folChaos());
    state.strikeTimes.push(now);
    if (state.strikeTimes.length > 8) state.strikeTimes.shift();
  }
}// ─────────────────────────────────────────────────────────────
// SECTION 15 — ANIMATION LOOP
// ─────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  ctx.fillStyle='rgba(0,0,0,.13)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  if (showFlowerBg) drawFlowerBackground();
  if (showModules) drawSynthGlow();
  gameEngine?.update();
  if (feedbackAlpha > 0) { feedbackAlpha -= 0.006; feedbackEl.style.opacity = Math.max(0, feedbackAlpha); }
  updateFlowerPulse();
  if (showFlowerNodes) drawFlowerNodes();
  drawNodeLabels();
  if (showFlowerLightning) drawFlowerLightning();
  if (showFlowerLightning) drawFlowerPlasmaArc();
  if (showFlowerRipples) drawFlowerRipples();
  if (showCenterGlow) drawCenterGlow();
  if (showPolygon) drawPolygon();
  if (showHintNotes) drawHintNotes();
  drawActiveNotes();
  drawParticles();
  if (showModules) drawSynthRipples();
  drawLabel();
  // Patch overlay — drawn on top-z canvas so cables/jacks appear above panels
  patchCtx.clearRect(0,0,patchCanvas.width,patchCanvas.height);
  if (showModules) { patchSystem?.draw(patchCtx); drawAudioOut(); }
  // Keyboard drawn on patch canvas so it sits above cables and psychedelia
  keyboardAlpha += ((showKeyboard ? 1 : 0) - keyboardAlpha) * 0.14;
  if (keyboardAlpha > 0.01) {
    patchCtx.globalAlpha = keyboardAlpha;
    drawKeyboard(patchCtx);
    patchCtx.globalAlpha = 1;
  }
}

// Play the challenge chord through the player's synth for ear training.
// Block chord first, then ascending strum. Does NOT touch activeNotes.
function playEarTrainingChord(notes) {
  const midis = notes.map(pc => pcToMidi(normPc(pc)));
  midis.forEach(m => audioGraph.playNote(m, 65));
  setTimeout(() => midis.forEach(m => audioGraph.stopNote(m)), 280);
  midis.forEach((m, i) => setTimeout(() => audioGraph.playNote(m, 58 + i * 4), 450 + i * 170));
  setTimeout(() => midis.forEach(m => audioGraph.stopNote(m)), 450 + midis.length * 170 + 1800);
}

// ─────────────────────────────────────────────────────────────
// SECTION 17 — AUDIO FEEDBACK
// ─────────────────────────────────────────────────────────────
function playSuccessSound(notes) {
  audioGraph.ensure(); const ac=audioGraph.ctx; if(!ac) return;
  const now=ac.currentTime;
  notes.forEach((pc,i)=>{ const m=60+NOTE_NAMES.indexOf(normPc(pc)); audioGraph.playTone(m+12,0.22,now+i*0.09,0.55); });
  const stab=now+notes.length*0.09+0.06;
  notes.forEach(pc=>audioGraph.playTone(60+NOTE_NAMES.indexOf(normPc(pc))+12,0.14,stab,0.9));
}
function playFailSound() {
  audioGraph.ensure(); const ac=audioGraph.ctx; if(!ac) return;
  const now=ac.currentTime;
  // boop boop — two descending short tones
  audioGraph.playTone(58,0.38,now,0.14); audioGraph.playTone(54,0.34,now+0.19,0.18);
}
function playShimmer(notes) {
  audioGraph.ensure(); const ac=audioGraph.ctx; if(!ac) return;
  const now=ac.currentTime;
  [...notes].sort((a,b)=>a-b).forEach((m,i)=>audioGraph.playTone(m,0.10,now+i*0.052,0.45+i*0.06));
}
function playLevelUpSound() {
  audioGraph.ensure(); const ac=audioGraph.ctx; if(!ac) return;
  const now=ac.currentTime;
  [60,64,67,72,76,79].forEach((m,i)=>audioGraph.playTone(m,0.18,now+i*0.07,0.5));
}

// ─────────────────────────────────────────────────────────────
// SECTION 16 — INPUT HANDLERS
// ─────────────────────────────────────────────────────────────
function refreshNoteDisplay() {
  notesEl.textContent=[...activeNotes.keys()].sort((a,b)=>a-b).map(midiToName).join('  ');
}

function runDetection() {
  const allNoteKeys = [...activeNotes.keys(), ...remoteNotes.keys()];
  if (allNoteKeys.length<2) { detectedLabel=''; labelFade=0; return; }
  const unique=[...new Set(allNoteKeys.map(midiToPitchClass))];
  let label='';
  const chords=Chord.detect(unique);
  if (chords.length) label=chords[0];
  if (!label&&unique.length>=5) { const sc=Scale.detect(unique); if(sc.length) label=sc[0]; }
  if (label&&label!==detectedLabel) {
    detectedLabel=label; detectedHue=rootHue(label); labelFade=1;
    if (gameMode==='practice') {
      const _rootKey = label.match(/^[A-G][#b]?/)?.[0] ?? label;
      const _newChord = _rootKey !== lastBurstChord;
      if (_newChord) { lastBurstChord = _pcKey; chordBurstStrength = 1.0; }
      else           { chordBurstStrength = Math.max(0.08, chordBurstStrength * 0.55); }
      spawnChordBurst(detectedHue, undefined, undefined, chordBurstStrength, false);
      if (_newChord) { playShimmer(activeNotes.keys()); spawnSynthHit(detectedHue); }
    }
  } else if (!label) { detectedLabel=''; labelFade=0; }
}

function onNoteOn(note, velocity) {
  audioGraph.ensure();
  activeNotes.set(note,{ startTime:performance.now() });
  if (showParticleRings) spawnRing(note,velocity);
  onNoteOnFlower(note);
  audioGraph.playNote(note,velocity);
  multiplayer.send('NOTE_ON', { midi: note, velocity });
  runDetection(); refreshNoteDisplay();
  if (!multiplayer.isClient) {
    if (gameMode==='play'&&gamePhase==='play') {
      phrasePeakNotes=Math.max(phrasePeakNotes,activeNotes.size+remoteNotes.size);
      gameEngine.checkSuccess();
    }
    if (gameMode==='play'&&gamePhase==='success') {
      gameEngine.checkBonusNote(note);
    }
  }
}

function onNoteOff(note) {
  audioGraph.stopNote(note);
  onNoteOffFlower(note);
  activeNotes.delete(note);
  multiplayer.send('NOTE_OFF', { midi: note });
  runDetection(); refreshNoteDisplay();
  if (!multiplayer.isClient && gameMode==='play'&&gamePhase==='play'&&activeNotes.size===0&&remoteNotes.size===0) {
    if (!_isCompetitive()) {
      if (phrasePeakNotes>=(currentChallenge?.notes.length??3)&&!phraseMatched) gameEngine.triggerFail();
      phrasePeakNotes=0;
    }
  }
}

modeBtnEl.addEventListener('click', () => {
  if (multiplayer.isClient) return;
  audioGraph.ensure();
  if (gameMode === 'play') gameEngine.stopGame();
  else { earTraining = selectedMode === 'ear'; gameEngine.startGame(); }
});

challengeNameEl.addEventListener('click', () => {
  if (earTraining && gameMode==='play' && gamePhase==='play' && currentChallenge)
    playEarTrainingChord(currentChallenge.notes);
});

timerSecsEl.addEventListener('click', () => {
  const idx=TIMER_PRESETS.indexOf(challengeTimerSecs);
  challengeTimerSecs=TIMER_PRESETS[(idx+1)%TIMER_PRESETS.length];
  timerSecsEl.textContent=challengeTimerSecs>0?`${challengeTimerSecs}s`:'∞';
  if (challengeTimerSecs===0) { timerFillEl.style.width='100%'; timerFillEl.style.background='rgba(255,255,255,0.3)'; }
});

document.addEventListener('keydown', e => {
  if (document.activeElement?.tagName==='INPUT'||document.activeElement?.tagName==='SELECT') return;
  if (e.metaKey||e.ctrlKey||e.altKey) return;
  const k=e.key;
  if (k==='z'||k==='Z') { kbOctave=Math.max(0,kbOctave-1); kbMap=buildKbMapFull(); return; }
  if (k==='x'||k==='X') { kbOctave=Math.min(8,kbOctave+1); kbMap=buildKbMapFull(); return; }
  if (e.repeat) return;
  const midi=kbMap[k];
  if (midi!==undefined&&!kbHeld.has(k)) { kbHeld.set(k,midi); onNoteOn(midi,80); }
});
document.addEventListener('keyup', e => {
  if (kbHeld.has(e.key)) { onNoteOff(kbHeld.get(e.key)); kbHeld.delete(e.key); }
});

const canvasRect = () => canvas.getBoundingClientRect();

// Pointer events route note input through NoteInputSystem (piano keys + FOL nodes).
// #pc has pointer-events:none so events fall through to #c (main canvas).
// Patch system jacks have priority — if a jack is nearby, yield to the click handler.
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  if (patchSystem?.hitTestJack(cx, cy)) return; // jack nearby — let document click handle it
  if (noteInputSystem.pointerDown(cx, cy, e.pointerId)) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', e => {
  if (!noteInputSystem.pointers.has(e.pointerId)) return;
  const r = canvas.getBoundingClientRect();
  noteInputSystem.pointerMove(e.clientX - r.left, e.clientY - r.top, e.pointerId);
});
canvas.addEventListener('pointerup',     e => noteInputSystem.pointerUp(e.pointerId));
canvas.addEventListener('pointercancel', e => noteInputSystem.pointerUp(e.pointerId));

// Document-level click handles patching — panels intercept canvas clicks so we can't use canvas only
document.addEventListener('click', e => {
  if (e.button!==0) return;
  const tag=e.target.tagName;
  if (tag==='BUTTON'||tag==='SELECT'||tag==='INPUT') return;
  if (e.target.closest('#shop-panel')||e.target.closest('#console-wrap')||e.target.closest('#game-controls')||e.target.closest('#hud')||e.target.closest('#midi-learn-btn')) return;
  const r=canvasRect(), cx=e.clientX-r.left, cy=e.clientY-r.top;
  if (noteInputSystem.hitTestAny(cx, cy)) return; // don't start patch over note input areas
  if (!multiplayer.isClient) patchSystem?.handleClick(cx, cy);
});

function releaseAllNotes() {
  for (const midi of [...kbHeld.values()]) onNoteOff(midi);
  kbHeld.clear();
  noteInputSystem.releaseAll();
}
window.addEventListener('blur', releaseAllNotes);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllNotes(); });

document.addEventListener('mousemove', e => {
  mouseX=e.clientX; mouseY=e.clientY;
  if (panelDrag) {
    panelDrag.panel.style.left=(e.clientX-panelDrag.ox)+'px';
    panelDrag.panel.style.top=(e.clientY-panelDrag.oy)+'px';
    // Highlight shop as sell target when dragging a module panel over it
    const shopEl = document.getElementById('shop-panel');
    if (shopEl && shopEl.classList.contains('open') && panelDrag.panel.id !== 'shop-panel') {
      const sr = shopEl.getBoundingClientRect();
      const over = e.clientX>=sr.left && e.clientX<=sr.right && e.clientY>=sr.top && e.clientY<=sr.bottom;
      shopEl.classList.toggle('sell-target', over);
    }
  }
  if (knobDrag) {
    const dy=knobDrag.startY-e.clientY, pdef=knobDrag.pdef;
    const range=(pdef.max??1)-(pdef.min??0);
    const nv=Math.max(pdef.min??0,Math.min(pdef.max??1,knobDrag.startVal+dy*(range/180)));
    registry.setParam(knobDrag.moduleId,knobDrag.param,nv);
  }
});
document.addEventListener('mouseup', () => {
  if (panelDrag) {
    const shopEl = document.getElementById('shop-panel');
    shopEl?.classList.remove('sell-target');
    // Drop on shop = sell module for half price
    if (panelDrag.panel.id !== 'shop-panel' && shopEl?.classList.contains('open')) {
      const sr = shopEl.getBoundingClientRect();
      if (mouseX>=sr.left && mouseX<=sr.right && mouseY>=sr.top && mouseY<=sr.bottom) {
        const moduleId = panelDrag.panel.id.replace(/^panel-/, '');
        if (moduleId !== 'audio-out-0' && registry.modules.has(moduleId)) {
          const modType = registry.modules.get(moduleId).type;
          const refund = Math.floor((GAME_CONFIG.modulePrices[modType] ?? 0) / 2);
          registry.removeModule(moduleId);
          score += refund;
          scoreValEl.textContent = score.toLocaleString();
          shopSystem?.render(score);
          saveState();
          panelDrag = null; knobDrag = null; return;
        }
      }
    }
    panelDrag.panel.classList.remove('is-dragging'); panelDrag=null;
  }
  knobDrag=null;
});

function armLearnParam(moduleId, param) {
  midiLearnParam={ moduleId, param };
  midiLearnBtnEl.classList.remove('armed'); midiLearnBtnEl.classList.add('listening');
  midiLearnBtnEl.textContent='TURN ENC';
}
function setLearnMode(active) {
  midiLearnMode=active; midiLearnParam=null;
  midiLearnBtnEl.classList.toggle('armed',active); midiLearnBtnEl.classList.remove('listening');
  midiLearnBtnEl.textContent=active?'CLICK KNOB':'MIDI LEARN';
}
midiLearnBtnEl.addEventListener('click',()=>setLearnMode(!midiLearnMode));
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&midiLearnMode)setLearnMode(false); },true);

// ─────────────────────────────────────────────────────────────
// NOTE INPUT SYSTEM
// NoteLayout interface — implement hitTest(x,y)→midi|null and draw(ctx,state)→void.
// NoteInputSystem dispatches pointer events to registered layouts in order,
// manages a per-pointer note map, and provides a priority gate for the patch system.
// ─────────────────────────────────────────────────────────────

class PianoLayout {
  get id()              { return 'piano'; }
  hitTest(x, y)         { return getKeyAtPos(x, y); }
  hintsFor(notes)       { return notes.map(pc => pcToMidi(normPc(pc))); }
  draw()                {} // drawn by animate loop
}

class FolLayout {
  get id()      { return 'fol'; }
  hitTest(x, y) {
    const r1 = folBaseR();
    let closest = null, closestD = 30;
    for (let fi = 0; fi < 12; fi++) {
      const pos = folNodePos(fi, 1);
      const d = Math.hypot(x - pos.x, y - pos.y);
      if (d < closestD) { closestD = d; closest = fi; }
    }
    if (closest === null) return null;
    return 60 + (closest * 7) % 12; // fifths index → pitch class, octave 4
  }
  hintsFor(notes) { return []; } // FOL ring glow is driven by hintNotes, not this path
  draw()          {} // FOL visualiser draws its own nodes
}

class NoteInputSystem {
  constructor() {
    this.layouts  = [];
    this.pointers = new Map(); // pointerId → { midi, layoutId }
  }

  register(layout)   { this.layouts.push(layout); }
  unregister(id)     { this.layouts = this.layouts.filter(l => l.id !== id); }
  hitTestAny(x, y)   { return this.layouts.some(l => l.hitTest(x, y) !== null); }
  hintsFor(notes)    { return this.layouts.flatMap(l => l.hintsFor(notes)); }

  pointerDown(x, y, id) {
    for (const layout of this.layouts) {
      const midi = layout.hitTest(x, y);
      if (midi !== null) {
        this.pointers.set(id, { midi, layoutId: layout.id });
        onNoteOn(midi, 90);
        return true;
      }
    }
    return false;
  }

  pointerMove(x, y, id) {
    const prev = this.pointers.get(id);
    if (!prev) return;
    const layout = this.layouts.find(l => l.id === prev.layoutId);
    if (!layout) return;
    const midi = layout.hitTest(x, y);
    if (midi === null)    { onNoteOff(prev.midi); this.pointers.delete(id); return; }
    if (midi === prev.midi) return;
    onNoteOff(prev.midi);
    this.pointers.set(id, { midi, layoutId: layout.id });
    onNoteOn(midi, 90);
  }

  pointerUp(id) {
    const prev = this.pointers.get(id);
    if (!prev) return;
    onNoteOff(prev.midi);
    this.pointers.delete(id);
  }

  releaseAll() {
    for (const { midi } of this.pointers.values()) onNoteOff(midi);
    this.pointers.clear();
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 18 — CONSOLE COMMANDS
// ─────────────────────────────────────────────────────────────
const consoleOutEl=document.getElementById('console-out');
function consolePrint(msg, ms=6000) {
  consoleOutEl.textContent=msg; consoleOutEl.style.display='block';
  clearTimeout(consolePrint._t);
  consolePrint._t=setTimeout(()=>{ consoleOutEl.style.display='none'; },ms);
}

const BTNS_KEY = 'm1d1sl0p2_btns';
let _customBtnCmds = [];
function _saveBtns() { try { localStorage.setItem(BTNS_KEY, JSON.stringify(_customBtnCmds)); } catch(e) {} }
function _spawnBtnEl(cmd) {
  const b = document.createElement('button');
  b.className = 'custom-btn'; b.textContent = cmd.toUpperCase();
  b.addEventListener('click', () => dispatchCommand(cmd));
  document.getElementById('custom-btns').appendChild(b);
}

function dispatchCommand(v) {
  // Strip optional trailing integer duration (e.g. "reset 20" → base="reset", ms=20000)
  const _dm = v.match(/^(.*?)\s+(\d+)$/);
  const base = _dm ? _dm[1].trim() : v;
  const ms   = _dm ? Math.min(45, parseInt(_dm[2])) * 1000 : 6000;

  if (base==='help') { consolePrint('COMMANDS (prefix ~ to run):\n  rules     — how to play\n  reset     — reset options\n  visuals   — visual toggles\n  controls  — button controls\n  cheats    — cheat codes\n  mp        — multiplayer status\n\nplain text sends as chat when connected', ms); return; }
  if (base==='visuals') { consolePrint('VISUALS:\n  flash       — trigger phosphor flash\n  streak      — trigger streak flare\n  labels      — flash note names on nodes\n  fol <n>     — scale flower of life (e.g. fol 0.8)\n  bg          — toggle flower background\n  nodes       — toggle flower nodes\n  lightning   — toggle lightning bolts\n  ripples     — toggle flower ripples\n  rings       — toggle note-on particle rings\n  polygon     — toggle chord polygon\n  centerglow  — toggle center glow\n  hintnotes   — toggle hint note markers\n  screenrip   — toggle full-screen chord ripples\n  fxon        — enable all effects\n  fxoff       — disable all effects', ms); return; }
  if (base==='cheats') { consolePrint('CHEATS:\n  idkfa   — +5000 pts\n  idclip  — next level\n  iddqd   — max level + unlock shop', ms); return; }
  if (base==='controls') { consolePrint('CONTROLS:\n  makebutton <cmd>   — add a quick-access button\n  removebutton <cmd> — remove a button', ms); return; }
  if (base==='rules') { consolePrint('HOW TO PLAY:\n  1. Press PLAY and pick a key/scale\n  2. Watch the chord name — that\'s your challenge\n  3. Play those notes on keyboard or MIDI\n  4. Score points → level up → buy synth modules\n  5. Patch cables between modules to shape your sound', ms); return; }
  if (base==='reset') { consolePrint('RESET OPTIONS\n\nWARNING: these unrecoverably remove progress.\n\n  resetall    — wipe all progress and reload\n  resetlevel  — reset level to 1\n  resetscore  — reset score to 0\n  resetmods   — clear all modules (keeps audio out)', ms); return; }
  if (base==='resetall') { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(BTNS_KEY); location.reload(); return; }
  if (base==='resetlevel') { levelIdx=0; levelValEl.textContent=GAME_CONFIG.levels[0].label; consolePrint('Level reset.', ms); saveState(); return; }
  if (base==='resetscore') { score=0; scoreValEl.textContent='0'; streakCount=0; streakLevels=0; streakValEl.style.opacity='0'; consolePrint('Score reset.', ms); saveState(); return; }
  if (base==='resetmods') { for(const id of [...registry.modules.keys()])if(id!=='audio-out-0')registry.removeModule(id); const oid=registry.addModule('osc-sine'); registry.addPatch(oid,'audio','audio-out-0','in'); audioGraph.ensure(); consolePrint('Modules reset.', ms); saveState(); return; }
  if (base==='idkfa') { score+=5000; scoreValEl.textContent=score.toLocaleString(); if(shopSystem?.el.classList.contains('open'))shopSystem.render(score); consolePrint('+5000 pts', ms); saveState(); return; }
  if (base==='flash') { triggerPhosphorFlash(); consolePrint('✦ phosphor', ms); return; }
  if (base==='streak') { triggerStreakFlash(); consolePrint('✦ streak', ms); return; }
  if (base==='labels') { folNodeLabelStart = performance.now(); return; }
  if (base==='idclip') {
    if (levelIdx<GAME_CONFIG.levels.length-1) {
      gameEngine._doLevelUp();
      consolePrint(GAME_CONFIG.levels[levelIdx].label, ms); spawnChordBurst(200); saveState();
    }
    return;
  }
  if (base==='iddqd') {
    levelIdx=GAME_CONFIG.levels.length-1; levelValEl.textContent=GAME_CONFIG.levels[levelIdx].label;
    shopBtnEl.classList.remove('locked'); _unlockEarMode();
    playLevelUpSound(); consolePrint('GOD MODE — max level, shop + ear training unlocked', ms); saveState(); return;
  }
  const tog = (flag, setter, name) => { setter(!flag); consolePrint(`${name}: ${!flag ? 'ON' : 'OFF'}`, ms); };
  if (base==='bg')         { tog(showFlowerBg,       v => showFlowerBg = v,        'flower background'); return; }
  if (base==='nodes')      { tog(showFlowerNodes,    v => showFlowerNodes = v,     'flower nodes'); return; }
  if (base==='lightning')  { tog(showFlowerLightning,v => showFlowerLightning = v, 'lightning'); return; }
  if (base==='ripples')    { tog(showFlowerRipples,  v => showFlowerRipples = v,   'flower ripples'); return; }
  if (base==='rings')      { tog(showParticleRings,  v => showParticleRings = v,   'particle rings'); return; }
  if (base==='polygon')    { tog(showPolygon,        v => showPolygon = v,         'chord polygon'); return; }
  if (base==='centerglow') { tog(showCenterGlow,     v => showCenterGlow = v,      'center glow'); return; }
  if (base==='hintnotes')  { tog(showHintNotes,      v => showHintNotes = v,       'hint notes'); return; }
  if (base==='keyguides')  { tog(showKeyGuides,      v => showKeyGuides = v,       'key guides'); return; }
  if (base==='eartraining') {
    if (levelIdx < 9) { consolePrint('unlocks at LEVEL 10', ms); return; }
    selectedMode = selectedMode === 'ear' ? 'play' : 'ear';
    _syncModePanel();
    consolePrint(`mode: ${selectedMode}`, ms); return;
  }
  if (base==='screenrip')  { tog(showScreenRipples,  v => showScreenRipples = v,   'screen ripples'); return; }
  if (base==='fxon')  { Object.keys(FX).forEach(k => FX[k] = true);  consolePrint('all effects ON', ms);  return; }
  if (base==='fxoff') { Object.keys(FX).forEach(k => FX[k] = false); consolePrint('all effects OFF', ms); return; }
  if (base.startsWith('fol ')) {
    const n = parseFloat(base.slice(4));
    if (isNaN(n)||n<=0) { consolePrint('usage: fol <scale>  e.g. fol 0.8', ms); return; }
    folScale = Math.min(3, n); consolePrint(`flower scale: ${folScale.toFixed(2)}`, ms); return;
  }
  if (base.startsWith('makebutton ')) {
    const cmd = base.slice(11).trim();
    if (!cmd) { consolePrint('usage: makebutton <command>', ms); return; }
    if (_customBtnCmds.includes(cmd)) { consolePrint(`button '${cmd}' already exists`, ms); return; }
    _customBtnCmds.push(cmd); _spawnBtnEl(cmd); _saveBtns();
    consolePrint(`button added: ${cmd}`, ms); return;
  }
  if (base.startsWith('removebutton ')) {
    const cmd = base.slice(13).trim();
    const idx = _customBtnCmds.indexOf(cmd);
    if (idx === -1) { consolePrint(`no button for '${cmd}'`, ms); return; }
    _customBtnCmds.splice(idx, 1);
    const container = document.getElementById('custom-btns');
    [...container.querySelectorAll('.custom-btn')].find(b => b.textContent === cmd.toUpperCase())?.remove();
    _saveBtns(); consolePrint(`button removed: ${cmd}`, ms); return;
  }
  if (base==='mp'||base==='online') {
    const st=multiplayer.state;
    if (st==='solo')       consolePrint('multiplayer: solo\nshare the URL after pressing PLAY to invite a partner', ms);
    else if (st==='connecting') consolePrint('multiplayer: connecting...', ms);
    else if (st==='host')  consolePrint(`multiplayer: HOST — partner connected\njoin URL: ${multiplayer.getJoinUrl()}`, ms);
    else if (st==='client') consolePrint('multiplayer: CLIENT — connected to host', ms);
    return;
  }
  if (base) consolePrint(`unknown: ${base}\ntype 'help' for directories`, ms);
}

document.getElementById('cheat-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const raw = e.target.value.trim(); e.target.value = '';
  if (!raw) return;
  if (raw.startsWith('~')) {
    dispatchCommand(raw.slice(1).toLowerCase().trim());
  } else {
    if (multiplayer.isConnected) {
      multiplayer.send('CHAT', { text: raw });
      chatAppend(raw, 'you');
    } else {
      consolePrint('not connected — use ~ for commands  (e.g. ~help)', 4000);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// SECTION 19 — BOOTSTRAP
// ─────────────────────────────────────────────────────────────
const registry    = new ModuleRegistry();
const audioGraph  = new AudioGraph(registry);
const uiRenderer  = new UIRenderer(registry);
const patchSystem     = new PatchSystem(registry);
const shopSystem      = new ShopSystem(registry);
const gameEngine      = new GameEngine(registry, GAME_CONFIG);
const noteInputSystem = new NoteInputSystem();

// ─────────────────────────────────────────────────────────────
// MULTIPLAYER
// ─────────────────────────────────────────────────────────────
const multiplayer = new MultiplayerSystem();
let _mpRemote = false;           // true while applying an incoming remote change — suppresses re-broadcast
let _registrySyncEnabled = true; // false in competitive — gates all outgoing registry messages
let _pendingModeChange   = null; // mode string while waiting for partner's MODE_CHANGE response

multiplayer
  .on('state-change', state => {
    const dot      = document.getElementById('mp-dot');
    const modeDot  = document.getElementById('mode-mp-dot');
    const modeStat = document.getElementById('mode-mp-status');
    const overlay  = document.getElementById('mp-overlay');
    // host = PeerJS registered but no partner yet → show as solo until conn is open
    const dotState = (state === 'host' && !multiplayer.conn?.open) ? 'solo' : state;
    if (dot)      dot.className      = 'mp-dot mp-' + dotState;
    if (modeDot)  modeDot.className  = 'mp-dot mp-' + dotState;
    if (modeStat) modeStat.textContent = { solo:'no partner', connecting:'connecting...', host:'partner connected', client:'connected to alice' }[dotState] ?? '';
    if (overlay)  overlay.style.display = state === 'connecting' ? 'flex' : 'none';
    // mp-client lockout is applied in HELLO handler once we know the mode
  })
  .on('connected', () => {
    document.body.classList.add('mp-connected');
    consolePrint(_isCompetitive() ? 'opponent connected — fight!' : 'co-op partner connected', 4000);
    setTimeout(() => chatAppend(_isCompetitive() ? 'opponent connected' : 'partner connected', 'system'), 50);
    if (multiplayer.isHost && !multiplayer._registryWired) {
      multiplayer._registryWired = true;
      const helloPayload = {
        game: {
          score, levelIdx, streakCount, streakLevels, gameMode, earTraining, selectedMode, roundsPlayed, internalBpm, internalBpmActive,
          challenge: currentChallenge
            ? { display: currentChallenge.display, notes: currentChallenge.notes }
            : null,
        },
      };
      if (!_isCompetitive()) {
        // Co-op only: mirror registry
        helloPayload.registry = multiplayer.snapshotRegistry(registry);
        registry.addEventListener('module-added',   e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('MODULE_ADD', e.detail); });
        registry.addEventListener('module-removed', e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('MODULE_REMOVE', e.detail); });
        registry.addEventListener('param-changed',  e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.sendParam(e.detail.id, e.detail.param, e.detail.value); });
        registry.addEventListener('patch-changed',  e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('PATCH_CHANGE', { patches: e.detail.patches }); });
      }
      multiplayer.send('HELLO', helloPayload);
    }
  })
  .on('disconnected', () => {
    consolePrint('co-op partner disconnected — solo mode', 5000);
    const msg = document.createElement('div');
    msg.className = 'chat-msg chat-system';
    msg.textContent = 'partner disconnected';
    chatMessagesEl.appendChild(msg);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatPanelEl.classList.add('chat-open');
    clearTimeout(_chatHideTimer);
    _chatHideTimer = setTimeout(() => chatPanelEl.classList.remove('chat-open'), 10000);
    for (const midi of remoteNotes.keys()) onNoteOffFlower(midi);
    remoteNotes.clear();
    document.body.classList.remove('mp-client');
    document.body.classList.remove('mp-connected');
  })
  // ── Incoming notes from partner ──
  .on('NOTE_ON', ({ midi, velocity }) => {
    remoteNotes.set(midi, { startTime: performance.now() });
    onNoteOnFlower(midi);
    runDetection(); refreshNoteDisplay();
    if (multiplayer.isHost && gameMode === 'play') {
      phrasePeakNotes = Math.max(phrasePeakNotes, activeNotes.size + remoteNotes.size);
      if (gamePhase === 'play')    gameEngine.checkSuccess();
      if (gamePhase === 'success') gameEngine.checkBonusNote(midi);
    }
  })
  .on('NOTE_OFF', ({ midi }) => {
    remoteNotes.delete(midi);
    onNoteOffFlower(midi);
    runDetection(); refreshNoteDisplay();
    if (multiplayer.isHost && gameMode === 'play' && gamePhase === 'play' && activeNotes.size === 0 && remoteNotes.size === 0) {
      if (phrasePeakNotes >= (currentChallenge?.notes.length ?? 3) && !phraseMatched) gameEngine.triggerFail();
      phrasePeakNotes = 0;
    }
  })
  // ── Client receives full state on join ──
  .on('HELLO', ({ registry: snap, game }) => {
    selectedMode = game.selectedMode ?? 'play';
    _syncModePanel();
    if (game.internalBpmActive) { internalBpm = game.internalBpm ?? 120; internalBpmActive = true; bpmEl.textContent = `${internalBpm} bpm`; }
    levelIdx    = Math.min(game.levelIdx, GAME_CONFIG.levels.length - 1);
    levelValEl.textContent = GAME_CONFIG.levels[levelIdx]?.label ?? 'LEVEL 1';
    hudEl.style.display = 'block';
    if (levelIdx >= 9) _unlockEarMode();

    if (_isCompetitive()) {
      // Independent synths — no registry mirror, full client control
      document.body.classList.remove('mp-client');
      score = 0; remoteScore = game.score;
      roundsPlayed = game.roundsPlayed ?? 0;
      scoreValEl.textContent = '0';
      _updateRemoteScore();
      if (levelIdx >= 1) shopBtnEl.classList.remove('locked');
      if (game.gameMode === 'play' && game.challenge) {
        currentChallenge = { ...game.challenge, h: rootHue(game.challenge.display) };
        gameMode = 'play'; earTraining = false;
        challengeEl.style.display    = 'block';
        challengeNameEl.textContent  = game.challenge.display;
        challengeNameEl.style.opacity = '1';
        challengeNameEl.style.color  = `hsl(${currentChallenge.h},85%,72%)`;
        challengeNameEl.style.textShadow = `0 0 28px hsl(${currentChallenge.h},85%,62%)`;
        hintLabelEl.textContent = '';
        hintNotes = game.challenge.notes.map(pc => ({ midi: pcToMidi(normPc(pc)), alpha: 0 }));
      }
      consolePrint('competitive — your synth is your own. fight!', 5000);
    } else {
      // Co-op: shared synth — both players can edit
      multiplayer.replaySnapshot(registry, snap); // fires events synchronously; listeners added after so no echo
      audioGraph.ensure();
      // Wire Bob's registry changes back to Alice (same guard prevents loops)
      registry.addEventListener('module-added',   e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('MODULE_ADD', e.detail); });
      registry.addEventListener('module-removed', e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('MODULE_REMOVE', e.detail); });
      registry.addEventListener('param-changed',  e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.sendParam(e.detail.id, e.detail.param, e.detail.value); });
      registry.addEventListener('patch-changed',  e => { if (!_mpRemote && _registrySyncEnabled) multiplayer.send('PATCH_CHANGE', { patches: e.detail.patches }); });
      score = game.score;
      streakCount = game.streakCount; streakLevels = game.streakLevels;
      scoreValEl.textContent = score.toLocaleString();
      shopBtnEl.classList.add('locked');
      document.body.classList.add('mp-client');
      if (game.gameMode === 'play' && game.challenge) {
        currentChallenge = { ...game.challenge, h: rootHue(game.challenge.display) };
        gameMode    = 'play';
        earTraining = game.earTraining;
        challengeEl.style.display    = 'block';
        challengeNameEl.textContent  = game.earTraining ? '?' : game.challenge.display;
        challengeNameEl.style.opacity = '1';
        challengeNameEl.style.color  = `hsl(${currentChallenge.h},85%,72%)`;
        challengeNameEl.style.textShadow = `0 0 28px hsl(${currentChallenge.h},85%,62%)`;
        hintLabelEl.textContent = '';
        hintNotes = game.earTraining ? [] : game.challenge.notes.map(pc => ({ midi: pcToMidi(normPc(pc)), alpha: 0 }));
      }
      consolePrint('connected — shared synth, edit together', 5000);
    }
  })
  // ── Client mirrors game events ──
  .on('CHALLENGE', ({ display, notes, earTraining: et }) => {
    if (!multiplayer.isClient) return;
    currentChallenge = { display, notes, h: rootHue(display) };
    gamePhase   = 'play';
    earTraining = et;
    challengeEl.style.display    = 'block';
    challengeNameEl.style.opacity = '1';
    if (et) {
      challengeNameEl.textContent      = '?';
      challengeNameEl.style.color      = 'rgba(255,255,255,0.35)';
      challengeNameEl.style.textShadow = 'none';
      hintLabelEl.textContent          = 'listen for the chord';
      hintNotes = [];
    } else {
      challengeNameEl.textContent      = display;
      challengeNameEl.style.color      = `hsl(${currentChallenge.h},85%,72%)`;
      challengeNameEl.style.textShadow = `0 0 28px hsl(${currentChallenge.h},85%,62%)`;
      hintLabelEl.textContent          = '';
      hintNotes = notes.map(pc => ({ midi: pcToMidi(normPc(pc)), alpha: 0 }));
    }
    timerBarEl.style.display = 'none';
    timerSecsEl.style.display = 'none';
  })
  .on('SUCCESS', ({ display, h, winner }) => {
    if (!multiplayer.isClient) return;
    gamePhase = 'success';
    const rootPos = notePos(pcToMidi(normPc(currentChallenge?.notes[0] ?? 'C')));
    if (_isCompetitive()) {
      const iWon = winner === 'client'; // client = Bob, so winner==='client' means Bob won
      feedbackEl.textContent      = iWon ? '✓ you got it' : '✗ they got it';
      feedbackEl.style.color      = iWon ? `hsl(${h},85%,75%)` : '#ff6060';
      feedbackEl.style.textShadow = iWon ? `0 0 40px hsl(${h},85%,60%)` : '0 0 20px #ff2020';
      feedbackAlpha = 1;
      if (iWon) { spawnChordBurst(h, rootPos.x, rootPos.y, 1, true); spawnSynthHit(h); }
      lockedOut = false; // clear any local lockout on round end
    } else {
      feedbackEl.textContent      = earTraining ? `✓  ${display}` : '✓';
      feedbackEl.style.color      = `hsl(${h},85%,75%)`;
      feedbackEl.style.textShadow = `0 0 40px hsl(${h},85%,60%)`;
      feedbackAlpha = 1;
      spawnChordBurst(h, rootPos.x, rootPos.y, 1, true);
      spawnSynthHit(h);
    }
  })
  .on('FAIL', ({ display, draw }) => {
    if (!multiplayer.isClient) return;
    gamePhase = 'fail';
    lockedOut = false;
    if (draw) {
      feedbackEl.textContent      = 'draw';
      feedbackEl.style.color      = 'rgba(255,255,255,0.4)';
      feedbackEl.style.textShadow = 'none';
    } else {
      feedbackEl.textContent      = earTraining ? `✗  ${display}` : '✗';
      feedbackEl.style.color      = '#ff4040';
      feedbackEl.style.textShadow = '0 0 30px #ff2020';
    }
    feedbackAlpha = 1;
    if (currentChallenge) challengeNameEl.style.opacity = '0.35';
  })
  .on('SCORE_UPDATE', ({ score: s, levelIdx: li, streakCount: sc, streakLevels: sl, remoteScore: rs,
                         hostScore, clientScore, roundsPlayed: rp }) => {
    if (!multiplayer.isClient) return;
    if (hostScore !== undefined) {
      // Competitive: client is Bob → clientScore = mine, hostScore = opponent's
      score = clientScore ?? 0; remoteScore = hostScore ?? 0;
      if (rp !== undefined) roundsPlayed = rp;
    } else {
      // Co-op
      score = s; streakCount = sc; streakLevels = sl;
      if (rs !== undefined) { remoteScore = rs; }
    }
    levelIdx = Math.min(li, GAME_CONFIG.levels.length - 1);
    scoreValEl.textContent = score.toLocaleString();
    levelValEl.textContent = GAME_CONFIG.levels[levelIdx]?.label ?? 'LEVEL 1';
    gameEngine._updateStreakDisplay();
    if (levelIdx >= 9) _unlockEarMode();
    _updateRemoteScore();
  })
  .on('LOCKOUT', ({ ms }) => {
    if (!multiplayer.isClient) return;
    lockedOut = true;
    hintLabelEl.textContent = 'wrong — locked out';
    feedbackEl.textContent = '✗'; feedbackEl.style.color = '#ff4040';
    feedbackEl.style.textShadow = '0 0 20px #ff2020'; feedbackAlpha = 0.8;
    setTimeout(() => { lockedOut = false; if (gamePhase === 'play') hintLabelEl.textContent = ''; }, ms);
  })
  .on('GAME_MODE', ({ mode }) => {
    if (!multiplayer.isClient) return;
    if (mode === 'practice') {
      gameMode = 'practice'; currentChallenge = null; hintNotes = [];
      challengeEl.style.display = 'none';
    }
  })
  // ── Client mirrors registry changes ──
  .on('MODULE_ADD', ({ id, type, params }) => {
    if (_isCompetitive()) return;
    _mpRemote = true;
    registry.modules.set(id, { id, type, params: { ...params } });
    registry.dispatchEvent(new CustomEvent('module-added', { detail: { id, type, params } }));
    _mpRemote = false;
  })
  .on('MODULE_REMOVE', ({ id }) => {
    if (_isCompetitive()) return;
    _mpRemote = true;
    registry.removeModule(id);
    _mpRemote = false;
  })
  .on('PARAM_CHANGE', ({ id, param, value }) => {
    if (_isCompetitive()) return;
    _mpRemote = true;
    registry.setParam(id, param, value);
    _mpRemote = false;
  })
  .on('PATCH_CHANGE', ({ patches }) => {
    if (_isCompetitive()) return;
    _mpRemote = true;
    registry.patches = patches.map(p => ({ ...p }));
    registry.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: registry.patches } }));
    _mpRemote = false;
  })
  // ── Mode change negotiation ──
  .on('MODE_CHANGE', ({ mode }) => {
    // Bob receives: Alice wants to change mode
    const toComp = _isCompetitive(mode);
    if (toComp) {
      // Co-op → Competitive: no confirm, synth stays, just disable sync
      _registrySyncEnabled = false;
      selectedMode = mode;
      _syncModePanel();
      consolePrint('mode: competitive', 4000);
    } else {
      // Competitive → Co-op: offer choice
      _showConfirm(
        () => {
          multiplayer.send('MODE_CHANGE_ACCEPT', { score });
          selectedMode = mode;
          _syncModePanel();
          consolePrint('switching to co-op...', 4000);
        },
        {
          msg: 'switch to co-op?',
          sub: 'your synth will be replaced (+500 pts compensation)',
          yes: 'ACCEPT',
          no: 'KEEP SYNTH',
          onNo: () => {
            multiplayer.send('MODE_CHANGE_DECLINE');
            multiplayer.conn?.close();
            consolePrint('kept your synth — going solo', 4000);
          },
        }
      );
    }
  })
  .on('MODE_CHANGE_ACCEPT', ({ score: bobScore }) => {
    // Alice receives: Bob accepted co-op transition
    score += bobScore + 500;
    scoreValEl.textContent = score.toLocaleString();
    selectedMode = _pendingModeChange ?? 'coop';
    _pendingModeChange = null;
    _registrySyncEnabled = true;
    _syncModePanel();
    multiplayer.send('RESYNC', { registry: multiplayer.snapshotRegistry(registry), score });
    consolePrint(`partner joined co-op (+${bobScore + 500} pts)`, 5000);
  })
  .on('MODE_CHANGE_DECLINE', () => {
    // Alice receives: Bob kept his synth and disconnected
    _pendingModeChange = null;
    consolePrint('partner kept their synth — disconnected', 5000);
  })
  .on('RESYNC', ({ registry: snap, score: newScore }) => {
    // Bob receives: full registry resync after accepting co-op
    _mpRemote = true;
    multiplayer.replaySnapshot(registry, snap);
    _mpRemote = false;
    audioGraph.ensure();
    _registrySyncEnabled = true;
    score = newScore;
    scoreValEl.textContent = score.toLocaleString();
    consolePrint('synced to shared synth', 4000);
  });

multiplayer.init();

// ─────────────────────────────────────────────────────────────
// MODE PANEL
// ─────────────────────────────────────────────────────────────
const modePanelEl  = document.getElementById('mode-panel');
const modePanelBtn = document.getElementById('mode-panel-btn');

function _updateRemoteScore() {
  const area = document.getElementById('remote-score-area');
  if (!area) return;
  const versus = _isCompetitive();
  area.style.display = (versus && multiplayer.isConnected) ? 'block' : 'none';
  document.getElementById('remote-score-val').textContent = remoteScore.toLocaleString();
  document.getElementById('remote-score-label').textContent = multiplayer.isHost ? 'bob' : 'alice';
}

function _unlockEarMode() {
  document.getElementById('mode-opt-ear')?.classList.remove('mode-opt-locked');
  document.querySelector('#mode-opt-ear .mode-opt-tag')?.remove();
}

function _syncModePanel() {
  document.querySelectorAll('.mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
  _syncModeToggles();
}

function _syncModeToggles() {
  document.querySelectorAll('.mode-toggle[data-fx]').forEach(btn => {
    const key = btn.dataset.fx;
    btn.classList.toggle('on', !!FX[key]);
  });
  document.getElementById('opt-midiclock')?.classList.toggle('on', useMidiClock);
}

document.querySelectorAll('.mode-toggle[data-fx]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.fx;
    FX[key] = !FX[key];
    _syncModeToggles();
    saveState();
  });
});

document.getElementById('opt-midiclock')?.addEventListener('click', () => {
  useMidiClock = !useMidiClock;
  if (!useMidiClock) { bpm = 0; clockTimes = []; bpmEl.textContent = internalBpmActive ? `${internalBpm} bpm` : ''; }
  _syncModeToggles();
  saveState();
});

function _openModePanel()  { modePanelEl.classList.add('open');    modePanelBtn.classList.add('panel-open'); }
function _closeModePanel() { modePanelEl.classList.remove('open'); modePanelBtn.classList.remove('panel-open'); }

modePanelBtn?.addEventListener('click', () => modePanelEl.classList.contains('open') ? _closeModePanel() : _openModePanel());
document.getElementById('mode-panel-close')?.addEventListener('click', _closeModePanel);

document.addEventListener('click', e => {
  if (!modePanelEl.classList.contains('open')) return;
  if (modePanelEl.contains(e.target) || e.target === modePanelBtn) return;
  _closeModePanel();
});

document.getElementById('mode-disconnect-btn')?.addEventListener('click', () => {
  _closeModePanel();
  _showConfirm(_disconnect, { msg: 'disconnect from partner?', sub: 'your current synth state will be kept', yes: 'DISCONNECT' });
});

document.querySelectorAll('.mode-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('mode-opt-locked') || btn.classList.contains('mode-opt-soon')) return;
    const newMode = btn.dataset.mode;
    if (newMode === selectedMode) { _closeModePanel(); return; }
    const go = () => { selectedMode = newMode; _syncModePanel(); _closeModePanel(); };
    // Clients can switch locally (non-competitiveness changes only — competitive changes are host-driven)
    if (!multiplayer.isHost) { go(); return; }
    const switchingCompetitiveness = multiplayer.isConnected && (_isCompetitive(newMode) !== _isCompetitive(selectedMode));
    if (!switchingCompetitiveness) { go(); return; }
    const toComp = _isCompetitive(newMode);
    if (toComp) {
      // Co-op → Competitive: switch immediately, disable registry sync
      multiplayer.send('MODE_CHANGE', { mode: newMode });
      _registrySyncEnabled = false;
      go();
    } else {
      // Competitive → Co-op: wait for Bob's response
      _pendingModeChange = newMode;
      multiplayer.send('MODE_CHANGE', { mode: newMode });
      _closeModePanel();
      consolePrint('waiting for partner...', 10000);
    }
  });
});

// ── New game ──
let _confirmCb = null, _confirmNoCb = null;
function _showConfirm(cb, { msg = 'are you sure?', sub = '', yes = 'YES', no = 'CANCEL', onNo = null } = {}) {
  _confirmCb   = cb;
  _confirmNoCb = onNo;
  document.getElementById('confirm-msg').textContent  = msg;
  document.getElementById('confirm-sub').textContent  = sub;
  document.getElementById('confirm-yes').textContent  = yes;
  document.getElementById('confirm-no').textContent   = no;
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function _isCompetitive(mode) { return (mode ?? selectedMode) === 'competitive' || (mode ?? selectedMode) === 'tennis'; }

function _disconnect() {
  multiplayer.conn?.close();
  multiplayer.peer?.disconnect();
}
document.getElementById('confirm-yes')?.addEventListener('click', () => {
  document.getElementById('confirm-overlay').style.display = 'none';
  _confirmCb?.(); _confirmCb = null;
});
document.getElementById('confirm-no')?.addEventListener('click', () => {
  document.getElementById('confirm-overlay').style.display = 'none';
  const cb = _confirmNoCb; _confirmCb = null; _confirmNoCb = null;
  cb?.();
});

function _doNewGameReset() {
  if (gameMode === 'play') gameEngine.stopGame();
  score = 0; levelIdx = 0; streakCount = 0; streakLevels = 0;
  scoreValEl.textContent = '0';
  levelValEl.textContent = GAME_CONFIG.levels[0].label;
  streakValEl.style.opacity = '0';
  shopBtnEl.classList.add('locked');
  document.getElementById('mode-opt-ear')?.classList.add('mode-opt-locked');
  saveState();
}

document.getElementById('mode-new-game-btn')?.addEventListener('click', () => {
  _closeModePanel();
  const hasProgress = score > 0 || levelIdx > 0 || gameMode === 'play';
  const go = () => { _doNewGameReset(); earTraining = selectedMode === 'ear'; gameEngine.startGame(); };
  if (hasProgress) _showConfirm(go, { msg: 'start a new game?', sub: 'score and progress will be reset', yes: 'START' }); else go();
});

// Share button now lives in mode panel
document.getElementById('mode-share-btn')?.addEventListener('click', () => {
  const url = multiplayer.getJoinUrl();
  if (!url) { consolePrint('still connecting — try again in a moment', 3000); return; }
  navigator.clipboard.writeText(url)
    .then(()  => consolePrint('invite link copied!\nsend it to your partner', 5000))
    .catch(()  => consolePrint(`invite link:\n${url}`, 15000));
});

// ── Chat ──
const chatPanelEl    = document.getElementById('chat-panel');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl    = document.getElementById('cheat-input');
let _chatHideTimer   = null;

function _chatShow() {
  chatPanelEl.classList.add('chat-open');
  _chatRescheduleHide();
}
function _chatRescheduleHide() {
  clearTimeout(_chatHideTimer);
  if (document.activeElement === chatInputEl) return;
  _chatHideTimer = setTimeout(() => chatPanelEl.classList.remove('chat-open'), 10000);
}
function _chatForceClose() {
  clearTimeout(_chatHideTimer);
  chatPanelEl.classList.remove('chat-open');
}

chatInputEl.addEventListener('focus', () => {
  clearTimeout(_chatHideTimer);
  if (multiplayer.isConnected) chatPanelEl.classList.add('chat-open');
});
chatInputEl.addEventListener('blur', () => {
  if (multiplayer.isConnected) _chatRescheduleHide();
});
document.getElementById('chat-close-btn').addEventListener('click', _chatForceClose);

function chatAppend(text, side) {
  const msg = document.createElement('div');
  msg.className = `chat-msg chat-${side}`;
  if (side !== 'system') {
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = side;
    msg.appendChild(who);
  }
  msg.appendChild(document.createTextNode(text));
  chatMessagesEl.appendChild(msg);
  if (chatMessagesEl.children.length > 60) chatMessagesEl.firstChild.remove();
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  if (multiplayer.isConnected) _chatShow();
}

multiplayer.on('CHAT', ({ text }) => chatAppend(text, multiplayer.isHost ? 'bob' : 'alice'));

multiplayer.on('BPM_UPDATE', ({ bpm: b }) => {
  internalBpm = b; internalBpmActive = true;
  bpmEl.textContent = `${internalBpm} bpm`;
});

noteInputSystem.register(new PianoLayout());
noteInputSystem.register(new FolLayout());

// Tap tempo — click #bpm to set internal BPM; host pushes to client
bpmEl.style.cursor = 'pointer';
bpmEl.title = 'tap to set BPM';
bpmEl.addEventListener('click', () => {
  if (multiplayer.isClient) return;
  const now = performance.now();
  _tapTimes = _tapTimes.filter(t => now - t < 3000);
  _tapTimes.push(now);
  if (_tapTimes.length < 2) { bpmEl.textContent = 'TAP...'; return; }
  const avg = (_tapTimes.at(-1) - _tapTimes[0]) / (_tapTimes.length - 1);
  internalBpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
  internalBpmActive = true;
  bpmEl.textContent = `${internalBpm} bpm`;
  saveState();
  if (multiplayer.isHost) multiplayer.send('BPM_UPDATE', { bpm: internalBpm });
});

if (!navigator.requestMIDIAccess) {
  statusEl.textContent='Web MIDI not supported — use Chrome';
} else {
  navigator.requestMIDIAccess().then(midi => {
    function onMidiMessage(e) {
      const [cmd,note,velocity]=e.data;
      if (cmd===0xF8) {
        if (!useMidiClock) return;
        clockTimes.push(performance.now()); if(clockTimes.length>48)clockTimes.shift();
        if(clockTimes.length>=4){const rc=clockTimes.slice(-24);if(rc.length>=2){const avg=(rc.at(-1)-rc[0])/(rc.length-1);bpm=Math.round(60000/(avg*24));bpmEl.textContent=bpm>0?`${bpm} bpm`:'';}}
        pulseCount=(pulseCount+1)%24; lastPulseTime=performance.now(); return;
      }
      if (cmd===0xFC){ if(useMidiClock){bpm=0;bpmEl.textContent='';} return;}
      if (cmd===0xFA||cmd===0xFB) return;
      if ((cmd&0xf0)===0xB0) {
        if (midiLearnMode&&midiLearnParam) {
          const {moduleId,param}=midiLearnParam;
          midiCCMap[note]={moduleId,param}; setLearnMode(false);
          midiLearnBtnEl.style.borderColor='rgba(60,255,120,.7)'; midiLearnBtnEl.style.color='rgba(80,255,140,1)';
          setTimeout(()=>{midiLearnBtnEl.style.borderColor='';midiLearnBtnEl.style.color='';},900);
        } else if (midiCCMap[note]) {
          const {moduleId,param}=midiCCMap[note], mod=registry.modules.get(moduleId); if(!mod)return;
          const pdef=MODULE_TYPE_DEFS[mod.type]?.paramDefs?.[param]; if(!pdef)return;
          registry.setParam(moduleId,param,(pdef.min??0)+(velocity/127)*((pdef.max??1)-(pdef.min??0)));
        }
        return;
      }
      const isOn=(cmd&0xf0)===0x90&&velocity>0;
      const isOff=(cmd&0xf0)===0x80||((cmd&0xf0)===0x90&&velocity===0);
      if (isOn)  onNoteOn(note,velocity);
      if (isOff) onNoteOff(note);
    }
    function connectAll() {
      for (const inp of midi.inputs.values()) inp.onmidimessage=onMidiMessage;
      statusEl.textContent=`MIDI connected — ${midi.inputs.size} input(s)`;
    }
    connectAll(); midi.onstatechange=connectAll;
  }).catch(()=>{ statusEl.textContent='MIDI access denied — check Chrome permissions'; });
}

// Visibility toggles
let showKeyboard = true, showModules = true;

// ── Effect registry — add new effects here, fxon/fxoff pick them up automatically ──
const FX = {
  flowerBg:      true,
  flowerNodes:   true,
  flowerLight:   true,
  flowerRipples: true,
  particleRings: true,
  polygon:       true,
  centerGlow:    true,
  hintNotes:     true,
  keyGuides:     true,
  screenRipples: true,
};

// Convenience getters (keep existing read sites working)
const fx = new Proxy(FX, { get: (t, k) => t[k] });

// Shim existing flag names → FX registry
Object.defineProperties(window, {
  showFlowerBg:       { get(){ return FX.flowerBg;      }, set(v){ FX.flowerBg = v;      } },
  showFlowerNodes:    { get(){ return FX.flowerNodes;   }, set(v){ FX.flowerNodes = v;   } },
  showFlowerLightning:{ get(){ return FX.flowerLight;   }, set(v){ FX.flowerLight = v;   } },
  showFlowerRipples:  { get(){ return FX.flowerRipples; }, set(v){ FX.flowerRipples = v; } },
  showParticleRings:  { get(){ return FX.particleRings; }, set(v){ FX.particleRings = v; } },
  showPolygon:        { get(){ return FX.polygon;       }, set(v){ FX.polygon = v;       } },
  showCenterGlow:     { get(){ return FX.centerGlow;    }, set(v){ FX.centerGlow = v;    } },
  showHintNotes:      { get(){ return FX.hintNotes;     }, set(v){ FX.hintNotes = v;     } },
  showKeyGuides:      { get(){ return FX.keyGuides;     }, set(v){ FX.keyGuides = v;     } },
  showScreenRipples:  { get(){ return FX.screenRipples; }, set(v){ FX.screenRipples = v; } },
});
const panelsContainerEl = document.getElementById('panels-container');
// KEYS / MODS toggles (buttons are static HTML in #game-controls)
(function initVisToggles() {
  const keysBtn = document.getElementById('keys-btn');
  const modsBtn = document.getElementById('mods-btn');
  keysBtn?.addEventListener('click', () => {
    showKeyboard = !showKeyboard;
    keysBtn.classList.toggle('active', showKeyboard);
  });
  modsBtn?.addEventListener('click', () => {
    showModules = !showModules;
    panelsContainerEl.style.visibility = showModules ? '' : 'hidden';
    modsBtn.classList.toggle('active', showModules);
  });
})();

// Controls bar position
function setControlsPos(pos) {
  controlsBarPos = pos ?? 'below';
  const gc = document.getElementById('game-controls');
  const mp = document.getElementById('mode-panel');
  const kH = (Math.min(canvas.width - 60, 720) / 14) * 4;
  const barH = gc ? gc.getBoundingClientRect().height || 36 : 36;
  if (controlsBarPos === 'below') {
    kbRiseOffset = Math.round(barH + 10);
    if (gc) { gc.style.top = 'auto'; gc.style.bottom = '12px'; gc.style.left = '50%'; gc.style.transform = 'translateX(-50%)'; }
    if (mp) { mp.style.top = 'auto'; mp.style.bottom = '52px'; mp.style.left = '50%'; mp.style.transform = 'translateX(-50%)'; }
  } else if (controlsBarPos === 'above') {
    kbRiseOffset = 0;
    const fromBot = Math.round(kH + 18);
    const maxW = Math.min(canvas.width - 60, 720);
    const kbRight = (canvas.width + maxW) / 2; // right edge of keyboard in px from left
    if (gc) { gc.style.top = 'auto'; gc.style.bottom = `${fromBot}px`; gc.style.left = `${kbRight - (gc.getBoundingClientRect().width || 300)}px`; gc.style.transform = 'none'; }
    if (mp) { mp.style.top = 'auto'; mp.style.bottom = `${fromBot + barH + 8}px`; mp.style.left = `${kbRight - 280}px`; mp.style.transform = 'none'; }
  } else { // 'top'
    kbRiseOffset = 0;
    if (gc) { gc.style.bottom = 'auto'; gc.style.top = '12px'; gc.style.left = '50%'; gc.style.transform = 'translateX(-50%)'; }
    if (mp) { mp.style.bottom = 'auto'; mp.style.top = '52px'; mp.style.left = '50%'; mp.style.transform = 'translateX(-50%)'; }
  }
  document.querySelectorAll('.ctrl-pos-opt').forEach(b => b.classList.toggle('active', b.dataset.pos === controlsBarPos));
}

document.querySelectorAll('.ctrl-pos-opt').forEach(btn => {
  btn.addEventListener('click', () => { setControlsPos(btn.dataset.pos); saveState(); });
});

// Mode panel tab switching
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mode-tab-pane').forEach(p => p.classList.add('mode-tab-pane-hidden'));
    tab.classList.add('active');
    document.querySelector(`.mode-tab-pane[data-pane="${tab.dataset.tab}"]`)?.classList.remove('mode-tab-pane-hidden');
  });
});

// Score HUD always visible
hudEl.style.display = 'block';

// Audio output is a permanent singleton — always pre-create before loadState
registry.addModule('audio-out'); // → 'audio-out-0'

try { (JSON.parse(localStorage.getItem(BTNS_KEY)||'[]')).forEach(cmd=>{_customBtnCmds.push(cmd);_spawnBtnEl(cmd);}); } catch(e) {}
const restored=loadState();
_syncModeToggles();
setControlsPos(controlsBarPos);
if (!restored||registry.getOscModules().length===0) {
  const oscId=registry.addModule('osc-sine');
  registry.addPatch(oscId,'audio','audio-out-0','in');
} else if (!registry.getOscModules().some(m=>registry.patchesFrom(m.id).length>0)) {
  // Old save with no patches — wire first osc to output
  const firstOsc=registry.getOscModules()[0];
  if (firstOsc) registry.addPatch(firstOsc.id,'audio','audio-out-0','in');
}

animate();

