// ╔══════════════════════════════════════════════════════════════╗
// ║  synth-ui.js                                                 ║
// ║  Contains: S8 UI renderer, S9 patch system, S10 shop system  ║
// ╚══════════════════════════════════════════════════════════════╝

// ─────────────────────────────────────────────────────────────
// SECTION 8 — UI RENDERER
// ─────────────────────────────────────────────────────────────

// Find the closest clear screen position within an optional preferred X zone.
// xZone: { min, max } in px — searches that band first, falls back to full width.
function findClearSpot(panelW, panelH, xZone) {
  const margin = 12, pad = 10;
  const W = window.innerWidth, H = window.innerHeight;
  const topBound = 60, botBound = H - 240;
  const occupied = [...document.querySelectorAll('#panels-container .panel-box')]
    .map(p => p.getBoundingClientRect()).filter(r => r.width > 0);

  const search = (lft, rgt) => {
    if (lft + panelW > rgt) return null;
    const cx = (lft + rgt) / 2, cy = (topBound + botBound - panelH) / 2;
    const candidates = [];
    for (let x = lft; x <= rgt; x += 24)
      for (let y = topBound; y <= botBound - panelH; y += 24)
        candidates.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    candidates.sort((a, b) => a.d - b.d);
    for (const { x, y } of candidates)
      if (!occupied.some(r => x < r.right+pad && x+panelW > r.left-pad && y < r.bottom+pad && y+panelH > r.top-pad))
        return { left: x, top: y };
    return null;
  };

  if (xZone) {
    const pos = search(Math.max(margin, Math.round(xZone.min)), Math.min(W - panelW - margin, Math.round(xZone.max) - panelW));
    if (pos) return pos;
  }
  return search(margin, W - panelW - margin)
      ?? { left: Math.max(margin, Math.round((W - panelW) / 2)), top: Math.max(60, Math.round((H - panelH) / 2)) };
}

class UIRenderer {
  constructor(registry) {
    this.registry   = registry;
    this.container  = document.getElementById('panels-container');
    this.panelMap   = new Map(); // moduleId → DOM element
    this.jackLighting = true;
    this.positions  = {};        // loaded from localStorage
    this.panelTopZ  = 5;

    registry.addEventListener('module-added',   e => this._onModuleAdded(e.detail));
    registry.addEventListener('module-removed',  e => this._onModuleRemoved(e.detail));
    registry.addEventListener('param-changed',   e => this._onParamChanged(e.detail));
    registry.addEventListener('patch-changed',   e => this._onPatchChanged());
  }

  _onModuleAdded({ id, type, params }) {
    if (this.panelMap.has(id)) return;
    const panel = this._createPanel(id, type, params);
    if (!panel) return;
    this.container.appendChild(panel);
    this.panelMap.set(id, panel);
    this._injectRivets(panel);
    this._initDrag(panel);
    this._positionPanel(id, type, panel);
    this._renderModulePorts(id, panel);
    requestAnimationFrame(() => panel.classList.add('unlocked'));
  }

  _onModuleRemoved({ id }) {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    panel.classList.remove('unlocked');
    setTimeout(() => { panel.remove(); }, 600);
    this.panelMap.delete(id);
  }

  _onParamChanged({ id, param, value }) {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const def = MODULE_TYPE_DEFS[mod.type];

    // Update knob value display
    const valEl = panel.querySelector(`[data-val="${param}"]`);
    if (valEl) {
      const fmt = def?.paramDefs?.[param]?.format;
      valEl.textContent = fmt ? fmt(value) : Math.round(value*100)+'%';
    }
    // Redraw knob — use paramDef bounds if available, else 0–1 fallback (e.g. mixer level-in-* params)
    const knobEl = panel.querySelector(`[data-param="${param}"]`);
    if (knobEl) {
      const pdef = def?.paramDefs?.[param] ?? { min:0, max:1 };
      const v01 = (value - pdef.min) / (pdef.max - pdef.min);
      if (knobEl.classList.contains('fader-canvas')) drawFader(knobEl, v01, false);
      else drawKnob(knobEl, v01, false);
    }
    // Wave preview update for osc types
    if (param === 'fold')  this._updateWavePreview(panel, id, mod.type);
    if (param === 'drive') this._updateWavePreview(panel, id, mod.type);
    if (param === 'slope') this._updateWavePreview(panel, id, mod.type);
    if (param === 'width') this._updateWavePreview(panel, id, mod.type);
    if (param === 'waveform' || param === 'waveParam') this._updateWavePreview(panel, id, mod.type);
    // Filter type toggle
    if (mod.type === 'filter' && param === 'filterType') {
      panel.querySelectorAll('.filter-type-btn').forEach(b => b.classList.toggle('active', b.dataset.ft === value));
    }
    // Seq cell updates
    if (mod.type === 'seq-cv' && param === 'bars') {
      this._rebuildSeqCvGrid(id, panel);
      return;
    }
    if ((mod.type === 'seq-cv' || mod.type === 'seq-drum') && param === 'rate') {
      panel.querySelectorAll('.seq-rate-btn').forEach(b => b.classList.toggle('active', b.dataset.rate === value));
      return;
    }
    if (mod.type === 'seq-cv' && param.startsWith('step-')) {
      this._refreshSeqCvGrid(id, panel);
    }
    if (mod.type === 'seq-drum' && param.startsWith('step-')) {
      const parts = param.split('-'); // 'step-R-C'
      const row = parseInt(parts[1]), col = parseInt(parts[2]);
      const cell = panel.querySelector(`.drum-cell[data-seq="${id}"][data-row="${row}"][data-step="${col}"]`);
      if (cell) cell.classList.toggle('active', !!value);
    }
    // Transport play button
    if (mod.type === 'transport' && param === 'playing') {
      const btn = panel.querySelector('.transport-play-btn');
      if (btn) { btn.textContent = value ? '■ STOP' : '▶ PLAY'; btn.classList.toggle('playing', !!value); }
    }
  }

  _onPatchChanged() {
    for (const [id] of this.registry.modules) {
      const panel = this.panelMap.get(id);
      if (panel) this._renderModulePorts(id, panel);
    }
    // Update static audio-out jack plugged state
    const aoJack = document.getElementById('audio-out-jack');
    if (aoJack) aoJack.classList.toggle('plugged', this.registry.patchesTo('audio-out-0').length > 0);
  }

  _createPanel(id, type, params) {
    const def = MODULE_TYPE_DEFS[type];
    if (!def) return null;

    if (def.category === 'osc') return this._createOscPanel(id, type, params, def);
    if (type === 'filter')       return this._createFilterPanel(id, params);
    if (type === 'env')          return this._createEnvPanel(id, params);
    if (type === 'fx')           return this._createFxPanel(id, params);
    if (type === 'delay')        return this._createDelayPanel(id, params);
    if (type === 'lfo')          return this._createLfoPanel(id, params);
    if (type === 'glide')        return this._createGlidePanel(id, params);
    if (type === 'pitch')        return this._createPitchPanel(id, params);
    if (type === 'vibrato')      return this._createVibratoPanel(id, params);
    if (type === 'unison')       return this._createUnisonPanel(id, params);
    if (type === 'chord')        return this._createChordPanel(id, params);
    if (type === 'velocity')     return this._createVelocityPanel(id, params);
    if (type === 'mixer')        return this._createMixerPanel(id, params);
    if (type === 'transport')    return null; // transport is now a fixed clock panel in the HTML
    if (type === 'seq-cv')       return this._createSeqCvPanel(id, params);
    if (type === 'seq-drum')     return this._createSeqDrumPanel(id, params);
    if (type === 'drum-hat')     return this._createDrumHatPanel(id, params);
    if (type === 'drum-kick')    return this._createDrumKickPanel(id, params);
    if (type === 'drum-snare')   return this._createDrumSnarePanel(id, params);
    if (type === 'sidechain')    return this._createSidechainPanel(id, params);
    if (type === 'midi-in')      return this._createMidiInPanel(id, params);
    if (type === 'midi-all')     return this._createMidiAllPanel(id, params);
    return null;
  }

  // ── OSC Panel ────────────────────────────────────────────────
  _createOscPanel(id, type, params, def) {
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-osc';
    panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);

    const wf = type === 'osc' ? (params.waveform || 'sine') : def.waveform;
    const specialLabel = { 'osc-sine':'FOLD', 'osc-saw':'DRIVE', 'osc-tri':'SLOPE', 'osc-sq':'WIDTH', 'osc-sub':'TUNE', 'osc-noise':'COLOR', 'osc':'PARAM' }[type] || '';
    const specialParam = { 'osc-sine':'fold', 'osc-saw':'drive', 'osc-tri':'slope', 'osc-sq':'width', 'osc-sub':'subTune', 'osc-noise':'color', 'osc':'waveParam' }[type] || '';
    const levelParam   = type === 'osc-noise' ? 'level' : 'level';
    const levelVal     = params[levelParam] ?? 0.8;

    const hasOct = type !== 'osc-noise';
    const octDef = params.octave ?? (type === 'osc-sub' ? -1 : 0);

    panel.innerHTML = `
      <span class="panel-title">${def.label}</span>
      ${type === 'osc' ? `<div class="wave-select"><select data-module="${id}" data-param="waveform">
        <option value="sine"${params.waveform==='sine'?' selected':''}>SINE</option>
        <option value="sawtooth"${params.waveform==='sawtooth'?' selected':''}>SAW</option>
        <option value="triangle"${params.waveform==='triangle'?' selected':''}>TRI</option>
        <option value="square"${params.waveform==='square'?' selected':''}>SQ</option>
      </select></div>` : ''}
      <canvas class="wave-preview" id="wave-prev-${id}" width="90" height="32"></canvas>
      <div class="osc-body">
        <canvas class="knob-canvas" id="knob-${id}-level" data-module="${id}" data-param="level" width="44" height="44" style="margin-bottom:3px"></canvas>
        <span class="val" data-val="level">${Math.round(levelVal*100)}%</span>
      </div>
      ${hasOct ? `<div class="oct-switch" data-module="${id}">
        <button class="oct-btn${octDef===-1?' oct-active':''}" data-oct="-1">-1</button>
        <button class="oct-btn${octDef===0?' oct-active':''}" data-oct="0">0</button>
        <button class="oct-btn${octDef===1?' oct-active':''}" data-oct="1">+1</button>
      </div>` : ''}
      ${specialParam ? `<div class="osc-special">
        <label>${specialLabel}</label>
        <div class="osc-body">
          <canvas class="knob-canvas" id="knob-${id}-${specialParam}" data-module="${id}" data-param="${specialParam}" width="34" height="34" style="margin-bottom:2px"></canvas>
          <span class="val" data-val="${specialParam}">${def.paramDefs[specialParam]?.format(params[specialParam]??0)??'0%'}</span>
        </div>
      </div>` : ''}
    `;

    // Oct buttons
    panel.querySelectorAll('.oct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.oct-btn').forEach(b => b.classList.remove('oct-active'));
        btn.classList.add('oct-active');
        registry.setParam(id, 'octave', parseInt(btn.dataset.oct));
      });
    });

    // Waveform select (generic osc)
    const wfSel = panel.querySelector(`[data-param="waveform"]`);
    if (wfSel) {
      wfSel.addEventListener('change', e => {
        registry.setParam(id, 'waveform', e.target.value);
        this._updateWavePreview(panel, id, type);
      });
    }

    this._initKnobs(panel, id);
    requestAnimationFrame(() => {
      this._updateWavePreview(panel, id, type);
      this._redrawAllKnobs(panel, id, params, def);
    });
    return panel;
  }

  _createFilterPanel(id, params) {
    const def = MODULE_TYPE_DEFS['filter'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const ft = params.filterType ?? 'lp';
    panel.innerHTML = `
      <span class="panel-title">VCF</span>
      <div class="filter-type-row" style="display:flex;gap:4px;margin-bottom:5px;">
        <button class="filter-type-btn${ft==='lp'?' active':''}" data-ft="lp" data-module="${id}">LP</button>
        <button class="filter-type-btn${ft==='hp'?' active':''}" data-ft="hp" data-module="${id}">HP</button>
        <button class="filter-type-btn${ft==='bp'?' active':''}" data-ft="bp" data-module="${id}">BP</button>
      </div>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>CUTOFF</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="cutoff" width="38" height="38"></canvas>
          <span class="val" data-val="cutoff">${def.paramDefs.cutoff.format(params.cutoff??1)}</span>
        </div>
        <div class="synth-control">
          <label>RES</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="resonance" width="38" height="38"></canvas>
          <span class="val" data-val="resonance">${def.paramDefs.resonance.format(params.resonance??0.05)}</span>
        </div>
      </div>
    `;
    panel.querySelectorAll('.filter-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.filter-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        registry.setParam(id, 'filterType', btn.dataset.ft);
      });
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createEnvPanel(id, params) {
    const def = MODULE_TYPE_DEFS['env'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">ENV</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>ATK</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="attack" width="30" height="30"></canvas>
          <span class="val" data-val="attack">${def.paramDefs.attack.format(params.attack??0.02)}</span>
        </div>
        <div class="synth-control">
          <label>DEC</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="decay" width="30" height="30"></canvas>
          <span class="val" data-val="decay">${def.paramDefs.decay.format(params.decay??0.22)}</span>
        </div>
        <div class="synth-control">
          <label>SUS</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="sustain" width="30" height="30"></canvas>
          <span class="val" data-val="sustain">${def.paramDefs.sustain.format(params.sustain??0.55)}</span>
        </div>
        <div class="synth-control">
          <label>REL</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="release" width="30" height="30"></canvas>
          <span class="val" data-val="release">${def.paramDefs.release.format(params.release??0.2)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createFxPanel(id, params) {
    const def = MODULE_TYPE_DEFS['fx'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">SPACE</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>REV</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="wet" width="34" height="34"></canvas>
          <span class="val" data-val="wet">${def.paramDefs.wet.format(params.wet??params.reverb??0.4)}</span>
        </div>
        <div class="synth-control">
          <label>DRY</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="dry" width="34" height="34"></canvas>
          <span class="val" data-val="dry">${def.paramDefs.dry.format(params.dry??1.0)}</span>
        </div>
        <div class="synth-control">
          <label>PAD</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="pad" width="34" height="34"></canvas>
          <span class="val" data-val="pad">${def.paramDefs.pad.format(params.pad??0.42)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createDelayPanel(id, params) {
    const def = MODULE_TYPE_DEFS['delay'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">DELAY</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>TIME</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="time" width="30" height="30"></canvas>
          <span class="val" data-val="time">${def.paramDefs.time.format(params.time??0.3)}</span>
        </div>
        <div class="synth-control">
          <label>FDBK</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="feedback" width="30" height="30"></canvas>
          <span class="val" data-val="feedback">${def.paramDefs.feedback.format(params.feedback??0.3)}</span>
        </div>
        <div class="synth-control">
          <label>MIX</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="mix" width="30" height="30"></canvas>
          <span class="val" data-val="mix">${def.paramDefs.mix.format(params.mix??0.5)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createLfoPanel(id, params) {
    const def = MODULE_TYPE_DEFS['lfo'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">LFO</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>RATE</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="rate" width="34" height="34"></canvas>
          <span class="val" data-val="rate">${def.paramDefs.rate.format(params.rate??0.1)}</span>
        </div>
        <div class="synth-control">
          <label>DEPTH</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="depth" width="34" height="34"></canvas>
          <span class="val" data-val="depth">${def.paramDefs.depth.format(params.depth??0.5)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createGlidePanel(id, params) {
    const def = MODULE_TYPE_DEFS['glide'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">GLIDE</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>TIME</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="time" width="34" height="34"></canvas>
          <span class="val" data-val="time">${def.paramDefs.time.format(params.time??0.1)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createVibratoPanel(id, params) {
    const def = MODULE_TYPE_DEFS['vibrato'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">VIBRATO</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>RATE</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="rate" width="34" height="34"></canvas>
          <span class="val" data-val="rate">${def.paramDefs.rate.format(params.rate??0.2)}</span>
        </div>
        <div class="synth-control">
          <label>DEPTH</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="depth" width="34" height="34"></canvas>
          <span class="val" data-val="depth">${def.paramDefs.depth.format(params.depth??0.3)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createUnisonPanel(id, params) {
    const def = MODULE_TYPE_DEFS['unison'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">UNISON</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>SPRD</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="spread" width="34" height="34"></canvas>
          <span class="val" data-val="spread">${def.paramDefs.spread.format(params.spread??0.5)}</span>
        </div>
      </div>
      <ul class="cv-outputs">
        ${def.cvOutputs.map(o=>`<li class="cv-out-row"><span class="cv-out-label">${o.label}</span><div class="port-jack port-out port-cv" data-module="${id}" data-port="${o.port}"></div></li>`).join('')}
      </ul>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createChordPanel(id, params) {
    const def = MODULE_TYPE_DEFS['chord'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const q = params.quality ?? 'maj';
    panel.innerHTML = `
      <span class="panel-title">CHORD</span>
      <div class="chord-quality">
        <button class="chord-btn${q==='maj'?' active':''}" data-q="maj">MAJ</button>
        <button class="chord-btn${q==='min'?' active':''}" data-q="min">MIN</button>
      </div>
      <ul class="cv-outputs">
        ${def.cvOutputs.map(o=>`<li class="cv-out-row"><span class="cv-out-label">${o.label}</span><div class="port-jack port-out port-cv" data-module="${id}" data-port="${o.port}"></div></li>`).join('')}
      </ul>
    `;
    panel.querySelectorAll('.chord-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.chord-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        registry.setParam(id, 'quality', btn.dataset.q);
      });
    });
    return panel;
  }

  _createVelocityPanel(id, params) {
    const def = MODULE_TYPE_DEFS['velocity'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">VELOCITY</span>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>SENS</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="sens" width="34" height="34"></canvas>
          <span class="val" data-val="sens">${def.paramDefs.sens.format(params.sens??0.7)}</span>
        </div>
      </div>
    `;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createPitchPanel(id, params) {
    const def = MODULE_TYPE_DEFS['pitch'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-cv'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const octDef = params.octave ?? 0;
    panel.innerHTML = `
      <span class="panel-title">PITCH</span>
      <div style="display:flex;gap:6px;align-items:flex-start;">
        <div class="oct-switch-v" data-module="${id}">
          <button class="oct-btn${octDef===2?' oct-active':''}" data-oct="2">+2</button>
          <button class="oct-btn${octDef===1?' oct-active':''}" data-oct="1">+1</button>
          <button class="oct-btn${octDef===0?' oct-active':''}" data-oct="0">0</button>
          <button class="oct-btn${octDef===-1?' oct-active':''}" data-oct="-1">-1</button>
          <button class="oct-btn${octDef===-2?' oct-active':''}" data-oct="-2">-2</button>
        </div>
        <div class="synth-control" style="flex:1;">
          <canvas class="knob-canvas" data-module="${id}" data-param="semi" width="30" height="30"></canvas>
          <span class="val" data-val="semi">${def.paramDefs.semi.format(params.semi??0)}</span>
        </div>
      </div>
    `;
    panel.querySelectorAll('.oct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.oct-btn').forEach(b => b.classList.remove('oct-active'));
        btn.classList.add('oct-active');
        registry.setParam(id, 'octave', parseInt(btn.dataset.oct));
      });
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createMixerPanel(id, params) {
    const def = MODULE_TYPE_DEFS['mixer'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-mixer'; panel.id = `panel-${id}`;
    panel.style.width = 'auto'; panel.style.minWidth = '90px';
    panel.style.setProperty('--ph', def.hue);
    panel.innerHTML = `
      <span class="panel-title">MIXER</span>
      <span class="mix-edge-label mix-edge-label-top">RETURN</span>
      <div class="mix-returns-row" id="mix-returns-${id}"></div>
      <div class="mix-main-row">
        <div class="mix-snd-ctrl" id="mix-snd-ctrl-${id}"></div>
        <div class="mix-body" id="mix-body-${id}"></div>
      </div>
      <div class="mix-sends-row" id="mix-sends-${id}"></div>
      <span class="mix-edge-label mix-edge-label-bot">SEND</span>
    `;
    return panel;
  }

  _renderModulePorts(id, panel) {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const def = MODULE_TYPE_DEFS[mod.type];
    if (!def) return;
    // Sidechain jacks are rendered inline in _createSidechainPanel — just sync plugged state
    if (mod.type === 'sidechain') {
      for (const port of (def.fixedInputPorts ?? [])) {
        const j = panel.querySelector(`.port-jack.port-in[data-port="${port}"]`);
        if (j) j.classList.toggle('plugged', this.registry.patchesTo(id).some(p => p.toPort === port));
      }
      this._syncOutputJack(id, panel, def);
      return;
    }

    // ── Mixer: delegate input/send/return handling ───────────────
    if (mod.type === 'mixer') {
      this._rebuildMixerChannels(id, panel);
    } else if (def.dynamicInputs) {
      // ── Input port list (create if absent) ──────────────────────
      let list = panel.querySelector(`#ports-${id}`);
      if (!list) {
        list = document.createElement('ul');
        list.className = 'ports-in-list'; list.id = `ports-${id}`;
        panel.appendChild(list);
      }
      list.innerHTML = '';
      this.registry.patchesTo(id).forEach(p => {
        const fromMod = this.registry.modules.get(p.fromId);
        const row = document.createElement('li'); row.className = 'port-in-row';
        row.innerHTML = `<div class="port-jack port-in plugged" data-module="${id}" data-port="${p.toPort}" style="--jh:${MODULE_TYPE_DEFS[fromMod?.type]?.hue||200}"></div>`;
        list.appendChild(row);
      });
      const emptyRow = document.createElement('li'); emptyRow.className = 'port-in-row';
      emptyRow.innerHTML = `<div class="port-jack port-in port-empty" data-module="${id}" data-port="${this.registry.nextInputPort(id)}"></div>`;
      list.appendChild(emptyRow);
    }

    // ── Fixed single input jack (non-mixer processors) ─────────────
    if (def.fixedInputPort) {
      const port = def.fixedInputPort;
      let inJack = panel.querySelector(`.port-jack.port-in[data-module="${id}"][data-port="${port}"]`);
      if (!inJack) {
        inJack = document.createElement('div');
        inJack.className = 'port-jack port-in';
        inJack.dataset.module = id;
        inJack.dataset.port = port;
        panel.appendChild(inJack);
      }
      inJack.classList.toggle('plugged', this.registry.patchesTo(id).some(p => p.toPort === port));
    }

    // ── Fixed multiple input ports (sidechain: ['in-0','key']) ──────
    if (def.fixedInputPorts) {
      for (const port of def.fixedInputPorts) {
        let inJack = panel.querySelector(`.port-jack.port-in[data-module="${id}"][data-port="${port}"]`);
        if (!inJack) {
          inJack = document.createElement('div');
          inJack.className = 'port-jack port-in';
          inJack.dataset.module = id;
          inJack.dataset.port = port;
          // Label the key port visually
          if (port === 'key') inJack.title = 'KEY';
          panel.appendChild(inJack);
        }
        inJack.classList.toggle('plugged', this.registry.patchesTo(id).some(p => p.toPort === port));
      }
    }

    // ── Note output jacks (dynamic fan-out list) ────────────────────
    if (def.noteOutputPort) {
      const port = def.noteOutputPort;
      let noteOutList = panel.querySelector(`#note-out-ports-${id}`);
      if (!noteOutList) {
        noteOutList = document.createElement('ul');
        noteOutList.className = 'ports-out-list'; noteOutList.id = `note-out-ports-${id}`;
        panel.appendChild(noteOutList);
      }
      noteOutList.innerHTML = '';
      // Plugged jacks first (existing patches in order)
      this.registry.patchesFrom(id).filter(p => p.fromPort === port).forEach(() => {
        const row = document.createElement('li'); row.className = 'port-out-row';
        row.innerHTML = `<div class="port-jack port-out port-note plugged" data-module="${id}" data-port="${port}" title="NOTE OUT"></div>`;
        noteOutList.appendChild(row);
      });
      // One empty jack at end for new connections
      const emptyRow = document.createElement('li'); emptyRow.className = 'port-out-row';
      emptyRow.innerHTML = `<div class="port-jack port-out port-note" data-module="${id}" data-port="${port}" title="NOTE OUT"></div>`;
      noteOutList.appendChild(emptyRow);
    }

    // ── Note input jack ─────────────────────────────────────────────
    if (def.fixedNoteInputPort) {
      const port = def.fixedNoteInputPort;
      let noteIn = panel.querySelector(`.port-jack.port-in.port-note[data-module="${id}"][data-port="${port}"]`);
      if (!noteIn) {
        noteIn = document.createElement('div');
        noteIn.className = 'port-jack port-in port-note';
        noteIn.dataset.module = id; noteIn.dataset.port = port;
        noteIn.title = 'NOTE IN';
        panel.appendChild(noteIn);
      }
      noteIn.classList.toggle('plugged', this.registry.patchesTo(id).some(p => p.toPort === port));
    }

    // ── Output jack (create if absent, always update plugged state) ─
    if (def.outputPort) {
      let outJack = panel.querySelector(`.port-jack.port-out[data-module="${id}"][data-port="${def.outputPort}"]`);
      if (!outJack) {
        outJack = document.createElement('div');
        outJack.className = `port-jack port-out`;
        outJack.dataset.module = id;
        outJack.dataset.port = def.outputPort;
        panel.appendChild(outJack);
      }
      outJack.classList.toggle('plugged', this.registry.patchesFrom(id).some(p => p.fromPort === def.outputPort));
    }

    // ── Dynamic CV inputs — OSC panels + CV category modules ────────
    if ((def.category === 'osc' && mod.type !== 'osc-noise') || def.dynamicCvInputs) {
      let cvList = panel.querySelector(`#cv-ports-${id}`);
      if (!cvList) {
        cvList = document.createElement('ul');
        cvList.className = 'ports-in-list'; cvList.id = `cv-ports-${id}`;
        panel.appendChild(cvList);
      }
      cvList.innerHTML = '';
      this.registry.patchesTo(id).filter(p => p.signalType === 'cv').forEach(p => {
        const row = document.createElement('li'); row.className = 'port-in-row';
        row.innerHTML = `<div class="port-jack port-in port-cv plugged" data-module="${id}" data-port="${p.toPort}"></div>`;
        cvList.appendChild(row);
      });
      const emptyRow = document.createElement('li'); emptyRow.className = 'port-in-row';
      emptyRow.innerHTML = `<div class="port-jack port-in port-cv port-empty" data-module="${id}" data-port="${this.registry.nextCvInputPort(id)}"></div>`;
      cvList.appendChild(emptyRow);
    }

    // ── Dynamic CV outputs (fan-out) — single-out CV modules ────────
    if (def.dynamicCvOutputs) {
      let cvoList = panel.querySelector(`#cvo-ports-${id}`);
      if (!cvoList) {
        cvoList = document.createElement('ul');
        cvoList.className = 'ports-out-list'; cvoList.id = `cvo-ports-${id}`;
        panel.appendChild(cvoList);
      }
      cvoList.innerHTML = '';
      this.registry.patchesFrom(id).filter(p => p.fromPort.startsWith('cvo-')).forEach(p => {
        const row = document.createElement('li'); row.className = 'port-out-row';
        row.innerHTML = `<div class="port-jack port-out port-cv plugged" data-module="${id}" data-port="${p.fromPort}"></div>`;
        cvoList.appendChild(row);
      });
      const emptyOutRow = document.createElement('li'); emptyOutRow.className = 'port-out-row';
      emptyOutRow.innerHTML = `<div class="port-jack port-out port-cv" data-module="${id}" data-port="${this.registry.nextCvOutputPort(id)}"></div>`;
      cvoList.appendChild(emptyOutRow);
    }

    // ── Multiple CV outputs (CHORD, UNISON) — update plugged state on pre-built jacks ─
    if (def.cvOutputs) {
      def.cvOutputs.forEach(({ port }) => {
        const jack = panel.querySelector(`.port-jack.port-out.port-cv[data-module="${id}"][data-port="${port}"]`);
        if (jack) jack.classList.toggle('plugged', this.registry.patchesFrom(id).some(p => p.fromPort === port));
      });
    }
    this._updatePanelGlow(id);
  }

  _rebuildMixerChannels(id, panel) {
    const mod  = this.registry.modules.get(id);
    const channels = this.registry.patchesTo(id).filter(p => p.toPort.startsWith('in-'));
    const returns  = this.registry.patchesTo(id).filter(p => p.toPort.startsWith('return-'));

    // ── Returns row (top) ───────────────────────────────────────
    const returnsRow = panel.querySelector(`#mix-returns-${id}`);
    if (returnsRow) {
      returnsRow.innerHTML = '';
      returns.forEach(p => {
        const fromMod = this.registry.modules.get(p.fromId);
        const hue = MODULE_TYPE_DEFS[fromMod?.type]?.hue || 200;
        const slot = document.createElement('div'); slot.className = 'mix-port-slot';
        slot.innerHTML = `<div class="port-jack port-in plugged" data-module="${id}" data-port="${p.toPort}" style="--jh:${hue}" title="RTN"></div>`;
        returnsRow.appendChild(slot);
      });
      const nextRtn = document.createElement('div'); nextRtn.className = 'mix-port-slot';
      nextRtn.innerHTML = `<div class="port-jack port-in port-empty" data-module="${id}" data-port="${this.registry.nextReturnPort(id)}" title="RTN"></div>`;
      returnsRow.appendChild(nextRtn);
    }

    // ── Channel input jacks (left edge) ─────────────────────────
    let jackList = panel.querySelector(`#ports-${id}`);
    if (!jackList) {
      jackList = document.createElement('ul');
      jackList.className = 'ports-in-list'; jackList.id = `ports-${id}`;
      panel.appendChild(jackList);
    }
    jackList.innerHTML = '';
    channels.forEach(p => {
      const fromMod = this.registry.modules.get(p.fromId);
      const hue = MODULE_TYPE_DEFS[fromMod?.type]?.hue || 200;
      const row = document.createElement('li'); row.className = 'port-in-row';
      row.innerHTML = `<div class="port-jack port-in plugged" data-module="${id}" data-port="${p.toPort}" style="--jh:${hue}"></div>`;
      jackList.appendChild(row);
    });
    const emptyRow = document.createElement('li'); emptyRow.className = 'port-in-row';
    emptyRow.innerHTML = `<div class="port-jack port-in port-empty" data-module="${id}" data-port="${this.registry.nextInputPort(id)}"></div>`;
    jackList.appendChild(emptyRow);

    // ── Channel faders + send level knobs (middle) ──────────────
    const body = panel.querySelector(`#mix-body-${id}`);
    if (body) {
      body.innerHTML = '';
      channels.forEach(p => {
        const fromMod  = this.registry.modules.get(p.fromId);
        const label    = fromMod ? (MODULE_TYPE_DEFS[fromMod.type]?.label?.slice(0,4) || '?') : '?';
        const levelKey = `level-${p.toPort}`;
        const levelVal = mod?.params[levelKey] ?? 1;
        const cell = document.createElement('div'); cell.className = 'fader-cell';
        cell.innerHTML = `
          <canvas class="fader-canvas knob-canvas" data-module="${id}" data-param="${levelKey}" width="22" height="84"></canvas>
          <span class="mix-label">${label}</span>
          <span class="val" data-val="${levelKey}">${Math.round(levelVal*100)}%</span>
        `;
        body.appendChild(cell);
        requestAnimationFrame(() => drawFader(cell.querySelector('.fader-canvas'), levelVal, false));
        this._initKnobs(cell, id);
      });
      // Empty placeholder column
      const emptyCell = document.createElement('div'); emptyCell.className = 'fader-cell';
      emptyCell.innerHTML = `<div style="width:22px;height:84px;border-left:1px dashed rgba(255,255,255,0.12);margin:0 auto"></div>`;
      body.appendChild(emptyCell);
    }

    // ── Sends row (bottom border) — mirrors returns, grows as sends are used ──
    const sendsRow = panel.querySelector(`#mix-sends-${id}`);
    if (sendsRow) {
      sendsRow.innerHTML = '';
      const sends = this.registry.patchesFrom(id).filter(p => p.fromPort.startsWith('send-'));
      sends.forEach(p => {
        const slot = document.createElement('div'); slot.className = 'mix-port-slot';
        slot.innerHTML = `<div class="port-jack port-out plugged" data-module="${id}" data-port="${p.fromPort}" title="SND"></div>`;
        sendsRow.appendChild(slot);
      });
      const nextSlot = document.createElement('div'); nextSlot.className = 'mix-port-slot';
      nextSlot.innerHTML = `<div class="port-jack port-out port-empty" data-module="${id}" data-port="${this.registry.nextSendPort(id)}" title="SND"></div>`;
      sendsRow.appendChild(nextSlot);
    }

    // ── Send level controls (one knob per active send) ───────────
    const sndCtrl = panel.querySelector(`#mix-snd-ctrl-${id}`);
    if (sndCtrl) {
      sndCtrl.innerHTML = '';
      const sends = this.registry.patchesFrom(id).filter(p => p.fromPort.startsWith('send-'));
      sends.forEach(p => {
        const sendNum  = p.fromPort.replace('send-', '');
        const levelKey = `send-level-${sendNum}`;
        if (mod && mod.params[levelKey] === undefined) mod.params[levelKey] = 0.8;
        const levelVal = mod?.params[levelKey] ?? 0.8;
        const toMod    = this.registry.modules.get(p.toId);
        const label    = MODULE_TYPE_DEFS[toMod?.type]?.label?.slice(0, 4) || 'SND';
        const ctrl = document.createElement('div'); ctrl.className = 'send-ctrl';
        ctrl.innerHTML = `
          <canvas class="knob-canvas" data-module="${id}" data-param="${levelKey}" width="22" height="22"></canvas>
          <span class="mix-label">${label}</span>
          <span class="val" data-val="${levelKey}">${Math.round(levelVal*100)}%</span>
        `;
        sndCtrl.appendChild(ctrl);
        requestAnimationFrame(() => drawKnob(ctrl.querySelector('.knob-canvas'), levelVal, false));
        this._initKnobs(ctrl, id);
      });
    }

    // ── Resize panel width ───────────────────────────────────────
    const cols = channels.length + 1;
    panel.style.width = Math.max(90, 28 + cols * 28 + Math.max(0, cols-1) * 6) + 'px';
  }

  _initKnobs(parent, moduleId) {
    parent.querySelectorAll('.knob-canvas[data-param]').forEach(knobEl => {
      knobEl.addEventListener('mousedown', e => {
        if (midiLearnMode && knobEl.dataset.param) { armLearnParam(moduleId, knobEl.dataset.param); e.preventDefault(); return; }
        const mod = registry.modules.get(moduleId);
        if (!mod) return;
        const param = knobEl.dataset.param;
        const def   = MODULE_TYPE_DEFS[mod.type];
        const pdef  = def?.paramDefs?.[param] || { min:0, max:1 };
        const range = (pdef.max??1)-(pdef.min??0);
        knobDrag = { moduleId, param, pdef, startY: e.clientY, startVal: mod.params[param]??0 };
        e.preventDefault();
      });
    });
  }

  _redrawAllKnobs(panel, id, params, def) {
    panel.querySelectorAll('.knob-canvas[data-param]').forEach(knobEl => {
      const param = knobEl.dataset.param;
      const pdef = def?.paramDefs?.[param];
      if (!pdef) return;
      const val = params[param] ?? pdef.min ?? 0;
      const v01 = (val-(pdef.min??0))/((pdef.max??1)-(pdef.min??0));
      if (knobEl.classList.contains('fader-canvas')) drawFader(knobEl, v01, false);
      else drawKnob(knobEl, v01, false);
    });
  }

  _positionPanel(id, type, panel) {
    const saved = this.positions[id];
    if (saved) { panel.style.left = saved.left+'px'; panel.style.top = saved.top+'px'; return; }
    const w = panel.offsetWidth  || 148;
    const h = panel.offsetHeight || 180;
    const W = window.innerWidth;
    const cat = MODULE_TYPE_DEFS[type]?.category;
    // Signal flow left→right: CV(Q1) | Voice/osc(Q2) | Effects/processor(Q3) | Seq/Drum(lower half)
    const zone = cat === 'cv'                              ? { min: 0,        max: W * 0.25 }
               : cat === 'osc'                             ? { min: W * 0.25, max: W * 0.50 }
               : (cat === 'processor' || cat === 'utility')? { min: W * 0.50, max: W * 0.75 }
               : (cat === 'sequencer' || cat === 'drum')   ? { min: W * 0.20, max: W * 0.80 }
               : null; // sink/unknown — no preference
    const pos = findClearSpot(w, h, zone);
    panel.style.left = pos.left + 'px';
    panel.style.top  = pos.top  + 'px';
  }

  _initDrag(panel) {
    panel.addEventListener('mousedown', () => { panel.style.zIndex = ++this.panelTopZ; }, true);
    const handle = panel.querySelector('.panel-title');
    if (!handle) return;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      panelDrag = { panel, ox: e.clientX-r.left, oy: e.clientY-r.top, renderer: this };
      panel.classList.add('is-dragging');
      panel.style.zIndex = ++this.panelTopZ;
      e.preventDefault(); e.stopPropagation();
    });
  }

  savePosition(id, left, top) {
    this.positions[id] = { left, top };
    saveState();
  }

  _injectRivets(panel) {
    ['tl','tr','bl','br'].forEach(pos => {
      const r = document.createElement('span'); r.className=`rivet ${pos}`; panel.appendChild(r);
    });
  }

  _updateWavePreview(panel, id, type) {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const c = panel.querySelector(`#wave-prev-${id}`);
    if (!c) return;
    const wf = type === 'osc' ? (mod.params.waveform || 'sine') : MODULE_TYPE_DEFS[type]?.waveform;
    const p1 = mod.params.fold ?? mod.params.drive ?? mod.params.slope ?? mod.params.width ?? mod.params.waveParam ?? 0;
    drawWavePreview(c, wf, p1);
  }

  pulsePanels(h) {
    for (const [, panel] of this.panelMap) {
      if (!panel.classList.contains('unlocked')) continue;
      panel.style.setProperty('--ph', h);
      panel.classList.remove('chord-hit');
      requestAnimationFrame(() => panel.classList.add('chord-hit'));
    }
  }

  getPanel(id) { return this.panelMap.get(id); }

  // Called by animate() loop via audioGraph.seqPlayheads
  setSeqPlayhead(id, step, row) {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    panel.querySelectorAll('.seq-cell.playhead, .drum-cell.playhead').forEach(c => c.classList.remove('playhead'));
    if (mod.type === 'seq-cv') {
      panel.querySelectorAll(`.seq-cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
    } else if (mod.type === 'seq-drum') {
      panel.querySelectorAll(`.drum-cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
    }
  }

  updateSeqRootKey(noteNameOrPc) {
    // Root key changed: seq-cv grids highlight root row — already done via CSS class root-row (row 12 always)
    // If we had row labels showing note names, we'd update them here.
  }

  _refreshSeqCvGrid(id, panel) {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    panel.querySelectorAll('.seq-cell').forEach(cell => {
      const step     = parseInt(cell.dataset.step);
      const row      = parseInt(cell.dataset.row);
      const activeRow = mod.params[`step-${step}-note`] ?? 12;
      const vel       = mod.params[`step-${step}-vel`]  ?? 0;
      cell.className = 'seq-cell';
      if (row === 12) cell.classList.add('root-row');
      if (activeRow === row && vel > 0) cell.classList.add(`vel-${vel}`);
    });
  }

  _injectSeqCss() {
    if (document.getElementById('seq-grid-styles')) return;
    const style = document.createElement('style');
    style.id = 'seq-grid-styles';
    style.textContent = `
      .seq-grid { display:grid; gap:1px; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.1); user-select:none; }
      .seq-cv-grid  { grid-template-columns:repeat(var(--seq-cols,16),1fr); }
      .seq-drum-grid{ grid-template-columns:repeat(16,1fr); width:256px; }
      .seq-cell  { width:15px; height:9px; background:rgba(255,255,255,0.05); cursor:pointer; border-radius:1px; box-sizing:border-box; }
      .seq-cell.vel-1 { background:hsla(var(--ph,180),65%,45%,0.55); }
      .seq-cell.vel-2 { background:hsla(var(--ph,180),80%,58%,0.88); }
      .seq-cell.vel-3 { background:hsla(var(--ph,180),90%,74%,1); }
      .seq-cell.root-row { border-top:1px solid rgba(255,255,255,0.22); }
      .seq-cell.playhead,.drum-cell.playhead { outline:1px solid rgba(255,255,255,0.85); outline-offset:-1px; }
      .drum-cell { width:15px; height:14px; background:rgba(255,255,255,0.05); cursor:pointer; border-radius:1px; box-sizing:border-box; }
      .drum-cell.active { background:hsla(var(--ph,300),70%,55%,0.88); }
      .seq-panel { width:max-content; min-width:180px; }
      .seq-grid-wrap { overflow:hidden; }
      .seq-grid-wrap.collapsed { display:none; }
      .seq-collapse-btn { background:none; border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); padding:1px 5px; cursor:pointer; border-radius:2px; font-size:9px; line-height:1.4; }
      .seq-collapse-btn:hover { color:rgba(255,255,255,0.9); border-color:rgba(255,255,255,0.35); }
      .seq-bars-btn { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.6); padding:1px 5px; cursor:pointer; border-radius:2px; font-size:9px; letter-spacing:0.04em; }
      .seq-bars-btn:hover { background:rgba(255,255,255,0.15); color:rgba(255,255,255,0.9); }
      .seq-beat-dot { width:15px; height:6px; display:flex; align-items:center; justify-content:center; }
      .seq-beat-dot.beat, .seq-beat-dot.bar { gap:2px; }
      .seq-beat-dot.beat::after { content:''; display:block; width:3px; height:3px; border-radius:50%; background:rgba(255,255,255,0.5); }
      .seq-beat-dot.bar::before { content:''; display:block; width:3px; height:3px; border-radius:50%; background:rgba(255,255,255,0.5); }
      .seq-beat-dot.bar::after  { content:''; display:block; width:3px; height:3px; border-radius:50%; background:rgba(255,255,255,0.5); }
      .seq-rate-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:2px; }
      .seq-rate-btn { background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.13); color:rgba(255,255,255,0.5); padding:2px 0; cursor:pointer; border-radius:2px; font-size:8px; letter-spacing:0.03em; text-align:center; }
      .seq-rate-btn:hover { background:rgba(255,255,255,0.14); color:rgba(255,255,255,0.85); }
      .seq-rate-btn.active { background:rgba(255,255,255,0.2); color:rgba(255,255,255,0.95); border-color:rgba(255,255,255,0.32); }
      .transport-play-btn { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.18); color:rgba(255,255,255,0.8); padding:3px 10px; cursor:pointer; border-radius:2px; font-size:10px; letter-spacing:0.05em; }
      .transport-play-btn:hover { background:rgba(255,255,255,0.18); }
      .transport-play-btn.playing { background:rgba(80,220,120,0.2); border-color:rgba(80,220,120,0.4); color:rgb(80,220,120); }
      .filter-type-btn { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.6); padding:2px 7px; cursor:pointer; border-radius:2px; font-size:9px; letter-spacing:0.06em; }
      .filter-type-btn.active { background:rgba(255,255,255,0.22); color:rgba(255,255,255,0.95); border-color:rgba(255,255,255,0.35); }
      .port-note { border-radius:0; width:12px; height:12px; background:rgba(255,200,80,0.25); border:1px solid rgba(255,200,80,0.55); }
      .port-note.plugged { background:rgba(255,200,80,0.75); }
    `;
    document.head.appendChild(style);
  }

  // ── New Panel Methods ─────────────────────────────────────────────

  _createTransportPanel(id, params) {
    this._injectSeqCss();
    const def = MODULE_TYPE_DEFS['transport'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const bpmVal = params.bpm ?? 0.545;
    panel.innerHTML = `
      <span class="panel-title">CLOCK</span>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <button class="transport-play-btn" data-module="${id}">▶ PLAY</button>
      </div>
      <div class="synth-hgroup">
        <div class="synth-control">
          <label>BPM</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="bpm" width="38" height="38"></canvas>
          <span class="val" data-val="bpm">${def.paramDefs.bpm.format(bpmVal)}</span>
        </div>
        <div class="synth-control">
          <label>DIV</label>
          <div class="rate-btns" data-module="${id}" style="display:flex;flex-direction:column;gap:2px;">
            ${[4,8,16,32].map(r=>`<button class="filter-type-btn${params.rate===r?' active':''}" data-rate="${r}" style="font-size:8px;padding:1px 4px;">${r}</button>`).join('')}
          </div>
        </div>
      </div>
    `;
    // Play button (audioGraph is the global from app.js)
    panel.querySelector('.transport-play-btn').addEventListener('click', () => {
      if (typeof audioGraph === 'undefined' || !audioGraph.transport) return;
      audioGraph.ensure();
      if (audioGraph.transport.playing) { audioGraph.transport.stop(); registry.setParam(id, 'playing', 0); }
      else { audioGraph.transport.start(); registry.setParam(id, 'playing', 1); }
    });
    // Rate buttons
    panel.querySelectorAll('[data-rate]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('[data-rate]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const idx = [4,8,16,32].indexOf(parseInt(btn.dataset.rate));
        registry.setParam(id, 'rate', idx / 3);
        if (typeof audioGraph !== 'undefined' && audioGraph.transport) audioGraph.transport.rateDivision = parseInt(btn.dataset.rate);
      });
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createSeqCvPanel(id, params) {
    this._injectSeqCss();
    const def = MODULE_TYPE_DEFS['seq-cv'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx seq-panel'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);

    const bars    = params.bars ?? 1;
    const curRate = params.rate ?? '16';
    const rates   = [['4','4TH'],['8','8TH'],['d8','D8TH'],['t8','T8TH'],['16','16TH'],['32','32ND']];

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
        <span class="panel-title" style="margin-bottom:0;flex:1;">SEQ</span>
        <button class="seq-collapse-btn" title="Show/hide grid">▶</button>
      </div>
      <div style="display:flex;align-items:flex-start;gap:6px;">
        <div class="synth-control" style="flex:0 0 auto;">
          <label>GATE</label>
          <canvas class="knob-canvas" data-module="${id}" data-param="gate" width="28" height="28"></canvas>
          <span class="val" data-val="gate">${def.paramDefs.gate.format(params.gate ?? 0.374)}</span>
        </div>
        <div style="flex:1;">
          <div style="font-size:8px;color:rgba(255,255,255,0.35);letter-spacing:0.06em;margin-bottom:2px;">RATE</div>
          <div class="seq-rate-grid">
            ${rates.map(([r,l])=>`<button class="seq-rate-btn${curRate===r?' active':''}" data-rate="${r}">${l}</button>`).join('')}
          </div>
          <button class="seq-bars-btn" style="margin-top:4px;width:100%;" title="Click to cycle bars">BARS: ${bars}</button>
        </div>
      </div>
      <div class="seq-grid-wrap collapsed" id="seq-wrap-${id}">
        <div class="seq-grid seq-cv-grid" id="seq-grid-${id}" style="--seq-cols:${16*bars};width:${16*bars*16}px;"></div>
      </div>
    `;

    this._buildSeqCvCells(id, panel, params, bars);
    this._attachSeqCvHandlers(id, panel);

    // Collapse button
    const collapseBtn = panel.querySelector('.seq-collapse-btn');
    collapseBtn.addEventListener('click', () => {
      const wrap = panel.querySelector(`#seq-wrap-${id}`);
      const isCollapsed = wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', !isCollapsed);
      collapseBtn.textContent = isCollapsed ? '▼' : '▶';
      if (isCollapsed) panel.style.zIndex = this.panelTopZ++;
    });

    // Bars button
    panel.querySelector('.seq-bars-btn').addEventListener('click', () => {
      const mod = this.registry.modules.get(id);
      if (!mod) return;
      const cur = mod.params.bars ?? 1;
      const next = cur >= 4 ? 1 : cur * 2;
      this.registry.setParam(id, 'bars', next);
    });

    // Rate buttons
    panel.querySelectorAll('.seq-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.registry.setParam(id, 'rate', btn.dataset.rate);
      });
    });

    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _buildSeqCvCells(id, panel, params, bars) {
    const totalSteps = 16 * (bars ?? 1);
    const grid = panel.querySelector(`#seq-grid-${id}`);
    if (!grid) return;
    grid.style.setProperty('--seq-cols', totalSteps);
    grid.style.width = `${totalSteps * 16}px`;
    grid.innerHTML = '';
    // Beat-marker row
    for (let col = 0; col < totalSteps; col++) {
      const isBar  = col % 16 === 0;
      const isBeat = col % 4  === 0;
      const cls = isBar ? 'seq-beat-dot bar' : (isBeat ? 'seq-beat-dot beat' : 'seq-beat-dot');
      const dot = document.createElement('div');
      dot.className = cls;
      grid.appendChild(dot);
    }
    // Note cells
    for (let row = 0; row < 25; row++) {
      for (let col = 0; col < totalSteps; col++) {
        const activeRow = params[`step-${col}-note`] ?? 12;
        const vel       = params[`step-${col}-vel`]  ?? 0;
        const velCls  = (activeRow === row && vel > 0) ? `vel-${vel}` : '';
        const rootCls = row === 12 ? 'root-row' : '';
        const cell = document.createElement('div');
        cell.className = `seq-cell ${velCls} ${rootCls}`.trim();
        cell.dataset.seq = id; cell.dataset.step = col; cell.dataset.row = row;
        grid.appendChild(cell);
      }
    }
  }

  _rebuildSeqCvGrid(id, panel) {
    const mod = this.registry.modules.get(id);
    if (!mod) return;
    const bars = mod.params.bars ?? 1;
    const btn = panel.querySelector('.seq-bars-btn');
    if (btn) btn.textContent = `BARS: ${bars}`;
    this._buildSeqCvCells(id, panel, mod.params, bars);
    this._attachSeqCvHandlers(id, panel);
    this._refreshSeqCvGrid(id, panel);
  }

  _attachSeqCvHandlers(id, panel) {
    const grid = panel.querySelector(`#seq-grid-${id}`);
    if (!grid) return;
    // Remove old listeners by cloning (simpler than tracking)
    const newGrid = grid.cloneNode(true);
    grid.parentNode.replaceChild(newGrid, grid);

    let dragState = null; // { activate: bool }

    const paintCell = cell => {
      if (!cell || !cell.classList.contains('seq-cell')) return;
      const step = parseInt(cell.dataset.step);
      const row  = parseInt(cell.dataset.row);
      const mod  = this.registry.modules.get(id);
      if (!mod) return;
      const curNote = mod.params[`step-${step}-note`] ?? 12;
      const curVel  = mod.params[`step-${step}-vel`]  ?? 0;
      if (dragState.activate) {
        if (curNote !== row || curVel === 0) {
          this.registry.setParam(id, `step-${step}-note`, row);
          this.registry.setParam(id, `step-${step}-vel`, 1);
          // _onParamChanged → _refreshSeqCvGrid handles the visual update
        }
      } else {
        if (curNote === row && curVel > 0) {
          this.registry.setParam(id, `step-${step}-vel`, 0);
        }
      }
    };

    newGrid.addEventListener('mousedown', e => {
      const cell = e.target.closest('.seq-cell');
      if (!cell) return;
      const step = parseInt(cell.dataset.step);
      const row  = parseInt(cell.dataset.row);
      const mod  = this.registry.modules.get(id);
      if (!mod) return;
      const curNote = mod.params[`step-${step}-note`] ?? 12;
      const curVel  = mod.params[`step-${step}-vel`]  ?? 0;
      // Click (no drag): cycle velocity; drag: paint/erase
      if (curNote === row && curVel > 0) {
        if (e.type === 'mousedown') {
          // Will decide on mouseup vs mousemove
          dragState = { activate: false, stepped: false, step, row, origVel: curVel };
        } else {
          dragState = { activate: false };
          paintCell(cell);
        }
      } else {
        dragState = { activate: true };
        paintCell(cell);
      }
    });

    newGrid.addEventListener('mousemove', e => {
      if (!dragState) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seq-cell');
      if (!cell || cell.dataset.seq !== id) return;
      if (dragState.stepped === false && dragState.origVel !== undefined) {
        // Started on an active cell — first move means we're erasing, not cycling
        dragState.stepped = true;
        dragState.activate = false;
      }
      paintCell(cell);
    });

    const onUp = () => {
      if (!dragState) return;
      // If mouse released without dragging: cycle velocity
      if (dragState.stepped === false && dragState.origVel !== undefined) {
        const step = dragState.step, row = dragState.row;
        const mod  = this.registry.modules.get(id);
        if (mod) {
          const curVel = mod.params[`step-${step}-vel`] ?? 0;
          this.registry.setParam(id, `step-${step}-vel`, curVel >= 3 ? 0 : curVel + 1);
          // _onParamChanged handles visual update
        }
      }
      dragState = null;
    };
    newGrid.addEventListener('mouseup', onUp);
    document.addEventListener('mouseup', onUp);
  }

  _createSeqDrumPanel(id, params) {
    this._injectSeqCss();
    const def = MODULE_TYPE_DEFS['seq-drum'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx seq-panel'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);

    const curRate = params.rate ?? '16';
    const rates   = [['4','4TH'],['8','8TH'],['d8','D8TH'],['t8','T8TH'],['16','16TH'],['32','32ND']];

    // Beat markers: 2 dots at col 0 (bar), 1 dot at cols 4,8,12 (beats)
    const beatDotsHtml = Array.from({length: 16}, (_, i) =>
      `<div class="seq-beat-dot${i === 0 ? ' bar' : (i % 4 === 0 ? ' beat' : '')}"></div>`
    ).join('');

    let gridHtml = `<div class="seq-grid seq-drum-grid" id="seq-grid-${id}">`;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 16; col++) {
        const active = params[`step-${row}-${col}`] ? 'active' : '';
        gridHtml += `<div class="drum-cell ${active}" data-seq="${id}" data-row="${row}" data-step="${col}"></div>`;
      }
    }
    gridHtml += '</div>';

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
        <span class="panel-title" style="margin-bottom:0;flex:1;">D-SEQ</span>
        <button class="seq-collapse-btn" title="Show/hide grid">▶</button>
      </div>
      <div class="seq-rate-grid" style="margin-bottom:2px;">
        ${rates.map(([r,l])=>`<button class="seq-rate-btn${curRate===r?' active':''}" data-rate="${r}">${l}</button>`).join('')}
      </div>
      <div class="seq-grid-wrap collapsed" id="seq-wrap-${id}">
        <div style="display:flex;width:256px;margin-bottom:1px;">${beatDotsHtml}</div>
        ${gridHtml}
      </div>
    `;

    // Collapse button
    const collapseBtn = panel.querySelector('.seq-collapse-btn');
    collapseBtn.addEventListener('click', () => {
      const wrap = panel.querySelector(`#seq-wrap-${id}`);
      const isCollapsed = wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', !isCollapsed);
      collapseBtn.textContent = isCollapsed ? '▼' : '▶';
      if (isCollapsed) panel.style.zIndex = this.panelTopZ++;
    });

    // Rate buttons
    panel.querySelectorAll('.seq-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.registry.setParam(id, 'rate', btn.dataset.rate);
      });
    });

    // Click and drag-paint
    let drumDragActivate = null;

    const paintDrumCell = (cell) => {
      if (!cell || !cell.classList.contains('drum-cell')) return;
      const step = parseInt(cell.dataset.step);
      const row  = parseInt(cell.dataset.row);
      const mod  = this.registry.modules.get(id);
      if (!mod) return;
      const key = `step-${row}-${step}`;
      const cur = !!mod.params[key];
      if (drumDragActivate !== cur) return;
      this.registry.setParam(id, key, drumDragActivate ? 0 : 1);
      cell.classList.toggle('active', !drumDragActivate);
    };

    const grid = panel.querySelector(`#seq-grid-${id}`);
    grid.addEventListener('mousedown', e => {
      const cell = e.target.closest('.drum-cell');
      if (!cell) return;
      const mod  = this.registry.modules.get(id);
      if (!mod) return;
      const key = `step-${cell.dataset.row}-${cell.dataset.step}`;
      drumDragActivate = !!mod.params[key];
      paintDrumCell(cell);
    });

    grid.addEventListener('mousemove', e => {
      if (drumDragActivate === null) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.drum-cell');
      if (cell && cell.dataset.seq === id) paintDrumCell(cell);
    });

    grid.addEventListener('mouseup', () => { drumDragActivate = null; });
    document.addEventListener('mouseup', () => { drumDragActivate = null; });

    return panel;
  }

  _createDrumKnobPanel(id, type) {
    const def = MODULE_TYPE_DEFS[type];
    const params = this.registry.modules.get(id)?.params ?? {};
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const knobs = Object.entries(def.paramDefs).map(([p, pd]) =>
      `<div class="synth-control"><label>${pd.label}</label>
         <canvas class="knob-canvas" data-module="${id}" data-param="${p}" width="28" height="28"></canvas>
         <span class="val" data-val="${p}">${pd.format(params[p] ?? 0)}</span>
       </div>`
    ).join('');
    // Build trigger note options
    const noteOpts = '<option value="-1">ANY</option>' +
      Array.from({length:128}, (_,i) => `<option value="${i}">${midiToName(i)}</option>`).join('');
    const trigVal = params.triggerNote ?? -1;
    panel.innerHTML = `<span class="panel-title">${def.label}</span><div class="synth-hgroup">${knobs}</div>
      <div class="drum-trig-row"><label>TRIG</label>
        <select class="drum-trig-sel" data-module="${id}">${noteOpts}</select></div>`;
    panel.querySelector('.drum-trig-sel').value = trigVal;
    panel.querySelector('.drum-trig-sel').addEventListener('change', e => {
      this.registry.setParam(id, 'triggerNote', parseInt(e.target.value));
    });
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createDrumHatPanel(id, params)   { return this._createDrumKnobPanel(id, 'drum-hat'); }
  _createDrumKickPanel(id, params)  { return this._createDrumKnobPanel(id, 'drum-kick'); }
  _createDrumSnarePanel(id, params) { return this._createDrumKnobPanel(id, 'drum-snare'); }

  _createSidechainPanel(id, params) {
    const def = MODULE_TYPE_DEFS['sidechain'];
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-fx'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', def.hue);
    const knobs = Object.entries(def.paramDefs).map(([p, pd]) =>
      `<div class="synth-control"><label>${pd.label}</label>
         <canvas class="knob-canvas" data-module="${id}" data-param="${p}" width="28" height="28"></canvas>
         <span class="val" data-val="${p}">${pd.format(params[p] ?? 0)}</span>
       </div>`
    ).join('');
    // Explicit labeled jack row: IN (audio to duck) and KEY (trigger signal)
    panel.innerHTML = `<span class="panel-title">DUCK</span>
      <div class="sc-jack-row">
        <div class="sc-jack-cell"><div class="port-jack port-in" data-module="${id}" data-port="in-0"></div><label>IN</label></div>
        <div class="sc-jack-cell"><div class="port-jack port-in" data-module="${id}" data-port="key"></div><label>KEY</label></div>
      </div>
      <div class="synth-hgroup">${knobs}</div>`;
    this._initKnobs(panel, id);
    requestAnimationFrame(() => this._redrawAllKnobs(panel, id, params, def));
    return panel;
  }

  _createMidiInPanel(id, params) {
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-generator panel-midi'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', 55);
    const name = (params.deviceName || 'MIDI IN').replace(/</g,'&lt;');
    panel.innerHTML = `<span class="panel-title">${name}</span><div class="midi-panel-sym">\u2669</div>`;
    return panel;
  }

  _createMidiAllPanel(id, params) {
    const panel = document.createElement('div');
    panel.className = 'panel-box panel-generator panel-midi'; panel.id = `panel-${id}`;
    panel.style.setProperty('--ph', 55);
    panel.innerHTML = `<span class="panel-title">ALL MIDI\n+ QWERTY</span><div class="midi-panel-sym">\u266C</div>`;
    return panel;
  }

  _updatePanelGlow(id) {
    if (!this.jackLighting) { this._clearPanelGlow(id); return; }
    const panel = this.panelMap.get(id);
    if (!panel) return;
    // Only glow for audio/cv inputs (not note-in)
    const patchesIn = this.registry.patchesTo(id).filter(p => p.signalType !== 'note');
    if (patchesIn.length === 0) { this._clearPanelGlow(id); return; }
    const hue = MODULE_TYPE_DEFS[this.registry.modules.get(patchesIn[0].fromId)?.type]?.hue ?? 200;
    panel.dataset.glowH = hue;
    this._applyPanelGlow(panel, hue, 0.16);
  }

  _applyPanelGlow(panel, hue, alpha) {
    panel.style.boxShadow = `0 4px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 26px 2px hsla(${hue},78%,62%,${alpha})`;
  }

  _clearPanelGlow(id) {
    const panel = this.panelMap.get(id);
    if (!panel) return;
    panel.style.boxShadow = '';
    delete panel.dataset.glowH;
  }

  beatPulse() {
    if (!this.jackLighting) return;
    for (const [id, panel] of this.panelMap) {
      const h = panel?.dataset?.glowH;
      if (!h) continue;
      this._applyPanelGlow(panel, h, 0.42);
      setTimeout(() => this._applyPanelGlow(panel, h, 0.16), 350);
    }
  }

  setJackLighting(on) {
    this.jackLighting = on;
    if (!on) {
      for (const [id, panel] of this.panelMap) {
        if (panel) { panel.style.boxShadow = ''; delete panel.dataset.glowH; }
      }
    } else {
      for (const [id] of this.panelMap) this._updatePanelGlow(id);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 9 — PATCH SYSTEM
// ─────────────────────────────────────────────────────────────
class PatchSystem {
  constructor(registry) {
    this.registry    = registry;
    this.patchCursor = null; // { fromId, fromPort, fromJack: {x,y,h} }
    this.cablePhysics = new Map();
  }

  // Called each frame — reads jack positions from DOM and draws cables
  draw(ctx2d) {
    const jacks = this._gatherJacks();
    this._drawAllCables(ctx2d, jacks);
    if (this.patchCursor) this._drawCompatibleJackHighlights(ctx2d, jacks);
    this._drawCursor(ctx2d);
    jacks.forEach(j => j.isCV ? drawCvJack(ctx2d, j.x, j.y, j.plugged, j.alpha) : j.isNote ? drawNoteJack(ctx2d, j.x, j.y, j.plugged, j.alpha) : drawJack(ctx2d, j.x, j.y, j.h, j.plugged, j.alpha));
  }

  _drawCompatibleJackHighlights(ctx2d, jacks) {
    const { signalType, fromId, fromPort, fromJack } = this.patchCursor;
    const t = performance.now();
    const pulse = 0.55 + Math.sin(t / 160) * 0.3;
    ctx2d.save();
    // Highlight source jack with a solid-fill circle (all types)
    ctx2d.beginPath();
    ctx2d.arc(fromJack.x, fromJack.y, 9, 0, Math.PI * 2);
    const srcCol = signalType === 'cv' ? `rgba(255,185,55,${pulse * 0.7})` : signalType === 'note' ? `rgba(255,210,80,${pulse * 0.6})` : `hsla(${fromJack.h},80%,65%,${pulse * 0.6})`;
    ctx2d.strokeStyle = srcCol;
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();
    // Highlight compatible destination input jacks with yellow boxes
    for (const j of jacks) {
      if (j.isOut) continue;
      const jSig = j.isNote ? 'note' : j.isCV ? 'cv' : 'audio';
      if (jSig !== signalType) continue;
      if (j.modId === fromId) continue;
      ctx2d.beginPath();
      ctx2d.rect(j.x - 11, j.y - 11, 22, 22);
      ctx2d.strokeStyle = `rgba(255,235,40,${pulse})`;
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  _gatherJacks() {
    const jacks = [];
    document.querySelectorAll('.port-jack[data-module]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const modId  = el.dataset.module;
      const port   = el.dataset.port;
      const isOut  = el.classList.contains('port-out');
      const isEmpty = el.classList.contains('port-empty');
      const mod    = registry.modules.get(modId);
      const h      = parseInt(el.style.getPropertyValue('--jh')) || MODULE_TYPE_DEFS[mod?.type]?.hue || 200;
      const plugged = isOut
        ? registry.patchesFrom(modId).some(p => p.fromPort === port)
        : !isEmpty && registry.patchesTo(modId).some(p => p.toPort === port);
      const isCV   = el.classList.contains('port-cv');
      const isNote = el.classList.contains('port-note');
      jacks.push({ x:cx, y:cy, h, plugged, alpha: isEmpty ? 0.45 : 0.88, id:`${isOut?'out':'in'}-${modId}-${port}`, modId, port, isOut, isEmpty, isCV, isNote });
    });
    return jacks;
  }

  _drawAllCables(ctx2d, jacks) {
    const jackMap = new Map(jacks.map(j => [j.id, j]));
    for (const p of registry.patches) {
      const fromJ = jackMap.get(`out-${p.fromId}-${p.fromPort}`);
      const toJ   = jackMap.get(`in-${p.toId}-${p.toPort}`);
      if (!fromJ || !toJ) continue;
      const key = `${p.fromId}-${p.fromPort}-${p.toId}-${p.toPort}`;
      const mid = { x:(fromJ.x+toJ.x)/2, y:(fromJ.y+toJ.y)/2 };
      const phys = this._getPhys(key, mid.x, mid.y);
      if (p.signalType === 'note') {
        drawNoteCable(ctx2d, fromJ.x, fromJ.y, toJ.x, toJ.y, phys.px, phys.py);
      } else if (p.signalType === 'cv') {
        drawCvCable(ctx2d, fromJ.x, fromJ.y, toJ.x, toJ.y, phys.px, phys.py);
      } else {
        const fromMod = registry.modules.get(p.fromId);
        const h = MODULE_TYPE_DEFS[fromMod?.type]?.hue || 200;
        drawCable(ctx2d, fromJ.x, fromJ.y, toJ.x, toJ.y, h, 0.72, phys.px, phys.py);
      }
    }
  }

  _drawCursor(ctx2d) {
    if (!this.patchCursor) return;
    const { fromJack, signalType } = this.patchCursor;
    if (signalType === 'note') {
      drawNoteCable(ctx2d, fromJack.x, fromJack.y, mouseX, mouseY, 0, 0);
    } else if (signalType === 'cv') {
      drawCvCable(ctx2d, fromJack.x, fromJack.y, mouseX, mouseY, 0, 0);
    } else {
      drawCable(ctx2d, fromJack.x, fromJack.y, mouseX, mouseY, fromJack.h, 0.55, 0, 0);
    }
  }

  _getPhys(key, midX, midY) {
    if (!this.cablePhysics.has(key)) this.cablePhysics.set(key, { px:0, py:0 });
    const phys = this.cablePhysics.get(key);
    const INFL=140, MAX_PUSH=44;
    const dx=mouseX-midX, dy=mouseY-midY, d=Math.hypot(dx,dy);
    let tx=0, ty=0;
    if (d < INFL && d > 0) { const s=(1-d/INFL)*MAX_PUSH; tx=dx/d*s; ty=dy/d*s; }
    phys.px += (tx-phys.px)*0.15;
    phys.py += (ty-phys.py)*0.15;
    return phys;
  }

  hitTestJack(cx, cy) {
    return this._gatherJacks().some(j => Math.hypot(j.x - cx, j.y - cy) < 18);
  }

  handleClick(cx, cy) {
    const jacks = this._gatherJacks();
    let hit = null, hitDist = 18;
    for (const j of jacks) {
      const d = Math.hypot(j.x-cx, j.y-cy);
      if (d < hitDist) { hit=j; hitDist=d; }
    }

    if (!hit) { this.patchCursor = null; return; }

    if (!this.patchCursor) {
      // Start patch from output jack, or lift cable from input jack
      if (hit.isOut) {
        // Note outputs fan-out: don't lift existing cable, just start a new one
        // Audio/CV outputs: lift existing cable (re-routing replaces)
        if (!hit.isNote) {
          const curOut = registry.patches.find(p => p.fromId === hit.modId && p.fromPort === hit.port);
          if (curOut) registry.removePatch(curOut.fromId, curOut.fromPort, curOut.toId, curOut.toPort);
        }
        // Start cursor
        const sigType = hit.isNote ? 'note' : hit.isCV ? 'cv' : 'audio';
        this.patchCursor = { fromId: hit.modId, fromPort: hit.port, fromJack: hit, signalType: sigType };
      } else if (!hit.isEmpty && hit.plugged) {
        // Lift cable from input — find what was connected and put it on cursor
        const existingPatch = registry.patches.find(p => p.toId === hit.modId && p.toPort === hit.port);
        if (existingPatch) {
          registry.removePatch(existingPatch.fromId, existingPatch.fromPort, existingPatch.toId, existingPatch.toPort);
          const fromJackEl = document.querySelector(`.port-jack.port-out[data-module="${existingPatch.fromId}"][data-port="${existingPatch.fromPort}"]`);
          const r = fromJackEl?.getBoundingClientRect();
          if (r) {
            const fromMod = registry.modules.get(existingPatch.fromId);
            const h = MODULE_TYPE_DEFS[fromMod?.type]?.hue || 200;
            const sigType = existingPatch.signalType ?? 'audio';
            this.patchCursor = { fromId: existingPatch.fromId, fromPort: existingPatch.fromPort, fromJack: { x:r.left+r.width/2, y:r.top+r.height/2, h, isCV: sigType==='cv', isNote: sigType==='note' }, signalType: sigType };
          }
        }
      } else if (hit.isEmpty) {
        // Click empty input — do nothing (wait for output click)
      }
    } else {
      // Complete the patch
      if (!hit.isOut) {
        // Validate signal type compatibility
        const toSigType = hit.isNote ? 'note' : hit.isCV ? 'cv' : 'audio';
        if (this.patchCursor.signalType !== toSigType) { this.patchCursor = null; return; }
        // Connecting to an input (or empty slot)
        const toId   = hit.modId;
        let toPort;
        if (hit.isEmpty) {
          if (hit.port.startsWith('return-'))   toPort = registry.nextReturnPort(toId);
          else if (hit.port.startsWith('cv-'))  toPort = registry.nextCvInputPort(toId);
          else                                  toPort = registry.nextInputPort(toId);
        } else {
          toPort = hit.port;
        }
        // For mixer: auto-init channel level param
        if (registry.modules.get(toId)?.type === 'mixer' && toPort.startsWith('in-')) {
          const mp = registry.modules.get(toId).params;
          if (!mp[`level-${toPort}`]) mp[`level-${toPort}`] = 1;
        }
        registry.addPatch(this.patchCursor.fromId, this.patchCursor.fromPort, toId, toPort);
        this.patchCursor = null;
      } else {
        // Clicked another output — switch source
        const sigType2 = hit.isNote ? 'note' : hit.isCV ? 'cv' : 'audio';
        if (!hit.isNote) {
          const curOut2 = registry.patches.find(p => p.fromId === hit.modId && p.fromPort === hit.port);
          if (curOut2) registry.removePatch(curOut2.fromId, curOut2.fromPort, curOut2.toId, curOut2.toPort);
        }
        this.patchCursor = { fromId: hit.modId, fromPort: hit.port, fromJack: hit, signalType: sigType2 };
      }
    }
  }

  cancel() { this.patchCursor = null; }
}

// ─────────────────────────────────────────────────────────────
// SECTION 10 — SHOP SYSTEM
// ─────────────────────────────────────────────────────────────
class ShopSystem {
  constructor(registry) {
    this.registry = registry;
    this.el       = document.getElementById('shop-panel');
    this.itemsEl  = document.getElementById('shop-items');
    this.balEl    = document.getElementById('shop-balance');
    this.shopBtn  = document.getElementById('shop-btn');
    this.activeTab = 'generators';

    document.getElementById('shop-close-btn').addEventListener('click', () => this.close());
    document.querySelectorAll('.shop-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        document.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t === tab));
        this.render(gameEngine?.score ?? 0);
      });
    });
    this.shopBtn.addEventListener('click', () => this.el.classList.contains('open') ? this.close() : this.open());

    // Shop panel drag
    const header = this.el.querySelector('.shop-header');
    header.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = this.el.getBoundingClientRect();
      panelDrag = { panel: this.el, ox: e.clientX-r.left, oy: e.clientY-r.top };
      header.classList.add('is-dragging');
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mouseup', () => header.classList.remove('is-dragging'));
  }

  open() {
    this.el.style.left = (window.innerWidth-264)+'px';
    this.el.style.top  = '56px';
    this.el.classList.add('open');
    this.shopBtn.classList.add('active');
    this.render(gameEngine?.score ?? 0);
  }

  close() {
    this.el.classList.remove('open');
    this.shopBtn.classList.remove('active');
  }

  render(score) {
    this.balEl.textContent = score.toLocaleString()+' pts';
    this.itemsEl.innerHTML = '';

    // ── Generators tab: sequencers first, then MIDI inputs ──────
    if (this.activeTab === 'generators') {
      const seqSection = document.createElement('div');
      seqSection.className = 'shop-section-label';
      seqSection.textContent = 'SEQUENCERS';
      this.itemsEl.appendChild(seqSection);
    }

    for (const def of SHOP_DEFS) {
      const cat = MODULE_TYPE_DEFS[def.type]?.category;
      if (this.activeTab === 'voices'     && cat !== 'osc') continue;
      if (this.activeTab === 'fx'         && (cat === 'osc' || cat === 'cv' || cat === 'sequencer' || cat === 'drum' || cat === 'generator')) continue;
      if (this.activeTab === 'cv'         && cat !== 'cv') continue;
      if (this.activeTab === 'drums'      && cat !== 'drum') continue;
      if (this.activeTab === 'generators' && cat !== 'sequencer') continue;
      const price = GAME_CONFIG.modulePrices[def.type] ?? 0;
      const afford = score >= price;
      const qty = this.registry.countByType(def.type);
      const moduleHue = MODULE_TYPE_DEFS[def.type]?.hue ?? 200;
      const item = document.createElement('div');
      item.className = 'shop-item' + (afford ? ' affordable' : '');
      item.innerHTML = `
        <div class="shop-item-name" style="color:hsla(${moduleHue},70%,68%,0.9)">${def.name}${qty>0?`<span class="shop-item-qty">×${qty}</span>`:''}</div>
        <div class="shop-item-desc">${def.desc}</div>
        <div class="shop-item-footer">
          <span class="shop-item-price">${price===0?'FREE':price.toLocaleString()+' pts'}</span>
          <button class="shop-buy-btn" ${afford?'':'disabled'} data-type="${def.type}">${price===0&&qty===0?'CLAIM':'BUY'}</button>
        </div>`;
      this.itemsEl.appendChild(item);
    }
    this.itemsEl.querySelectorAll('.shop-buy-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const price = GAME_CONFIG.modulePrices[type] ?? 0;
        if (gameEngine.score < price) return;
        gameEngine.score -= price;
        scoreValEl.textContent = gameEngine.score.toLocaleString();
        const id = registry.addModule(type);
        audioGraph.ensure();
        spawnSynthHit(MODULE_TYPE_DEFS[type]?.hue ?? 200);
        saveState();
        this.render(gameEngine.score);
      });
    });

    // ── Generators tab: MIDI inputs section (after sequencers) ──
    if (this.activeTab === 'generators') {
      const midiSection = document.createElement('div');
      midiSection.className = 'shop-section-label';
      midiSection.textContent = 'MIDI INPUTS';
      this.itemsEl.appendChild(midiSection);

      // midi-all row — sellable/re-addable
      const allDeployed = registry.modules.has('midi-all-0');
      const allRow = document.createElement('div');
      allRow.className = 'shop-item shop-gen-row';
      allRow.innerHTML = `
        <div class="shop-item-name" style="color:hsla(55,70%,68%,0.9)">\u266C ALL MIDI + QWERTY</div>
        <div class="shop-item-desc">Routes all MIDI and keyboard input</div>
        <div class="shop-item-footer">
          <button class="shop-buy-btn gen-toggle-btn ${allDeployed ? 'gen-deployed' : ''}"
            data-gen="midi-all" data-deployed="${allDeployed}">
            ${allDeployed ? 'DEPLOYED' : 'ADD'}
          </button>
        </div>`;
      this.itemsEl.appendChild(allRow);

      // per-device midi-in rows from midiDevices map
      const devMap = typeof midiDevices !== 'undefined' ? midiDevices : new Map();
      if (devMap.size === 0) {
        const empty = document.createElement('div');
        empty.className = 'shop-gen-empty';
        empty.textContent = 'No MIDI devices connected';
        this.itemsEl.appendChild(empty);
      } else {
        for (const [devId, dev] of devMap) {
          const devMod = [...registry.modules.values()].find(m => m.type === 'midi-in' && m.params.deviceId === devId);
          const deployed = !!devMod;
          const row = document.createElement('div');
          row.className = 'shop-item shop-gen-row';
          row.innerHTML = `
            <div class="shop-item-name" style="color:hsla(55,70%,68%,0.9)">\u2669 ${dev.name}</div>
            <div class="shop-item-desc">Per-device MIDI generator</div>
            <div class="shop-item-footer">
              <button class="shop-buy-btn gen-toggle-btn ${deployed ? 'gen-deployed' : ''}"
                data-gen="midi-in" data-device-id="${devId}" data-device-name="${dev.name}"
                data-mod-id="${devMod?.id || ''}" data-deployed="${deployed}">
                ${deployed ? 'DEPLOYED' : 'ADD'}
              </button>
            </div>`;
          this.itemsEl.appendChild(row);
        }
      }

      // Wire gen toggle buttons
      this.itemsEl.querySelectorAll('.gen-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const gen = btn.dataset.gen;
          const deployed = btn.dataset.deployed === 'true';
          if (deployed) {
            // Sell (put back in shop, no score change)
            const modId = gen === 'midi-all' ? 'midi-all-0' : btn.dataset.modId;
            if (registry.modules.has(modId)) registry.removeModule(modId);
          } else {
            // Add to registry
            if (gen === 'midi-all') {
              registry.addModule('midi-all');
            } else {
              registry.addModule('midi-in', { deviceId: btn.dataset.deviceId, deviceName: btn.dataset.deviceName });
            }
            audioGraph.ensure();
          }
          saveState();
          this.render(gameEngine.score);
        });
      });
    }
  }
}
