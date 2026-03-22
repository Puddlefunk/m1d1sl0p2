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
    // Determine signal type from port names — cv if port is 'cv', ends with '-cv', starts with 'cv-' or 'cvo-'
    const isCV = p => p === 'cv' || p.endsWith('-cv') || p.startsWith('cv-') || p.startsWith('cvo-');
    const fromType = isCV(fromPort) ? 'cv' : 'audio';
    const toType   = isCV(toPort)   ? 'cv' : 'audio';
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
// SECTION 7 — AUDIO GRAPH
// ─────────────────────────────────────────────────────────────
class AudioGraph {
  constructor(registry) {
    this.registry = registry;
    this.ctx = null;
    this.voices = new Map(); // midi → voice object
    this.glideFromFreq = null;
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

    // Init any already-added mixer/lfo/delay/fx modules
    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'mixer') this._initMixer(id, mod.params);
      if (mod.type === 'lfo')     this._initLFO(id, mod.params);
      if (mod.type === 'vibrato') this._initVibrato(id, mod.params);
      if (mod.type === 'delay')   this._initDelay(id, mod.params);
      if (mod.type === 'fx')    this._initFX(id, mod.params);
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
    if (type === 'mixer') this._initMixer(id, params);
    if (type === 'lfo')     this._initLFO(id, params);
    if (type === 'vibrato') this._initVibrato(id, params);
    if (type === 'delay')   this._initDelay(id, params);
    if (type === 'filter') this._applyFilterParams(params);
    if (type === 'fx')     this._initFX(id, params);
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
  }

  _onParamChanged({ id, param, value }) {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;

    if (mod.type === 'filter') {
      if (param === 'cutoff')    [this.filterNode, this.filterNode2].forEach(f => f.frequency.value = sliderToFreq(value));
      if (param === 'resonance') [this.filterNode, this.filterNode2].forEach(f => f.Q.value = 0.1+value*19);
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
    this._syncAllVoices(); // last: per-voice connections after globals
  }

  _applyFilterParams(params) {
    if (!this.filterNode) return;
    [this.filterNode, this.filterNode2].forEach(f => {
      if (params.cutoff    !== undefined) f.frequency.value = sliderToFreq(params.cutoff);
      if (params.resonance !== undefined) f.Q.value = 0.1 + params.resonance*19;
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

  // Compute the single voice output destination from the current patch graph.
  // Priority: ENV module output patch → first OSC direct/via-ENV output.
  _getVoiceOutputDest() {
    // If any ENV module has an output patch, follow it
    const envMod = this.registry.getModulesByType('env')[0];
    if (envMod) {
      const envOut = this.registry.patchesFrom(envMod.id).find(p => p.fromPort === 'env');
      if (envOut) {
        const dest = this._getDestNode(envOut.toId, envOut.toPort);
        if (dest) return dest;
      }
    }
    // Fall back: first OSC with a non-env output patch
    for (const [id, mod] of this.registry.modules) {
      if (MODULE_TYPE_DEFS[mod.type]?.category !== 'osc' || mod.type === 'osc-noise') continue;
      const patch = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
      if (!patch) continue;
      const toMod = this.registry.modules.get(patch.toId);
      if (toMod?.type === 'env') {
        // This OSC goes to ENV — follow ENV's output
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
    for (const [midi, voice] of this.voices) {
      this._rewireVoice(voice);
    }
  }

  _rewireVoice(voice) {
    // Disconnect all osc gains and envGain
    for (const [, vnode] of voice.oscNodes) { try { vnode.gain.disconnect(); } catch(e) {} }
    try { voice.envGain.disconnect(); } catch(e) {}
    // Reconnect envGain to current voice output destination
    const voiceDest = this._getVoiceOutputDest();
    if (voiceDest) voice.envGain.connect(voiceDest);
    // All OSC gains always flow through envGain (per-voice ADSR gate)
    for (const [modId, vnode] of voice.oscNodes) {
      const patch = this.registry.patchesFrom(modId).find(p => p.fromPort === 'audio');
      if (!patch) { vnode.gain.gain.value = 0; continue; }
      vnode.gain.gain.value = this._oscEffectiveGain(modId);
      vnode.gain.connect(voice.envGain);
    }
  }

  playNote(midi, velocity) {
    this.ensure();
    this.stopNote(midi);
    const ctx = this.ctx, now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const prevFreq = this.glideFromFreq;
    this.glideFromFreq = freq;
    const vol = (velocity/127)*0.28;

    // ADSR from env module — only if explicitly patched into the signal chain
    const envMod = this.registry.getModulesByType('env')[0];
    const envPatched = envMod && this.registry.patchesFrom(envMod.id).length > 0;
    const ep = envPatched ? envMod.params : { attack:0.02, decay:0.22, sustain:0.55, release:0.05 };
    const atk = sliderToAttack(ep.attack ?? 0.02);
    const dec = sliderToDecay(ep.decay ?? 0.22);
    const sus = ep.sustain ?? 0.55;
    const rel = sliderToRelease(ep.release ?? 0.2);

    // Glide only applied when a GLIDE CV module is explicitly patched to an OSC
    const globalGlide = 0;

    // Per-voice envelope
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(vol, now+atk);
    envGain.gain.linearRampToValueAtTime(vol*sus, now+atk+dec);
    const voiceDest = this._getVoiceOutputDest();
    if (voiceDest) envGain.connect(voiceDest);


    // Per-voice osc nodes
    const oscNodes = new Map();

    for (const [id, mod] of this.registry.modules) {
      const def = MODULE_TYPE_DEFS[mod.type];
      if (!def || def.category !== 'osc') continue;
      if (mod.type === 'osc-noise') continue; // handled globally

      const patch = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
      // Build voice even if unpatched (will have gain=0), to enable live patching

      // CV dispatch — accumulate all cv-* input contributions
      let semiOffset = 0, detuneAccum = 0, glide = globalGlide, gainScale = 1.0;
      const vibratoSources = [];
      for (const cvp of this.registry.patchesTo(id).filter(p => p.signalType === 'cv')) {
        const src = this.registry.modules.get(cvp.fromId);
        if (!src) continue;
        switch (src.type) {
          case 'pitch':
          case 'chord':   semiOffset += this._cvSemiOffset(cvp.fromId, cvp.fromPort); break;
          case 'unison': { const pi = parseInt(cvp.fromPort.replace('cv-','')) || 0; detuneAccum += (pi - 1) * (src.params.spread??0.5) * 20; break; }
          case 'vibrato': vibratoSources.push(cvp.fromId); break;
          case 'glide':   glide = (src.params.time ?? 0) * 2; break;
          case 'velocity':{ const s=src.params.sens??0.7; gainScale *= 1.0-s+s*(velocity/127); break; }
        }
      }

      const octMul = Math.pow(2, mod.params.octave ?? 0);
      const targetFreq = freq * octMul * (semiOffset !== 0 ? Math.pow(2, semiOffset/12) : 1);
      const wf = mod.params.waveform || def.waveform || 'sine';

      const osc = ctx.createOscillator();
      if (wf === 'sine')     { osc.type = 'sine'; }
      else if (wf === 'sawtooth') { osc.type = 'sawtooth'; }
      else if (wf === 'triangle') { if (this.triWave) osc.setPeriodicWave(this.triWave); else osc.type='triangle'; }
      else if (wf === 'square')   { if (this.sqWave)  osc.setPeriodicWave(this.sqWave);  else osc.type='square'; }
      else if (wf === 'sub')  { osc.type='square'; osc.detune.value=(mod.params.subTune??0)*100; }
      else osc.type = 'sine';

      if (glide > 0 && prevFreq !== null) {
        const startF = targetFreq*(prevFreq/freq);
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.linearRampToValueAtTime(targetFreq, now+glide);
      } else { osc.frequency.value = targetFreq; }
      osc.detune.value += detuneAccum;
      for (const vId of vibratoSources) { const vn = this.vibratoNodes.get(vId); if (vn) vn.depthGain.connect(osc.detune); }

      const gainNode = ctx.createGain();
      gainNode.gain.value = patch ? this._oscEffectiveGain(id) * gainScale : 0;

      // Waveshaping
      const foldAmt  = (wf==='sine')     ? (mod.params.fold ??0) : 0;
      const driveAmt = (wf==='sawtooth') ? (mod.params.drive??0) : 0;
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

      // All osc gains always flow through envGain (explicit routing is on envGain's output)
      gainNode.connect(envGain);

      osc.start(now);
    }

    // Pad (if fx module present)
    let padGain = null, padOsc = null;
    const fxMod = this.registry.getModulesByType('fx')[0];
    if (fxMod && (fxMod.params.pad??0) > 0) {
      padOsc = ctx.createOscillator(); padOsc.type='sine'; padOsc.frequency.value=freq;
      padGain = ctx.createGain();
      padGain.gain.setValueAtTime(0, now);
      padGain.gain.linearRampToValueAtTime(vol*(fxMod.params.pad??0)*0.6, now+0.5);
      const fxFn = this.fxNodes.get(fxMod.id);
      padOsc.connect(padGain); padGain.connect(fxFn?.inputGain ?? this.dryBus);
      padOsc.start(now);
    }

    // Open noise gate
    if (this.noiseGate) this.noiseGate.gain.setTargetAtTime(1, now, 0.008);

    this.voices.set(midi, { oscNodes, envGain, padGain, padOsc, rel });
  }

  stopNote(midi) {
    const v = this.voices.get(midi);
    if (!v || !this.ctx) return;
    const now = this.ctx.currentTime;
    [v.envGain, v.padGain].forEach(g => {
      if (!g) return;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now+v.rel);
    });
    const delay = (v.rel+0.15)*1000;
    setTimeout(() => {
      for (const [, vn] of v.oscNodes) { try { vn.osc.stop(); vn.shaper?.disconnect(); } catch(e){} }
      try { v.padOsc?.stop(); } catch(e) {}
    }, delay);
    this.voices.delete(midi);
    if (this.noiseGate && this.voices.size === 0)
      this.noiseGate.gain.setTargetAtTime(0, now, 0.06);
  }

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
shfsfhsfhsfhsfh