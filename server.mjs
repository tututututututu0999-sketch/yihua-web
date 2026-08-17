import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, unlink, rename, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, normalize, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { successCasePresets } from './成功案例预设.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(root, 'data');
const uploadDir = join(root, 'uploads');
const port = Number(process.env.PORT || 4174);
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
// The single definition of the approved print canvases. Both front ends read it
// from GET /shared.js instead of keeping their own copy, because a stale copy in
// 设计工作台.html used to silently rewrite 6 of these 8 ratios.
const printCanvasSpecs = {
  // 300 dpi print-output dimensions derived from the approved millimetre sizes.
  '32:23': { width: 3780, height: 2717, printSize: '320 x 230 mm', orientation: '横版', label: '横版 · 320 × 230 mm' },
  '4:3': { width: 3780, height: 2835, printSize: '4:3 横版', orientation: '横版', label: '横版 · 4:3' },
  '3:2': { width: 3780, height: 2520, printSize: '3:2 横版', orientation: '横版', label: '横版 · 3:2' },
  '1:1': { width: 2894, height: 2894, printSize: '1:1 方版', orientation: '方版', label: '方版 · 1:1' },
  '7:8': { width: 2894, height: 3307, printSize: '7:8 近方竖版', orientation: '竖版', label: '近方竖版 · 7:8' },
  '3:4': { width: 2894, height: 3859, printSize: '3:4 竖版', orientation: '竖版', label: '竖版 · 3:4' },
  '2:3': { width: 2894, height: 4341, printSize: '2:3 竖版', orientation: '竖版', label: '竖版 · 2:3' },
  '7:10': { width: 2894, height: 4134, printSize: '245 x 350 mm', orientation: '竖版', label: '竖版 · 245 × 350 mm' }
};
const canvasRatioKeys = new Set(Object.keys(printCanvasSpecs));
const maxReferenceSize = 10 * 1024 * 1024;
const maxImageReferences = 8;
const maxPromptReferenceImages = 8;
const promptVisionPreviewEdge = 640;
let imageGenerationQueue = Promise.resolve();
const execFileAsync = promisify(execFile);

await mkdir(dataDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });

async function loadEnv() {
  try {
    const content = await readFile(join(root, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadEnv();

const db = new DatabaseSync(join(dataDir, 'yihua.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '主视觉待确认',
    current_design_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS demand_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    design_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reference_assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    role TEXT NOT NULL,
    authorized INTEGER NOT NULL,
    storage_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proposal_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    demand_snapshot_id TEXT NOT NULL,
    reference_ids TEXT NOT NULL,
    content TEXT NOT NULL,
    design_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    parent_visual_id TEXT,
    content TEXT NOT NULL,
    design_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS image_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    parent_visual_id TEXT,
    material_type TEXT NOT NULL DEFAULT '主视觉',
    status TEXT NOT NULL,
    requested_count INTEGER NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    provider_usage TEXT,
    design_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visual_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    parent_visual_id TEXT,
    material_type TEXT NOT NULL DEFAULT '主视觉',
    candidate_index INTEGER NOT NULL,
    storage_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待确认',
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    variant_label TEXT,
    is_reference_candidate INTEGER NOT NULL DEFAULT 0,
    design_revision INTEGER NOT NULL DEFAULT 0,
    stale_reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS badge_settings (
    project_id TEXT PRIMARY KEY,
    badge_asset_id TEXT,
    position TEXT NOT NULL DEFAULT '右上角',
    size_ratio REAL NOT NULL DEFAULT 0.12,
    margin_ratio REAL NOT NULL DEFAULT 0.04,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback_events (
    id TEXT PRIMARY KEY,
    visual_id TEXT NOT NULL,
    feedback_types TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    visual_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '草稿',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS material_briefs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    material_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, material_type)
  );
  CREATE TABLE IF NOT EXISTS published_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_project_id TEXT NOT NULL,
    source_visual_id TEXT NOT NULL,
    cover_storage_name TEXT NOT NULL,
    canvas_spec TEXT NOT NULL,
    visual_config TEXT NOT NULL,
    preview_positions TEXT NOT NULL,
    material_settings TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

async function syncSuccessCasePresets() {
  const sourceDir = join(dirname(root), '礼盒封面');
  // Built-in cases are versioned product data, so refresh them on startup.
  // User-published presets have different IDs and remain untouched.
  const insert = db.prepare(`INSERT INTO published_presets (id, name, source_project_id, source_visual_id, cover_storage_name, canvas_spec, visual_config, preview_positions, material_settings, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      cover_storage_name = excluded.cover_storage_name,
      canvas_spec = excluded.canvas_spec,
      visual_config = excluded.visual_config,
      preview_positions = excluded.preview_positions,
      material_settings = excluded.material_settings`);
  for (const preset of successCasePresets) {
    const target = join(uploadDir, preset.coverStorageName);
    try {
      await copyFile(join(sourceDir, preset.sourceFileName), target);
    } catch (error) {
      if (error.code === 'ENOENT') console.warn(`[案例预设] 找不到缩略图：${preset.sourceFileName}`);
      else throw error;
    }
    insert.run(preset.id, preset.name, 'built-in-case-library', preset.sourceVisualId, preset.coverStorageName, json(canvasSpec(preset.canvasSpec)), json(preset.visualConfig), json(preset.previewPositions), json([]), '2026-08-12T00:00:00.000Z');
  }
}

await syncSuccessCasePresets();

// Existing local databases predate material-specific generation. Keep the
// prototype upgradeable without asking designers to delete their test data.
for (const statement of [
  "ALTER TABLE image_jobs ADD COLUMN material_type TEXT NOT NULL DEFAULT '主视觉'",
  "ALTER TABLE visual_versions ADD COLUMN material_type TEXT NOT NULL DEFAULT '主视觉'",
  "ALTER TABLE visual_versions ADD COLUMN variant_label TEXT",
  "ALTER TABLE visual_versions ADD COLUMN is_reference_candidate INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE prompt_versions ADD COLUMN material_type TEXT NOT NULL DEFAULT '主视觉'",
  "ALTER TABLE projects ADD COLUMN current_design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE demand_snapshots ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE proposal_versions ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE prompt_versions ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE image_jobs ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE visual_versions ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE visual_versions ADD COLUMN stale_reason TEXT"
]) {
  try { db.exec(statement); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

// Every hot read filters by project_id; without these the queries are full scans.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_demand_snapshots_project ON demand_snapshots(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_history_events_project ON history_events(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_visual_versions_project ON visual_versions(project_id, created_at DESC, candidate_index);
  CREATE INDEX IF NOT EXISTS idx_image_jobs_project ON image_jobs(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_image_jobs_lookup ON image_jobs(project_id, material_type, prompt_id, status);
  CREATE INDEX IF NOT EXISTS idx_proposal_versions_project ON proposal_versions(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_prompt_versions_project ON prompt_versions(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reference_assets_project ON reference_assets(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_style_profiles_project ON style_profiles(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_events_visual ON feedback_events(visual_id);
`);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function json(value) { return JSON.stringify(value ?? {}); }
function parse(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function providerError(message, status = 0) {
  const error = new Error(message);
  error.providerStatus = status;
  error.status = 502;
  error.retryable = status === 429 || status >= 500 || /资源紧张|资源不足|resource.?busy|overloaded|rate.?limit|temporar/i.test(message);
  return error;
}

// Rejected client input is not a server fault; the response code should say so.
function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a || 1; }
function sizeForUnits(widthUnits, heightUnits, shortEdge) {
  const unit = Math.max(1, Math.round(shortEdge / Math.min(widthUnits, heightUnits)));
  return { width: widthUnits * unit, height: heightUnits * unit, size: `${widthUnits * unit}x${heightUnits * unit}` };
}
function canvasSpec(input = '7:10') {
  const raw = typeof input === 'string' ? { ratio: input } : (input || {});
  let widthUnits = Number(raw.widthUnits), heightUnits = Number(raw.heightUnits);
  let ratio = String(raw.ratio || '').trim();
  if (ratio === 'custom') ratio = '7:10';
  // The approved print ratio is authoritative. Older project records may
  // contain stale widthUnits/heightUnits from a previous portrait selection.
  if (canvasRatioKeys.has(ratio)) [widthUnits, heightUnits] = ratio.split(':').map(Number);
  if (!ratio && widthUnits && heightUnits) ratio = `${widthUnits}:${heightUnits}`;
  if (!widthUnits || !heightUnits) {
    const match = ratio.match(/^(\d+):(\d+)$/);
    if (match) [widthUnits, heightUnits] = match.slice(1).map(Number);
  }
  const resolvedInputRatio = ratio || `${widthUnits}:${heightUnits}`;
  const isApprovedPrintRatio = canvasRatioKeys.has(resolvedInputRatio);
  if (!Number.isInteger(widthUnits) || !Number.isInteger(heightUnits) || widthUnits < 1 || heightUnits < 1 || (!isApprovedPrintRatio && (widthUnits > 20 || heightUnits > 20))) throw badRequest('画幅比例必须为有效的正整数。');
  const divisor = gcd(widthUnits, heightUnits);
  widthUnits /= divisor; heightUnits /= divisor;
  ratio = `${widthUnits}:${heightUnits}`;
  // Legacy ratios are migrated to the approved portrait or landscape print size.
  if (!canvasRatioKeys.has(ratio)) ratio = widthUnits > heightUnits ? '32:23' : '7:10';
  const print = printCanvasSpecs[ratio];
  const [finalWidthUnits, finalHeightUnits] = ratio.split(':').map(Number);
  return { ratio, widthUnits: finalWidthUnits, heightUnits: finalHeightUnits, width: print.width, height: print.height, exportSize: `${print.width}x${print.height}`, printSize: print.printSize, orientation: print.orientation, isCustom: false };
}
function modelSizeForCanvas(spec) {
  if (spec.width === spec.height) return '1024x1024';
  return spec.width > spec.height ? '1536x1024' : '1024x1536';
}
function sizeForRatio(ratio) { return modelSizeForCanvas(canvasSpec(ratio)); }
function applyCanvasSpec(target, fallback = '7:10') {
  const spec = canvasSpec(target.canvasSpec || target.ratio || fallback);
  target.canvasSpec = spec;
  target.ratio = spec.ratio;
  return target;
}
function materialPresetSettings(rows) {
  return rows.map(row => {
    const payload = parse(row.payload, {});
    const { title, subtitle, grade, selling, extraInfo, designNote, sourceVisualId, sourceVisualIds, ...settings } = payload;
    return { materialType: row.material_type, displayName: row.display_name, sortOrder: row.sort_order, payload: applyCanvasSpec(settings) };
  });
}

// Callers fire this without awaiting, so the chain must never settle rejected:
// an unhandled rejection would take the process down and strand the job as
// "生成中" forever in the client's poll.
function queueImageJob(jobId) {
  imageGenerationQueue = imageGenerationQueue
    .catch(() => {})
    .then(() => runImageJob(jobId))
    .catch(error => {
      console.error(`[image-job] ${jobId}`, error);
      try {
        db.prepare('UPDATE image_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
          .run('失败', error?.message || '生成任务异常终止。', now(), jobId);
      } catch (writeError) {
        console.error(`[image-job] ${jobId} 状态回写失败`, writeError);
      }
    });
  return imageGenerationQueue;
}

function isImageBytes(bytes, mimeType) {
  if (mimeType === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/webp') return bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  const payload = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(payload);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 14_000_000) throw badRequest('请求内容过大');
  }
  return JSON.parse(body || '{}');
}

// Every history write funnels through here, so this is the one place that can
// guarantee no caller ever smuggles a multi-megabyte data URL into the database.
function stripInlineMedia(value) {
  if (typeof value === 'string') return value.startsWith('data:') && value.length > 1024 ? '[inline-media-removed]' : value;
  if (Array.isArray(value)) return value.map(stripInlineMedia);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripInlineMedia(item)]));
  return value;
}

function logHistory(projectId, eventType, title, payload = {}) {
  db.prepare('INSERT INTO history_events (id, project_id, event_type, title, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id('hist'), projectId, eventType, title, json(stripInlineMedia(payload)), now());
}

function ensureProject(projectId, demand = {}) {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  const timestamp = now();
  if (!project) {
    db.prepare('INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, demand.name || '未命名造品项目', '主视觉待确认', timestamp, timestamp);
    logHistory(projectId, 'project_created', '创建项目', { demand: demandWithoutMedia(demand) });
  } else if (demand.name) {
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(demand.name, timestamp, projectId);
  }
}

function saveDemandSnapshot(projectId, demand) {
  const snapshotId = id('demand');
  db.prepare('INSERT INTO demand_snapshots (id, project_id, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(snapshotId, projectId, json(demandWithoutMedia(demand)), now());
  logHistory(projectId, 'demand_snapshot', '保存需求快照', { snapshotId });
  return snapshotId;
}

function currentDesignRevision(projectId) {
  return Number(db.prepare('SELECT current_design_revision FROM projects WHERE id = ?').get(projectId)?.current_design_revision || 0);
}

function saveDesignRevision(projectId, demand, title = '保存需求版本') {
  const normalizedDemand = json(demandWithoutMedia(demand));
  const latest = latestDemand(projectId);
  if (latest && json(latest.payload) === normalizedDemand) {
    return { snapshotId: latest.id, revision: currentDesignRevision(projectId), unchanged: true };
  }
  const revision = currentDesignRevision(projectId) + 1;
  const snapshotId = id('demand');
  db.prepare('INSERT INTO demand_snapshots (id, project_id, payload, design_revision, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(snapshotId, projectId, normalizedDemand, revision, now());
  db.prepare('UPDATE projects SET current_design_revision = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(revision, '需求已更新，待生成主视觉', now(), projectId);
  db.prepare("UPDATE visual_versions SET is_confirmed = 0, status = '需求已更新，历史版本', stale_reason = '需求已更新' WHERE project_id = ? AND design_revision < ? AND is_confirmed = 1")
    .run(projectId, revision);
  db.prepare("UPDATE visual_versions SET status = '主视觉已变更，历史物料', stale_reason = '需求已更新' WHERE project_id = ? AND material_type != '主视觉' AND design_revision < ? AND status NOT LIKE '主视觉已变更%'")
    .run(projectId, revision);
  logHistory(projectId, 'design_revision_saved', title, { snapshotId, designRevision: revision });
  return { snapshotId, revision };
}

function latestDemand(projectId) {
  const row = db.prepare('SELECT * FROM demand_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
  return row ? { ...row, payload: parse(row.payload, {}) } : null;
}

// The uploaded IP image already lives on disk as a reference_assets row, so the
// inline base64 copy is write-only weight. Drop it before it reaches storage or
// the prompt planner; image generation reads the file back from uploads/.
function demandWithoutMedia(demand = {}) {
  if (!demand.ipAsset) return demand;
  const { dataUrl, ...ipMetadata } = demand.ipAsset;
  return { ...demand, ipAsset: ipMetadata };
}

function compactDemandForSkill(demand = {}) {
  const compact = demandWithoutMedia(demand);
  return {
    ...compact,
    ipAsset: demand.ipAsset ? {
      ...compact.ipAsset,
      authorized: Boolean(compact.ipAsset.authorized),
      uploaded: true
    } : null
  };
}

function currentReferenceAssets(projectId, roles = null) {
  const rows = db.prepare('SELECT * FROM reference_assets WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  const allowed = roles ? new Set(roles) : null;
  const counts = new Map();
  return rows.filter(asset => {
    if (allowed && !allowed.has(asset.role)) return false;
    const limit = asset.role === '徽章' ? 2 : 1;
    const count = counts.get(asset.role) || 0;
    if (count >= limit) return false;
    counts.set(asset.role, count + 1);
    return true;
  });
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => item.text || '').join('');
  return '';
}

function parseModelJson(content) {
  const text = contentText(content).trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

function providerUrl(pathname) {
  const baseUrl = (process.env.CCPROXY_BASE_URL || 'https://ccproxy.yukework.com').replace(/\/+$/, '');
  return `${baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`}${pathname}`;
}

// A single global queue drives image generation, so any request without a
// deadline can wedge generation for every project until the process restarts.
async function fetchWithTimeout(url, init, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw providerError(`${label}超过 ${Math.round(timeoutMs / 1000)} 秒未响应，请稍后重试。`, 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Upstream bodies can echo request headers, so they stay in the server log and
// the caller gets a message that says which knob to turn.
function providerFailure(label, status, detail) {
  console.error(`[provider] ${label} ${status}: ${String(detail).slice(0, 2000)}`);
  if (status === 401 || status === 403) return providerError(`${label}鉴权失败（${status}）：请检查 .env 中的 CCPROXY_API_KEY 是否正确。`, status);
  if (status === 429) return providerError(`${label}触发限流（429）：请稍后重试。`, status);
  if (status === 400 || status === 422) return providerError(`${label}被拒绝（${status}）：内容可能未通过安全审核，请调整文案或参考图后重试。`, status);
  if (status >= 500) return providerError(`${label}服务端异常（${status}）：这通常是临时故障，请稍后重试。`, status);
  return providerError(`${label}失败（${status}）：详情见服务端日志。`, status);
}

async function callChatJson(system, payload, referenceImages = []) {
  const apiKey = process.env.CCPROXY_API_KEY;
  if (!apiKey) throw new Error('未配置 API Key。请在 .env 中填写 CCPROXY_API_KEY 后重启服务。');
  const response = await fetchWithTimeout(providerUrl('/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.CCPROXY_MODEL || 'gpt-5.6-terra',
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, {
        role: 'user', content: referenceImages.length ? [
          { type: 'text', text: JSON.stringify(payload) },
          ...referenceImages.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
        ] : JSON.stringify(payload)
      }]
    })
  }, Number(process.env.CCPROXY_CHAT_TIMEOUT_MS || 75000), '方案模型调用');
  if (!response.ok) throw providerFailure('方案模型调用', response.status, await response.text());
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('方案模型未返回可读取的内容。');
  return parseModelJson(content);
}

const mainVisualBasePositive = '教育互联网礼盒封面，高明度高对比，印刷级清晰；标题、主体、卖点层级清楚，留白干净；核心主体四周保留与相邻背景同风格、同色系的呼吸余量，不做贴边满版。';
const materialBasePositive = '明亮清晰的教育系列物料，继承主视觉配色与图形语言，信息层级更轻。';
const commonNegativePrompt = '灰暗低饱和，模糊，乱码错字，任何未填写的文字或数字，Logo，水印，重绘徽章，拥挤背景，多主体，遮挡标题，裁切出血。';

const proposalSkill = `你是资深视觉提示词规划专家。先准确理解用户需求并提取可执行约束；你是教辅造品平台的“主视觉方案完善 Skill”。根据需求、业务规则和参考图元数据，输出给设计师确认的主视觉方案。
规则：不要生成图片，不承诺生产文件；参考图只可提炼风格、构图、元素，不能复制其中标题、卖点或未授权内容；不确定内容必须列入待确认项。
严格只返回 JSON：{"summary":"","designGoal":"","informationHierarchy":[""],"palette":[""],"coreElements":[""],"layout":"","executableConstraints":[""],"referenceAnalysis":[""],"risks":[""],"questions":[""]}`;

const promptSkill = `你是教辅礼盒封面 Prompt Skill。依据已确认文案、网站选项、拖拽版式和参考图，输出可直接用于生图的中文补充词。
规则：只写输入未覆盖的主体、装饰、材质和画面气质；不重复文案、画幅、配色、版式字段。只允许呈现“已确认文案”中的文字、数字和英文，严禁自行增加任何标题、口号、标签、认证、数字或英文。参考图只继承角色特征、配色、构图和图形语言，不复制旧文案、Logo、徽章或未授权角色。徽章和 Logo 必须后置，徽章预留区必须自然延续周围背景的颜色、纹理和风格，不能生成独立色块、白底、底牌、认证章、飘带或替代图形。主体四周必须留出与相邻背景同风格同色系的呼吸余量，不得贴边或满版。画面高明度、高对比、干净明亮，拒绝灰暗电影感。positivePrompt 控制在 120 至 220 个汉字；integratedPrompt 写成一段完整的“制作一张……”整合版生图提示词，串联当前画幅、正式文案、配色、版式、主体、装饰、留白和氛围；negativePrompt 仅保留必要禁用项。
严格只返回 JSON：{"positivePrompt":"","integratedPrompt":"","negativePrompt":"","size":"","titleText":"","keepItems":[""],"changeItems":[""],"referenceInstructions":[""]}`;

const materialPromptSkill = `你是教辅礼盒系列延展物料 Prompt Skill。继承已确认主视觉的明亮配色、图形语言和主体身份，重组为独立版式；非主书物料的信息层级弱于主书。
规则：只写输入未覆盖的画面内容，不重复网站字段。只允许呈现“已确认文案”中的文字、数字和英文，严禁自行增加标题、口号、标签、认证或英文。徽章和 Logo 必须后置，预留区自然延续周围背景，不能另加色块或徽章替代图形；主体四周保留与背景一致的呼吸余量；参考图不复制旧文案、Logo、徽章或未授权角色。画面高明度、高对比、干净明亮。positivePrompt 控制在 120 至 220 个汉字；integratedPrompt 写成一段完整的“制作一张……”整合版生图提示词；negativePrompt 仅保留必要禁用项。
严格只返回 JSON：{"positivePrompt":"","integratedPrompt":"","negativePrompt":"","size":"","titleText":"","keepItems":[""],"changeItems":[""],"referenceInstructions":[""]}`;

const styleProfileSkill = `你是资深视觉提示词规划专家。先准确理解用户需求并提取可执行约束；你是教辅造品平台的“风格规则提炼 Skill”。根据一张已确认的礼盒主视觉及其 Prompt，输出只供后续主书、练习册继承的可编辑风格规则。
规则：不能声称生成生产文件；只描述色彩、标题气质、核心元素、版式留白和禁用项；不得复制图片中不属于当前项目的旧标题或卖点。
严格只返回 JSON：{"palette":["#000000"],"titleTone":"","coreElements":"","spacing":"","avoid":""}`;

async function loadReferenceAssets(projectId, referenceIds) {
  if (!Array.isArray(referenceIds) || !referenceIds.length) return [];
  const query = db.prepare('SELECT * FROM reference_assets WHERE project_id = ? AND id = ?');
  const rows = referenceIds.map(assetId => query.get(projectId, assetId)).filter(Boolean);
  return Promise.all(rows.map(async row => ({
    id: row.id, fileName: row.file_name, mimeType: row.mime_type, role: row.role, authorized: Boolean(row.authorized), url: `/uploads/${row.storage_name}`,
    dataUrl: `data:${row.mime_type};base64,${(await readFile(join(uploadDir, row.storage_name))).toString('base64')}`
  })));
}

async function loadPromptVisionPreviews(assets) {
  const selected = [...assets].slice(0, maxPromptReferenceImages);
  const previews = await Promise.all(selected.map(async asset => {
    const preview = join(uploadDir, `.prompt-preview-${randomUUID()}.jpg`);
    try {
      await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '65', '-Z', String(promptVisionPreviewEdge), join(uploadDir, asset.storage_name), '--out', preview]);
      const bytes = await readFile(preview);
      return { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
    } catch {
      // Visual analysis is additive. Metadata still reaches the planning skill
      // when a local preview cannot be prepared.
      return null;
    } finally {
      await unlink(preview).catch(() => {});
    }
  }));
  return previews.filter(Boolean);
}

function sanitizeProposal(result) {
  return {
    summary: String(result.summary || ''), designGoal: String(result.designGoal || ''), layout: String(result.layout || ''),
    informationHierarchy: Array.isArray(result.informationHierarchy) ? result.informationHierarchy.map(String) : [],
    executableConstraints: Array.isArray(result.executableConstraints) ? result.executableConstraints.map(String) : [],
    palette: Array.isArray(result.palette) ? result.palette.map(String) : [],
    coreElements: Array.isArray(result.coreElements) ? result.coreElements.map(String) : [],
    referenceAnalysis: Array.isArray(result.referenceAnalysis) ? result.referenceAnalysis.map(String) : [],
    risks: Array.isArray(result.risks) ? result.risks.map(String) : [],
    questions: Array.isArray(result.questions) ? result.questions.map(String) : []
  };
}

function quickProposal(demand) {
  const facts = demand.projectFacts || {};
  const config = demand.visualConfig || {};
  const layout = config.layoutComponentConfig || {};
  return sanitizeProposal({
    summary: '已根据当前设计信息建立快速方案上下文。',
    designGoal: demand.designNote || demand.constraints?.freeformDesignNote || '以当前已确认文案和视觉字段生成主视觉。',
    informationHierarchy: [facts.headline || demand.title || '主标题', facts.subtitle || demand.subtitle || '副标题', ...(facts.sellingPoints || []).map(item => typeof item === 'string' ? item : item?.text).filter(Boolean)],
    palette: [config.colorConfig?.primaryColor, config.colorConfig?.secondaryColor].filter(Boolean),
    coreElements: [config.illustrationConfig?.subjectType, config.illustrationConfig?.illustrationStyle].filter(Boolean),
    layout: layout.compositionTemplate || '以当前构图字段为准',
    executableConstraints: Object.entries(layout).map(([key, value]) => `${key}=${value}`),
    referenceAnalysis: [], risks: [], questions: []
  });
}

function sanitizePrompt(result) {
  return {
    positivePrompt: compactPositivePrompt(String(result.positivePrompt || '')), integratedPrompt: compactIntegratedPrompt(String(result.integratedPrompt || '')), negativePrompt: String(result.negativePrompt || ''),
    size: /^\d{3,5}x\d{3,5}$/.test(String(result.size || '')) ? String(result.size) : '1024x1364', titleText: String(result.titleText || ''),
    canvasSpec: result.canvasSpec && typeof result.canvasSpec === 'object' ? result.canvasSpec : null,
    keepItems: Array.isArray(result.keepItems) ? result.keepItems.map(String) : [],
    changeItems: Array.isArray(result.changeItems) ? result.changeItems.map(String) : [],
    referenceInstructions: Array.isArray(result.referenceInstructions) ? result.referenceInstructions.map(String) : [],
    referenceAssetIds: Array.isArray(result.referenceAssetIds) ? result.referenceAssetIds.map(String).slice(0, 8) : []
  };
}

function compactPositivePrompt(value) {
  const unique = [...new Set(value.replace(/\s+/g, ' ').split(/[；。\n]/).map(item => item.trim()).filter(Boolean))];
  return unique.join('；').slice(0, 260);
}

function compactIntegratedPrompt(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 760);
}

function layoutComponentModules(config, points, previewPositions = {}) {
  const component = config.layoutComponentConfig || {};
  const label = (value, map, fallback) => map[value] || fallback;
  const position = (id, name) => {
    const value = previewPositions[id] || {};
    const left = Number(value.left);
    const top = Number(value.top);
    return Number.isFinite(left) && Number.isFinite(top)
      ? `${name}@${Math.max(0, Math.min(100, left)).toFixed(0)}%,${Math.max(0, Math.min(100, top)).toFixed(0)}%`
      : `${name}@默认位置`;
  };
  const draggedLayout = [
    position('previewTitle', '主标题'),
    position('previewSub', '副标题'),
    position('previewSelling', '卖点区'),
    position('previewIp', '主体')
  ].join('；');
  // Dragged preview coordinates are the source of truth. compositionTemplate remains
  // only as a fallback for saved projects created before position dragging existed.
  const legacyComposition = label(component.compositionTemplate, {
    left_text_right_person: '旧版左文右主体构图',
    left_text_right_ip: '旧版左文右主体构图',
    left_ip_right_text: '旧版左主体右文构图',
    left_person_right_text: '旧版左主体右文构图',
    top_text_bottom_scene: '旧版上文下主体构图',
    top_text_bottom_data: '旧版上文下主体构图',
    center_info_board: '旧版居中信息构图',
    split_columns: '旧版左右分栏构图',
    full_title: '旧版大标题构图'
  }, '未指定旧版构图');
  const titlePosition = label(component.titlePosition, {
    top_left: '画面左上安全区',
    top_center: '画面上方居中安全区',
    top_right: '画面右上安全区',
    middle_left: '画面左侧中部安全区',
    middle_center: '画面正中央安全区',
    middle_right: '画面右侧中部安全区'
  }, '由旧版构图确定标题 / 副标题位置');
  const subjectPlacement = label(component.subjectPlacement, {
    left: '画面左侧主体区',
    right: '画面右侧主体区',
    center: '画面中央主体区',
    bottom_full: '画面中下部至底部的满幅主体区'
  }, '由旧版构图确定主体位置');
  const background = label(component.backgroundStructure, {
    solid_full_bleed: '单一主色覆盖整个画幅，不切出大面积无关背景面',
    subtle_pattern_full_bleed: '主色全幅铺满，并使用同色系低对比菱形或斜格暗纹作为背景纹理',
    left_right_blocks: '按左右分区设置明确但协调的色块背景',
    top_bottom_blocks: '按上下分区设置明确但协调的色块背景',
    curved_split: '使用大弧形色块分区承托标题、主体或底部卖点，弧面流畅且不切割文字',
    motion_swoosh: '使用斜向或弧形动势飘带贯穿画面，形成从标题到主体的视觉动线，飘带不可遮挡正式文案',
    inset_info_panel: '背景中嵌入轮廓清晰的信息板，文字仅位于信息板内',
    stage_curtain: '使用舞台帷幕式层次背景，中央舞台区域保持文字清晰'
  }, '背景结构与信息区保持一致');
  const backgroundPosition = Math.max(20, Math.min(80, Number(component.backgroundPosition) || 60));
  const backgroundPositionInstruction = component.backgroundStructure === 'solid_full_bleed'
    ? '纯色满版不设置分区起点'
    : `背景结构的视觉分区起点位于画幅 ${backgroundPosition}% 处，色块、弧带或暗纹必须围绕该位置组织，不得遮挡标题和卖点`;
  const titleLayout = label(component.titleLayout, {
    single_line: '主标题仅排为一行',
    two_line_stack: '主标题按语义排为上下两行',
    three_line_steps: '主标题按语义排为三行阶梯式结构',
    english_top_chinese_two_lines: '如主标题含英文和中文，英文必须独立位于第一行，中文按语义拆为第二、第三行；不得压缩成两行或混排',
    vertical_stack: '主标题采用纵向层叠排版，逐行清晰可读'
  }, '主标题按语义分行，层级明确');
  const titleColor = label(component.titleColorTreatment, {
    unified_color: '所有标题行使用统一主色，保持一致的立体或描边效果',
    primary_secondary: '标题主副层级使用主色与辅助色区分',
    first_last_accent: '标题首行和末行使用辅助强调色，中间行使用高对比浅色文字；所有标题行保持一致的硬质侧边或挤出层级',
    white_dark_side: '标题文字为白色，带深色硬质侧边或挤出阴影',
    gold_dark_red_side: '标题文字为金色，带暗红色硬质侧边或挤出阴影'
  }, '标题各行配色必须服务于层级');
  const titleContainer = label(component.titleContainer, {
    none: '标题直接置于背景上，不额外使用承托容器',
    rounded_panel: '标题置于单一圆角信息牌内，容器边缘清晰、留出充足内边距',
    irregular_badge_panel: '标题置于不规则徽章式深色标题牌内，外轮廓圆润，标题牌不可伪装成真实品牌徽章'
  }, '标题容器仅承担信息承托，不生成品牌或认证内容');
  const informationHierarchy = label(config.bodyTypographyConfig?.bodyHierarchy, {
    single_level: '仅保留一层核心说明，避免出现第二套同权重标题',
    headline_plus_detail: '主标题最大，副标题或说明紧随其后，卖点与说明明确降级',
    numbered_modules: '标题外使用等权编号模块组织信息，每个模块的数字或序号优先于说明文字',
    tagged_benefits: '卖点以短标签或徽章化词组组织，标签间距一致且易于扫读',
    headline_metric_row: '主标题后接一整行数字指标，数字显著大于指标说明，所有指标对齐',
    headline_module_row: '主标题后接等宽模块卖点行，每个模块只承载一个短卖点，模块层级一致',
    headline_promise_strip: '主标题后接一条简短承诺或适用范围条，承诺条弱于标题但高于底部卖点'
  }, '主标题、说明与卖点必须形成明确的三级阅读顺序');
  const subjectCrop = label(component.personPlacement, {
    left_half: '主体以半身裁切呈现',
    right_half: '主体以半身裁切呈现',
    left_full: '主体以全身呈现',
    right_full: '主体以全身呈现',
    center_single: '单一主体以全身或核心物体呈现',
    center_group: '主体以中心群像呈现',
    none: '不生成任何人物、角色或人物剪影'
  }, '主体裁切服务于已选择的主体位置');
  const sellingPlacement = label(component.sellingPlacement, {
    under_title: '卖点组件紧接在标题下方',
    bottom: '卖点组件位于画面底部的主信息区',
    bottom_arc: '卖点组件沿画面底部弧带排布',
    footer_swoosh: '卖点组件沿底部斜切或弧形飘带排布，飘带从一侧进入并在另一侧收束',
    bottom_data_bar: '卖点组件位于底部横向数据条内',
    side_rail: '卖点组件沿左右一侧的垂直侧栏排布',
    none: '不生成卖点组件或空白卖点卡'
  }, '卖点组件位于独立且不遮挡标题的位置');
  const sellingStyle = label(component.sellingStyle, {
    short_phrase_row: '卖点以短句横向并排呈现，无卡片、无图标；使用中点、竖线或留白分隔',
    rounded_capsules: '每条卖点使用同尺寸圆角胶囊承载，纯文字，不添加 icon；胶囊内边距一致',
    three_column_ribbon: '卖点使用三栏并列标签条承载，每栏包含一条短卖点，使用细竖线或留白分隔，不添加 icon',
    promise_strip_columns: '先用一条横向承诺短条承载课程范围或核心价值，再在其下方并列三栏短卖点；承诺条比底栏更醒目',
    split_metric_bar: '卖点置于连续的底部横向数据条中，按数量均分，每项由大数字、单位和两行以内说明组成，使用细竖线分隔，不使用独立卡片',
    equal_data_cards: '每条卖点使用等宽矩形数据卡承载；数字最大，单位紧贴数字，说明置于下方，卡片间距和高度一致',
    icon_number_cards: '每条卖点使用图标加大数字的信息卡承载；图标表达课程事实，数字大于说明，所有图标统一风格与尺寸',
    icon_number_pills: '每条卖点使用白底或浅色圆角数字胶囊承载；左侧或上方放简洁图标，数字高对比突出，说明紧随数字',
    centered_number_cluster: '所有卖点置于同一个中心信息板内，以两行或三行对齐的数字簇呈现；数字上大下小，说明置于数字下方，无独立卡片',
    grid_paper_metric_cards: '底部使用浅色方格纸信息带，卖点为红色或深色大数字加黑色说明，模块间由细线或花括号分隔',
    laurel_medallions: '每条卖点使用完整圆形月桂圆章承载，月桂围合文字，圆章尺寸与间距一致，适合三项权威卖点',
    laurel_stat_row: '每条卖点使用左右分开的月桂枝承托大数字，中心不做封闭圆章；数字最大，说明位于下方，适合四至五项数据',
    window_modules: '卖点以四个或五个等宽场景窗口呈现；每个窗口含一幅统一画风的小场景或图形，下方仅放一个模块短标题'
  }, '卖点使用统一组件样式承载');
  const sellingArrangement = label(component.sellingArrangement, {
    columns: '所有卖点必须按当前条数横向等宽分栏：三条为三栏、四条为四栏；每条独立占位，不得合并为一段文字',
    grid: '卖点按横向分行排列，每行最多两栏；每条独立占位，行列间距一致',
    row: '所有卖点拆分为横向等距分栏，每条独立占位',
    stack: '卖点拆分为纵向列表，每条独立成行，不合并为大段文字'
  }, '所有卖点按当前条数横向等宽分栏，每条独立占位');
  const countInstruction = `卖点组件数量严格等于当前 ${points.length} 条卖点的行数，每条卖点各占一个组件，不得合并、遗漏或编造。`;
  const hardLayout = `【版式】${draggedLayout}；标题${titleLayout}、${titleColor}；主体${subjectPlacement}、${subjectCrop}；背景${background}，分区${backgroundPosition}%；卖点${sellingPlacement}、${sellingStyle}、${sellingArrangement}，严格${points.length}条。\n【留白与文字安全区，硬性条件】主视觉主体四周至少保留其宽度 8% 的呼吸余量，余量必须连续使用相邻背景的同色系、同纹理、同光感，不得改成白边、边框或额外色块；所有正式文字距画幅边缘至少 6%，标题、副标题与卖点组件彼此至少保留 1.5 个字高的净空；每个卖点组件内边距不少于组件高度的 14%，不得贴边、拥挤、互相遮挡或被裁切。`;
  const stylesWithIcons = new Set(['icon_number_cards', 'icon_number_pills', 'window_modules']);
  const negative = [
    '不得改写、遗漏或编造已确认文案',
    '不得添加已确认文案以外的文字、数字、英文或认证标签',
    '徽章预留区必须延续周围背景风格与颜色，不添加独立色块、白底、底牌、认证章、飘带或Logo',
    !stylesWithIcons.has(component.sellingStyle) ? '卖点不加图标' : '',
    component.sellingStyle === 'laurel_medallions' ? '月桂圆章不换成卡片' : '',
    component.sellingStyle === 'split_metric_bar' ? '连续数据条不拆成卡片' : '',
    component.personPlacement === 'none' ? '不生成人物' : '',
    component.sellingPlacement === 'none' ? '不生成卖点组件' : ''
  ].filter(Boolean).join('；');
  return { hardLayout, negative };
}

function promptModules(demand, materialType, edits = {}) {
  const facts = demand.projectFacts || {};
  const config = demand.visualConfig || {};
  const illustration = config.illustrationConfig || {};
  const decoration = config.decorationConfig || {};
  const photoSubject = illustration.assetType === 'teacher_photo' || illustration.subjectType === 'teacher_photo';
  const colorLabels = {
    red: '珊瑚红 #FF4D4F', deep_red: '明快绯红 #E53935', orange: '活力橙 #FF8A34', yellow: '明黄 #FFC83D', green: '薄荷绿 #32B768', cyan: '清透湖蓝 #22B8CF', blue: '互联网蓝 #2F80ED', navy: '亮学院蓝 #1D5FD1', purple: '活力紫 #7B61FF',
    white: '白色', champagne_gold: '亮香槟金 #E6B85C', silver: '亮银灰 #B8C4D6', black_gold: '深墨黑配亮金点缀', white_gold: '白金', none: '自动推荐高明度辅助色，与主色形成清晰对比'
  };
  const visualPreferenceLabels = {
    playful_lively: '童趣活泼', growth_motivation: '成长激励', professional_reliable: '专业可信', exploration_thinking: '探索思考',
    promo_burst: '促销爆点：高对比、强动势、信息直给', course_launch: '新课首发：新品感、主标题优先、重点聚焦',
    live_conversion: '直播转化：讲师可信度、数据卖点、即时决策感', authority_premium: '权威高端：体系感、品质感、克制留白'
  };
  const marketingIntensityLabels = {
    none: '无营销感：课程内容优先，版式克制，不额外制造促销氛围',
    low: '弱营销感：以轻量色彩对比和卖点层级强调课程优势',
    medium: '中营销感：标题与卖点对比更强、视觉动线更明确，但保持专业可读',
    high: '强营销感：高对比、大标题、强动势与卖点优先，用于强化转化注意力'
  };
  const titleStyleLabels = { rounded_playful: '圆润童趣粗体', block_building: '粗圆积木标题', geometric_modern: '超粗几何黑体', condensed_speed: '窄体冲刺标题', scholarly_culture: '书卷文化标题', inflated_3d: '圆润立体膨胀标题' };
  const titleWeightLabels = { regular: '常规字重', medium: '中等字重', bold: '粗体', extra_bold: '特粗字重', black: '超粗字重' };
  const illustrationStyleLabels = {
    flat_geometric: '明亮扁平几何插画', picture_book: '高明度绘本插画', three_d_toy_render: '高品质明亮 3D 玩具渲染', watercolor: '明亮水彩插画', graphic_poster: '高对比海报图形', photographic_portrait: '清晰自然的授权讲师肖像',
    chinese_ink_wash: '国风水墨插画：宣纸肌理、墨色层次、写意笔触与克制留白'
  };
  const subjectTypeLabels = { none: '不设置主体', learning_tools: '书本、文具等学习工具', subject_symbols: '几何、字母、学科符号', nature_exploration: '学习探索场景', abstract_graphics: '抽象图形主体', teacher_photo: '授权讲师肖像' };
  const coverElementLabels = {
    none: '不额外添加封面元素',
    page_turn: '翻页书页：作为轻量学习氛围元素，展示翻开的书页或纸张翻页动势',
    envelope_letter: '信封信笺：作为轻量信息传递元素，展示简洁信封、信笺或封蜡意象',
    travel_suitcase: '旅行行李箱：作为轻量探索主题元素，展示简洁旅行箱或行李牌意象',
    film_playback: '胶片播放：作为视频课程主题元素，展示胶片边框或播放符号',
    ticket_stub: '车票票券：作为学习旅程主题元素，展示通用票券或登车牌意象',
    unrolled_scroll: '展开画卷：作为文化课程主题元素，展示展开卷轴或纸卷意象'
  };
  const colorLabel = (value, customValue) => value === 'custom' ? `自定义色 ${customValue || ''}`.trim() : colorLabels[value] || value || '未指定';
  const points = Array.isArray(facts.sellingPoints) ? facts.sellingPoints.map(item => typeof item === 'string' ? item : item?.text).filter(Boolean) : String(demand.selling || '').split(/\n+/).map(item => item.trim()).filter(Boolean);
  const confirmedCopy = [
    `主标题：${edits.title || facts.headline || demand.title || ''}`,
    `副标题：${edits.subtitle || facts.subtitle || demand.subtitle || '无'}`,
    `年级/册别标签：${edits.grade || facts.levelLabel || edits.extraInfo || '无'}`,
    `卖点：${edits.selling || points.join('；') || '无'}`
  ].join('；');
  const spec = canvasSpec(edits.canvasSpec || demand.materialCanvasSpecs?.[materialType] || demand.canvasSpec || edits.ratio || demand.ratio || '7:10');
  const blueprint = config.presetConfig?.promptBlueprint;
  const visual = [
    `【定位】${visualPreferenceLabels[config.audienceConfig?.visualPreference] || '教育课程风格'}，${marketingIntensityLabels[config.audienceConfig?.marketingIntensity] || marketingIntensityLabels.none}`,
    `【画幅】${spec.ratio}，完整安全边距`,
    `【字体】${titleStyleLabels[config.titleTypographyConfig?.titleStyle] || '现代粗体'}，${titleWeightLabels[config.titleTypographyConfig?.titleWeight] || '粗体'}`,
    `【配色】${colorLabel(config.colorConfig?.primaryColor, config.colorConfig?.primaryCustomColor)} + ${colorLabel(config.colorConfig?.secondaryColor, config.colorConfig?.secondaryCustomColor)}，高明度高对比`,
    `【主体】${illustrationStyleLabels[illustration.illustrationStyle] || '明亮图形插画'}，${subjectTypeLabels[illustration.subjectType] || '学习元素'}${photoSubject ? '；仅一个授权真人讲师' : ''}`,
    decoration.coverElement && decoration.coverElement !== 'none' ? `【装饰】${coverElementLabels[decoration.coverElement]}` : '',
    blueprint?.layout ? `【案例结构】${blueprint.layout}` : ''
  ].filter(Boolean).join('\n');
  const basePositive = materialType === '主视觉' ? mainVisualBasePositive : materialBasePositive;
  const rawDetail = edits.designNote || demand.designNote || demand.constraints?.freeformDesignNote || '';
  const detail = rawDetail === config.presetConfig?.caseGuidance ? '' : rawDetail;
  const badgePosition = demand.textRenderConfig?.previewPositions?.previewBadge || { left: 76, top: 6 };
  const hasBadge = Boolean(demand.assetBindings?.badgeAssetId || demand.assetBindings?.badgeTwoAssetId);
  const badgeInstruction = hasBadge
    ? `【徽章后置】徽章由系统后置叠加；在画幅 ${Math.round(Number(badgePosition.left) || 76)}%,${Math.round(Number(badgePosition.top) || 6)}% 处仅预留无文字、无图标的干净位置，位置必须自然延续周围背景的颜色、纹理、光感和视觉风格，不得额外添加色块、白底、底牌、边框、阴影、认证章、飘带或任何替代装饰。`
    : '';
  const hasIpReference = Boolean(demand.assetBindings?.ipAssetId);
  const referenceInstruction = hasIpReference
    ? '【主体参考图，硬性条件】输入的画幅预览中已包含上传 IP。必须保留该 IP 的物种、脸型、五官比例、毛色、服装、帽子、姿态和材质特征，不得替换成其他动物、角色或通用卡通形象。'
    : '';
  return { confirmedCopy, visual, detail, badgeInstruction, referenceInstruction, canvasSpec: spec, basePositive, baseNegative: commonNegativePrompt, ...layoutComponentModules(config, points, demand.textRenderConfig?.previewPositions || {}) };
}

function appendPromptModules(prompt, modules) {
  return [
    `【文案】${modules.confirmedCopy}`,
    '【文字白名单】画面只允许出现【文案】中逐字提供的中文、数字和英文；除此之外不出现任何标题、口号、课程名、认证、标签、数字、英文、Logo、水印或装饰文字。',
    `【画面基调】${modules.basePositive}`,
    modules.visual,
    modules.hardLayout,
    modules.badgeInstruction,
    modules.referenceInstruction,
    modules.detail ? `【补充】${modules.detail}` : '',
    prompt
  ].filter(Boolean).join('\n');
}

function compactNegativePrompt(...parts) {
  const unique = [...new Set(parts.join('；').split(/[；。\n]/).map(item => item.trim()).filter(Boolean))];
  return unique.slice(0, 14).join('；').slice(0, 280);
}

function sanitizeStyleProfile(result) {
  return {
    palette: Array.isArray(result.palette) && result.palette.length ? result.palette.map(String).slice(0, 5) : ['#f7dd55', '#ff9f2f', '#246bfe', '#19395e'],
    titleTone: String(result.titleTone || '圆润、醒目、具有闯关感'),
    coreElements: String(result.coreElements || '书本、学习路径、星星、暑期图形'),
    spacing: String(result.spacing || '标题上方，插画居中，卖点置底'),
    avoid: String(result.avoid || '复杂背景、深色压抑画面、无授权 IP')
  };
}

function publicVisual(row) {
  const revision = currentDesignRevision(row.project_id);
  const isCurrentRevision = Number(row.design_revision || 0) === revision;
  return { id: row.id, promptId: row.prompt_id, candidateIndex: row.candidate_index, materialType: row.material_type || '主视觉', status: row.status, isConfirmed: Boolean(row.is_confirmed), parentVisualId: row.parent_visual_id, variantLabel: row.variant_label || '', isReferenceCandidate: Boolean(row.is_reference_candidate), designRevision: Number(row.design_revision || 0), isCurrentRevision, isStale: !isCurrentRevision || Boolean(row.stale_reason), staleReason: row.stale_reason || (!isCurrentRevision ? '需求已更新' : ''), createdAt: row.created_at, imageUrl: `/uploads/${row.storage_name}` };
}

async function persistImage(result, jobId, index) {
  const item = result?.data?.[0];
  if (!item) throw new Error('图像模型未返回图片数据。');
  let bytes;
  if (item.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
  else if (item.url) {
    const imageResponse = await fetchWithTimeout(item.url, {}, Number(process.env.CCPROXY_IMAGE_DOWNLOAD_TIMEOUT_MS || 30000), '图片下载');
    if (!imageResponse.ok) throw providerFailure('图片下载', imageResponse.status, await imageResponse.text());
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  } else throw new Error('图像模型返回格式不受支持。');
  const storageName = `${jobId}-${index}.png`;
  await writeFile(join(uploadDir, storageName), bytes);
  return storageName;
}

async function normalizeGeneratedImage(storageName, size) {
  const target = String(size || '').match(/^(\d{2,5})x(\d{2,5})$/);
  if (!target) return;
  const [targetWidth, targetHeight] = target.slice(1).map(Number);
  const source = join(uploadDir, storageName);
  const inspect = (await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', source])).stdout;
  const width = Number(inspect.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(inspect.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error('无法识别图像服务返回的尺寸。');
  if (width === targetWidth && height === targetHeight) return;
  const normalized = join(uploadDir, `${storageName}.normalized.png`);
  try {
    // Preserve the full provider image while matching the approved print ratio.
    // This avoids both crop loss and letterbox borders when native model ratios differ.
    await execFileAsync('sips', ['--resampleHeightWidth', String(targetHeight), String(targetWidth), source, '--out', normalized]);
    await rename(normalized, source);
  } finally {
    await unlink(normalized).catch(() => {});
  }
}

function imageTimeoutMs() { return Number(process.env.CCPROXY_IMAGE_TIMEOUT_MS || 180000); }

async function requestGeneratedImage({ projectId, prompt, model, apiKey, parentVisualId = null, jobId = null }) {
  if (!apiKey) throw new Error('未配置 API Key。请在 .env 中填写 CCPROXY_API_KEY 后重启服务。');
  const requestedSize = String(prompt.size || '');
  if (!/^\d{3,5}x\d{3,5}$/.test(requestedSize)) throw badRequest('缺少与当前设计画幅一致的模型生成尺寸。');
  const storedIds = Array.isArray(prompt.referenceAssetIds) ? prompt.referenceAssetIds : [];
  // The canvas preview anchors text regions and composition; pair it with the
  // IP/style references so edit generation can preserve both layout and subject.
  const currentIds = currentReferenceAssets(projectId, ['画幅预览', 'IP 参考', 'overall_style', 'layout', 'illustration', 'palette']).map(asset => asset.id);
  // A prompt owns its reference list. Later uploads must not silently rewrite
  // a queued generation, while deleted files naturally drop out on lookup.
  // Keep older Prompt versions compatible: before preview references were
  // persisted, their saved list only contained the subject/style image.
  const previewIds = currentReferenceAssets(projectId, ['画幅预览']).map(asset => asset.id);
  const referenceIds = storedIds.length ? [...new Set([...previewIds, ...storedIds])] : currentIds;
  const references = await loadReferenceAssets(projectId, referenceIds.slice(0, maxImageReferences));
  const visualIds = [...new Set([...(Array.isArray(prompt.referenceVisualIds) ? prompt.referenceVisualIds : []), parentVisualId].filter(Boolean))].slice(0, 4);
  for (const visualId of visualIds.reverse()) {
    const parent = db.prepare('SELECT * FROM visual_versions WHERE id = ? AND project_id = ? AND is_confirmed = 1').get(visualId, projectId);
    if (parent) references.unshift({ fileName: `${parent.material_type || '物料'}-已确认版.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${(await readFile(join(uploadDir, parent.storage_name))).toString('base64')}` });
  }
  references.splice(maxImageReferences);
  if (references.length) {
    // Several compatible providers silently consume only the final multipart
    // file. The saved preview is a flattened, single source of truth: it
    // contains the placed IP, official copy zones and composition together.
    const previewReference = references.filter(asset => asset.role === '画幅预览').slice(0, 1);
    const ipReference = references.filter(asset => asset.role === 'IP 参考').slice(0, 1);
    const editReferences = previewReference.length ? previewReference : (ipReference.length ? ipReference : references.slice(0, 1));
    const editWithField = async imageField => {
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt.positivePrompt);
      form.set('size', requestedSize);
      form.set('n', '1');
      form.set('response_format', 'b64_json');
      form.set('input_fidelity', process.env.CCPROXY_IMAGE_INPUT_FIDELITY || 'high');
      for (const reference of editReferences) {
        const base64 = reference.dataUrl.split(',')[1];
        form.append(imageField, new Blob([Buffer.from(base64, 'base64')], { type: reference.mimeType }), reference.fileName);
      }
      return fetchWithTimeout(providerUrl('/images/edits'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form }, imageTimeoutMs(), '引用参考图生成');
    };
    // Compatible image services disagree on whether repeated files use image[]
    // or image. Try both before any text-only fallback, preserving references.
    const configuredField = process.env.CCPROXY_EDIT_IMAGE_FIELD;
    const imageFields = configuredField ? [configuredField] : ['image[]', 'image'];
    logHistory(projectId, 'image_job_reference_source', '使用单张画幅参考图生成', { jobId, sourceRoles: editReferences.map(asset => asset.role), availableRoles: references.map(asset => asset.role) });
    let lastError = null;
    for (let index = 0; index < imageFields.length; index += 1) {
      const editResponse = await editWithField(imageFields[index]);
      if (editResponse.ok) return editResponse;
      lastError = providerFailure('引用参考图生成', editResponse.status, await editResponse.text());
      // A safety rejection applies to the edit request's input image, not
      // necessarily to the approved project copy. Preserve the job by using
      // the final text prompt in the regular generation endpoint instead.
      if (editResponse.status < 500 && editResponse.status !== 400) throw lastError;
      if (index < imageFields.length - 1 && jobId) db.prepare('UPDATE image_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
        .run('生成中', '正在切换参考图兼容模式，继续保留画幅预览与主体参考图。', now(), jobId);
    }
    if (jobId) db.prepare('UPDATE image_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
      .run('生成中', lastError?.providerStatus === 400 ? '参考图编辑未通过审核，已保留文案与版式约束并改用稳定生成模式。' : '参考图编辑服务暂不可用，已改用稳定生成模式。', now(), jobId);
    logHistory(projectId, 'image_job_fallback', lastError?.providerStatus === 400 ? '参考图编辑审核未通过，改用普通生成' : '参考图编辑失败，改用普通生成', { jobId, providerStatus: lastError?.providerStatus || 0 });
  }
  return fetchWithTimeout(providerUrl('/images/generations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt: prompt.positivePrompt, size: requestedSize, n: 1, response_format: 'b64_json' })
  }, imageTimeoutMs(), '图像模型调用');
}

async function runImageJob(jobId) {
  const job = db.prepare('SELECT * FROM image_jobs WHERE id = ?').get(jobId);
  if (!job) return;
  try {
    const promptRow = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(job.prompt_id);
    if (!promptRow) throw new Error('找不到本次生成使用的 Prompt 版本。');
    const prompt = parse(promptRow.content, {});
    const activeCanvasSpec = canvasSpec(prompt.canvasSpec || '7:10');
    prompt.canvasSpec = activeCanvasSpec;
    prompt.size = modelSizeForCanvas(activeCanvasSpec);
    db.prepare('UPDATE image_jobs SET status = ?, updated_at = ? WHERE id = ?').run('生成中', now(), jobId);
    logHistory(job.project_id, 'image_job_started', `开始生成${job.material_type || '主视觉'}`, { jobId, promptId: job.prompt_id, materialType: job.material_type || '主视觉' });
    const apiKey = process.env.CCPROXY_API_KEY;
    const model = process.env.CCPROXY_IMAGE_MODEL || 'gpt-image-2';
    for (let index = 1; index <= job.requested_count; index += 1) {
      let response;
      let finalError;
      // Keep the interaction responsive. Capacity failures are surfaced after
      // two short retries so the designer can retry instead of waiting minutes.
      const retryDelays = [0, 6_000, 18_000];
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (retryDelays[attempt]) {
          const delay = retryDelays[attempt] + Math.round(Math.random() * 5_000);
          const seconds = Math.round(delay / 1000);
          db.prepare('UPDATE image_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
            .run('等待资源', `图片服务资源紧张，${seconds} 秒后自动重试（${attempt}/${retryDelays.length - 1}）。`, now(), jobId);
          await sleep(delay);
          db.prepare('UPDATE image_jobs SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?').run('生成中', now(), jobId);
        }
        try {
          response = await requestGeneratedImage({ projectId: job.project_id, prompt, model, apiKey, parentVisualId: job.parent_visual_id, jobId });
          if (!response.ok) throw providerFailure('图像模型调用', response.status, await response.text());
          finalError = null;
          break;
        } catch (error) {
          finalError = error;
          if (!error.retryable || attempt === retryDelays.length - 1) break;
        }
      }
      if (finalError || !response) throw finalError || new Error('图像服务没有返回结果。');
      const result = await response.json();
      const storageName = await persistImage(result, jobId, index);
      await normalizeGeneratedImage(storageName, activeCanvasSpec.exportSize);
      const visualId = id('visual');
      const isCurrentRevision = Number(job.design_revision || 0) === currentDesignRevision(job.project_id);
      db.prepare('INSERT INTO visual_versions (id, project_id, job_id, prompt_id, parent_visual_id, material_type, candidate_index, storage_name, status, design_revision, stale_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(visualId, job.project_id, jobId, job.prompt_id, job.parent_visual_id, job.material_type || '主视觉', index, storageName, isCurrentRevision ? '待确认' : '需求已更新，历史版本', Number(job.design_revision || 0), isCurrentRevision ? null : '需求已更新', now());
      db.prepare('UPDATE image_jobs SET completed_count = ?, provider_usage = ?, updated_at = ? WHERE id = ?')
        .run(index, json(result.usage || {}), now(), jobId);
    }
    db.prepare('UPDATE image_jobs SET status = ?, updated_at = ? WHERE id = ?').run('已完成', now(), jobId);
    logHistory(job.project_id, 'image_job_completed', `${job.material_type || '主视觉'}生成完成`, { jobId, count: job.requested_count, materialType: job.material_type || '主视觉' });
  } catch (error) {
    db.prepare('UPDATE image_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?').run('失败', error.message, now(), jobId);
    logHistory(job.project_id, 'image_job_failed', '主视觉生成失败', { jobId, error: error.message });
  }
}

function projectState(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const demand = latestDemand(projectId);
  const proposals = db.prepare('SELECT * FROM proposal_versions WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(row => ({ ...row, content: parse(row.content, {}) }));
  const revision = currentDesignRevision(projectId);
  const prompts = db.prepare('SELECT * FROM prompt_versions WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(row => ({ id: row.id, proposalId: row.proposal_id, parentVisualId: row.parent_visual_id, materialType: row.material_type || '主视觉', designRevision: Number(row.design_revision || 0), isCurrentRevision: Number(row.design_revision || 0) === revision, createdAt: row.created_at, content: parse(row.content, {}) }));
  const assets = currentReferenceAssets(projectId).map(row => ({ id: row.id, fileName: row.file_name, role: row.role, authorized: Boolean(row.authorized), url: `/uploads/${row.storage_name}` }));
  const jobs = db.prepare('SELECT * FROM image_jobs WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(row => ({ ...row, designRevision: Number(row.design_revision || 0), isCurrentRevision: Number(row.design_revision || 0) === revision, provider_usage: parse(row.provider_usage, {}) }));
  const visuals = db.prepare('SELECT * FROM visual_versions WHERE project_id = ? ORDER BY created_at DESC, candidate_index ASC').all(projectId).map(publicVisual);
  const styleProfile = db.prepare('SELECT * FROM style_profiles WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
  const badgeSettings = db.prepare('SELECT * FROM badge_settings WHERE project_id = ?').get(projectId);
  const materialBriefs = db.prepare('SELECT * FROM material_briefs WHERE project_id = ? ORDER BY sort_order, created_at').all(projectId)
    .map(row => ({ id: row.id, materialType: row.material_type, displayName: row.display_name, sortOrder: row.sort_order, payload: parse(row.payload, {}), createdAt: row.created_at, updatedAt: row.updated_at }));
  return { project: { ...project, designRevision: revision }, demand, proposals, prompts, assets, jobs, visuals, materialBriefs, styleProfile: styleProfile ? { ...styleProfile, content: parse(styleProfile.content, {}) } : null, badgeSettings: badgeSettings || null };
}

async function apiHandler(request, response, pathname) {
  const proposalMatch = pathname.match(/^\/api\/projects\/([^/]+)\/history$/);
  const stateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/state$/);
  const jobMatch = pathname.match(/^\/api\/image-jobs\/([^/]+)$/);
  const feedbackMatch = pathname.match(/^\/api\/visual-versions\/([^/]+)\/feedback$/);
  const confirmMatch = pathname.match(/^\/api\/visual-versions\/([^/]+)\/confirm$/);
  const variantMatch = pathname.match(/^\/api\/visual-versions\/([^/]+)\/variant$/);
  const badgeSettingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/badge-settings$/);
  const badgeLayoutMatch = pathname.match(/^\/api\/projects\/([^/]+)\/badge-layout$/);
  const proposalUpdateMatch = pathname.match(/^\/api\/proposal-versions\/([^/]+)$/);
  const promptUpdateMatch = pathname.match(/^\/api\/prompt-versions\/([^/]+)$/);
  const referenceAssetMatch = pathname.match(/^\/api\/assets\/reference\/([^/]+)$/);
  const materialBriefMatch = pathname.match(/^\/api\/projects\/([^/]+)\/material-briefs\/([^/]+)$/);
  const materialBriefsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/material-briefs$/);
  const presetPublishMatch = pathname.match(/^\/api\/projects\/([^/]+)\/presets$/);
  const presetSimulationMatch = pathname.match(/^\/api\/presets\/([^/]+)\/simulation$/);

  if (request.method === 'GET' && pathname === '/api/health') {
    return send(response, 200, { ok: true, apiKeyConfigured: Boolean(process.env.CCPROXY_API_KEY), imageModel: process.env.CCPROXY_IMAGE_MODEL || 'gpt-image-2', editImageField: process.env.CCPROXY_EDIT_IMAGE_FIELD || 'image[]' });
  }
  if (request.method === 'GET' && pathname === '/api/skills/prompt') {
    return send(response, 200, {
      skills: [
        { id: 'main_visual', name: '主视觉 Prompt Skill', description: '用于礼盒主视觉，要求模型完整生成当前项目的正式文字与图像结构。', content: promptSkill },
        { id: 'material_extension', name: '系列延展物料 Prompt Skill', description: '用于主书、练习册等延展物料，保持系列感但降低视觉等级并重组版式。', content: materialPromptSkill }
      ]
    });
  }
  if (request.method === 'GET' && pathname === '/api/presets') {
    const presets = db.prepare("SELECT * FROM published_presets ORDER BY CASE WHEN source_project_id = 'built-in-case-library' THEN 0 ELSE 1 END, source_visual_id, created_at DESC").all().map(row => ({
      id: row.id, name: row.name, sourceProjectId: row.source_project_id, sourceVisualId: row.source_visual_id,
      coverUrl: `/uploads/${row.cover_storage_name}`, canvasSpec: parse(row.canvas_spec, {}), visualConfig: parse(row.visual_config, {}),
      previewPositions: parse(row.preview_positions, {}), materialSettings: parse(row.material_settings, []), publishedAt: row.created_at
    }));
    return send(response, 200, { presets });
  }
  if (request.method === 'GET' && presetSimulationMatch) {
    const row = db.prepare('SELECT * FROM published_presets WHERE id = ?').get(presetSimulationMatch[1]);
    if (!row) throw notFound('预设不存在。');
    const visualConfig = parse(row.visual_config, {});
    const previewPositions = parse(row.preview_positions, {});
    const sampleDemand = {
      title: '示例课程主标题',
      subtitle: '示例副标题与课程价值',
      canvasSpec: parse(row.canvas_spec, {}),
      textRenderConfig: { previewPositions },
      projectFacts: {
        headline: '示例课程主标题',
        subtitle: '示例副标题与课程价值',
        levelLabel: '适用年级',
        sellingPoints: ['核心课程体系', '名师带学服务', '学习效果提升']
      },
      visualConfig
    };
    const modules = promptModules(sampleDemand, '主视觉');
    const modelSupplement = '使用原创且与课程主题相关的学习元素，保持主标题最醒目、主体与卖点不互相遮挡，画面清爽有秩序。';
    return send(response, 200, {
      preset: { id: row.id, name: row.name, canvasSpec: sampleDemand.canvasSpec, category: visualConfig.presetConfig?.caseCategory || '' },
      simulation: {
        positivePrompt: appendPromptModules(modelSupplement, modules),
        negativePrompt: compactNegativePrompt(commonNegativePrompt, modules.negative),
        modules: { confirmedCopy: modules.confirmedCopy, visual: modules.visual, layout: modules.hardLayout }
      }
    });
  }
  if (request.method === 'POST' && presetPublishMatch) {
    const body = await readJson(request);
    const projectId = presetPublishMatch[1];
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw badRequest('请填写 1-60 个字的预设名称。');
    const demand = latestDemand(projectId)?.payload;
    if (!demand) return send(response, 404, { error: '项目设计信息不存在。' });
    const selected = body.visualId
      ? db.prepare("SELECT * FROM visual_versions WHERE id = ? AND project_id = ? AND is_confirmed = 1").get(body.visualId, projectId)
      : db.prepare("SELECT * FROM visual_versions WHERE project_id = ? AND material_type = '主视觉' AND is_confirmed = 1 ORDER BY created_at DESC LIMIT 1").get(projectId);
    if (!selected) throw badRequest('请先确认主视觉，或选择一张已确认的视觉作为案例头图。');
    const presetId = id('preset');
    const coverStorageName = `${presetId}.png`;
    const suppliedCover = String(body.coverDataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (suppliedCover) {
      const bytes = Buffer.from(suppliedCover[1], 'base64');
      if (bytes.length > 20 * 1024 * 1024 || !isImageBytes(bytes, 'image/png')) throw badRequest('案例头图合成数据无效。');
      await writeFile(join(uploadDir, coverStorageName), bytes);
    } else {
      await copyFile(join(uploadDir, selected.storage_name), join(uploadDir, coverStorageName));
    }
    const config = demand.visualConfig || {};
    const visualConfig = parse(json(config), {});
    if (visualConfig.illustrationConfig) delete visualConfig.illustrationConfig.ipReferenceUploaded;
    visualConfig.badgeConfig = { badgeMode: config.badgeConfig?.badgeMode === 'overlay_asset' ? 'overlay_asset' : 'reserved_zone' };
    const previewPositions = config.textRenderConfig?.previewPositions || {};
    const materialSettings = materialPresetSettings(db.prepare('SELECT * FROM material_briefs WHERE project_id = ? ORDER BY sort_order, created_at').all(projectId));
    const spec = canvasSpec(demand.canvasSpec || demand.ratio || '7:10');
    db.prepare('INSERT INTO published_presets (id, name, source_project_id, source_visual_id, cover_storage_name, canvas_spec, visual_config, preview_positions, material_settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(presetId, name, projectId, selected.id, coverStorageName, json(spec), json(visualConfig), json(previewPositions), json(materialSettings), now());
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run('已完成，已发布预设', now(), projectId);
    logHistory(projectId, 'preset_published', `发布预设：${name}`, { presetId, visualId: selected.id });
    return send(response, 201, { id: presetId, name, coverUrl: `/uploads/${coverStorageName}`, canvasSpec: spec, publishedAt: now() });
  }

  if (request.method === 'GET' && proposalMatch) {
    const projectId = proposalMatch[1];
    const requestedLimit = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('limit'));
    const limit = Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 50, 200);
    const total = db.prepare('SELECT COUNT(*) AS count FROM history_events WHERE project_id = ?').get(projectId).count;
    const events = db.prepare('SELECT * FROM history_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit).map(row => ({ ...row, payload: parse(row.payload, {}) }));
    return send(response, 200, { events, total, limit });
  }
  if (request.method === 'GET' && stateMatch) {
    const state = projectState(stateMatch[1]);
    return state ? send(response, 200, state) : send(response, 404, { error: '项目不存在' });
  }
  if (request.method === 'POST' && materialBriefsMatch) {
    const body = await readJson(request);
    const projectId = materialBriefsMatch[1];
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) return send(response, 404, { error: '项目不存在' });
    const materialType = String(body.materialType || '').trim();
    const displayName = String(body.displayName || materialType).trim();
    if (!materialType || !displayName) throw badRequest('请填写物料名称。');
    const exists = db.prepare('SELECT id FROM material_briefs WHERE project_id = ? AND material_type = ?').get(projectId, materialType);
    if (exists) return send(response, 409, { error: '该物料已存在。' });
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : db.prepare('SELECT COUNT(*) AS count FROM material_briefs WHERE project_id = ?').get(projectId).count;
    const briefId = id('material');
    const payload = applyCanvasSpec({ title: '', subtitle: '', grade: '', selling: '', extraInfo: '', designNote: '', ratio: '7:10', badgePosition: '右上角', sourceVisualId: null, ...(body.payload || {}) });
    db.prepare('INSERT INTO material_briefs (id, project_id, material_type, display_name, sort_order, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(briefId, projectId, materialType, displayName, sortOrder, json(payload), now(), now());
    logHistory(projectId, 'material_brief_created', `新增${displayName}物料`, { briefId, materialType });
    return send(response, 201, { id: briefId, materialType, displayName, sortOrder, payload });
  }
  if (request.method === 'PUT' && materialBriefMatch) {
    const body = await readJson(request);
    const [projectId, materialType] = [materialBriefMatch[1], materialBriefMatch[2]];
    const current = db.prepare('SELECT * FROM material_briefs WHERE project_id = ? AND material_type = ?').get(projectId, materialType);
    if (!current) return send(response, 404, { error: '物料草稿不存在。' });
    const payload = applyCanvasSpec({ ...parse(current.payload, {}), ...(body.payload || {}) });
    const displayName = String(body.displayName || current.display_name).trim() || current.display_name;
    db.prepare('UPDATE material_briefs SET display_name = ?, payload = ?, updated_at = ? WHERE id = ?').run(displayName, json(payload), now(), current.id);
    logHistory(projectId, 'material_brief_saved', `保存${displayName}物料信息`, { materialType });
    return send(response, 200, { id: current.id, materialType, displayName, payload });
  }
  if (request.method === 'DELETE' && materialBriefMatch) {
    const [projectId, materialType] = [materialBriefMatch[1], materialBriefMatch[2]];
    const current = db.prepare('SELECT * FROM material_briefs WHERE project_id = ? AND material_type = ?').get(projectId, materialType);
    if (!current) return send(response, 404, { error: '物料不存在。' });
    db.prepare('DELETE FROM material_briefs WHERE id = ?').run(current.id);
    logHistory(projectId, 'material_brief_removed', `移除${current.display_name}物料`, { materialType, displayName: current.display_name, retainedHistory: true });
    return send(response, 200, { materialType, displayName: current.display_name, removed: true, retainedHistory: true });
  }
  if (request.method === 'POST' && pathname === '/api/projects') {
    const body = await readJson(request);
    const demand = body.demand || {};
    if (!String(demand.name || '').trim()) throw badRequest('请填写项目名称。');
    if (!String(demand.title || '').trim()) throw badRequest('请填写主标题。');
    applyCanvasSpec(demand);
    const projectId = id('project');
    ensureProject(projectId, demand);
    // Assets are uploaded immediately after project creation. The following
    // PUT commits copy, layout and those assets as one design revision.
    return send(response, 201, { id: projectId, designRevision: 0 });
  }
  const demandUpdateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/demand$/);
  if (request.method === 'PUT' && demandUpdateMatch) {
    const body = await readJson(request);
    const demand = body.demand || {};
    if (!String(demand.name || '').trim() || !String(demand.title || '').trim()) throw badRequest('请填写主标题。');
    applyCanvasSpec(demand);
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(demandUpdateMatch[1]);
    if (!project) return send(response, 404, { error: '项目不存在' });
    ensureProject(project.id, demand);
    const saved = saveDesignRevision(project.id, demand, '保存需求版本');
    return send(response, 200, { id: project.id, demandSnapshotId: saved.snapshotId, designRevision: saved.revision });
  }
  if (request.method === 'PUT' && badgeLayoutMatch) {
    const projectId = badgeLayoutMatch[1];
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return send(response, 404, { error: '项目不存在' });
    const body = await readJson(request);
    const demand = latestDemand(projectId);
    if (!demand) throw badRequest('请先保存需求。');
    const payload = parse(demand.payload, {});
    const positions = payload.visualConfig?.textRenderConfig?.previewPositions || {};
    const normalizePosition = (value, fallback) => ({
      left: Math.max(0, Math.min(100, Number(value?.left ?? fallback.left))),
      top: Math.max(0, Math.min(100, Number(value?.top ?? fallback.top)))
    });
    payload.visualConfig = payload.visualConfig || {};
    payload.visualConfig.textRenderConfig = payload.visualConfig.textRenderConfig || {};
    payload.visualConfig.textRenderConfig.previewPositions = {
      ...positions,
      previewBadge: normalizePosition(body.previewBadge, positions.previewBadge || { left: 76, top: 6 }),
      previewBadgeTwo: normalizePosition(body.previewBadgeTwo, positions.previewBadgeTwo || { left: 6, top: 76 })
    };
    payload.visualConfig.badgeConfig = {
      ...(payload.visualConfig.badgeConfig || {}),
      previewPosition: payload.visualConfig.textRenderConfig.previewPositions.previewBadge,
      secondPreviewPosition: payload.visualConfig.textRenderConfig.previewPositions.previewBadgeTwo
    };
    // Badge placement is a post-processing setting, not a new visual demand.
    db.prepare('UPDATE demand_snapshots SET payload = ? WHERE id = ?').run(json(payload), demand.id);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
    logHistory(projectId, 'badge_layout_saved', '保存徽章后置叠加位置', payload.visualConfig.textRenderConfig.previewPositions);
    return send(response, 200, { previewPositions: payload.visualConfig.textRenderConfig.previewPositions });
  }
  if (request.method === 'GET' && jobMatch) {
    const job = db.prepare('SELECT * FROM image_jobs WHERE id = ?').get(jobMatch[1]);
    if (!job) return send(response, 404, { error: '生成任务不存在' });
    const visuals = db.prepare('SELECT * FROM visual_versions WHERE job_id = ? ORDER BY candidate_index').all(job.id).map(publicVisual);
    return send(response, 200, { ...job, provider_usage: parse(job.provider_usage, {}), visuals });
  }
  if (request.method === 'PUT' && proposalUpdateMatch) {
    const body = await readJson(request);
    const proposal = db.prepare('SELECT * FROM proposal_versions WHERE id = ?').get(proposalUpdateMatch[1]);
    if (!proposal) throw notFound('方案版本不存在。');
    const content = sanitizeProposal(body.content || {});
    db.prepare('UPDATE proposal_versions SET content = ? WHERE id = ?').run(json(content), proposal.id);
    logHistory(proposal.project_id, 'proposal_updated', '设计师编辑主视觉方案', { proposalId: proposal.id });
    return send(response, 200, { id: proposal.id, content });
  }
  if (request.method === 'PATCH' && promptUpdateMatch) {
    const body = await readJson(request);
    const prompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(promptUpdateMatch[1]);
    if (!prompt) throw notFound('Prompt 版本不存在。');
    const content = sanitizePrompt(body.content || {});
    db.prepare('UPDATE prompt_versions SET content = ? WHERE id = ?').run(json(content), prompt.id);
    logHistory(prompt.project_id, 'prompt_updated', '设计师编辑主视觉 Prompt', { promptId: prompt.id });
    return send(response, 200, { id: prompt.id, content });
  }
  if (request.method === 'POST' && badgeSettingsMatch) {
    const body = await readJson(request);
    const projectId = badgeSettingsMatch[1];
    const asset = body.badgeAssetId ? db.prepare("SELECT * FROM reference_assets WHERE id = ? AND project_id = ? AND role = '徽章'").get(body.badgeAssetId, projectId) : null;
    if (body.badgeAssetId && !asset) throw badRequest('请选择当前项目已上传的徽章图片。');
    const positions = new Set(['左上角', '右上角', '左下角', '右下角']);
    if (!positions.has(body.position)) throw badRequest('徽章位置无效。');
    const sizeRatio = Number(body.sizeRatio);
    const marginRatio = Number(body.marginRatio);
    if (!(sizeRatio >= 0.05 && sizeRatio <= 0.28) || !(marginRatio >= 0 && marginRatio <= 0.15)) throw badRequest('徽章尺寸或边距超出可用范围。');
    db.prepare('INSERT INTO badge_settings (project_id, badge_asset_id, position, size_ratio, margin_ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET badge_asset_id = excluded.badge_asset_id, position = excluded.position, size_ratio = excluded.size_ratio, margin_ratio = excluded.margin_ratio, updated_at = excluded.updated_at')
      .run(projectId, body.badgeAssetId || null, body.position, sizeRatio, marginRatio, now());
    logHistory(projectId, 'badge_settings_saved', '保存徽章位置与尺寸', { badgeAssetId: body.badgeAssetId || null, position: body.position, sizeRatio, marginRatio });
    return send(response, 200, { projectId, badgeAssetId: body.badgeAssetId || null, position: body.position, sizeRatio, marginRatio });
  }
  if (request.method === 'POST' && pathname === '/api/assets/reference') {
    const body = await readJson(request);
    if (!body.projectId || !body.name || !body.dataUrl || !allowedImageTypes.has(body.mimeType)) throw badRequest('请上传 PNG、JPG 或 WebP 格式的参考图。');
    if (!body.authorized) throw badRequest('请确认参考图已授权或可用于本项目。');
    const match = String(body.dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw badRequest('参考图数据格式无效。');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > maxReferenceSize) throw badRequest('单张参考图不能超过 10MB。');
    if (!isImageBytes(bytes, body.mimeType)) throw badRequest('上传文件与声明的图片格式不一致。');
    ensureProject(body.projectId, body.demand || {});
    const assetId = id('asset');
    const extension = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/webp' ? '.webp' : '.png';
    const storageName = `${assetId}${extension}`;
    await writeFile(join(uploadDir, storageName), bytes);
    db.prepare('INSERT INTO reference_assets (id, project_id, file_name, mime_type, byte_size, role, authorized, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(assetId, body.projectId, basename(body.name), body.mimeType, bytes.length, body.role || '风格参考', 1, storageName, now());
    logHistory(body.projectId, 'reference_uploaded', '上传参考图', { assetId, role: body.role || '风格参考' });
    return send(response, 201, { id: assetId, name: basename(body.name), role: body.role || '风格参考', authorized: true, url: `/uploads/${storageName}` });
  }
  if (request.method === 'DELETE' && referenceAssetMatch) {
    const asset = db.prepare('SELECT * FROM reference_assets WHERE id = ?').get(referenceAssetMatch[1]);
    if (!asset) return send(response, 404, { error: '参考图不存在。' });
    if (asset.role === '徽章') {
      db.prepare('UPDATE badge_settings SET badge_asset_id = NULL, updated_at = ? WHERE project_id = ? AND badge_asset_id = ?').run(now(), asset.project_id, asset.id);
      const demand = latestDemand(asset.project_id);
      if (demand) {
        const payload = parse(demand.payload, {});
        const bindings = payload.assetBindings || {};
        if (bindings.badgeAssetId === asset.id) bindings.badgeAssetId = null;
        if (bindings.badgeTwoAssetId === asset.id) bindings.badgeTwoAssetId = null;
        payload.assetBindings = bindings;
        payload.visualConfig = payload.visualConfig || {};
        payload.visualConfig.badgeConfig = {
          ...(payload.visualConfig.badgeConfig || {}),
          assetAuthorization: bindings.badgeAssetId || bindings.badgeTwoAssetId ? 'confirmed' : 'pending',
          secondBadgeUploaded: Boolean(bindings.badgeTwoAssetId)
        };
        // Badge removal only changes the post-processing overlay and must not
        // invalidate existing generated visuals.
        db.prepare('UPDATE demand_snapshots SET payload = ? WHERE id = ?').run(json(payload), demand.id);
      }
    }
    db.prepare('DELETE FROM reference_assets WHERE id = ?').run(asset.id);
    await unlink(join(uploadDir, asset.storage_name)).catch(() => {});
    logHistory(asset.project_id, 'reference_deleted', '删除参考图', { assetId: asset.id, role: asset.role });
    return send(response, 200, { id: asset.id });
  }
  if (request.method === 'POST' && pathname === '/api/agent/proposal') {
    const body = await readJson(request);
    if (!body.projectId || !body.demand) throw badRequest('缺少项目或需求信息。');
    const currentDemand = latestDemand(body.projectId);
    if (!currentDemand) throw badRequest('请先保存需求后再生成 Prompt。');
    const designRevision = currentDesignRevision(body.projectId);
    const demandSnapshotId = currentDemand.id;
    const references = await loadReferenceAssets(body.projectId, body.referenceIds || []);
    const skillDemand = compactDemandForSkill(body.demand);
    const proposal = body.fast === true
      ? quickProposal(body.demand)
      : sanitizeProposal(await callChatJson(proposalSkill, { demand: skillDemand, references: references.map(({ dataUrl, ...asset }) => asset), businessRules: ['低年级语文：明亮、清晰、避免复杂信息', '参考图仅继承风格和排版逻辑'] }, references));
    const proposalId = id('proposal');
    db.prepare('INSERT INTO proposal_versions (id, project_id, demand_snapshot_id, reference_ids, content, design_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(proposalId, body.projectId, demandSnapshotId, json(references.map(item => item.id)), json(proposal), designRevision, now());
    logHistory(body.projectId, 'proposal_created', body.fast === true ? '快速建立主视觉方案上下文' : 'AI 完善主视觉方案', { proposalId, referenceIds: references.map(item => item.id), designRevision });
    return send(response, 201, { id: proposalId, content: proposal, references: references.map(({ dataUrl, ...asset }) => asset) });
  }
  if (request.method === 'POST' && pathname === '/api/agent/prompt') {
    const body = await readJson(request);
    const proposal = db.prepare('SELECT * FROM proposal_versions WHERE id = ?').get(body.proposalId);
    if (!proposal) throw badRequest('请先保存主视觉方案。');
    const designRevision = currentDesignRevision(proposal.project_id);
    if (Number(proposal.design_revision || 0) !== designRevision) throw badRequest('当前需求已更新，请重新生成 Prompt。');
    const proposalContent = parse(proposal.content, {});
    const feedback = body.parentVisualId ? db.prepare('SELECT * FROM feedback_events WHERE visual_id = ? ORDER BY created_at DESC LIMIT 1').get(body.parentVisualId) : null;
    const parentVisualIds = [...new Set((Array.isArray(body.parentVisualIds) ? body.parentVisualIds : [body.parentVisualId]).filter(Boolean).map(String))].slice(0, 4);
    // A confirmed main visual remains a valid source even when it was created
    // under an earlier demand revision. Designers can deliberately return to it.
    const parentVisuals = parentVisualIds.map(visualId => db.prepare('SELECT * FROM visual_versions WHERE id = ? AND project_id = ? AND is_confirmed = 1').get(visualId, proposal.project_id)).filter(Boolean);
    const parentVisual = parentVisuals[0] || null;
    const assetBindings = demandWithoutMedia(parse(db.prepare('SELECT * FROM demand_snapshots WHERE id = ?').get(proposal.demand_snapshot_id)?.payload, {})).assetBindings || {};
    const requestedAssetIds = [...new Set([...(assetBindings.referenceIds || []), assetBindings.ipAssetId, assetBindings.previewAssetId].filter(Boolean))];
    const generationAssets = requestedAssetIds.length
      ? await loadReferenceAssets(proposal.project_id, requestedAssetIds)
      : currentReferenceAssets(proposal.project_id, ['画幅预览', 'IP 参考', '徽章', 'overall_style', 'layout', 'illustration', 'palette']);
    const referencePriority = { 'IP 参考': 0, illustration: 1, layout: 2, overall_style: 3, palette: 4 };
    const modelReferenceAssets = generationAssets.filter(asset => !['徽章', '画幅预览'].includes(asset.role));
    const imageGenerationAssets = generationAssets
      .filter(asset => asset.role !== '徽章')
      .sort((a, b) => ({ '画幅预览': 0, 'IP 参考': 1, illustration: 2, layout: 3, overall_style: 4, palette: 5 }[a.role] ?? 9) - ({ '画幅预览': 0, 'IP 参考': 1, illustration: 2, layout: 3, overall_style: 4, palette: 5 }[b.role] ?? 9));
    const promptReferenceAssets = [...modelReferenceAssets].sort((a, b) => (referencePriority[a.role] ?? 9) - (referencePriority[b.role] ?? 9)).slice(0, maxPromptReferenceImages);
    const promptVisionPreviews = await loadPromptVisionPreviews(promptReferenceAssets);
    const badgeSettings = db.prepare('SELECT * FROM badge_settings WHERE project_id = ?').get(proposal.project_id);
    const badgeAsset = badgeSettings?.badge_asset_id ? db.prepare("SELECT * FROM reference_assets WHERE id = ? AND project_id = ? AND role = '徽章'").get(badgeSettings.badge_asset_id, proposal.project_id) : null;
    const materialType = String(body.materialType || '主视觉');
    const demandSnapshot = db.prepare('SELECT * FROM demand_snapshots WHERE id = ?').get(proposal.demand_snapshot_id);
    const demand = parse(demandSnapshot?.payload, {});
    const skillDemand = compactDemandForSkill(demand);
    const modules = promptModules(demand, materialType, body.edits || {});
    const selectedSkill = materialType === '主视觉' ? promptSkill : materialPromptSkill;
    const prompt = sanitizePrompt(await callChatJson(selectedSkill, { demand: skillDemand, proposal: proposalContent, materialType, seriesHierarchy: materialType === '主书' ? '主书为延展物料的一级信息载体，承接礼盒主视觉。' : '当前物料比主书弱一级，保持系列感但不得压过主书。', confirmedCopy: modules.confirmedCopy, visualModules: modules.visual, feedback: feedback ? { message: feedback.message } : null, designerEdits: body.edits || {}, parentVisual: parentVisual ? { id: parentVisual.id, materialType: parentVisual.material_type } : null, parentVisuals: parentVisuals.map(visual => ({ id: visual.id, materialType: visual.material_type })), referenceAssets: promptReferenceAssets.map(asset => ({ fileName: asset.file_name, role: asset.role, analysis: asset.role === 'IP 参考' ? '识别并继承角色身份、外形、服装、姿态与表情；禁止提取图中文字。' : '识别并提取配色、构图、插图与图形语言；禁止复制图中文字、徽章或 Logo。' })), badge: badgeAsset ? { position: badgeSettings.position, sizeRatio: badgeSettings.size_ratio, marginRatio: badgeSettings.margin_ratio, instruction: '徽章由系统在后处理阶段精确叠加；图像模型仅保留无文字的纯色空白位置，不得重绘、替代、放大或复制徽章、Logo及其文字。' } : null }, promptVisionPreviews));
    prompt.positivePrompt = appendPromptModules(prompt.positivePrompt, modules);
    if (prompt.integratedPrompt) prompt.positivePrompt += `\n【整合版提示词】${prompt.integratedPrompt}`;
    prompt.negativePrompt = compactNegativePrompt(prompt.negativePrompt, commonNegativePrompt, modules.negative);
    prompt.referenceAssetIds = imageGenerationAssets.slice(0, maxImageReferences).map(asset => asset.id);
    prompt.referenceVisualIds = parentVisuals.map(visual => visual.id);
    const materialBrief = materialType === '主视觉' ? null : db.prepare('SELECT * FROM material_briefs WHERE project_id = ? AND material_type = ?').get(proposal.project_id, materialType);
    const briefPayload = parse(materialBrief?.payload, {});
    const targetSpec = canvasSpec(body.edits?.canvasSpec || (materialType === '主视觉' ? demand.canvasSpec || demand.ratio : briefPayload.canvasSpec || briefPayload.ratio || demand.canvasSpec || demand.ratio));
    prompt.canvasSpec = targetSpec;
    prompt.size = modelSizeForCanvas(targetSpec);
    prompt.referenceMode = modelReferenceAssets.length || parentVisuals.length ? 'image_edit' : 'text_generation';
    const promptId = id('prompt');
    db.prepare('INSERT INTO prompt_versions (id, project_id, proposal_id, parent_visual_id, material_type, content, design_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(promptId, proposal.project_id, proposal.id, body.parentVisualId || null, materialType, json(prompt), designRevision, now());
    logHistory(proposal.project_id, 'prompt_created', `生成${materialType} Prompt`, { promptId, proposalId: proposal.id, parentVisualId: body.parentVisualId || null, materialType, designRevision });
    return send(response, 201, { id: promptId, content: prompt });
  }
  if (request.method === 'POST' && pathname === '/api/image-jobs') {
    const body = await readJson(request);
    const prompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(body.promptId);
    if (!prompt) throw badRequest('请先生成并确认 Prompt。');
    const designRevision = currentDesignRevision(prompt.project_id);
    if (Number(prompt.design_revision || 0) !== designRevision) throw badRequest('当前需求已更新，请重新生成 Prompt。');
    const materialType = String(body.materialType || '主视觉');
    if (materialType !== '主视觉') {
      const parent = db.prepare("SELECT * FROM visual_versions WHERE id = ? AND project_id = ? AND material_type = '主视觉' AND is_confirmed = 1").get(body.parentVisualId, prompt.project_id);
      if (!parent) throw badRequest('已确认主视觉已变更，请重新生成物料 Prompt。');
    }
    const active = db.prepare("SELECT * FROM image_jobs WHERE project_id = ? AND material_type = ? AND prompt_id = ? AND status IN ('排队中','生成中') ORDER BY created_at DESC LIMIT 1").get(prompt.project_id, materialType, prompt.id);
    if (active) return send(response, 200, { id: active.id, status: active.status, requestedCount: active.requested_count, reused: true });
    const jobId = id('job');
    db.prepare('INSERT INTO image_jobs (id, project_id, prompt_id, parent_visual_id, material_type, status, requested_count, design_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, prompt.project_id, prompt.id, body.parentVisualId || null, materialType, '排队中', 1, designRevision, now(), now());
    logHistory(prompt.project_id, 'image_job_queued', `创建${materialType}生成任务`, { jobId, promptId: prompt.id, materialType, requestedCount: 1, designRevision });
    queueImageJob(jobId);
    return send(response, 202, { id: jobId, status: '排队中', requestedCount: 1 });
  }
  if (request.method === 'POST' && feedbackMatch) {
    const body = await readJson(request);
    const visual = db.prepare('SELECT * FROM visual_versions WHERE id = ?').get(feedbackMatch[1]);
    if (!visual) throw notFound('图片版本不存在。');
    if (Number(visual.design_revision || 0) !== currentDesignRevision(visual.project_id) || visual.stale_reason) throw badRequest('该版本属于历史需求，不能继续修改。');
    if (!String(body.message || '').trim()) throw badRequest('请填写具体修改反馈。');
    const feedbackId = id('feedback');
    db.prepare('INSERT INTO feedback_events (id, visual_id, feedback_types, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(feedbackId, visual.id, json([]), String(body.message).trim(), now());
    logHistory(visual.project_id, 'feedback_saved', `保存${visual.material_type || '主视觉'}文字反馈`, { feedbackId, visualId: visual.id });
    return send(response, 201, { id: feedbackId, visualId: visual.id, message: String(body.message).trim() });
  }
  if (request.method === 'POST' && variantMatch) {
    const body = await readJson(request);
    const visual = db.prepare('SELECT * FROM visual_versions WHERE id = ?').get(variantMatch[1]);
    if (!visual) throw notFound('图片版本不存在。');
    const label = String(body.label || '').trim();
    if (!label || label.length > 30) throw badRequest('请填写不超过 30 个字的颜色版本名称。');
    db.prepare('UPDATE visual_versions SET variant_label = ?, is_reference_candidate = 1 WHERE id = ?').run(label, visual.id);
    logHistory(visual.project_id, 'color_variant_saved', `暂存${visual.material_type}颜色版本`, { visualId: visual.id, label });
    return send(response, 200, { visualId: visual.id, label, isReferenceCandidate: true });
  }
  if (request.method === 'POST' && confirmMatch) {
    const body = await readJson(request);
    const visual = db.prepare('SELECT * FROM visual_versions WHERE id = ?').get(confirmMatch[1]);
    if (!visual) throw notFound('图片版本不存在。');
    const revision = currentDesignRevision(visual.project_id);
    if (visual.material_type !== '主视觉' && (Number(visual.design_revision || 0) !== revision || visual.stale_reason)) throw badRequest('该物料版本属于历史需求，不能确认。');
    if (visual.material_type !== '主视觉') {
      const parent = db.prepare("SELECT * FROM visual_versions WHERE id = ? AND project_id = ? AND material_type = '主视觉' AND is_confirmed = 1").get(visual.parent_visual_id, visual.project_id);
      if (!parent) throw badRequest('主视觉已变更，请重新生成物料版本。');
      db.prepare('UPDATE visual_versions SET is_confirmed = 0 WHERE project_id = ? AND material_type = ?').run(visual.project_id, visual.material_type);
      db.prepare('UPDATE visual_versions SET is_confirmed = 1, status = ? WHERE id = ?').run('已确认', visual.id);
      logHistory(visual.project_id, 'material_confirmed', `确认${visual.material_type}`, { visualId: visual.id, materialType: visual.material_type });
      return send(response, 200, { visualId: visual.id, materialType: visual.material_type, confirmed: true });
    }
    const confirmed = db.prepare("SELECT * FROM visual_versions WHERE project_id = ? AND material_type = '主视觉' AND is_confirmed = 1 LIMIT 1").get(visual.project_id);
    const hasCurrentMaterials = Boolean(db.prepare("SELECT 1 FROM visual_versions WHERE project_id = ? AND material_type != '主视觉' AND design_revision = ? AND stale_reason IS NULL LIMIT 1").get(visual.project_id, revision));
    if (confirmed && confirmed.id !== visual.id && hasCurrentMaterials && body.confirmMaterialInvalidation !== true) {
      throw badRequest('切换主视觉会使全部延展物料失效，请确认后重试。');
    }
    // A newly confirmed main visual changes the source of every derived material.
    if (!confirmed || confirmed.id !== visual.id) {
      db.prepare("UPDATE visual_versions SET is_confirmed = 0, status = '主视觉已变更，历史物料', stale_reason = '主视觉已变更' WHERE project_id = ? AND material_type != '主视觉' AND design_revision = ?")
        .run(visual.project_id, revision);
    }
    // Confirmation must be immediate. Detailed visual analysis belongs to the
    // later extension-material workflow, not to this final approval action.
    const profile = sanitizeStyleProfile({
      titleTone: '继承已确认主视觉的标题字形、字重与色彩关系',
      coreElements: '继承已确认主视觉中的主体、背景结构与卖点组件',
      spacing: '继承主视觉的标题、主体与卖点相对位置；延展物料需重新组织版式',
      avoid: '复制旧文案、重绘徽章或 Logo、未授权 IP、复杂低对比背景'
    });
    db.prepare('UPDATE visual_versions SET is_confirmed = 0 WHERE project_id = ?').run(visual.project_id);
    db.prepare('UPDATE visual_versions SET is_confirmed = 1, status = ?, stale_reason = NULL WHERE id = ?').run('已确认', visual.id);
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run('主视觉已确认，可生成基础物料', now(), visual.project_id);
    const styleId = id('style');
    db.prepare('INSERT INTO style_profiles (id, project_id, visual_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(styleId, visual.project_id, visual.id, json(profile), '草稿', now());
    logHistory(visual.project_id, 'visual_confirmed', '确认礼盒主视觉并生成风格规则草稿', { visualId: visual.id, styleId });
    return send(response, 200, { visualId: visual.id, styleProfile: { id: styleId, content: profile, status: '草稿' } });
  }
  return false;
}

// Generated from printCanvasSpecs above so the browsers cannot drift from it.
// Loaded as a classic script before the page scripts, which rely on globals.
const sharedClientScript = `/* 由 server.mjs 生成，请勿手改。画幅定义只维护在服务端一处。 */
window.YIHUA = (() => {
  const printCanvasSpecs = ${JSON.stringify(printCanvasSpecs)};
  const ratioKeys = Object.keys(printCanvasSpecs);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a || 1; };
  const normalizeRatio = value => {
    const raw = String(value == null ? '' : value).trim();
    if (printCanvasSpecs[raw]) return raw;
    const [width, height] = raw.split(':').map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const divisor = gcd(width, height);
    const reduced = (width / divisor) + ':' + (height / divisor);
    if (printCanvasSpecs[reduced]) return reduced;
    console.warn('[yihua] 未收录的画幅 ' + raw + '，已按方向回退');
    return width > height ? '32:23' : '7:10';
  };
  const toCanvasSpec = input => {
    const raw = typeof input === 'string' ? { ratio: input } : (input || {});
    const ratio = normalizeRatio(raw.ratio) || normalizeRatio(raw.widthUnits + ':' + raw.heightUnits) || '7:10';
    const preset = printCanvasSpecs[ratio];
    const [widthUnits, heightUnits] = ratio.split(':').map(Number);
    return {
      ratio, widthUnits, heightUnits, width: preset.width, height: preset.height,
      exportSize: preset.width + 'x' + preset.height,
      printSize: preset.label, label: preset.label, orientation: preset.orientation, isCustom: false
    };
  };
  const modelSizeFor = spec => (spec.width === spec.height ? '1024x1024' : (spec.width > spec.height ? '1536x1024' : '1024x1536'));
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return { printCanvasSpecs, ratioKeys, gcd, normalizeRatio, toCanvasSpec, modelSizeFor, escapeHtml };
})();
`;

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      const handled = await apiHandler(request, response, pathname);
      if (handled === false) send(response, 404, { error: '接口不存在' });
      return;
    }
    if (request.method !== 'GET') return send(response, 405, { error: '不支持的请求方法' });
    if (pathname === '/shared.js') return send(response, 200, sharedClientScript, mimeTypes['.js']);
    const relativePath = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
    if (relativePath.includes('..')) return send(response, 403, { error: '禁止访问' });
    // The project root also holds .env, the SQLite file and the server source,
    // so only known-servable extensions may leave this directory.
    const contentType = mimeTypes[extname(relativePath)];
    if (!contentType) return send(response, 404, { error: '资源不存在' });
    const file = await readFile(join(root, relativePath));
    send(response, 200, file, contentType);
  } catch (error) {
    if (error.code === 'ENOENT') return send(response, 404, { error: '资源不存在' });
    send(response, error.status || 500, { error: error.message || '服务暂时不可用。' });
  }
});

// A local tool that exits on an unexpected rejection loses the tester's work.
// Log loudly, stay up; the request that triggered it has already been answered.
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', error => console.error('[uncaughtException]', error));

server.listen(port, '127.0.0.1', () => console.log(`易画需求预检原型已启动：http://127.0.0.1:${port}`));
