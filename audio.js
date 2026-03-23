// ╔══════════════════════════════════════════════════════════════╗
// ║  audio.js                                                    ║
// ║  Contains: S6 module registry, S7 audio graph                ║
// ╚══════════════════════════════════════════════════════════════╝
// ─────────────────────────────────────────────────────────────
// SECTION 6 — MODULE REGISTRY
// ─────────────────────────────────────────────────────────────
class ModuleRegistry extends EventTarget {
  constructor() {
    super();
    this.modules  = new Map(); // id → { id, type, params }
    this.patches  = [];        // [{ fromId, fromPort, toId, toPort }]
    this._counters = {};       // type → next index
  }

  addModule(type, paramsOverride = {}) {
    if (!MODULE_TYPE_DEFS[type]) { console.warn('Unknown module type:', type); return null; }
    const idx = this._counters[type] ?? 0;
    this._counters[type] = idx + 1;
    const id = `${type}-${idx}`;
    const defaults = { ...MODULE_TYPE_DEFS[type].defaultParams };
    const params = { ...defaults, ...paramsOverride };
    this.modules.set(id, { id, type, params });
    this.dispatchEvent(new CustomEvent('module-added', { detail: { id, type, params } }));
    return id;
  }

  removeModule(id) {
    const mod = this.modules.get(id);
    if (!mod) return;
    // Remove all patches involving this module
    this.patches = this.patches.filter(p => p.fromId !== id && p.toId !== id);
    this.modules.delete(id);
    this.dispatchEvent(new CustomEvent('module-removed', { detail: { id, type: mod.type } }));
    this.dispatchEvent(new CustomEvent('patch-changed',  { detail: { patches: this.patches } }));
  }

  setParam(id, param, value) {
    const mod = this.modules.get(id);
    if (!mod) return;
    mod.params[param] = value;
    this.dispatchEvent(new CustomEvent('param-changed', { detail: { id, param, value } }));
  }

  nextCvInputPort(moduleId) {
    const used = new Set(
      this.patches.filter(p => p.toId === moduleId && p.toPort.startsWith('cv-')).map(p => parseInt(p.toPort.replace('cv-','')) || 0)
    );
    let i = 0; while (used.has(i)) i++;
    return `cv-${i}`;
  }

  nextCvOutputPort(moduleId) {
    const used = new Set(
      this.patches.filter(p => p.fromId === moduleId && p.fromPort.startsWith('cvo-')).map(p => parseInt(p.fromPort.replace('cvo-','')) || 0)
    );
    let i = 0; while (used.has(i)) i++;
    return `cvo-${i}`;
  }

  addPatch(fromId, fromPort, toId, toPort) {
    const fromType = this._portSignalType(fromPort);
    const toType   = this._portSignalType(toPort);
    if (fromType !== toType) return; // reject incompatible signal types
    // Dynamic input modules: remove existing connection to same toPort
    const def = MODULE_TYPE_DEFS[this.modules.get(toId)?.type];
    if (!def?.dynamicInputs) {
      this.patches = this.patches.filter(p => !(p.toId === toId && p.toPort === toPort));
    }
    // Remove any existing connection from same fromId+fromPort+toId+toPort
    this.patches = this.patches.filter(p => !(p.fromId === fromId && p.fromPort === fromPort && p.toId === toId && p.toPort === toPort));
    this.patches.push({ fromId, fromPort, toId, toPort, signalType: fromType });
    this.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: this.patches } }));
  }

  removePatch(fromId, fromPort, toId, toPort) {
    const before = this.patches.length;
    this.patches = this.patches.filter(p =>
      !(p.fromId === fromId && p.fromPort === fromPort && p.toId === toId && p.toPort === toPort)
    );
    if (this.patches.length !== before) {
      this.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: this.patches } }));
    }
  }

  removePatchesFrom(fromId) {
    const before = this.patches.length;
    this.patches = this.patches.filter(p => p.fromId !== fromId);
    if (this.patches.length !== before)
      this.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: this.patches } }));
  }

  // Signal type helpers
  _portSignalType(port) {
    if (port === 'note-out' || port === 'note-in') return 'note';
    const isCV = p => p === 'cv' || p.endsWith('-cv') || p.startsWith('cv-') || p.startsWith('cvo-');
    return isCV(port) ? 'cv' : 'audio';
  }

  removePatchesTo(toId, toPort) {
    const before = this.patches.length;
    this.patches = this.patches.filter(p => !(p.toId === toId && p.toPort === toPort));
    if (this.patches.length !== before)
      this.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: this.patches } }));
  }

  nextInputPort(moduleId) {
    const used = new Set(
      this.patches.filter(p => p.toId === moduleId && p.toPort.startsWith('in-')).map(p => parseInt(p.toPort.replace('in-','')) || 0)
    );
    let i = 0; while (used.has(i)) i++;
    return `in-${i}`;
  }

  nextReturnPort(moduleId) {
    const used = new Set(
      this.patches.filter(p => p.toId === moduleId && p.toPort.startsWith('return-')).map(p => parseInt(p.toPort.replace('return-','')) || 0)
    );
    let i = 0; while (used.has(i)) i++;
    return `return-${i}`;
  }

  nextSendPort(moduleId) {
    const used = new Set(
      this.patches.filter(p => p.fromId === moduleId && p.fromPort.startsWith('send-')).map(p => parseInt(p.fromPort.replace('send-','')) || 0)
    );
    let i = 0; while (used.has(i)) i++;
    return `send-${i}`;
  }

  getModulesByCategory(cat) {
    return [...this.modules.values()].filter(m => MODULE_TYPE_DEFS[m.type]?.category === cat);
  }

  getModulesByType(type) {
    return [...this.modules.values()].filter(m => m.type === type);
  }

  countByType(type) { return this.getModulesByType(type).length; }

  getOscModules() { return this.getModulesByCategory('osc'); }

  patchesFrom(id)         { return this.patches.filter(p => p.fromId === id); }
  patchesTo(id)           { return this.patches.filter(p => p.toId === id); }
  patchesFromPort(id, port){ return this.patches.filter(p => p.fromId === id && p.fromPort === port); }
}

// ─────────────────────────────────────────────────────────────
// SECTION 6b — TRANSPORT
// ─────────────────────────────────────────────────────────────
class Transport {
  constructor(audioGraph) {
    this.ag           = audioGraph;
    this.bpm          = 120;
    this.rateDivision = 16;
    this.playing      = false;
    this.rootMidi     = 36; // C2 default
    this._nextStepTime = 0;
    this._globalStep   = 0;
    this._timerId      = null;
    this._subscribers  = new Map(); // moduleId → callback(globalStep, audioTime)
    this.LOOKAHEAD     = 0.1;
    this.INTERVAL      = 0.025;
  }

  get stepDuration() { return (60 / this.bpm) * (4 / this.rateDivision); }

  setRootKey(noteNameOrPc) {
    const pc  = NOTE_NAMES.includes(noteNameOrPc) ? noteNameOrPc : (ENHARMONIC[noteNameOrPc] ?? noteNameOrPc);
    const idx = NOTE_NAMES.indexOf(pc);
    if (idx >= 0) this.rootMidi = 36 + idx;
  }

  start() {
    if (this.playing || !this.ag.ctx) return;
    this.playing      = true;
    this._globalStep  = 0;
    this._nextStepTime = this.ag.ctx.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.playing = false;
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
  }

  subscribe(id, cb)   { this._subscribers.set(id, cb); }
  unsubscribe(id)     { this._subscribers.delete(id); }

  getBeatPosition(audioTime) {
    if (!this.playing) return { bar:0, beat:0, phase:0 };
    const elapsed    = Math.max(0, audioTime - (this._nextStepTime - this._globalStep * this.stepDuration));
    const totalSteps = elapsed / this.stepDuration;
    const beat       = Math.floor(totalSteps / (this.rateDivision / 4));
    return { bar: Math.floor(beat / 4), beat: beat % 4, phase: totalSteps % 1 };
  }

  _tick() {
    if (!this.playing || !this.ag.ctx) return;
    const ctx = this.ag.ctx;
    while (this._nextStepTime < ctx.currentTime + this.LOOKAHEAD) {
      const step = this._globalStep, time = this._nextStepTime;
      for (const [, cb] of this._subscribers) cb(step, time);
      this._globalStep++;
      this._nextStepTime += this.stepDuration;
    }
    this._timerId = setTimeout(() => this._tick(), this.INTERVAL * 1000);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 7 — AUDIO GRAPH
// ─────────────────────────────────────────────────────────────
class AudioGraph {
  constructor(registry) {
    this.registry = registry;
    this.ctx = null;
    this.voices = new Map(); // vk ('midi:60', 'seq-cv-0:60') → voice object
    this.glideFromFreq = null;
    this.seqGlideFreqs = new Map(); // seqId → last freq for per-seq glide
    this.transport = null;
    this.seqPlayheads       = new Map(); // seqId → {step, row, audioTime}
    this._seqCvNoteOffTimers = new Map(); // seqId → {midi, timerId}
    this.drumNoiseBuffers   = new Map(); // voiceId → AudioBuffer
    this._kickClickBuf      = null;
    this.sidechainNodes     = new Map(); // scId → {inputGain,keyGain,rectifier,smoother,duckerGain,processGain,dryGain,wetGain,outGain}
    this.userNoteHistory    = [];        // rolling buffer of {midi,velocity,time}
    // Global nodes
    this.masterGain = null;
    this.dryBus = null;
    this.reverbSend = null;
    this.wetGain = null;
    this.filterNode = null;
    this.filterNode2 = null;
    this.noiseGain = null;
    this.noiseGate = null;
    this.noiseColorFilter = null;
    // Mixer nodes per instance: mixerId → { outGain, channelGains: Map<portName, GainNode> }
    this.mixerNodes = new Map();
    // Delay nodes per instance: delayId → { inputGain, delayNode, feedbackGain, wetGain, dryGain, outGain }
    this.delayNodes = new Map();
    // LFO nodes per instance: lfoId → { inputGain, lfoOsc, lfoDepthGain, tremoloGain, outputGain }
    this.lfoNodes = new Map();
    // Vibrato nodes per instance: vibratoId → { lfoOsc, depthGain }
    this.vibratoNodes = new Map();
    // FX nodes per instance: fxId → { inputGain, dryGain, wetSend, outputGain }
    this.fxNodes = new Map();
    // Custom waveforms
    this.triWave = null;
    this.sqWave  = null;

    registry.addEventListener('module-added',  e => this._onModuleAdded(e.detail));
    registry.addEventListener('module-removed',e => this._onModuleRemoved(e.detail));
    registry.addEventListener('param-changed', e => this._onParamChanged(e.detail));
    registry.addEventListener('patch-changed', e => this._onPatchChanged());
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;

    this.masterGain = ctx.createGain(); this.masterGain.gain.value = 0.65;
    this.masterGain.connect(ctx.destination);

    // Reverb
    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len,2);
    }
    convolver.buffer = buf;
    this.wetGain = ctx.createGain(); this.wetGain.gain.value = 1;
    convolver.connect(this.wetGain); this.wetGain.connect(this.masterGain);
    this.dryBus = ctx.createGain(); this.dryBus.gain.value = 1;
    this.dryBus.connect(this.masterGain);
    this.reverbSend = convolver;

    // Filter (always in chain, controls unlock progressively)
    this.filterNode  = ctx.createBiquadFilter();
    this.filterNode2 = ctx.createBiquadFilter();
    [this.filterNode, this.filterNode2].forEach(f => { f.type='lowpass'; f.frequency.value=20000; f.Q.value=1; });
    this.filterNode.connect(this.filterNode2);
    // filterNode2 output is now explicit — driven by _syncFilterOutput()

    // Noise
    const nBuf = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
    const nSrc = ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value=0;
    this.noiseGate = ctx.createGain(); this.noiseGate.gain.value=0;
    this.noiseColorFilter = ctx.createBiquadFilter();
    this.noiseColorFilter.type='lowpass'; this.noiseColorFilter.frequency.value=20000; this.noiseColorFilter.Q.value=0.5;
    nSrc.connect(this.noiseGain); this.noiseGain.connect(this.noiseColorFilter);
    this.noiseColorFilter.connect(this.noiseGate);
    // noiseGate output is now explicit — driven by _syncNoiseRouting()
    nSrc.start();

    this._buildCustomWaves();
    this._applyAllParams();

    // Init any already-added modules
    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'mixer')    this._initMixer(id, mod.params);
      if (mod.type === 'lfo')      this._initLFO(id, mod.params);
      if (mod.type === 'vibrato')  this._initVibrato(id, mod.params);
      if (mod.type === 'delay')    this._initDelay(id, mod.params);
      if (mod.type === 'fx')       this._initFX(id, mod.params);
      if (mod.type === 'sidechain') this._initSidechain(id, mod.params);
    }

    // Transport — always live
    if (!this.transport) {
      this.transport = new Transport(this);
      const transMod = this.registry.modules.get('transport-0');
      if (transMod) this.transport.bpm = Math.round(sliderToBpm(transMod.params.bpm ?? 0.545));
    }

    // Subscribe existing seq modules (if ensure() called after modules were added)
    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'seq-cv')   this._initSeqCv(id, mod.params);
      if (mod.type === 'seq-drum') this._initSeqDrum(id, mod.params);
    }
  }

  _buildCustomWaves() {
    if (!this.ctx) return;
    const triMod = this.registry.getModulesByType('osc-tri')[0];
    const sqMod  = this.registry.getModulesByType('osc-sq')[0];
    this._buildTriWave(triMod?.params.slope ?? 0.5);
    this._buildSqWave(sqMod?.params.width   ?? 0.5);
  }

  _buildTriWave(slope) {
    const a = Math.max(0.02, Math.min(0.98, slope)), N=64;
    const real=new Float32Array(N+1), imag=new Float32Array(N+1);
    for (let n=1;n<=N;n++) imag[n]=(2*Math.sin(n*Math.PI*a))/(n*n*Math.PI*Math.PI*a*(1-a));
    this.triWave = this.ctx.createPeriodicWave(real, imag);
  }

  _buildSqWave(duty) {
    const d = Math.max(0.02, Math.min(0.98, duty)), N=64;
    const real=new Float32Array(N+1), imag=new Float32Array(N+1);
    for (let n=1;n<=N;n++) imag[n]=(2/(n*Math.PI))*Math.sin(n*Math.PI*d);
    this.sqWave = this.ctx.createPeriodicWave(real, imag);
  }

  // Resolve the semitone contribution from a CV source, supporting 1-level chaining
  // (e.g. CHORD → PITCH → OSC: PITCH accumulates its own offset + CHORD's interval)
  _cvSemiOffset(srcId, srcPort) {
    const src = this.registry.modules.get(srcId);
    if (!src) return 0;
    switch (src.type) {
      case 'pitch': {
        let s = (src.params.octave ?? 0) * 12 + (src.params.semi ?? 0);
        for (const p of this.registry.patchesTo(srcId).filter(x => x.signalType === 'cv')) {
          s += this._cvSemiOffset(p.fromId, p.fromPort);
        }
        return s;
      }
      case 'chord': {
        const ivs = (src.params.quality ?? 'maj') === 'maj' ? [0,4,7,12] : [0,3,7,12];
        const pi = parseInt(srcPort.replace('cv-','')) || 0;
        return ivs[pi] ?? 0;
      }
      default: return 0;
    }
  }

  _makeFoldCurve(fold) {
    const N=256, curve=new Float32Array(N);
    for (let i=0;i<N;i++) { const x=(i*2/(N-1))-1; let y=x*(1+fold*3.5); while(Math.abs(y)>1) y=Math.sign(y)*2-y; curve[i]=y; }
    return curve;
  }
  _makeDriveCurve(drive) {
    const N=256, g=1+drive*5, curve=new Float32Array(N);
    for (let i=0;i<N;i++) { const x=(i*2/(N-1))-1; curve[i]=Math.tanh(x*g)/Math.tanh(g); }
    return curve;
  }

  _initMixer(id, params) {
    if (!this.ctx || this.mixerNodes.has(id)) return;
    const preSumGain = this.ctx.createGain(); preSumGain.gain.value = 1;
    const outGain    = this.ctx.createGain(); outGain.gain.value = 1;
    preSumGain.connect(outGain);
    this.mixerNodes.set(id, { preSumGain, outGain, channelGains: new Map(), sendGains: new Map(), returnGains: new Map() });
  }

  _initLFO(id, params) {
    if (!this.ctx || this.lfoNodes.has(id)) return;
    const ctx   = this.ctx;
    const depth = params.depth ?? 0.5;
    const inputGain    = ctx.createGain(); inputGain.gain.value = 1;
    const tremoloGain  = ctx.createGain(); tremoloGain.gain.value = 1 - depth * 0.5;
    const outputGain   = ctx.createGain(); outputGain.gain.value = 1;
    const lfoOsc       = ctx.createOscillator(); lfoOsc.type = 'sine';
    lfoOsc.frequency.value = sliderToLfoRate(params.rate ?? 0.1);
    const lfoDepthGain = ctx.createGain(); lfoDepthGain.gain.value = depth * 0.5;
    // LFO modulates tremoloGain.gain around its base value
    lfoOsc.connect(lfoDepthGain);
    lfoDepthGain.connect(tremoloGain.gain);
    inputGain.connect(tremoloGain);
    tremoloGain.connect(outputGain);
    lfoOsc.start();
    this.lfoNodes.set(id, { inputGain, lfoOsc, lfoDepthGain, tremoloGain, outputGain });
  }

  _initVibrato(id, params) {
    if (!this.ctx || this.vibratoNodes.has(id)) return;
    const lfoOsc = this.ctx.createOscillator();
    lfoOsc.type = 'sine';
    lfoOsc.frequency.value = sliderToLfoRate(params.rate ?? 0.2);
    const depthGain = this.ctx.createGain();
    depthGain.gain.value = (params.depth ?? 0.3) * 50; // ±50 cents at depth=1
    lfoOsc.connect(depthGain);
    lfoOsc.start();
    this.vibratoNodes.set(id, { lfoOsc, depthGain });
  }

  _initDelay(id, params) {
    if (!this.ctx || this.delayNodes.has(id)) return;
    const ctx = this.ctx;
    const inputGain    = ctx.createGain();     inputGain.gain.value = 1;
    const delayNode    = ctx.createDelay(2.0); delayNode.delayTime.value = sliderToDelayTime(params.time ?? 0.3);
    const feedbackGain = ctx.createGain();     feedbackGain.gain.value = (params.feedback ?? 0.3) * 0.9;
    const mix = params.mix ?? 0.5;
    const wetGain      = ctx.createGain();     wetGain.gain.value  = mix;
    const dryGain      = ctx.createGain();     dryGain.gain.value  = 1 - mix;
    const outGain      = ctx.createGain();     outGain.gain.value  = 1;
    // Signal flow
    inputGain.connect(dryGain);
    inputGain.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode); // internal feedback loop
    delayNode.connect(wetGain);
    dryGain.connect(outGain);
    wetGain.connect(outGain);
    this.delayNodes.set(id, { inputGain, delayNode, feedbackGain, wetGain, dryGain, outGain });
  }

  _initFX(id, params) {
    if (!this.ctx || this.fxNodes.has(id)) return;
    const inputGain  = this.ctx.createGain(); inputGain.gain.value = 1;
    const dryGain    = this.ctx.createGain(); dryGain.gain.value = params.dry ?? 1.0;
    const wetSend    = this.ctx.createGain(); wetSend.gain.value = (params.wet ?? 0.4) * 0.55;
    const outputGain = this.ctx.createGain(); outputGain.gain.value = 1;
    inputGain.connect(wetSend); wetSend.connect(this.reverbSend);
    inputGain.connect(dryGain); dryGain.connect(outputGain);
    this.fxNodes.set(id, { inputGain, dryGain, wetSend, outputGain });
  }

  _onModuleAdded({ id, type, params }) {
    if (!this.ctx) return;
    if (type === 'mixer')    this._initMixer(id, params);
    if (type === 'lfo')      this._initLFO(id, params);
    if (type === 'vibrato')  this._initVibrato(id, params);
    if (type === 'delay')    this._initDelay(id, params);
    if (type === 'filter')   this._applyFilterParams(params);
    if (type === 'fx')       this._initFX(id, params);
    if (type === 'sidechain') this._initSidechain(id, params);
    if (type === 'seq-cv')   this._initSeqCv(id, params);
    if (type === 'seq-drum') this._initSeqDrum(id, params);
  }

  _onModuleRemoved({ id, type }) {
    if (type === 'mixer') {
      const n = this.mixerNodes.get(id);
      if (n) {
        n.channelGains.forEach(g  => { try{g.disconnect();}catch(e){} });
        n.sendGains.forEach(sg    => { try{sg.disconnect();}catch(e){} });
        n.returnGains.forEach(rg  => { try{rg.disconnect();}catch(e){} });
        try{n.preSumGain.disconnect();}catch(e){}
        try{n.outGain.disconnect();}catch(e){}
        this.mixerNodes.delete(id);
      }
    }
    if (type === 'lfo') {
      const n = this.lfoNodes.get(id);
      if (n) {
        [n.inputGain, n.lfoDepthGain, n.tremoloGain, n.outputGain].forEach(nd => { try{nd.disconnect();}catch(e){} });
        try{n.lfoOsc.stop();}catch(e){} try{n.lfoOsc.disconnect();}catch(e){}
        this.lfoNodes.delete(id);
      }
    }
    if (type === 'vibrato') {
      const vn = this.vibratoNodes.get(id);
      if (vn) {
        try{vn.lfoOsc.stop();}catch(e){} try{vn.lfoOsc.disconnect();}catch(e){}
        try{vn.depthGain.disconnect();}catch(e){}
        this.vibratoNodes.delete(id);
      }
    }
    if (type === 'delay') {
      const dn = this.delayNodes.get(id);
      if (dn) {
        [dn.inputGain, dn.delayNode, dn.feedbackGain, dn.wetGain, dn.dryGain, dn.outGain]
          .forEach(n => { try{n.disconnect();}catch(e){} });
        this.delayNodes.delete(id);
      }
    }
    if (type === 'fx') {
      const fn = this.fxNodes.get(id);
      if (fn) {
        [fn.inputGain, fn.dryGain, fn.wetSend, fn.outputGain].forEach(n => { try{n.disconnect();}catch(e){} });
        this.fxNodes.delete(id);
      }
    }
    if (type === 'sidechain') {
      const sc = this.sidechainNodes.get(id);
      if (sc) {
        [sc.inputGain, sc.keyGain, sc.rectifier, sc.smoother, sc.processGain, sc.dryGain, sc.wetGain, sc.outGain]
          .forEach(n => { try{n.disconnect();}catch(e){} });
        this.sidechainNodes.delete(id);
      }
    }
    if (type === 'seq-cv' || type === 'seq-drum') {
      if (this.transport) this.transport.unsubscribe(id);
      this.seqPlayheads.delete(id);
      const t = this._seqCvNoteOffTimers.get(id);
      if (t) { clearTimeout(t.timerId); this._seqCvNoteOffTimers.delete(id); }
    }
  }

  _onParamChanged({ id, param, value }) {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;

    if (mod.type === 'filter') {
      if (param === 'cutoff')     [this.filterNode, this.filterNode2].forEach(f => f.frequency.value = sliderToFreq(value));
      if (param === 'resonance')  [this.filterNode, this.filterNode2].forEach(f => f.Q.value = 0.1+value*19);
      if (param === 'filterType') {
        const ft = value === 'hp' ? 'highpass' : value === 'bp' ? 'bandpass' : 'lowpass';
        [this.filterNode, this.filterNode2].forEach(f => f.type = ft);
      }
    } else if (mod.type === 'lfo') {
      const n = this.lfoNodes.get(id);
      if (n) {
        if (param === 'rate')  n.lfoOsc.frequency.value = sliderToLfoRate(value);
        if (param === 'depth') {
          n.lfoDepthGain.gain.setTargetAtTime(value * 0.5, this.ctx.currentTime, 0.01);
          n.tremoloGain.gain.setTargetAtTime(1 - value * 0.5, this.ctx.currentTime, 0.01);
        }
      }
    } else if (mod.type === 'vibrato') {
      const vn = this.vibratoNodes.get(id);
      if (vn) {
        if (param === 'rate')  vn.lfoOsc.frequency.value = sliderToLfoRate(value);
        if (param === 'depth') vn.depthGain.gain.setTargetAtTime(value * 50, this.ctx.currentTime, 0.01);
      }
    } else if (mod.type === 'fx') {
      const fn = this.fxNodes.get(id);
      if (fn) {
        if (param === 'wet' || param === 'reverb') fn.wetSend.gain.setTargetAtTime(value*0.55, this.ctx.currentTime, 0.01);
        if (param === 'dry') fn.dryGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
      }
    } else if (mod.type === 'delay') {
      const dn = this.delayNodes.get(id);
      if (dn) {
        if (param === 'time')     dn.delayNode.delayTime.setTargetAtTime(sliderToDelayTime(value), this.ctx.currentTime, 0.02);
        if (param === 'feedback') dn.feedbackGain.gain.setTargetAtTime(value*0.9, this.ctx.currentTime, 0.01);
        if (param === 'mix') {
          dn.wetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
          dn.dryGain.gain.setTargetAtTime(1 - value, this.ctx.currentTime, 0.01);
        }
      }
    } else if (mod.type === 'osc-tri' && param === 'slope') {
      this._buildTriWave(value);
    } else if (mod.type === 'osc-sq' && param === 'width') {
      this._buildSqWave(value);
    } else if (mod.type === 'osc-noise') {
      if (param === 'level') {
        const patched = this.registry.patchesFrom(id).length > 0;
        if (this.noiseGain) this.noiseGain.gain.value = patched ? value*0.2 : 0;
      }
      if (param === 'color' && this.noiseColorFilter)
        this.noiseColorFilter.frequency.value = 300 + value*19700;
    } else if (mod.type === 'mixer') {
      const mn = this.mixerNodes.get(id);
      if (mn) {
        if (param.startsWith('level-in-')) {
          const g = mn.channelGains.get(param.slice(6)); // 'in-X'
          if (g) g.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
        }
        if (param.startsWith('send-level-')) {
          const sendPort = `send-${param.replace('send-level-', '')}`;
          const sg = mn.sendGains.get(sendPort);
          if (sg) sg.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
        }
      }
    }
    if (mod.type === 'transport') {
      if (param === 'bpm'  && this.transport) this.transport.bpm = Math.round(sliderToBpm(value));
      if (param === 'rate' && this.transport) this.transport.rateDivision = [4,8,16,32][Math.round(value*3)] ?? 16;
    }
    if (mod.type === 'sidechain') {
      const sc = this.sidechainNodes.get(id);
      if (sc) {
        if (param === 'amount') sc.duckerGain.gain.setTargetAtTime(-value * 0.95, this.ctx.currentTime, 0.01);
        if (param === 'wet')    sc.wetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
        if (param === 'dry')    sc.dryGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
      }
    }
    // Sync active voice gains when osc level changes
    if (MODULE_TYPE_DEFS[mod.type]?.category === 'osc' && param === 'level') {
      this._syncVoiceGainsForModule(id);
    }
  }

  _onPatchChanged() {
    if (!this.ctx) return;
    this._syncNoiseRouting();
    this._syncFilterOutput();
    this._syncMixerOutputs();
    this._syncMixerSends();
    this._syncDelayOutputs();
    this._syncFXOutputs();
    this._syncLFOOutputs();
    this._syncSidechainOutputs();
    this._syncAllVoices(); // last: per-voice connections after globals
  }

  _applyFilterParams(params) {
    if (!this.filterNode) return;
    [this.filterNode, this.filterNode2].forEach(f => {
      if (params.cutoff     !== undefined) f.frequency.value = sliderToFreq(params.cutoff);
      if (params.resonance  !== undefined) f.Q.value = 0.1 + params.resonance*19;
      if (params.filterType !== undefined) {
        const ft = params.filterType === 'hp' ? 'highpass' : params.filterType === 'bp' ? 'bandpass' : 'lowpass';
        f.type = ft;
      }
    });
  }

  _applyFxParams(params, id) {
    const fn = this.fxNodes?.get(id);
    if (!fn) return;
    fn.dryGain.gain.value = params.dry ?? 1.0;
    fn.wetSend.gain.value = (params.wet ?? params.reverb ?? 0.4) * 0.55;
  }

  _applyAllParams() {
    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'filter') this._applyFilterParams(mod.params);
      if (mod.type === 'fx')     this._applyFxParams(mod.params, id);
      if (mod.type === 'osc-noise') {
        const patched = this.registry.patchesFrom(id).length > 0;
        if (this.noiseGain) this.noiseGain.gain.value = patched ? (mod.params.level??0.8)*0.2 : 0;
        if (this.noiseColorFilter) this.noiseColorFilter.frequency.value = 300+(mod.params.color??1)*19700;
      }
    }
  }

  _syncNoiseRouting() {
    if (!this.noiseGate) return;
    try { this.noiseGate.disconnect(); } catch(e) {}
    for (const mod of this.registry.getModulesByType('osc-noise')) {
      const patch = this.registry.patchesFrom(mod.id).find(p => p.fromPort === 'audio');
      if (patch) {
        const dest = this._getDestNode(patch.toId, patch.toPort);
        if (this.noiseGain) this.noiseGain.gain.value = (mod.params.level ?? 0.8) * 0.2;
        if (dest) this.noiseGate.connect(dest);
      } else {
        if (this.noiseGain) this.noiseGain.gain.value = 0;
      }
    }
  }

  _syncDelayOutputs() {
    for (const [delayId, dn] of this.delayNodes) {
      try { dn.outGain.disconnect(); } catch(e) {}
      const outPatch = this.registry.patchesFrom(delayId).find(p => p.fromPort === 'audio');
      if (outPatch) {
        const dest = this._getDestNode(outPatch.toId, outPatch.toPort);
        if (dest) dn.outGain.connect(dest);
      }
    }
  }

  _syncMixerOutputs() {
    for (const [mixerId] of this.mixerNodes) {
      const mn = this.mixerNodes.get(mixerId);
      if (!mn) continue;
      try { mn.outGain.disconnect(); } catch(e) {}
      const outPatch = this.registry.patchesFrom(mixerId).find(p => p.fromPort === 'audio');
      if (outPatch) {
        const dest = this._getDestNode(outPatch.toId, outPatch.toPort);
        if (dest) mn.outGain.connect(dest);
      }
    }
  }

  _syncMixerSends() {
    for (const [mixerId, mn] of this.mixerNodes) {
      // Disconnect and clear all existing send gains
      for (const sg of mn.sendGains.values()) { try { sg.disconnect(); } catch(e) {} }
      mn.sendGains.clear();
      // Re-create one send gain per send-* patch, tapping from preSumGain
      const mod = this.registry.modules.get(mixerId);
      const sendPatches = this.registry.patchesFrom(mixerId).filter(p => p.fromPort.startsWith('send-'));
      for (const p of sendPatches) {
        const sendNum  = p.fromPort.replace('send-', '');
        const levelKey = `send-level-${sendNum}`;
        const sg = this.ctx.createGain(); sg.gain.value = mod?.params[levelKey] ?? 0.8;
        mn.preSumGain.connect(sg);
        mn.sendGains.set(p.fromPort, sg);
        const dest = this._getDestNode(p.toId, p.toPort);
        if (dest) sg.connect(dest);
      }
    }
  }

  _syncFilterOutput() {
    if (!this.filterNode2) return;
    try { this.filterNode2.disconnect(); } catch(e) {}
    // filterNode → filterNode2 is internal; only disconnect filterNode2's outputs
    for (const mod of this.registry.getModulesByType('filter')) {
      for (const patch of this.registry.patchesFrom(mod.id)) {
        if (patch.fromPort !== 'audio') continue;
        const dest = this._getDestNode(patch.toId, patch.toPort);
        if (dest) this.filterNode2.connect(dest);
      }
    }
  }

  _syncFXOutputs() {
    for (const [fxId, fn] of this.fxNodes) {
      try { fn.outputGain.disconnect(); } catch(e) {}
      const outPatch = this.registry.patchesFrom(fxId).find(p => p.fromPort === 'audio');
      if (outPatch) {
        const dest = this._getDestNode(outPatch.toId, outPatch.toPort);
        if (dest) fn.outputGain.connect(dest);
      }
    }
  }

  _syncLFOOutputs() {
    for (const [lfoId, ln] of this.lfoNodes) {
      try { ln.outputGain.disconnect(); } catch(e) {}
      const outPatch = this.registry.patchesFrom(lfoId).find(p => p.fromPort === 'audio');
      if (outPatch) {
        const dest = this._getDestNode(outPatch.toId, outPatch.toPort);
        if (dest) ln.outputGain.connect(dest);
      }
    }
  }

  _getDestNode(toId, toPort) {
    const mod = this.registry.modules.get(toId);
    if (!mod) return null;
    if (mod.type === 'audio-out') return this.dryBus;
    if (mod.type === 'filter') return this.filterNode;
    if (mod.type === 'fx') {
      const fn = this.fxNodes.get(toId);
      return fn?.inputGain ?? null;
    }
    if (mod.type === 'delay') {
      const dn = this.delayNodes.get(toId);
      return dn ? dn.inputGain : null;
    }
    if (mod.type === 'mixer') {
      const mn = this.mixerNodes.get(toId);
      if (!mn) return null;
      // Return inputs (top jacks) — feed into outGain post-channels
      if (toPort.startsWith('return-')) {
        if (!mn.returnGains.has(toPort)) {
          const rg = this.ctx.createGain(); rg.gain.value = 1;
          rg.connect(mn.outGain);
          mn.returnGains.set(toPort, rg);
        }
        return mn.returnGains.get(toPort);
      }
      // Channel inputs (in-N) — feed into preSumGain
      if (!mn.channelGains.has(toPort)) {
        const g = this.ctx.createGain();
        g.gain.value = mod.params[`level-${toPort}`] ?? 1;
        g.connect(mn.preSumGain);
        mn.channelGains.set(toPort, g);
      }
      return mn.channelGains.get(toPort);
    }
    if (mod.type === 'lfo') {
      return this.lfoNodes.get(toId)?.inputGain ?? null;
    }
    if (mod.type === 'sidechain') {
      const sc = this.sidechainNodes.get(toId);
      if (!sc) return null;
      return toPort === 'key' ? sc.keyGain : sc.inputGain;
    }
    return null;
  }

  // Compute effective gain for an osc module (level * mixer channel level if through mixer)
  _oscEffectiveGain(modId) {
    const mod = this.registry.modules.get(modId);
    if (!mod) return 0;
    const level = mod.params.level ?? 0.8;
    const patch = this.registry.patchesFrom(modId).find(p => p.fromPort === 'audio');
    if (!patch) return 0; // not patched = silent
    if (patch.toId.startsWith('mixer-')) {
      const mixerMod = this.registry.modules.get(patch.toId);
      const chLevel = mixerMod?.params[`level-${patch.toPort}`] ?? 1;
      return level * chLevel;
    }
    return level;
  }

  // Compute voice output destination from the patch graph.
  // ownedOscIds: array of osc module IDs this voice controls (null = all).
  _getVoiceOutputDest(ownedOscIds = null) {
    const owns = id => !ownedOscIds || ownedOscIds.includes(id);
    // If any ENV has an output patch and is downstream of an owned OSC, follow it
    const envMod = this.registry.getModulesByType('env')[0];
    if (envMod) {
      const envFed = !ownedOscIds ||
        this.registry.patchesTo(envMod.id).some(p => p.toPort === 'audio' && owns(p.fromId));
      if (envFed) {
        const envOut = this.registry.patchesFrom(envMod.id).find(p => p.fromPort === 'env');
        if (envOut) {
          const dest = this._getDestNode(envOut.toId, envOut.toPort);
          if (dest) return dest;
        }
      }
    }
    // Fall back: first owned OSC with an output patch
    for (const [id, mod] of this.registry.modules) {
      if (MODULE_TYPE_DEFS[mod.type]?.category !== 'osc' || mod.type === 'osc-noise') continue;
      if (!owns(id)) continue;
      const patch = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
      if (!patch) continue;
      const toMod = this.registry.modules.get(patch.toId);
      if (toMod?.type === 'env') {
        const envOut = this.registry.patchesFrom(patch.toId).find(p => p.fromPort === 'env');
        if (envOut) {
          const dest = this._getDestNode(envOut.toId, envOut.toPort);
          if (dest) return dest;
        }
      } else {
        const dest = this._getDestNode(patch.toId, patch.toPort);
        if (dest) return dest;
      }
    }
    return null;
  }

  // Returns OSC module IDs owned by seqId (null = MIDI-driven, unpatched OSCs)
  _getOwnedOscIds(seqId) {
    const owned = [];
    for (const [id, mod] of this.registry.modules) {
      const def = MODULE_TYPE_DEFS[mod.type];
      if (!def || def.category !== 'osc' || mod.type === 'osc-noise') continue;
      const noteInPatch = this.registry.patchesTo(id).find(p => p.toPort === 'note-in');
      if (seqId === null) {
        if (!noteInPatch) owned.push(id);
      } else {
        if (noteInPatch?.fromId === seqId) owned.push(id);
      }
    }
    return owned;
  }

  _syncVoiceGainsForModule(modId) {
    for (const [, voice] of this.voices) {
      const vnode = voice.oscNodes.get(modId);
      if (vnode) {
        const gain = this._oscEffectiveGain(modId);
        vnode.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);
      }
    }
  }

  _syncAllVoices() {
    for (const [, voice] of this.voices) this._rewireVoice(voice);
  }

  _rewireVoice(voice) {
    const ownedOscIds = voice.ownedOscIds ?? null;
    for (const [, vnode] of voice.oscNodes) { try { vnode.gain.disconnect(); } catch(e) {} }
    try { voice.envGain.disconnect(); } catch(e) {}
    const voiceDest = this._getVoiceOutputDest(ownedOscIds);
    if (voiceDest) voice.envGain.connect(voiceDest);
    for (const [modId, vnode] of voice.oscNodes) {
      if (ownedOscIds && !ownedOscIds.includes(modId)) { vnode.gain.gain.value = 0; continue; }
      const patch = this.registry.patchesFrom(modId).find(p => p.fromPort === 'audio');
      if (!patch) { vnode.gain.gain.value = 0; continue; }
      vnode.gain.gain.value = this._oscEffectiveGain(modId);
      vnode.gain.connect(voice.envGain);
    }
  }

  // seqId=null → MIDI voice; seqId='seq-cv-0' etc → sequencer voice.
  // when=null → immediate; when=audioTime → scheduled (lookahead).
  playNote(midi, velocity, when = null, seqId = null) {
    this.ensure();
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const vk = seqId ? `${seqId}:${midi}` : `midi:${midi}`;
    this.stopNote(midi, t, seqId);

    const freq = midiToFreq(midi);
    const prevFreq = seqId === null ? this.glideFromFreq : (this.seqGlideFreqs.get(seqId) ?? null);
    if (seqId === null) this.glideFromFreq = freq;
    else this.seqGlideFreqs.set(seqId, freq);
    const vol = (velocity / 127) * 0.28;

    const envMod = this.registry.getModulesByType('env')[0];
    const envPatched = envMod && this.registry.patchesFrom(envMod.id).length > 0;
    const ep = envPatched ? envMod.params : { attack:0.02, decay:0.22, sustain:0.55, release:0.05 };
    const atk = sliderToAttack(ep.attack ?? 0.02);
    const dec = sliderToDecay(ep.decay ?? 0.22);
    const sus = ep.sustain ?? 0.55;
    const rel = sliderToRelease(ep.release ?? 0.2);
    const sustainLevel = vol * sus;

    const ownedOscIds = this._getOwnedOscIds(seqId);

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, t);
    envGain.gain.linearRampToValueAtTime(vol, t + atk);
    envGain.gain.linearRampToValueAtTime(sustainLevel, t + atk + dec);
    const voiceDest = this._getVoiceOutputDest(ownedOscIds.length ? ownedOscIds : null);
    if (voiceDest) envGain.connect(voiceDest);

    const oscNodes = new Map();

    for (const [id, mod] of this.registry.modules) {
      const def = MODULE_TYPE_DEFS[mod.type];
      if (!def || def.category !== 'osc') continue;
      if (mod.type === 'osc-noise') continue;
      if (ownedOscIds.length && !ownedOscIds.includes(id)) continue; // MIDI isolation

      const patch = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');

      let semiOffset = 0, detuneAccum = 0, glide = 0, gainScale = 1.0;
      const vibratoSources = [];
      for (const cvp of this.registry.patchesTo(id).filter(p => p.signalType === 'cv')) {
        const src = this.registry.modules.get(cvp.fromId);
        if (!src) continue;
        switch (src.type) {
          case 'pitch':
          case 'chord':   semiOffset += this._cvSemiOffset(cvp.fromId, cvp.fromPort); break;
          case 'unison': { const pi = parseInt(cvp.fromPort.replace('cv-','')) || 0; detuneAccum += (pi-1)*(src.params.spread??0.5)*20; break; }
          case 'vibrato': vibratoSources.push(cvp.fromId); break;
          case 'glide':   glide = (src.params.time ?? 0) * 2; break;
          case 'velocity':{ const s=src.params.sens??0.7; gainScale *= 1.0-s+s*(velocity/127); break; }
        }
      }

      const octMul = Math.pow(2, mod.params.octave ?? 0);
      const targetFreq = freq * octMul * (semiOffset !== 0 ? Math.pow(2, semiOffset/12) : 1);
      const wf = mod.params.waveform || def.waveform || 'sine';

      const osc = ctx.createOscillator();
      if      (wf === 'sine')     osc.type = 'sine';
      else if (wf === 'sawtooth') osc.type = 'sawtooth';
      else if (wf === 'triangle') { if (this.triWave) osc.setPeriodicWave(this.triWave); else osc.type='triangle'; }
      else if (wf === 'square')   { if (this.sqWave)  osc.setPeriodicWave(this.sqWave);  else osc.type='square'; }
      else if (wf === 'sub')      { osc.type='square'; osc.detune.value=(mod.params.subTune??0)*100; }
      else osc.type = 'sine';

      if (glide > 0 && prevFreq !== null) {
        osc.frequency.setValueAtTime(targetFreq*(prevFreq/freq), t);
        osc.frequency.linearRampToValueAtTime(targetFreq, t+glide);
      } else { osc.frequency.value = targetFreq; }
      osc.detune.value += detuneAccum;
      for (const vId of vibratoSources) { const vn = this.vibratoNodes.get(vId); if (vn) vn.depthGain.connect(osc.detune); }

      const gainNode = ctx.createGain();
      gainNode.gain.value = patch ? this._oscEffectiveGain(id) * gainScale : 0;

      const foldAmt  = wf==='sine'     ? (mod.params.fold ??0) : 0;
      const driveAmt = wf==='sawtooth' ? (mod.params.drive??0) : 0;
      const waveParam = mod.params.waveParam ?? 0;

      if (foldAmt>0.01 || (wf==='sine' && mod.type==='osc' && waveParam>0.01)) {
        const folder = ctx.createWaveShaper(); folder.curve = this._makeFoldCurve(foldAmt||waveParam);
        osc.connect(folder); folder.connect(gainNode);
        oscNodes.set(id, { osc, gain: gainNode, shaper: folder });
      } else if (driveAmt>0.01 || (wf==='sawtooth' && mod.type==='osc' && waveParam>0.01)) {
        const driver = ctx.createWaveShaper(); driver.curve = this._makeDriveCurve(driveAmt||waveParam);
        osc.connect(driver); driver.connect(gainNode);
        oscNodes.set(id, { osc, gain: gainNode, shaper: driver });
      } else {
        osc.connect(gainNode);
        oscNodes.set(id, { osc, gain: gainNode });
      }

      gainNode.connect(envGain);
      osc.start(t);
    }

    // Pad (fx module)
    let padGain = null, padOsc = null;
    if (seqId === null) { // pad only for MIDI voices
      const fxMod = this.registry.getModulesByType('fx')[0];
      if (fxMod && (fxMod.params.pad??0) > 0) {
        padOsc = ctx.createOscillator(); padOsc.type='sine'; padOsc.frequency.value=freq;
        padGain = ctx.createGain();
        padGain.gain.setValueAtTime(0, t);
        padGain.gain.linearRampToValueAtTime(vol*(fxMod.params.pad??0)*0.6, t+0.5);
        const fxFn = this.fxNodes.get(fxMod.id);
        padOsc.connect(padGain); padGain.connect(fxFn?.inputGain ?? this.dryBus);
        padOsc.start(t);
      }
    }

    if (this.noiseGate) this.noiseGate.gain.setTargetAtTime(1, t, 0.008);

    this.voices.set(vk, { oscNodes, envGain, padGain, padOsc, rel, sustainLevel, ownedOscIds });
  }

  stopNote(midi, when = null, seqId = null) {
    const vk = seqId ? `${seqId}:${midi}` : `midi:${midi}`;
    const v = this.voices.get(vk);
    if (!v || !this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const isScheduled = when !== null && when > this.ctx.currentTime + 0.001;
    [v.envGain, v.padGain].forEach(g => {
      if (!g) return;
      g.gain.cancelScheduledValues(t);
      if (isScheduled) {
        g.gain.setValueAtTime(v.sustainLevel ?? 0, t);
      } else {
        g.gain.setValueAtTime(g.gain.value, t);
      }
      g.gain.linearRampToValueAtTime(0, t + v.rel);
    });
    const delay = (v.rel + 0.15 + Math.max(0, t - this.ctx.currentTime)) * 1000;
    setTimeout(() => {
      for (const [, vn] of v.oscNodes) { try { vn.osc.stop(); vn.shaper?.disconnect(); } catch(e){} }
      try { v.padOsc?.stop(); } catch(e) {}
    }, delay);
    this.voices.delete(vk);
    if (this.noiseGate && this.voices.size === 0)
      this.noiseGate.gain.setTargetAtTime(0, t, 0.06);
  }

  // ── RATE HELPER ──────────────────────────────────────────────
  // Returns [{localStep, time, cellDur}] for any steps that fire at this globalStep.
  // rate: '4'=quarters, '8'=eighths, 'd8'=dotted-8ths, 't8'=triplet-8ths, '16'=sixteenths, '32'=32nds
  _rateFiresAt(globalStep, rate, total, audioTime, stepDur) {
    switch (rate) {
      case '4':
        if (globalStep % 4 !== 0) return [];
        return [{ localStep: Math.floor(globalStep / 4) % total, time: audioTime, cellDur: stepDur * 4 }];
      case '8':
        if (globalStep % 2 !== 0) return [];
        return [{ localStep: Math.floor(globalStep / 2) % total, time: audioTime, cellDur: stepDur * 2 }];
      case 'd8':
        if (globalStep % 3 !== 0) return [];
        return [{ localStep: Math.floor(globalStep / 3) % total, time: audioTime, cellDur: stepDur * 3 }];
      case 't8': {
        if (globalStep % 4 === 3) return [];
        const t8Count = Math.floor(globalStep / 4) * 3 + (globalStep % 4);
        return [{ localStep: t8Count % total, time: audioTime, cellDur: stepDur * 4 / 3 }];
      }
      case '32': {
        const ls1 = (globalStep * 2) % total;
        const ls2 = (globalStep * 2 + 1) % total;
        return [
          { localStep: ls1, time: audioTime,               cellDur: stepDur / 2 },
          { localStep: ls2, time: audioTime + stepDur / 2, cellDur: stepDur / 2 },
        ];
      }
      default: // '16'
        return [{ localStep: globalStep % total, time: audioTime, cellDur: stepDur }];
    }
  }

  // ── SEQ-CV ──────────────────────────────────────────────────
  _initSeqCv(id, params) {
    if (!this.transport || this.transport._subscribers.has(id)) return;
    this.transport.subscribe(id, (step, time) => this._fireSeqCvStep(id, step, time));
  }

  _fireSeqCvStep(seqId, globalStep, audioTime) {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(seqId);
    if (!mod) return;
    const rate    = mod.params.rate ?? '16';
    const bars    = mod.params.bars ?? 1;
    const total   = 16 * bars;
    const stepDur = this.transport.stepDuration;
    const fires   = this._rateFiresAt(globalStep, rate, total, audioTime, stepDur);
    if (!fires.length) return;

    for (const { localStep, time, cellDur } of fires) {
      const velState = mod.params[`step-${localStep}-vel`] ?? 0;
      this.seqPlayheads.set(seqId, { step: localStep, row: mod.params[`step-${localStep}-note`] ?? 12, audioTime: time });
      if (velState === 0) { this._seqCvStopPrev(seqId, time); continue; }

      const noteRow = mod.params[`step-${localStep}-note`] ?? 12;
      const midi    = this.transport.rootMidi + (noteRow - 12);
      const vel     = velState === 1 ? 64 : 127;
      const gate    = sliderToGate(mod.params.gate ?? 0.5);
      const noteOff = time + cellDur * gate;

      this._seqCvStopPrev(seqId, time);

      if (velState === 3) {
        for (let i = 0; i < 4; i++) this.playNote(midi, 64, time + i * cellDur / 4, seqId);
        const lastOff = time + 3 * cellDur / 4 + cellDur / 4 * 0.8;
        const delay   = Math.max(0, (lastOff - this.ctx.currentTime) * 1000);
        const timerId = setTimeout(() => { if (this.ctx) this.stopNote(midi, lastOff, seqId); }, delay);
        this._seqCvNoteOffTimers.set(seqId, { midi, timerId });
      } else {
        this.playNote(midi, vel, time, seqId);
        const delay   = Math.max(0, (noteOff - this.ctx.currentTime) * 1000);
        const capturedOff = noteOff;
        const timerId = setTimeout(() => { if (this.ctx) this.stopNote(midi, capturedOff, seqId); }, delay);
        this._seqCvNoteOffTimers.set(seqId, { midi, timerId });
      }
    }
  }

  _seqCvStopPrev(seqId, atTime) {
    const prev = this._seqCvNoteOffTimers.get(seqId);
    if (prev) {
      clearTimeout(prev.timerId);
      this.stopNote(prev.midi, atTime, seqId);
      this._seqCvNoteOffTimers.delete(seqId);
    }
  }

  // ── SEQ-DRUM ─────────────────────────────────────────────────
  _initSeqDrum(id, params) {
    if (!this.transport || this.transport._subscribers.has(id)) return;
    this.transport.subscribe(id, (step, time) => this._fireSeqDrumStep(id, step, time));
  }

  _fireSeqDrumStep(seqId, globalStep, audioTime) {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(seqId);
    if (!mod) return;
    const rate    = mod.params.rate ?? '16';
    const stepDur = this.transport.stepDuration;
    const fires   = this._rateFiresAt(globalStep, rate, 16, audioTime, stepDur);
    if (!fires.length) return;

    const notePatches = this.registry.patchesFrom(seqId).filter(p => p.fromPort === 'note-out' && p.signalType === 'note');

    for (const { localStep, time } of fires) {
      const col = localStep;
      this.seqPlayheads.set(seqId, { step: col, row: 0, audioTime: time });
      for (let row = 0; row < 4; row++) {
        if (!mod.params[`step-${row}-${col}`]) continue;
        const patch = notePatches[row];
        if (!patch) continue;
        const drumMod = this.registry.modules.get(patch.toId);
        if (drumMod) this._fireDrumVoice(patch.toId, drumMod.type, 100, time);
      }
    }
  }

  // ── DRUM VOICES ──────────────────────────────────────────────
  // Fire all drum voices patched from a generator module, respecting triggerNote
  _fireMidiNoteToDrums(sourceModuleId, note, vel, time) {
    const patches = this.registry.patchesFrom(sourceModuleId).filter(p => p.fromPort === 'note-out' && p.signalType === 'note');
    for (const patch of patches) {
      const drumMod = this.registry.modules.get(patch.toId);
      if (!drumMod) continue;
      const triggerNote = drumMod.params?.triggerNote ?? -1;
      if (triggerNote >= 0 && triggerNote !== note) continue;
      this._fireDrumVoice(patch.toId, drumMod.type, vel, time);
    }
  }

  _fireDrumVoice(voiceId, type, vel, time) {
    if (!this.ctx) return;
    if (type === 'drum-hat')   this._fireHat(voiceId, vel, time);
    if (type === 'drum-kick')  this._fireKick(voiceId, vel, time);
    if (type === 'drum-snare') this._fireSnare(voiceId, vel, time);
  }

  _getDrumOutputDest(voiceId) {
    const patch = this.registry.patchesFrom(voiceId).find(p => p.fromPort === 'audio');
    if (!patch) return null;
    return this._getDestNode(patch.toId, patch.toPort) ?? null;
  }

  _getDrumNoiseBuffer(voiceId) {
    if (this.drumNoiseBuffers.has(voiceId)) return this.drumNoiseBuffers.get(voiceId);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.drumNoiseBuffers.set(voiceId, buf);
    return buf;
  }

  _getKickClickBuffer() {
    if (this._kickClickBuf) return this._kickClickBuf;
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * 0.01);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * (1 - i/len);
    this._kickClickBuf = buf;
    return buf;
  }

  _fireHat(voiceId, vel, time) {
    const ctx   = this.ctx;
    const mod   = this.registry.modules.get(voiceId);
    if (!mod) return;
    const atk   = sliderToDrumDecay((mod.params.attack ?? 0.28) * 0.1); // short click
    const decay = sliderToDrumDecay(mod.params.decay ?? 0.55);
    const vol   = (vel / 127) * (mod.params.level ?? 0.7) * 0.4;
    const buf   = this._getDrumNoiseBuffer(voiceId);
    const src   = ctx.createBufferSource(); src.buffer = buf;
    const hpf   = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 8000;
    const gain  = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + atk);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    src.connect(hpf); hpf.connect(gain);
    const dest = this._getDrumOutputDest(voiceId);
    if (dest) gain.connect(dest);
    src.start(time); src.stop(time + decay + 0.05);
  }

  _fireKick(voiceId, vel, time) {
    const ctx = this.ctx;
    const mod = this.registry.modules.get(voiceId);
    if (!mod) return;
    const decay     = sliderToDrumDecay(mod.params.decay ?? 0.55);
    const startFreq = sliderToKickFreq(mod.params.tune ?? 0.3);
    const vol       = (vel / 127) * (mod.params.level ?? 0.8) * 0.8;
    const dest      = this._getDrumOutputDest(voiceId);

    const osc  = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + decay * 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    osc.connect(gain);
    if (dest) gain.connect(dest);
    osc.start(time); osc.stop(time + decay + 0.05);

    // Click transient
    const clickBuf = this._getKickClickBuffer();
    if (clickBuf) {
      const clickSrc  = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
      const clickGain = ctx.createGain(); clickGain.gain.value = vol * 0.8;
      clickSrc.connect(clickGain);
      if (dest) clickGain.connect(dest);
      clickSrc.start(time); clickSrc.stop(time + 0.05);
    }
  }

  _fireSnare(voiceId, vel, time) {
    const ctx  = this.ctx;
    const mod  = this.registry.modules.get(voiceId);
    if (!mod) return;
    const decay    = sliderToDrumDecay(mod.params.decay ?? 0.4);
    const snapAmt  = mod.params.snap  ?? 0.5; // 0-1: affects noise decay speed
    const toneFreq = 100 + (mod.params.tone ?? 0.3) * 200; // 100–300 Hz
    const vol      = (vel / 127) * (mod.params.level ?? 0.7) * 0.6;
    const dest     = this._getDrumOutputDest(voiceId);

    // Noise rattle (snap affects noise portion)
    const noiseSrc  = ctx.createBufferSource(); noiseSrc.buffer = this._getDrumNoiseBuffer(voiceId);
    const bpf       = ctx.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=1500; bpf.Q.value=0.8;
    const noiseGain = ctx.createGain();
    const noiseDec  = decay * (0.5 + snapAmt * 0.5);
    noiseGain.gain.setValueAtTime(vol * (0.4 + snapAmt * 0.4), time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseDec);
    noiseSrc.connect(bpf); bpf.connect(noiseGain);

    // Tone body
    const osc      = ctx.createOscillator(); osc.type='triangle'; osc.frequency.value=toneFreq;
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(vol * (0.6 - snapAmt * 0.3), time);
    toneGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
    osc.connect(toneGain);

    if (dest) { noiseGain.connect(dest); toneGain.connect(dest); }
    noiseSrc.start(time); noiseSrc.stop(time + noiseDec + 0.05);
    osc.start(time); osc.stop(time + decay * 0.5 + 0.05);
  }

  // ── SIDECHAIN ─────────────────────────────────────────────────
  _initSidechain(id, params) {
    if (!this.ctx || this.sidechainNodes.has(id)) return;
    const ctx = this.ctx;
    const inputGain  = ctx.createGain(); inputGain.gain.value = 1;
    const keyGain    = ctx.createGain(); keyGain.gain.value = 1;
    // Full-wave rectifier curve
    const rectCurve  = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i*2/255-1; rectCurve[i] = Math.abs(x); }
    const rectifier  = ctx.createWaveShaper(); rectifier.curve = rectCurve;
    const smoother   = ctx.createBiquadFilter(); smoother.type='lowpass'; smoother.frequency.value = 20;
    const duckerGain = ctx.createGain(); duckerGain.gain.value = -(params.amount ?? 0.7) * 0.95;
    const processGain = ctx.createGain(); processGain.gain.value = 1;
    // Key sidechain path: key → rectify → smooth → duckerGain → processGain.gain
    keyGain.connect(rectifier);
    rectifier.connect(smoother);
    smoother.connect(duckerGain);
    duckerGain.connect(processGain.gain);
    // Audio path: input → (dry) + (processGain → wet) → out
    inputGain.connect(processGain);
    const dryGain = ctx.createGain(); dryGain.gain.value = params.dry ?? 0;
    const wetGain = ctx.createGain(); wetGain.gain.value = params.wet ?? 1;
    const outGain = ctx.createGain(); outGain.gain.value = 1;
    inputGain.connect(dryGain);
    processGain.connect(wetGain);
    dryGain.connect(outGain);
    wetGain.connect(outGain);
    this.sidechainNodes.set(id, { inputGain, keyGain, rectifier, smoother, duckerGain, processGain, dryGain, wetGain, outGain });
  }

  _syncSidechainOutputs() {
    for (const [scId, sc] of this.sidechainNodes) {
      try { sc.outGain.disconnect(); } catch(e) {}
      const outPatch = this.registry.patchesFrom(scId).find(p => p.fromPort === 'audio');
      if (outPatch) {
        const dest = this._getDestNode(outPatch.toId, outPatch.toPort);
        if (dest) sc.outGain.connect(dest);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  playTone(midi, vol, when, duration) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator(); osc.type='sine';
    osc.frequency.value = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when+duration);
    osc.connect(g); g.connect(this.filterNode ?? this.dryBus);
    osc.start(when); osc.stop(when+duration+0.05);
  }
}