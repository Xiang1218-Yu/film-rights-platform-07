import crypto from 'node:crypto';
import { appendAuditEvent, assets, createApproval, iso, projects } from './domain.js';

/*
 * 授权证据台账（rights evidence ledger）
 *
 * 法务收到的只是“授权合同 / 补充条款 / 付款凭证”的引用与登记方自报的摘要校验值。
 * 本模块只保存证据“元数据 + 引用”，不会抓取或信任外部文件内容：
 *  - 登记时 digestStatus = 'claimed'（登记方自报，未独立核验）
 *  - 法务对原件复核后调用 attestEvidence，校验值一致才转为 'verified'
 * 只有 verified 的证据才参与覆盖结论；claimed / mismatch 仅产生风险提示。
 */

export const GLOBAL_TERRITORY = '全球';
export const ALL_PLATFORMS = '*';

export type DigestStatus = 'claimed' | 'verified' | 'mismatch';
export type CoverageStatus = 'covered' | 'missing' | 'expired' | 'mismatch';

export interface AssetVersionRef { assetId: string; version: number | null }
export interface EvidenceScope { territories: string[]; platforms: string[] }
export interface EvidenceRecord {
  id: string;
  projectId: string;
  reference: string;            // 外部证据引用，如 contract://CTR-02/grant?sig=…（第一版不落对象存储）
  referenceType: 'contract' | 'amendment' | 'payment' | 'certificate' | 'other';
  digest: string;               // sha256:<64hex>，登记方自报
  digestStatus: DigestStatus;
  granter: string;              // 授权方
  scope: EvidenceScope;         // 许可地域与平台
  validFrom: string;            // YYYY-MM-DD
  validTo: string;              // YYYY-MM-DD（含当日，到期当天仍覆盖）
  assetRefs: AssetVersionRef[]; // 一条证据可覆盖多个资产版本
  registeredBy: string;
  registeredAt: string;
  attestedAt?: string;
  attestedBy?: string;
}

export interface VersionLineage { assetId: string; version: number; supersedesVersion: number | null; registeredAt: string }
export interface PendingWrite { token: string; payload: RegisterEvidenceInput; attempts: number; lastError: string; firstFailedAt: string }
export interface CoverageReason { evidenceId: string; digestStatus: DigestStatus; status: CoverageStatus | 'unverified' | 'future'; message: string }
export interface CoverageCell { territory: string; platform: string; date: string; status: CoverageStatus; reasons: CoverageReason[]; matchedEvidenceIds: string[] }
export interface DeliveryTarget { assetId: string; version?: number; territories: string[]; platforms: string[]; date: string }
export interface CoverageConclusion {
  assetId: string; assetName: string; version: number; supersededVersion: number | null;
  target: { territories: string[]; platforms: string[]; date: string };
  overallStatus: CoverageStatus;
  counts: Record<CoverageStatus, number>;
  cells: CoverageCell[];
  warnings: string[];
  evaluatedAt: string;
}
export interface ApprovalCoverage { id: string; approvalId: string; conclusion: CoverageConclusion; recordedBy: string; recordedAt: string }

export interface RegisterEvidenceInput {
  projectId: string;
  reference: string;
  referenceType: EvidenceRecord['referenceType'];
  digest: string;
  granter: string;
  territories: string[];
  platforms: string[];
  validFrom: string;
  validTo: string;
  assetRefs: { assetId: string; version?: number | null }[];
  registeredBy: string;
  clientToken?: string;
}

export class LedgerError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'LEDGER_INVALID', readonly retryToken?: string) { super(message); }
}

// ---------- 台账存储（第一版：进程内内存；写入走带重试的提交器） ----------

const evidenceStore: EvidenceRecord[] = [];
const lineageStore: VersionLineage[] = [];
const pendingWritesStore = new Map<string, PendingWrite>();
const committedTokenIndex = new Map<string, string>(); // clientToken -> evidenceId，重放幂等
const approvalCoverageStore: ApprovalCoverage[] = [];
let evidenceSeq = 0;
let coverageSeq = 0;
let commitFailuresLeft = 0; // 故障注入：剩余的强制提交失败次数（测试 / 演示重试链路）

const newId = (prefix: string, seq: number) => `${prefix}-${String(Date.now()).slice(-6)}${String(seq).padStart(3, '0')}`;
const normalizeDigest = (digest: string) => digest.trim().toLowerCase();
const normalizeList = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));

export function territoryCovers(granted: string[], target: string) {
  return granted.includes(GLOBAL_TERRITORY) || granted.includes(target);
}
export function platformCovers(granted: string[], target: string) {
  return granted.includes(ALL_PLATFORMS) || granted.includes(target);
}

/** 规范化指纹：用于“同一证据重复提交”的去重判定 */
function evidenceFingerprint(input: RegisterEvidenceInput, refs: AssetVersionRef[]) {
  return crypto.createHash('sha256').update(JSON.stringify({
    projectId: input.projectId,
    reference: input.reference.trim().toLowerCase(),
    digest: normalizeDigest(input.digest),
    granter: input.granter.trim(),
    territories: normalizeList(input.territories),
    platforms: normalizeList(input.platforms),
    validFrom: input.validFrom,
    validTo: input.validTo,
    refs: refs.map(ref => `${ref.assetId}@${ref.version ?? '*'}`).sort(),
  })).digest('hex');
}

// ---------- 写入：校验 → 提交（含重试）→ 失败进待重试日志 ----------

function validate(input: RegisterEvidenceInput): AssetVersionRef[] {
  if (!input?.projectId || !projects.some(project => project.id === input.projectId)) throw new LedgerError('证据必须关联到存在的项目');
  if (!input.reference?.trim()) throw new LedgerError('证据引用不能为空');
  if (!input.granter?.trim()) throw new LedgerError('授权方不能为空');
  if (!/^sha256:[0-9a-f]{64}$/i.test(input.digest?.trim() ?? '')) throw new LedgerError('摘要校验值必须为 sha256:<64位十六进制>');
  if (!validDate(input.validFrom) || !validDate(input.validTo)) throw new LedgerError('有效期必须是 YYYY-MM-DD');
  if (input.validTo < input.validFrom) throw new LedgerError('有效期止日不能早于起日');
  const territories = normalizeList(input.territories);
  const platforms = normalizeList(input.platforms);
  if (!territories.length) throw new LedgerError('许可地域不能为空（全球授权请填“全球”）');
  if (!platforms.length) throw new LedgerError('许可平台不能为空（全平台请填“*”）');
  if (!['contract', 'amendment', 'payment', 'certificate', 'other'].includes(input.referenceType)) throw new LedgerError('未知的证据类型');
  if (!input.assetRefs?.length) throw new LedgerError('证据至少要关联一个资产版本');
  const refs: AssetVersionRef[] = [];
  for (const raw of input.assetRefs) {
    const asset = assets.find(item => item.id === raw.assetId && item.projectId === input.projectId);
    if (!asset) throw new LedgerError(`资产 ${raw.assetId} 不存在或不属于该项目`);
    if (raw.version != null && (!Number.isInteger(raw.version) || raw.version < 1)) throw new LedgerError(`资产 ${raw.assetId} 的版本号非法`);
    refs.push({ assetId: asset.id, version: raw.version ?? asset.version });
  }
  return refs;
}

function commitEvidence(input: RegisterEvidenceInput, refs: AssetVersionRef[]): EvidenceRecord {
  if (commitFailuresLeft > 0) { commitFailuresLeft -= 1; throw new Error('台账存储暂时不可用（注入故障）'); }
  const record: EvidenceRecord = {
    id: newId('EV', ++evidenceSeq),
    projectId: input.projectId,
    reference: input.reference.trim(),
    referenceType: input.referenceType,
    digest: normalizeDigest(input.digest),
    digestStatus: 'claimed',
    granter: input.granter.trim(),
    scope: { territories: normalizeList(input.territories), platforms: normalizeList(input.platforms) },
    validFrom: input.validFrom,
    validTo: input.validTo,
    assetRefs: refs,
    registeredBy: input.registeredBy || '法务控制台',
    registeredAt: new Date().toISOString(),
  };
  evidenceStore.unshift(record);
  return record;
}

const MAX_ATTEMPTS = 3;

/**
 * 登记证据。同一 clientToken 重放（网络重试 / 台账失败后补提交）只会产生一条记录；
 * 不带 token 的完全相同重复提交也会被指纹去重，不产生新记录、不重复写审计。
 */
export function registerEvidence(input: RegisterEvidenceInput): { record: EvidenceRecord; duplicated: boolean; pendingToken?: string } {
  const refs = validate(input);
  const token = input.clientToken;

  if (token) {
    const committedId = committedTokenIndex.get(token);
    if (committedId) {
      const done = evidenceStore.find(item => item.id === committedId);
      if (done) {
        if (fingerprintOf(done) !== evidenceFingerprint(input, refs)) throw new LedgerError('该 clientToken 已提交过另一份内容，拒绝重复绑定，请使用新的登记请求', 409, 'TOKEN_CONTENT_CONFLICT');
        return { record: done, duplicated: true };
      }
    }
    const waiting = pendingWritesStore.get(token);
    if (waiting && evidenceFingerprint(input, refs) !== evidenceFingerprint(waiting.payload, validate(waiting.payload))) {
      throw new LedgerError('该重试 token 已绑定另一份内容，拒绝覆盖，请使用新的登记请求', 409, 'TOKEN_CONTENT_CONFLICT');
    }
  }

  const existing = evidenceStore.find(item => item.projectId === input.projectId && fingerprintOf(item) === evidenceFingerprint(input, refs));
  if (existing) return { record: existing, duplicated: true };

  const previous = token ? pendingWritesStore.get(token) : undefined;
  let lastError = previous?.lastError ?? '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const record = commitEvidence(input, refs);
      if (token) committedTokenIndex.set(token, record.id);
      if (token) pendingWritesStore.delete(token);
      appendAuditEvent({ action: 'EVIDENCE_REGISTER', entity: 'evidence', entityId: record.id, actor: record.registeredBy, details: `登记${record.referenceType === 'payment' ? '付款凭证' : record.referenceType === 'amendment' ? '补充条款' : '授权证据'}：${record.granter} · ${record.scope.territories.join('/')} · ${record.scope.platforms.join('/')} · 有效期至 ${record.validTo}（摘要待核验，关联 ${record.assetRefs.map(ref => `${ref.assetId}@v${ref.version}`).join('、')}）` });
      return { record, duplicated: false };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const pendingToken = token || `retry-${crypto.randomUUID()}`;
  pendingWritesStore.set(pendingToken, { token: pendingToken, payload: input, attempts: (previous?.attempts ?? 0) + MAX_ATTEMPTS, lastError, firstFailedAt: previous?.firstFailedAt ?? new Date().toISOString() });
  throw new LedgerError(`台账写入连续失败，已进入待重试队列（${MAX_ATTEMPTS} 次），可凭 token 补提交`, 503, 'LEDGER_WRITE_PENDING', pendingToken);
}

/** 失败日志中同一条证据的指纹（重放时用于确认内容未被篡改） */
function fingerprintOf(record: EvidenceRecord) {
  return crypto.createHash('sha256').update(JSON.stringify({
    projectId: record.projectId,
    reference: record.reference.toLowerCase(),
    digest: record.digest,
    granter: record.granter,
    territories: record.scope.territories,
    platforms: record.scope.platforms,
    validFrom: record.validFrom,
    validTo: record.validTo,
    refs: record.assetRefs.map(ref => `${ref.assetId}@${ref.version ?? '*'}`).sort(),
  })).digest('hex');
}

/** 台账恢复后对待重试写入进行补提交；幂等，重复补提交返回同一条记录 */
export function retryPendingWrite(token: string): { record: EvidenceRecord; duplicated: boolean; pendingToken?: string } {
  const waiting = pendingWritesStore.get(token);
  if (!waiting) {
    const committed = committedTokenIndex.get(token);
    const record = committed ? evidenceStore.find(item => item.id === committed) : undefined;
    if (record) return { record, duplicated: true };
    throw new LedgerError('待重试写入不存在或已被清理', 404, 'PENDING_NOT_FOUND');
  }
  const result = registerEvidence({ ...waiting.payload, clientToken: token });
  return { ...result, pendingToken: pendingWritesStore.has(token) ? token : undefined };
}

export function listPendingWrites(projectId?: string): PendingWrite[] {
  const all = [...pendingWritesStore.values()];
  return projectId ? all.filter(item => item.payload.projectId === projectId) : all;
}

/** 测试 / 演示用：让接下来 n 次台账提交强制失败 */
export function _armCommitFailures(n: number) { commitFailuresLeft = n; }

// ---------- 法务对原件做独立核验（不抓取外部文件，只比对人工录入的原件摘要） ----------

export function attestEvidence(id: string, observedDigest: string, actor: string): EvidenceRecord {
  const record = evidenceStore.find(item => item.id === id);
  if (!record) throw new LedgerError('证据不存在', 404, 'EVIDENCE_NOT_FOUND');
  const normalized = normalizeDigest(observedDigest);
  record.digestStatus = normalized === record.digest ? 'verified' : 'mismatch';
  record.attestedAt = new Date().toISOString();
  record.attestedBy = actor;
  appendAuditEvent({
    action: 'EVIDENCE_ATTEST', entity: 'evidence', entityId: record.id, actor,
    details: record.digestStatus === 'verified'
      ? `法务核验通过：原件摘要与登记一致（${record.granter}，有效期至 ${record.validTo}）`
      : `法务核验未通过：原件摘要与登记值不一致，证据已标记 mismatch 且不参与覆盖结论`,
  });
  return record;
}

// ---------- 资产版本谱系（旧版本被新版本替代） ----------

export function registerAssetVersion(input: { assetId: string; version: number; supersedesVersion?: number | null; registeredBy?: string }): VersionLineage {
  const asset = assets.find(item => item.id === input.assetId);
  if (!asset) throw new LedgerError('资产不存在', 404, 'ASSET_NOT_FOUND');
  if (!Number.isInteger(input.version) || input.version < 1) throw new LedgerError('版本号非法');
  const prior = lineageStore.filter(item => item.assetId === input.assetId);
  const supersedesVersion = input.supersedesVersion ?? (prior.length ? Math.max(...prior.map(item => item.version)) : null);
  const existing = prior.find(item => item.version === input.version);
  if (existing) return existing;
  const lineage: VersionLineage = { assetId: input.assetId, version: input.version, supersedesVersion, registeredAt: new Date().toISOString() };
  lineageStore.unshift(lineage);
  if (input.version > asset.version) asset.version = input.version;
  appendAuditEvent({ action: 'ASSET_VERSION_REGISTER', entity: 'asset', entityId: input.assetId, actor: input.registeredBy ?? '后期制片', details: `登记资产版本 v${input.version}${supersedesVersion ? `，替代 v${supersedesVersion}` : ''}；旧版本证据不自动继承到新版本` });
  return lineage;
}

// ---------- 覆盖计算：已覆盖 / 缺证 / 已过期 / 范围不匹配 ----------

export function evaluateCoverage(target: DeliveryTarget): CoverageConclusion {
  const asset = assets.find(item => item.id === target.assetId);
  if (!asset) throw new LedgerError('资产不存在', 404, 'ASSET_NOT_FOUND');
  const version = target.version ?? asset.version;
  if (!validDate(target.date)) throw new LedgerError('目标日期必须是 YYYY-MM-DD');
  const territories = normalizeList(target.territories);
  const platforms = normalizeList(target.platforms);
  if (!territories.length || !platforms.length) throw new LedgerError('待交付地域与平台不能为空');

  // 仅取“显式关联到该资产该版本”的证据；关联旧版本（如 v7）的证据不会被新版本 v8 自动继承
  const linked = evidenceStore.filter(item =>
    item.projectId === asset.projectId &&
    item.assetRefs.some(ref => ref.assetId === asset.id && (ref.version === version)));
  const linkedOld = evidenceStore.filter(item =>
    item.projectId === asset.projectId &&
    item.assetRefs.some(ref => ref.assetId === asset.id && ref.version !== null && ref.version < version));
  const verified = linked.filter(item => item.digestStatus === 'verified');
  const unverified = linked.filter(item => item.digestStatus !== 'verified');

  const warnings: string[] = [];
  const lineageEntry = lineageStore.find(item => item.assetId === asset.id && item.version === version);
  const supersededVersion = lineageEntry?.supersedesVersion ?? null;
  if (supersededVersion) warnings.push(`当前版本 v${version} 已替代 v${supersededVersion}，关联旧版本的证据不自动继承，需重新提交新版本授权证据。`);
  for (const old of linkedOld) warnings.push(`证据 ${old.id}（${old.granter}）只关联旧版本 v${old.assetRefs.find(ref => ref.assetId === asset.id)?.version}，不计入 v${version} 的覆盖结论。`);
  for (const item of unverified) warnings.push(`证据 ${item.id} 摘要${item.digestStatus === 'mismatch' ? '核验不一致（mismatch）' : '尚未经法务核验（claimed）'}，不参与覆盖结论。`);

  const rank: Record<CoverageStatus, number> = { covered: 0, mismatch: 1, expired: 2, missing: 3 };
  const cells: CoverageCell[] = [];
  for (const territory of territories) for (const platform of platforms) {
    const reasons: CoverageReason[] = [];
    let status: CoverageStatus = 'missing';

    // 1) 有任何“地域+平台都覆盖”的已核验证据 → 只看日期（到期日含当日）
    const scopeCovering = verified.filter(item => territoryCovers(item.scope.territories, territory) && platformCovers(item.scope.platforms, platform));
    if (scopeCovering.length) {
      const inWindow = scopeCovering.filter(item => target.date >= item.validFrom && target.date <= item.validTo);
      if (inWindow.length) {
        status = 'covered';
        for (const item of inWindow) reasons.push({ evidenceId: item.id, digestStatus: item.digestStatus, status: 'covered', message: `在有效期内（${item.validFrom} 至 ${item.validTo}，到期日含当日）` });
      } else if (scopeCovering.some(item => target.date > item.validTo)) {
        status = 'expired';
        for (const item of scopeCovering) reasons.push({ evidenceId: item.id, digestStatus: item.digestStatus, status: target.date > item.validTo ? 'expired' : 'future', message: target.date > item.validTo ? `已于 ${item.validTo} 到期` : `自 ${item.validFrom} 才生效` });
      } else {
        status = 'missing';
        for (const item of scopeCovering) reasons.push({ evidenceId: item.id, digestStatus: item.digestStatus, status: 'future', message: `授权自 ${item.validFrom} 才生效，目标日尚未取得权利` });
      }
    } else if (verified.length) {
      // 2) 有在窗口内、关联本版本的已核验证据，但没有任何一条恰好覆盖“该地域+该平台” → 范围不匹配
      const inWindow = verified.filter(item => target.date >= item.validFrom && target.date <= item.validTo);
      status = inWindow.length ? 'mismatch' : 'missing';
      for (const item of inWindow.length ? inWindow : verified) {
        const territoryOk = territoryCovers(item.scope.territories, territory);
        const platformOk = platformCovers(item.scope.platforms, platform);
        const dateOk = target.date >= item.validFrom && target.date <= item.validTo;
        const missingDims = [territoryOk ? '' : `地域 ${territory}`, platformOk ? '' : `平台 ${platform}`, dateOk ? '' : '日期窗口'].filter(Boolean);
        reasons.push({ evidenceId: item.id, digestStatus: item.digestStatus, status: dateOk ? 'mismatch' : (target.date > item.validTo ? 'expired' : 'future'), message: missingDims.length ? `不覆盖：${missingDims.join('、')}` : '范围覆盖' });
      }
    } else {
      // 3) 没有任何已核验证据关联本版本 → 缺证
      reasons.push({ evidenceId: '-', digestStatus: 'claimed', status: 'unverified', message: unverified.length ? '仅有未核验证据，不能视为已取得权利' : '没有关联到该资产版本的已核验证据' });
    }

    for (const item of unverified) reasons.push({ evidenceId: item.id, digestStatus: item.digestStatus, status: 'unverified', message: `证据 ${item.digestStatus === 'mismatch' ? '核验不一致' : '待法务核验'}：${item.granter} ${item.scope.territories.join('/')} / ${item.scope.platforms.join('/')}` });

    cells.push({ territory, platform, date: target.date, status, reasons, matchedEvidenceIds: reasons.filter(reason => reason.status === 'covered').map(reason => reason.evidenceId) });
  }

  const overallStatus = cells.map(cell => cell.status).reduce((worst, current) => rank[current] > rank[worst] ? current : worst, 'covered' as CoverageStatus);
  const counts: Record<CoverageStatus, number> = { covered: 0, missing: 0, expired: 0, mismatch: 0 };
  for (const cell of cells) counts[cell.status] += 1;

  return { assetId: asset.id, assetName: asset.name, version, supersededVersion, target: { territories, platforms, date: target.date }, overallStatus, counts, cells, warnings, evaluatedAt: new Date().toISOString() };
}


// ---------- 覆盖结论接入审批链（随审批留存快照） ----------

export function attachCoverageToApproval(approvalId: string, target: DeliveryTarget, actor: string): ApprovalCoverage {
  const conclusion = evaluateCoverage(target);
  const snapshot: ApprovalCoverage = { id: newId('COV', ++coverageSeq), approvalId, conclusion, recordedBy: actor, recordedAt: new Date().toISOString() };
  approvalCoverageStore.unshift(snapshot);
  appendAuditEvent({
    action: 'COVERAGE_EVALUATE', entity: 'approval', entityId: approvalId, actor,
    details: `覆盖结论 ${conclusion.overallStatus.toUpperCase()}（${conclusion.assetName} v${conclusion.version} @ ${conclusion.target.date}，${conclusion.target.territories.join('/')} / ${conclusion.target.platforms.join('/')}）：已覆盖 ${conclusion.counts.covered}、缺证 ${conclusion.counts.missing}、已过期 ${conclusion.counts.expired}、范围不匹配 ${conclusion.counts.mismatch}`,
  });
  return snapshot;
}

export function approvalCoverage(approvalId: string): ApprovalCoverage | undefined {
  return approvalCoverageStore.find(item => item.approvalId === approvalId);
}

/**
 * 从审批上下文发起覆盖评估：留存快照并写审计；结论为缺证/过期/不匹配时可一键发起补证审批。
 */
export function appraiseCoverageForApproval(
  approvalId: string, target: DeliveryTarget, actor: string, decision: 'snapshot' | 'request-evidence', comment = '',
): { snapshot: ApprovalCoverage; followUpApprovalId?: string } {
  const snapshot = attachCoverageToApproval(approvalId, target, actor);
  const result: { snapshot: ApprovalCoverage; followUpApprovalId?: string } = { snapshot };
  if (decision === 'request-evidence' && snapshot.conclusion.overallStatus !== 'covered') {
    const followUp = createApproval({
      projectId: assets.find(item => item.id === target.assetId)?.projectId ?? projects[0].id,
      entityType: 'asset',
      entityId: target.assetId,
      title: `补证要求：${snapshot.conclusion.assetName} v${snapshot.conclusion.version}（${snapshot.conclusion.overallStatus}）`,
      requestedBy: actor,
      approver: '版权方对接人',
    });
    appendAuditEvent({ action: 'COVERAGE_FOLLOWUP', entity: 'approval', entityId: followUp.id, actor, details: `依据审批 ${approvalId} 的覆盖结论（${snapshot.conclusion.overallStatus}）发起补证审批${comment ? `：${comment}` : ''}` });
    result.followUpApprovalId = followUp.id;
  }
  return result;
}

// ---------- 查询 ----------

export function getEvidence(id: string) { return evidenceStore.find(item => item.id === id); }
export function projectEvidence(projectId: string) { return evidenceStore.filter(item => item.projectId === projectId); }
export function assetEvidence(assetId: string) {
  const asset = assets.find(item => item.id === assetId);
  if (!asset) throw new LedgerError('资产不存在', 404, 'ASSET_NOT_FOUND');
  const currentVersion = asset.version;
  const lineage = lineageStore.filter(item => item.assetId === assetId).sort((a, b) => b.version - a.version);
  const list = evidenceStore.filter(item => item.assetRefs.some(ref => ref.assetId === assetId)).map(item => ({
    ...item,
    assetRefs: item.assetRefs.filter(ref => ref.assetId === assetId),
    appliesToCurrentVersion: item.assetRefs.some(ref => ref.assetId === assetId && ref.version === currentVersion),
  }));
  return { asset: { id: asset.id, name: asset.name, version: currentVersion, territories: asset.territories, platforms: asset.platforms, availableFrom: asset.availableFrom, availableTo: asset.availableTo }, lineage, evidence: list, pendingWrites: [...pendingWritesStore.values()].filter(item => item.payload.assetRefs.some(ref => ref.assetId === assetId)) };
}

// ---------- 种子数据（模拟版权方分批发来的合同 / 补充条款 / 付款凭证） ----------

const seed = () => {
  const digestA = 'sha256:' + crypto.createHash('sha256').update('seed-ev-100').digest('hex');
  const digestB = 'sha256:' + crypto.createHash('sha256').update('seed-ev-101').digest('hex');
  const digestC = 'sha256:' + crypto.createHash('sha256').update('seed-ev-102').digest('hex');
  const digestD = 'sha256:' + crypto.createHash('sha256').update('seed-ev-103').digest('hex');
  const digestE = 'sha256:' + crypto.createHash('sha256').update('seed-ev-104').digest('hex');
  const digestF = 'sha256:' + crypto.createHash('sha256').update('seed-ev-105').digest('hex');
  const at = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  lineageStore.push({ assetId: 'AST-001', version: 8, supersedesVersion: 7, registeredAt: at(-2) });
  evidenceStore.push(
    { id: 'EV-100', projectId: 'PRJ-001', reference: 'contract://CTR-02/grant-deed?sig=9f31&batch=1', referenceType: 'contract', digest: digestA, digestStatus: 'verified', granter: '远景国际版权', scope: { territories: [GLOBAL_TERRITORY], platforms: ['影院', 'StreamBox'] }, validFrom: iso(-30), validTo: iso(400), assetRefs: [{ assetId: 'AST-001', version: 8 }], registeredBy: '法务-林', registeredAt: at(-28), attestedAt: at(-27), attestedBy: '法务-林' },
    { id: 'EV-101', projectId: 'PRJ-001', reference: 'payment://CTR-02/milestone-2/receipt?batch=2', referenceType: 'payment', digest: digestB, digestStatus: 'verified', granter: '远景国际版权', scope: { territories: ['CN', 'HK', 'SG'], platforms: ['StreamBox'] }, validFrom: iso(-12), validTo: iso(0), assetRefs: [{ assetId: 'AST-001', version: 8 }, { assetId: 'AST-002', version: 4 }], registeredBy: '法务-林', registeredAt: at(-11), attestedAt: at(-10), attestedBy: '法务-林' },
    { id: 'EV-102', projectId: 'PRJ-001', reference: 'contract://music-sync/winter-signal/addendum?batch=3', referenceType: 'amendment', digest: digestC, digestStatus: 'verified', granter: 'Winter Signal Publishing', scope: { territories: ['CN', 'US', 'CA'], platforms: ['影院'] }, validFrom: iso(-60), validTo: iso(300), assetRefs: [{ assetId: 'AST-003', version: 2 }], registeredBy: '法务-林', registeredAt: at(-58), attestedAt: at(-57), attestedBy: '法务-林' },
    { id: 'EV-103', projectId: 'PRJ-001', reference: 'contract://cast-publicity/clause-12?batch=3', referenceType: 'contract', digest: digestD, digestStatus: 'claimed', granter: '演员工会集体授权', scope: { territories: ['CN'], platforms: ['短视频'] }, validFrom: iso(0), validTo: iso(180), assetRefs: [{ assetId: 'AST-002', version: 4 }], registeredBy: '法务-林', registeredAt: at(-1) },
    { id: 'EV-104', projectId: 'PRJ-001', reference: 'contract://northstar/master-v7/license?batch=0', referenceType: 'contract', digest: digestE, digestStatus: 'verified', granter: '北境制片厂', scope: { territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'] }, validFrom: iso(-400), validTo: iso(-5), assetRefs: [{ assetId: 'AST-001', version: 7 }], registeredBy: '法务-林', registeredAt: at(-390), attestedAt: at(-389), attestedBy: '法务-林' },
    { id: 'EV-105', projectId: 'PRJ-002', reference: 'contract://CTR-03/aerial-license?batch=1', referenceType: 'contract', digest: digestF, digestStatus: 'verified', granter: '云帧视觉', scope: { territories: [GLOBAL_TERRITORY], platforms: ['影院'] }, validFrom: iso(-10), validTo: iso(365), assetRefs: [{ assetId: 'AST-004', version: 3 }], registeredBy: '法务-林', registeredAt: at(-9), attestedAt: at(-8), attestedBy: '法务-林' },
  );
};
seed();
