import { UpdateSystem } from './update-system.js';

const us = new UpdateSystem();

// Dados embutidos — exibidos imediatamente, independente de qualquer fetch
const STATIC_GROUPS = [
  {
    label: '13.02 – 13.52',
    exploit: 'SlopKit + GoldHEN',
    goldhen: '2.4b18.12',
    entrypoint: '1352/index.html',
    description: 'SlopKit WebKit exploit com GoldHEN integrado.'
  },
  {
    label: '11.00 – 13.00',
    exploit: 'SlopKit WebKit',
    goldhen: '2.4b18.12',
    entrypoint: '1300/version-selector.html',
    description: 'SlopKit usando o motor WebKit do sistema.'
  },
  {
    label: '9.00 – 9.60',
    exploit: 'PSFree + Lapse',
    goldhen: '2.4b18.12',
    entrypoint: '900/version-selector.html',
    description: 'PSFree WebKit + Lapse kernel exploit.'
  },
  {
    label: '7.00 – 8.52',
    exploit: 'PSFree + Lapse',
    goldhen: '2.4b18.12',
    entrypoint: '700/version-selector.html',
    description: 'PSFree WebKit + Lapse kernel exploit.'
  },
  {
    label: '6.72',
    exploit: 'Legacy',
    goldhen: '2.4b18.12',
    entrypoint: '672/index.html',
    description: 'Exploit legado para FW 6.72.'
  },
  {
    label: '5.05',
    exploit: 'Legacy',
    goldhen: '2.4b18.12',
    entrypoint: '505/index.html',
    description: 'Exploit legado para FW 5.05.'
  }
];

// ── DOM ───────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  stepSelect:  $('step-select'),
  stepReady:   $('step-ready'),
  fwGrid:      $('fw-grid'),
  btnBack:     $('btn-back'),
  progFwLabel: $('prog-fw-label'),
  progPct:     $('prog-pct'),
  progBar:     $('prog-bar'),
  progStatus:  $('prog-status'),
  particles:   $('particles'),
};

// Wrap inner panel (needed for the CSS structure)
const panel = document.querySelector('.progress-panel');
if (panel) {
  const inner = document.createElement('div');
  inner.className = 'progress-panel-inner';
  while (panel.firstChild) inner.appendChild(panel.firstChild);
  panel.appendChild(inner);
}

// ── Progress phases ───────────────────────────────────────────────────────────

const PHASES = [
  { at:  0, text: 'Inicializando…' },
  { at: 18, text: 'Carregando exploit…' },
  { at: 45, text: 'Verificando integridade…' },
  { at: 75, text: 'Aplicando patches…' },
  { at: 92, text: 'Quase lá…' },
  { at: 99, text: 'Pronto!' },
];

// ── Particles ─────────────────────────────────────────────────────────────────

function burst(originEl) {
  const r  = originEl.getBoundingClientRect();
  const cx = r.left + r.width  / 2;
  const cy = r.top  + r.height / 2;
  for (let i = 0; i < 28; i++) {
    const p     = document.createElement('div');
    p.className = i % 3 === 0 ? 'particle s' : 'particle';
    const angle = (i / 28) * 360 + Math.random() * 10;
    const dist  = 50 + Math.random() * 100;
    p.style.cssText = `left:${cx}px;top:${cy}px;--tx:${Math.cos(angle*Math.PI/180)*dist}px;--ty:${Math.sin(angle*Math.PI/180)*dist}px;animation-delay:${Math.random()*.1}s;animation-duration:${.5+Math.random()*.3}s;`;
    el.particles.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

// ── 3D Tilt ───────────────────────────────────────────────────────────────────

function attachTilt(card) {
  card.addEventListener('mousemove', e => {
    const r  = card.getBoundingClientRect();
    const x  = (e.clientX - r.left  - r.width  / 2) / (r.width  / 2);
    const y  = (e.clientY - r.top   - r.height / 2) / (r.height / 2);
    card.style.transform = `perspective(600px) rotateX(${-y*10}deg) rotateY(${x*10}deg) scale3d(1.04,1.04,1.04)`;
    card.style.transition = 'transform .06s ease,border-color .2s,background .2s,box-shadow .2s';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform  = '';
    card.style.transition = 'transform .32s ease,border-color .2s,background .2s,box-shadow .2s';
  });
}

// ── Progress animation ────────────────────────────────────────────────────────

function runProgress(targetUrl) {
  let current = 0;
  let raf;

  // Non-linear speed curve: fast → slows → snaps at 100
  function speed(pct) {
    if (pct <  30) return 1.4;
    if (pct <  60) return 0.7;
    if (pct <  85) return 0.4;
    if (pct <  96) return 0.2;
    return 1.8;
  }

  function updatePhase(pct) {
    const phase = [...PHASES].reverse().find(p => pct >= p.at);
    if (phase) el.progStatus.textContent = phase.text;
  }

  function tick() {
    current = Math.min(100, current + speed(current) * (Math.random() * .6 + .7));
    const rounded = Math.floor(current);

    // Update number
    const pctEl = el.progPct;
    pctEl.innerHTML = `${rounded}<span class="pct-sym">%</span>`;

    // Update bar
    el.progBar.style.width = current + '%';
    if (current > 5) el.progBar.classList.add('glow');

    updatePhase(rounded);

    if (current < 100) {
      raf = requestAnimationFrame(tick);
    } else {
      el.progBar.style.width = '100%';
      el.progStatus.textContent = 'Redirecionando…';
      burst(el.progBar);
      setTimeout(() => { window.location.href = targetUrl; }, 600);
    }
  }

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ── Navigation ────────────────────────────────────────────────────────────────

let cancelProgress = null;
let selected       = null;

function goReady(group) {
  selected = group;
  el.progFwLabel.textContent         = `FW ${group.label}`;
  el.progPct.innerHTML               = `0<span class="pct-sym">%</span>`;
  el.progBar.style.width             = '0%';
  el.progBar.classList.remove('glow');
  el.progStatus.textContent          = 'Inicializando…';

  el.stepSelect.hidden = true;
  el.stepReady.hidden  = false;

  cancelProgress = runProgress(group.entrypoint);
}

el.btnBack?.addEventListener('click', () => {
  if (cancelProgress) { cancelProgress(); cancelProgress = null; }
  el.stepReady.hidden  = true;
  el.stepSelect.hidden = false;
});

// ── Build grid (only versions) ────────────────────────────────────────────────

function buildGrid(groups) {
  el.fwGrid.innerHTML = '';
  if (!groups?.length) return;

  groups.forEach(group => {
    const card      = document.createElement('div');
    card.className  = 'fw-card';
    card.tabIndex   = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Firmware ${group.label}`);
    card.innerHTML  = `<div class="fw-range">${group.label}</div>`;
    card.addEventListener('click',   () => goReady(group));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') goReady(group); });
    attachTilt(card);
    el.fwGrid.appendChild(card);
  });
}

// ── Update system ─────────────────────────────────────────────────────────────

us
  .on('manifest',        manifest => buildGrid(manifest?.exploitGroups))
  .on('upstreamUpdated', ()       => {})   // silencioso — sem banner na UI
  .on('offline',         ()       => {});  // silencioso

// ── Boot ──────────────────────────────────────────────────────────────────────

// Mostra os cards imediatamente com dados embutidos
buildGrid(STATIC_GROUPS);

// Tenta carregar manifesto remoto em background (sobrescreve se tiver dados)
(async () => {
  try {
    await us.init();
    await us.fetchManifest();
    us.startPeriodicCheck();
  } catch {
    // servidor bloqueou JSON — dados estáticos já estão na tela
  }
})();
