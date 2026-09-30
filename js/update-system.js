/**
 * Update System — manifest-driven, SHA-256 verified, rollback-capable.
 * Works entirely on static hosting; no server required.
 */

const DB_NAME = 'update-system';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META  = 'meta';

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_FILES))
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META))
        db.createObjectStore(STORE_META,  { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── SHA-256 verification ─────────────────────────────────────────────────────

async function sha256hex(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyFile(buffer, expectedHash) {
  if (!expectedHash || expectedHash === '' || expectedHash === 'HASH_SHA256_DO_ARQUIVO_AQUI') {
    console.warn('[UpdateSystem] SHA-256 hash não configurado — verificação ignorada');
    return true;
  }
  const actual = await sha256hex(buffer);
  if (actual !== expectedHash.toLowerCase()) {
    console.error(`[UpdateSystem] SHA-256 mismatch: esperado ${expectedHash}, obtido ${actual}`);
    return false;
  }
  return true;
}

// ─── Source adapters ──────────────────────────────────────────────────────────

async function fetchGitHubManifest(source, allowPrerelease) {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/releases`;
  const resp = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
  const releases = await resp.json();

  const candidates = releases.filter(r => allowPrerelease || !r.prerelease);
  if (!candidates.length) throw new Error('Nenhuma release encontrada');

  const latest = candidates[0];
  const files  = latest.assets.map(a => ({
    name:    a.name,
    url:     a.browser_download_url,
    size:    a.size,
    sha256:  '',        // GitHub não fornece SHA-256 nativamente; adicione ao body da release
    firmware: ''
  }));

  // Tenta extrair compatibilidade de firmware do body da release
  // Formato esperado no corpo: `firmware: 13.52` ou `firmwares: 13.52, 14.00`
  const body = latest.body || '';
  const fwMatch = body.match(/firmwares?:\s*([\d., ]+)/i);
  const firmwares = fwMatch
    ? fwMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // Lê hashes SHA-256 do corpo: `sha256(payload.bin): abc123...`
  const hashMatches = [...body.matchAll(/sha256\(([^)]+)\):\s*([a-f0-9]{64})/gi)];
  for (const [, name, hash] of hashMatches) {
    const f = files.find(x => x.name === name.trim());
    if (f) f.sha256 = hash;
  }

  files.forEach(f => { if (!f.firmware) f.firmware = firmwares[0] || ''; });

  return {
    schemaVersion: 1,
    latest: latest.tag_name.replace(/^v/, ''),
    releases: [{
      version:   latest.tag_name.replace(/^v/, ''),
      date:      latest.published_at.slice(0, 10),
      changelog: body,
      firmwares,
      source:    latest.html_url,
      files
    }],
    firmwareCompatibility: firmwares.map(fw => ({
      firmware:  fw,
      supported: true,
      version:   latest.tag_name.replace(/^v/, ''),
      notes:     ''
    }))
  };
}

async function fetchManifestURL(source) {
  const resp = await fetch(source.url + '?_=' + Date.now());
  if (!resp.ok) throw new Error(`Manifest fetch ${resp.status}`);
  return resp.json();
}

// Checks upstream repo for new commits; returns { newCommit, upstreamUpdated }
async function checkGitHubCommits(source, storedCommit) {
  const url  = `https://api.github.com/repos/${source.owner}/${source.repo}/git/refs/heads/${source.branch ?? 'main'}`;
  const resp = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!resp.ok) throw new Error(`GitHub commit check ${resp.status}`);
  const data      = await resp.json();
  const newCommit = data?.object?.sha ?? null;
  return { newCommit, upstreamUpdated: newCommit && newCommit !== storedCommit };
}

// ─── Core UpdateSystem class ──────────────────────────────────────────────────

export class UpdateSystem {
  constructor() {
    this._config      = null;
    this._manifest    = null;
    this._installed   = null;  // { version, files: [{id, name, sha256}] }
    this._listeners   = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async init() {
    try {
      const cfgResp = await fetch('config.json');
      this._config  = await cfgResp.json();
    } catch {
      this._config = { sources: [], pinnedVersion: null, checkIntervalMinutes: 60, allowPrerelease: false };
    }

    const meta = await dbGet(STORE_META, 'installed');
    this._installed = meta?.value ?? null;

    this._emit('ready', { installed: this._installed });
    return this;
  }

  // ── Manifest fetch ──────────────────────────────────────────────────────────

  async fetchManifest() {
    const sources = (this._config?.sources ?? [])
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);

    let lastError;
    for (const src of sources) {
      try {
        if (src.type === 'github-commits') {
          // Upstream change detector — does not produce a manifest, only emits upstreamUpdated
          const stored = await dbGet(STORE_META, 'upstreamCommit');
          const { newCommit, upstreamUpdated } = await checkGitHubCommits(src, stored?.value ?? null);
          if (newCommit) await dbPut(STORE_META, { key: 'upstreamCommit', value: newCommit });
          if (upstreamUpdated) this._emit('upstreamUpdated', { commit: newCommit, source: src });
          continue;
        }

        let manifest;
        if (src.type === 'github-releases')
          manifest = await fetchGitHubManifest(src, this._config.allowPrerelease ?? false);
        else if (src.type === 'manifest-url')
          manifest = await fetchManifestURL(src);
        else
          continue;

        this._manifest = manifest;
        this._emit('manifest', manifest);
        return manifest;
      } catch (err) {
        console.warn(`[UpdateSystem] Fonte "${src.id}" falhou:`, err);
        lastError = err;
      }
    }

    // Fallback: manifest local
    try {
      const resp = await fetch('manifest.json');
      if (resp.ok) {
        this._manifest = await resp.json();
        this._emit('manifest', this._manifest);
        return this._manifest;
      }
    } catch {}

    this._emit('offline', {});
    throw lastError ?? new Error('Todas as fontes falharam');
  }

  // ── Version resolution ──────────────────────────────────────────────────────

  resolveTargetVersion() {
    if (!this._manifest) return null;
    const pinned = this._config?.pinnedVersion;
    if (pinned) {
      const found = this._manifest.releases.find(r => r.version === pinned);
      return found ?? null;
    }
    const latest = this._manifest.latest;
    return this._manifest.releases.find(r => r.version === latest) ?? null;
  }

  hasUpdate() {
    if (!this._manifest || !this._installed) return !!this.resolveTargetVersion();
    const target = this.resolveTargetVersion();
    if (!target) return false;
    return target.version !== this._installed.version;
  }

  installedVersion() {
    return this._installed?.version ?? null;
  }

  latestVersion() {
    return this._manifest?.latest ?? null;
  }

  getCompatibleFirmwares(version) {
    if (!this._manifest) return [];
    const release = this._manifest.releases.find(r => r.version === version);
    return release?.firmwares ?? [];
  }

  getFirmwareInfo(firmware) {
    if (!this._manifest) return null;
    return this._manifest.firmwareCompatibility?.find(f => f.firmware === firmware) ?? null;
  }

  // ── Download & verify ───────────────────────────────────────────────────────

  async _downloadFile(file, onProgress) {
    const resp = await fetch(file.url);
    if (!resp.ok) throw new Error(`Download falhou (${resp.status}): ${file.name}`);

    const total  = parseInt(resp.headers.get('content-length') ?? '0', 10);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.({ file: file.name, received, total });
    }

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }

    const ok = await verifyFile(buffer.buffer, file.sha256);
    if (!ok) throw new Error(`Verificação SHA-256 falhou: ${file.name}`);

    return buffer.buffer;
  }

  // ── Install ─────────────────────────────────────────────────────────────────

  async install(version, onProgress) {
    const release = this._manifest?.releases.find(r => r.version === version);
    if (!release) throw new Error(`Versão ${version} não encontrada no manifesto`);

    // Snapshot da versão anterior para rollback
    const previous = this._installed ? { ...this._installed } : null;

    const installedFiles = [];
    try {
      for (const file of release.files) {
        this._emit('progress', { phase: 'download', file: file.name, step: 0 });
        const buffer = await this._downloadFile(file, p => {
          onProgress?.(p);
          this._emit('progress', { phase: 'download', ...p });
        });

        const id = `${version}__${file.name}`;
        await dbPut(STORE_FILES, { id, name: file.name, version, sha256: file.sha256, buffer });
        installedFiles.push({ id, name: file.name, sha256: file.sha256 });
        this._emit('progress', { phase: 'stored', file: file.name });
      }

      this._installed = { version, files: installedFiles, installedAt: new Date().toISOString() };
      await dbPut(STORE_META, { key: 'installed', value: this._installed });

      if (previous) {
        await dbPut(STORE_META, { key: 'previous', value: previous });
      }

      this._emit('installed', { version, previous: previous?.version ?? null });
      return { success: true, version };
    } catch (err) {
      // Rollback automático
      if (previous) {
        this._installed = previous;
        await dbPut(STORE_META, { key: 'installed', value: previous });
        this._emit('rollback', { to: previous.version, reason: err.message });
      }
      throw err;
    }
  }

  // ── Rollback ────────────────────────────────────────────────────────────────

  async rollback() {
    const prev = await dbGet(STORE_META, 'previous');
    if (!prev?.value) throw new Error('Nenhuma versão anterior disponível');
    this._installed = prev.value;
    await dbPut(STORE_META, { key: 'installed', value: prev.value });
    await dbDelete(STORE_META, 'previous');
    this._emit('rollback', { to: prev.value.version, reason: 'manual' });
    return prev.value.version;
  }

  // ── File retrieval ───────────────────────────────────────────────────────────

  async getFile(name, version) {
    const ver = version ?? this._installed?.version;
    if (!ver) return null;
    const id   = `${ver}__${name}`;
    const rec  = await dbGet(STORE_FILES, id);
    return rec?.buffer ?? null;
  }

  async getFileURL(name, version) {
    const buf = await this.getFile(name, version);
    if (!buf) return null;
    return URL.createObjectURL(new Blob([buf]));
  }

  // ── Pin version ──────────────────────────────────────────────────────────────

  async pinVersion(version) {
    if (this._config) {
      this._config.pinnedVersion = version;
    }
    await dbPut(STORE_META, { key: 'pinnedVersion', value: version });
    this._emit('pinned', { version });
  }

  async unpinVersion() {
    if (this._config) this._config.pinnedVersion = null;
    await dbDelete(STORE_META, 'pinnedVersion');
    this._emit('pinned', { version: null });
  }

  // ── Periodic check ───────────────────────────────────────────────────────────

  startPeriodicCheck() {
    const intervalMs = (this._config?.checkIntervalMinutes ?? 60) * 60 * 1000;
    this._checkInterval = setInterval(async () => {
      try {
        await this.fetchManifest();
        if (this.hasUpdate()) this._emit('updateAvailable', { version: this.latestVersion() });
      } catch {}
    }, intervalMs);
  }

  stopPeriodicCheck() {
    clearInterval(this._checkInterval);
  }
}
