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
  }

  _onPatchChanged() {
    for (const [id] of this.registry.modules) {
      const panel = this.panelMap.get(id);
      if (panel) this._renderModulePorts(id, panel);
    }
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
    panel.innerHTML = `
      <span class="panel-title">VCF</span>
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
      <div class="mix-body" id="mix-body-${id}"></div>
      <div class="mix-snd-ctrl" id="mix-snd-ctrl-${id}"></div>
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
    // Signal flow left→right: CV(Q1) | Voice/osc(Q2) | Effects/processor(Q3) | Shop(Q4)
    const zone = cat === 'cv'                              ? { min: 0,        max: W * 0.25 }
               : cat === 'osc'                             ? { min: W * 0.25, max: W * 0.50 }
               : (cat === 'processor' || cat === 'utility')? { min: W * 0.50, max: W * 0.75 }
               : null; // sink/unknown — no preference
    const pos = findClearSpot(w, h, zone);
    panel.style.left = pos.left + 'px';
    panel.style.top  = pos.top  + 'px';
  }

  _initDrag(panel) {
    panel.addEventListener('mousedown', () => { panel.style.zIndex = ++this.panelTopZ; }, true);
    const handle = panel.querySelector(':scope > .panel-title');
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
    this._drawCursor(ctx2d);
    jacks.forEach(j => j.isCV ? drawCvJack(ctx2d, j.x, j.y, j.plugged, j.alpha) : drawJack(ctx2d, j.x, j.y, j.h, j.plugged, j.alpha));
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
      const isCV = el.classList.contains('port-cv');
      jacks.push({ x:cx, y:cy, h, plugged, alpha: isEmpty ? 0.45 : 0.88, id:`${isOut?'out':'in'}-${modId}-${port}`, modId, port, isOut, isEmpty, isCV });
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
      if (p.signalType === 'cv') {
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
    if (signalType === 'cv') {
      drawCvCable(ctx2d, fromJack.x, fromJack.y, mouseX, mouseY, 0, 0);
      const pulse = 0.45 + Math.sin(performance.now()/200)*0.2;
      ctx2d.save();
      ctx2d.beginPath(); ctx2d.rect(fromJack.x-7, fromJack.y-7, 14, 14);
      ctx2d.strokeStyle = `rgba(255,185,55,${pulse})`; ctx2d.lineWidth=1.2; ctx2d.stroke();
      ctx2d.restore();
    } else {
      drawCable(ctx2d, fromJack.x, fromJack.y, mouseX, mouseY, fromJack.h, 0.55, 0, 0);
      const pulse = 0.55 + Math.sin(performance.now()/200)*0.2;
      ctx2d.save();
      ctx2d.beginPath(); ctx2d.arc(fromJack.x, fromJack.y, 10, 0, Math.PI*2);
      ctx2d.strokeStyle = `hsla(${fromJack.h},85%,72%,${pulse})`; ctx2d.lineWidth=1.5; ctx2d.stroke();
      ctx2d.restore();
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
        // Lift any existing cable from this specific output port
        const curOut = registry.patches.find(p => p.fromId === hit.modId && p.fromPort === hit.port);
        if (curOut) registry.removePatch(curOut.fromId, curOut.fromPort, curOut.toId, curOut.toPort);
        // Start cursor (allow re-routing)
        const sigType = hit.isCV ? 'cv' : 'audio';
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
            this.patchCursor = { fromId: existingPatch.fromId, fromPort: existingPatch.fromPort, fromJack: { x:r.left+r.width/2, y:r.top+r.height/2, h, isCV: sigType === 'cv' }, signalType: sigType };
          }
        }
      } else if (hit.isEmpty) {
        // Click empty input — do nothing (wait for output click)
      }
    } else {
      // Complete the patch
      if (!hit.isOut) {
        // Validate signal type compatibility
        const toSigType = hit.isCV ? 'cv' : 'audio';
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
        const curOut2 = registry.patches.find(p => p.fromId === hit.modId && p.fromPort === hit.port);
        if (curOut2) registry.removePatch(curOut2.fromId, curOut2.fromPort, curOut2.toId, curOut2.toPort);
        this.patchCursor = { fromId: hit.modId, fromPort: hit.port, fromJack: hit };
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
    this.activeTab = 'voices';

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
    for (const def of SHOP_DEFS) {
      const cat = MODULE_TYPE_DEFS[def.type]?.category;
      if (this.activeTab === 'voices' && cat !== 'osc') continue;
      if (this.activeTab === 'fx'     && (cat === 'osc' || cat === 'cv')) continue;
      if (this.activeTab === 'cv'     && cat !== 'cv') continue;
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
  }
}
