// ╔══════════════════════════════════════════════════════════════╗
// ║  config.js                                                   ║
// ║  Contains: S1 note helpers, S2 game config, S3 module defs,  ║
// ║            S4 shop defs, S5 chord pool                       ║
// ╚══════════════════════════════════════════════════════════════╝
// ─────────────────────────────────────────────────────────────
// SECTION 1 — NOTE HELPERS
// ─────────────────────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const ENHARMONIC = { Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#' };
function midiToName(m)       { return NOTE_NAMES[m%12] + (Math.floor(m/12)-1); }
function midiToPitchClass(m) { return NOTE_NAMES[m%12]; }
function fifthsPos(m)        { return (m%12*7)%12; }
function hue(m)              { return fifthsPos(m)*30; }
function normPc(pc)          { return ENHARMONIC[pc]??pc; }
function pcToMidi(pc)        { return NOTE_NAMES.indexOf(pc)+60; }
function midiToFreq(m)       { return 440*Math.pow(2,(m-69)/12); }
function rootHue(label) {
  const root = label.match(/^[A-G][#b]?/)?.[0]??'';
  const pc = NOTE_NAMES.includes(root)?root:(ENHARMONIC[root]??'');
  const idx = NOTE_NAMES.indexOf(pc);
  return idx>=0?(idx*7%12)*30:0;
}
function notePos(midi) {
  const cx=canvas.width/2, cy=canvas.height/2;
  const angle=(fifthsPos(midi)/12)*Math.PI*2-Math.PI/2;
  const r=folBaseR(); // ring 1 radius — defined in app.js, safe to call at runtime
  return { x:cx+Math.cos(angle)*r, y:cy+Math.sin(angle)*r };
}
function formatFreq(hz) { return hz>=1000?(hz/1000).toFixed(1)+'k':hz+'Hz'; }
function formatMs(s)    { return Math.round(s*1000)+'ms'; }
function sliderToFreq(v)    { return Math.round(200*Math.pow(100,v)); }
function sliderToAttack(v)  { return 0.001+v*0.4; }
function sliderToDecay(v)   { return 0.01+v*0.5; }
function sliderToRelease(v) { return 0.05+v*2.0; }
function sliderToLfoRate(v)   { return 0.1+v*9.9; }
function sliderToDelayTime(v) { return Math.pow(10, -2 + v*2); } // 10ms–1s (log)
function sliderToBpm(v)       { return Math.round(40 * Math.pow(7.5, v)); }      // 40–300 BPM
function sliderToGate(v)      { return 0.01 + v * 1.98; }                        // 1%–199%
function sliderToDrumDecay(v) { return 0.01 * Math.pow(200, v); }                // 10ms–2s
function sliderToKickFreq(v)  { return 30 + v * 70; }                            // 30–100 Hz

// ─────────────────────────────────────────────────────────────
// SECTION 2 — GAME CONFIG (all tunable values)
// ─────────────────────────────────────────────────────────────
const GAME_CONFIG = {
  levels: [
    { n:1,  label:'LEVEL 1',   maxDiff:1, hintMs:2200, paramUnlock:null      },
    { n:2,  label:'LEVEL 2',   maxDiff:1, hintMs:1800, paramUnlock:null      },
    { n:3,  label:'LEVEL 3',   maxDiff:2, hintMs:1600, paramUnlock:'filter'  },
    { n:4,  label:'LEVEL 4',   maxDiff:2, hintMs:1200, paramUnlock:null      },
    { n:5,  label:'LEVEL 5',   maxDiff:3, hintMs:1000, paramUnlock:null      },
    { n:6,  label:'LEVEL 6',   maxDiff:3, hintMs:700,  paramUnlock:'env'     },
    { n:7,  label:'LEVEL 7',   maxDiff:4, hintMs:500,  paramUnlock:'fx'      },
    { n:8,  label:'LEVEL 8',   maxDiff:6, hintMs:280,  paramUnlock:null      },
    { n:9,  label:'LEVEL 9',   maxDiff:6, hintMs:180,  paramUnlock:'lfo'     },
    { n:10, label:'LEVEL 10',  maxDiff:7, hintMs:80,   paramUnlock:null      },
    { n:11, label:'LEVEL MAX', maxDiff:7, hintMs:35,   paramUnlock:null      },
  ],
  scoring: { basePoints:100, timeBonusMax:100, streakBonusPerHit:15, wrongChordPenalty:10, timeoutPenalty:30, extensionBonus:20, pentatonicBonus:10 },
  timing:  { timerPresets:[3,5,10,0], defaultTimer:5 },
  competitive: { lockoutMs:1500, roundsPerLevel:8 },
  // Prices for each module type (per purchase, unlimited purchases)
  modulePrices: {
    'osc-sine': 400, 'osc-saw': 600, 'osc-tri': 480, 'osc-sq': 600,
    'osc-sub': 800, 'osc-noise': 1000, 'osc': 1200,
    'filter': 600, 'env': 1000, 'fx': 1600, 'delay': 1400, 'lfo': 2000,
    'glide': 300, 'pitch': 200, 'vibrato': 350, 'unison': 400, 'chord': 450, 'velocity': 250,
    'mixer': 1800,
    'seq-cv': 2400, 'seq-drum': 1800,
    'drum-hat': 1200, 'drum-kick': 1400, 'drum-snare': 1300,
    'sidechain': 2000,
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 3 — MODULE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const MODULE_TYPE_DEFS = {
  'osc-sine': {
    label:'SINE', category:'osc', waveform:'sine', hue:58, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:0, fold:0 },
    paramDefs: {
      level: { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      fold:  { min:0, max:1, label:'FOLD',  format:v=>Math.round(v*100)+'%' },
    }
  },
  'osc-saw': {
    label:'SAW', category:'osc', waveform:'sawtooth', hue:22, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:0, drive:0 },
    paramDefs: {
      level: { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      drive: { min:0, max:1, label:'DRIVE', format:v=>Math.round(v*100)+'%' },
    }
  },
  'osc-tri': {
    label:'TRI', category:'osc', waveform:'triangle', hue:142, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:0, slope:0.5 },
    paramDefs: {
      level: { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      slope: { min:0, max:1, label:'SLOPE', format:v=>Math.round(v*100)+'%' },
    }
  },
  'osc-sq': {
    label:'SQ', category:'osc', waveform:'square', hue:202, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:0, width:0.5 },
    paramDefs: {
      level: { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      width: { min:0, max:1, label:'WIDTH', format:v=>Math.round(v*100)+'%' },
    }
  },
  'osc-sub': {
    label:'SUB', category:'osc', waveform:'sub', hue:262, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:-1, subTune:0 },
    paramDefs: {
      level:   { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      subTune: { min:-12, max:12, label:'TUNE', format:v=>(v>=0?'+':'')+Math.round(v)+'st' },
    }
  },
  'osc-noise': {
    label:'NOISE', category:'osc', waveform:'noise', hue:2, outputPort:'audio',
    dynamicInputs: false,
    defaultParams: { level:0.8, color:1.0 },
    paramDefs: {
      level: { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      color: { min:0, max:1, label:'COLOR', format:v=>Math.round(v*100)+'%' },
    }
  },
  'osc': {
    label:'MULTI', category:'osc', waveform:null, hue:45, outputPort:'audio',
    dynamicInputs: false, fixedNoteInputPort: 'note-in',
    defaultParams: { level:0.8, octave:0, waveform:'sine', waveParam:0 },
    paramDefs: {
      level:     { min:0, max:1, label:'LEVEL', format:v=>Math.round(v*100)+'%' },
      waveParam: { min:0, max:1, label:'PARAM', format:v=>Math.round(v*100)+'%' },
    }
  },
  'filter': {
    label:'VCF', category:'processor', hue:195, outputPort:'audio',
    dynamicInputs: false, fixedInputPort: 'in-0',
    defaultParams: { cutoff:1.0, resonance:0.05, filterType:'lp' },
    paramDefs: {
      cutoff:    { min:0, max:1, label:'CUTOFF', format:v=>formatFreq(sliderToFreq(v)) },
      resonance: { min:0, max:1, label:'RES',    format:v=>(0.1+v*19).toFixed(1) },
    }
  },
  'env': {
    label:'ENV', category:'processor', hue:120, outputPort:'env',
    dynamicInputs: false, fixedInputPort: 'in-0',
    defaultParams: { attack:0.02, decay:0.22, sustain:0.55, release:0.05 },
    paramDefs: {
      attack:  { min:0, max:1, label:'ATK', format:v=>formatMs(sliderToAttack(v)) },
      decay:   { min:0, max:1, label:'DEC', format:v=>formatMs(sliderToDecay(v)) },
      sustain: { min:0, max:1, label:'SUS', format:v=>Math.round(v*100)+'%' },
      release: { min:0, max:1, label:'REL', format:v=>formatMs(sliderToRelease(v)) },
    }
  },
  'fx': {
    label:'SPACE', category:'processor', hue:280, outputPort:'audio',
    dynamicInputs: false, fixedInputPort: 'in-0',
    defaultParams: { wet:0.4, dry:1.0, pad:0.42 },
    paramDefs: {
      wet: { min:0, max:1, label:'REV', format:v=>Math.round(v*100)+'%' },
      dry: { min:0, max:1, label:'DRY', format:v=>Math.round(v*100)+'%' },
      pad: { min:0, max:1, label:'PAD', format:v=>Math.round(v*100)+'%' },
    }
  },
  'lfo': {
    label:'LFO', category:'processor', hue:160, outputPort:'audio',
    dynamicInputs: false, fixedInputPort: 'in-0',
    defaultParams: { rate:0.1, depth:0.5 },
    paramDefs: {
      rate:  { min:0, max:1, label:'RATE',  format:v=>sliderToLfoRate(v).toFixed(1)+'Hz' },
      depth: { min:0, max:1, label:'DEPTH', format:v=>Math.round(v*100)+'%' },
    }
  },
  'glide': {
    label:'GLI', category:'cv', hue:42,
    dynamicCvOutputs: true, dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { time:0.1 },
    paramDefs: {
      time: { min:0, max:1, label:'TIME', format:v=>(v*2).toFixed(2)+'s' },
    }
  },
  'pitch': {
    label:'PCT', category:'cv', hue:42,
    dynamicCvOutputs: true, dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { octave:0, semi:0 },
    paramDefs: {
      semi: { min:-12, max:12, label:'SEMI', format:v=>(v>=0?'+':'')+Math.round(v)+'st' },
    }
  },
  'vibrato': {
    label:'VIB', category:'cv', hue:42,
    dynamicCvOutputs: true, dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { rate:0.2, depth:0.3 },
    paramDefs: {
      rate:  { min:0, max:1, label:'RATE',  format:v=>sliderToLfoRate(v).toFixed(1)+'Hz' },
      depth: { min:0, max:1, label:'DEPTH', format:v=>Math.round(v*100)+'%' },
    }
  },
  'unison': {
    label:'UNI', category:'cv', hue:42,
    cvOutputs: [{ port:'cv-0', label:'V1' }, { port:'cv-1', label:'V2' }, { port:'cv-2', label:'V3' }],
    dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { spread:0.5 },
    paramDefs: {
      spread: { min:0, max:1, label:'SPRD', format:v=>Math.round(v*25)+'ct' },
    }
  },
  'chord': {
    label:'CHD', category:'cv', hue:42,
    cvOutputs: [{ port:'cv-0', label:'ROOT' }, { port:'cv-1', label:'3RD' }, { port:'cv-2', label:'5TH' }, { port:'cv-3', label:'OCT' }],
    dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { quality:'maj' },
    paramDefs: {}
  },
  'velocity': {
    label:'VEL', category:'cv', hue:42,
    dynamicCvOutputs: true, dynamicCvInputs: true,
    dynamicInputs: false,
    defaultParams: { sens:0.7 },
    paramDefs: {
      sens: { min:0, max:1, label:'SENS', format:v=>Math.round(v*100)+'%' },
    }
  },
  'delay': {
    label:'DLY', category:'processor', hue:220, outputPort:'audio',
    dynamicInputs: false, fixedInputPort: 'in-0',
    defaultParams: { time:0.3, feedback:0.3, mix:0.5 },
    paramDefs: {
      time:     { min:0, max:1, label:'TIME', format:v=>formatMs(sliderToDelayTime(v)) },
      feedback: { min:0, max:1, label:'FDBK', format:v=>Math.round(v*90)+'%' },
      mix:      { min:0, max:1, label:'MIX',  format:v=>Math.round(v*100)+'%' },
    }
  },
  'mixer': {
    label:'MIX', category:'utility', hue:32, outputPort:'audio',
    dynamicInputs: true,
    defaultParams: {},
    paramDefs: {}
  },
  'audio-out': {
    label:'OUT', category:'sink', hue:0,
    dynamicInputs: false, fixedInputPort: 'in',
    defaultParams: {},
    paramDefs: {}
  },
  // ── Transport & Sequencers ──────────────────────────────────
  'transport': {
    label:'CLOCK', category:'utility', hue:0,
    dynamicInputs: false,
    defaultParams: { bpm:0.545, rate:16, playing:0 },
    paramDefs: {
      bpm: { min:0, max:1, label:'BPM', format:v=>sliderToBpm(v)+'bpm' },
    }
  },
  'seq-cv': {
    label:'SEQ', category:'sequencer', hue:180, noteOutputPort:'note-out',
    dynamicInputs: false,
    defaultParams: { activeSteps:16, gate:0.374, bars:1, rate:'16' },
    paramDefs: {
      gate: { min:0, max:1, label:'GATE', format:v=>Math.round(sliderToGate(v)*100)+'%' },
    }
  },
  'seq-drum': {
    label:'D-SEQ', category:'sequencer', hue:300, noteOutputPort:'note-out',
    dynamicInputs: false,
    defaultParams: { bars:4, rate:'16' },
    paramDefs: {}
  },
  // ── Drum Voices ─────────────────────────────────────────────
  'drum-hat': {
    label:'HAT', category:'drum', hue:45, outputPort:'audio', fixedNoteInputPort:'note-in',
    dynamicInputs: false,
    defaultParams: { level:0.7, attack:0.28, decay:0.55 },
    paramDefs: {
      level:  { min:0, max:1, label:'LVL', format:v=>Math.round(v*100)+'%' },
      attack: { min:0, max:1, label:'ATK', format:v=>formatMs(sliderToDrumDecay(v)*0.1) },
      decay:  { min:0, max:1, label:'DEC', format:v=>formatMs(sliderToDrumDecay(v)) },
    }
  },
  'drum-kick': {
    label:'KICK', category:'drum', hue:355, outputPort:'audio', fixedNoteInputPort:'note-in',
    dynamicInputs: false,
    defaultParams: { level:0.8, tune:0.3, decay:0.55, punch:0.6 },
    paramDefs: {
      level: { min:0, max:1, label:'LVL',  format:v=>Math.round(v*100)+'%' },
      tune:  { min:0, max:1, label:'TUNE', format:v=>Math.round(sliderToKickFreq(v))+'Hz' },
      decay: { min:0, max:1, label:'DEC',  format:v=>formatMs(sliderToDrumDecay(v)) },
      punch: { min:0, max:1, label:'PNC',  format:v=>Math.round(v*100)+'%' },
    }
  },
  'drum-snare': {
    label:'SNR', category:'drum', hue:50, outputPort:'audio', fixedNoteInputPort:'note-in',
    dynamicInputs: false,
    defaultParams: { level:0.7, snap:0.5, tone:0.3, decay:0.4 },
    paramDefs: {
      level: { min:0, max:1, label:'LVL',  format:v=>Math.round(v*100)+'%' },
      snap:  { min:0, max:1, label:'SNAP', format:v=>Math.round(v*100)+'%' },
      tone:  { min:0, max:1, label:'TONE', format:v=>Math.round(100+v*200)+'Hz' },
      decay: { min:0, max:1, label:'DEC',  format:v=>formatMs(sliderToDrumDecay(v)) },
    }
  },
  // ── Effects ──────────────────────────────────────────────────
  'sidechain': {
    label:'DUCK', category:'processor', hue:240, outputPort:'audio',
    dynamicInputs: false, fixedInputPorts: ['in-0', 'key'],
    defaultParams: { amount:0.8, attack:0.3, release:0.5, wet:1.0 },
    paramDefs: {
      amount:  { min:0, max:1, label:'AMT', format:v=>Math.round(v*100)+'%' },
      attack:  { min:0, max:1, label:'ATK', format:v=>Math.round((0.01+v*0.19)*1000)+'ms' },
      release: { min:0, max:1, label:'REL', format:v=>Math.round((0.05+v*0.45)*1000)+'ms' },
      wet:     { min:0, max:1, label:'WET', format:v=>Math.round(v*100)+'%' },
    }
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 4 — SHOP DEFINITIONS
// ─────────────────────────────────────────────────────────────
const SHOP_DEFS = [
  { type:'osc-sine',  name:'SINE OSC',    desc:'Pure fundamental tone. No harmonics — clear as a bell.' },
  { type:'osc-saw',   name:'SAW OSC',     desc:'Rich in harmonics. Classic leads and basses.' },
  { type:'osc-tri',   name:'TRI OSC',     desc:'Warm and hollow. Halfway between sine and square.' },
  { type:'osc-sq',    name:'SQ OSC',      desc:'Nasal and buzzy with odd harmonics.' },
  { type:'osc-sub',   name:'SUB OSC',     desc:'Square wave an octave below. Instant weight.' },
  { type:'osc-noise', name:'NOISE',       desc:'White noise. Texture, breath, gated to notes.' },
  { type:'osc',       name:'MULTIOSC',    desc:'Generic oscillator — select waveform freely. Fold, drive and waveshape per instance.' },
  { type:'filter',    name:'VCF',         desc:'24 dB Moog-style ladder filter. Sculpt tone with cutoff and resonance.' },
  { type:'env',       name:'ENV',         desc:'Full ADSR envelope. Shape attack, decay, sustain and release.' },
  { type:'fx',        name:'SPACE FX',     desc:'Hall reverb and atmospheric pad layer.' },
  { type:'delay',     name:'DELAY',       desc:'Tape-style echo with feedback. Use as send or insert.' },
  { type:'lfo',       name:'LFO',         desc:'Tremolo insert. Patch audio through it to apply amplitude modulation.' },
  { type:'glide',     name:'GLIDE',       desc:'Portamento. Patch CV output to OSC glide-cv input. Smooths pitch transitions.' },
  { type:'pitch',     name:'PITCH CV',    desc:'Transpose module. Patch CV output to OSC cv input for per-voice octave and semitone offset.' },
  { type:'vibrato',   name:'VIBRATO',     desc:'Pitch LFO. Patch to OSC cv input for continuous pitch wobble without volume pumping.' },
  { type:'unison',    name:'UNISON',      desc:'Three detuned CV voices. Patch V1/V2/V3 to separate OSCs for a fat unison stack.' },
  { type:'chord',     name:'CHORD',       desc:'Harmonic CV outputs: root, third, fifth, octave. Patch to separate OSCs for instant chords.' },
  { type:'velocity',  name:'VELOCITY',    desc:'Maps note velocity to CV. Patch to OSC cv input for dynamic loudness response.' },
  { type:'mixer',     name:'MIXER',       desc:'N-channel mixer. Grows as you patch. Chain mixers into mixers.' },
  // Sequencers & Drums
  { type:'seq-cv',    name:'STEP SEQ',    desc:'16-step pitch sequencer. Wire to any oscillator via note cable. Key-relative grid.' },
  { type:'seq-drum',  name:'DRUM SEQ',    desc:'4-bar drum sequencer (4 rows × 16 steps). Wire to any drum voice via note cable.' },
  { type:'drum-hat',  name:'HI-HAT',      desc:'Noise burst percussion. Wire a drum seq to trigger it.' },
  { type:'drum-kick', name:'808 KICK',    desc:'Classic sine sweep kick. Tune, punch and decay controls.' },
  { type:'drum-snare',name:'SNARE',       desc:'Noise + tone snare voice. Snap and decay controls.' },
  { type:'sidechain', name:'SIDECHAIN',   desc:'Ducking FX. Plug a signal into KEY to duck the audio through IN.' },
];

// ─────────────────────────────────────────────────────────────
// SECTION 5 — CHORD POOL
// ─────────────────────────────────────────────────────────────
const CHORD_POOL = (() => {
  const roots = ['C','G','D','A','E','F','Bb','Eb'];
  return [
    ...roots.map(r=>({display:`${r} major`, notes:Chord.get(r).notes,           diff:1})),
    ...roots.map(r=>({display:`${r} minor`, notes:Chord.get(`${r}m`).notes,     diff:2})),
    ...roots.map(r=>({display:`${r}7`,      notes:Chord.get(`${r}7`).notes,     diff:3})),
    ...roots.map(r=>({display:`${r}maj7`,   notes:Chord.get(`${r}M7`).notes,    diff:4})),
    ...roots.map(r=>({display:`${r}m7`,     notes:Chord.get(`${r}m7`).notes,    diff:4})),
    ...roots.map(r=>({display:`${r}dim`,    notes:Chord.get(`${r}dim`).notes,   diff:5})),
    ...roots.map(r=>({display:`${r}aug`,    notes:Chord.get(`${r}aug`).notes,   diff:6})),
    ...roots.map(r=>({display:`${r}sus2`,   notes:Chord.get(`${r}sus2`).notes,  diff:6})),
    ...roots.map(r=>({display:`${r}sus4`,   notes:Chord.get(`${r}sus4`).notes,  diff:6})),
    ...roots.map(r=>({display:`${r}dim7`,   notes:Chord.get(`${r}dim7`).notes,  diff:7})),
    ...roots.map(r=>({display:`${r}m7b5`,   notes:Chord.get(`${r}m7b5`).notes,  diff:7})),
  ].filter(c=>c.notes.length>=3);
})();
