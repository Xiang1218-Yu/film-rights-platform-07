export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; }
export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; }

export type RightsEvidenceKind = 'contract' | 'amendment' | 'payment_proof' | 'other';
export type CoverageStatus = 'covered' | 'missing' | 'expired' | 'scope_mismatch';
export interface DigestValue { algorithm: 'sha256'; value: string; }
export interface AssetVersionRef { assetId: string; version: number; currentVersion?: number; assetName?: string; supersededByVersion?: number; }
export interface RightsEvidence {
  id: string;
  kind: RightsEvidenceKind;
  title: string;
  reference: string;
  uri?: string;
  digest: DigestValue;
  licensor: string;
  assetVersions: AssetVersionRef[];
  territories: string[];
  platforms: string[];
  validFrom: string;
  validTo: string;
  grantsRights: boolean;
  submittedBy: string;
  submittedAt: string;
  idempotencyKey?: string;
  documentKey: string;
  submissionKey: string;
  verification: { state: 'reference_registered'; externalContentVerified: false; digestVerifiedAgainstContent: false; note: string };
}
export interface RegisterRightsEvidenceInput {
  kind?: RightsEvidenceKind;
  title?: string;
  reference: string;
  uri?: string;
  digest: string | DigestValue;
  licensor: string;
  assetVersions: Array<string | { assetId: string; version?: number }>;
  territories: string[];
  platforms: string[];
  validFrom: string;
  validTo: string;
  grantsRights?: boolean;
  idempotencyKey?: string;
  submittedBy?: string;
}
export interface CoverageScopeInput {
  projectId?: string;
  date?: string;
  territories?: string[];
  platforms?: string[];
  assetVersions: Array<{ assetId: string; version?: number; territories?: string[]; platforms?: string[] }>;
  writeAudit?: boolean;
}
export interface CoveragePair { territory: string; platform: string; status: CoverageStatus; reason: string; evidenceIds: string[]; }
export interface RightsCoverageItem {
  assetId: string;
  assetName: string;
  version: number;
  currentVersion: number;
  superseded: boolean;
  supersededByVersion?: number;
  status: CoverageStatus;
  reason: string;
  territories: string[];
  platforms: string[];
  pairs: CoveragePair[];
  matchedEvidenceIds: string[];
  expiredEvidenceIds: string[];
  supportingEvidenceIds: string[];
}
export interface RightsCoverageReport {
  projectId?: string;
  date: string;
  status: CoverageStatus;
  totals: Record<CoverageStatus, number>;
  items: RightsCoverageItem[];
  verification: RightsEvidence['verification'];
}

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];
export const budgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
];
export const contracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
export const assets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];
export const approvals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1) },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2) },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证' }
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目' }];

const GLOBAL_TERRITORY = '全球';
const RIGHTS_COVERAGE_STATUSES: CoverageStatus[] = ['covered', 'missing', 'expired', 'scope_mismatch'];
const versionReplacementKey = (assetId: string, version: number) => `${assetId}@v${version}`;
const explicitVersionReplacements = new Set<string>([versionReplacementKey('AST-001', 6)]);
const unique = (values: string[]) => Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const assertDate = (value: string, field: string) => { if (!isoDatePattern.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new Error(`${field} 必须是 YYYY-MM-DD 日期`); };
const findAssetOrThrow = (assetId: string) => { const asset = assets.find(item => item.id === assetId); if (!asset) throw new Error(`资产不存在：${assetId}`); return asset; };
function normalizeDigest(input: string | DigestValue): DigestValue {
  const algorithm = typeof input === 'string' ? 'sha256' : input.algorithm;
  const value = (typeof input === 'string' ? input : input.value).replace(/^sha256:/i, '').trim().toLowerCase();
  if (algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('摘要必须是 64 位 SHA-256 十六进制值');
  return { algorithm, value };
}
function normalizeVersionRefs(input: RegisterRightsEvidenceInput['assetVersions']): AssetVersionRef[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('至少关联一个资产版本');
  const seen = new Set<string>();
  return input.flatMap(rawRef => {
    const assetId = typeof rawRef === 'string' ? rawRef : rawRef.assetId;
    const requestedVersion = typeof rawRef === 'string' ? undefined : rawRef.version;
    const asset = findAssetOrThrow(assetId);
    const version = requestedVersion ?? asset.version;
    const dedupeKey = `${asset.id}@${version}`;
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    const replacementKey = versionReplacementKey(assetId, version);
    return [{ assetId, version, currentVersion: asset.version, assetName: asset.name, ...(explicitVersionReplacements.has(replacementKey) ? { supersededByVersion: asset.version } : {}) }];
  });
}
function decorateVersionRef(ref: AssetVersionRef): AssetVersionRef {
  const asset = findAssetOrThrow(ref.assetId);
  const key = versionReplacementKey(ref.assetId, ref.version);
  return { ...ref, currentVersion: asset.version, assetName: asset.name, ...(explicitVersionReplacements.has(key) ? { supersededByVersion: asset.version } : {}) };
}
const evidenceFingerprint = (input: { reference: string; digest: DigestValue; licensor: string; assetVersions: AssetVersionRef[]; territories: string[]; platforms: string[]; validFrom: string; validTo: string; grantsRights: boolean }) =>
  [input.reference.trim().toUpperCase(), input.digest.value, input.licensor.trim(), input.validFrom, input.validTo, String(input.grantsRights), input.territories.slice().sort().join('|'), input.platforms.slice().sort().join('|'), input.assetVersions.map(ref => `${ref.assetId}@v${ref.version}`).sort().join('|')].join('¦');

class InMemoryEvidenceStore {
  private records: RightsEvidence[] = [];
  private failNextCommits = 0;
  scheduleNextFailure(attempts = 1) { this.failNextCommits = Math.max(0, attempts); }
  async commit<T>(work: () => T, retries = 2): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        if (this.failNextCommits > 0) { this.failNextCommits -= 1; throw new Error('模拟台账写入失败，请重试'); }
        return work();
      } catch (error) { lastError = error; if (attempt === retries) break; }
    }
    throw lastError;
  }
  insert(record: RightsEvidence) {
    const duplicate = this.records.find(item => item.submissionKey === record.submissionKey || item.documentKey === record.documentKey);
    if (duplicate) return duplicate;
    this.records.push(record); return record;
  }
  update(id: string, change: (record: RightsEvidence) => void) { const record = this.get(id); change(record); return record; }
  get(id: string) { const record = this.records.find(item => item.id === id); if (!record) throw new Error(`授权证据不存在：${id}`); return record; }
  list() { return this.records.slice(); }
}
export const evidenceStore = new InMemoryEvidenceStore();
export function scheduleEvidenceLedgerFailureForTest(attempts = 1) { evidenceStore.scheduleNextFailure(attempts); }
let evidenceSequence = 1;

export async function registerRightsEvidence(rawInput: RegisterRightsEvidenceInput, options: { audit?: boolean; actor?: string } = {}): Promise<{ evidence: RightsEvidence; duplicate: boolean; reason?: string }> {
  const reference = rawInput.reference?.trim();
  const licensor = rawInput.licensor?.trim();
  const territories = unique(rawInput.territories ?? []);
  const platforms = unique(rawInput.platforms ?? []);
  if (!reference) throw new Error('证据引用不能为空');
  if (!licensor) throw new Error('授权方不能为空');
  if (territories.length === 0 || platforms.length === 0) throw new Error('授权地域和平台不能为空');
  assertDate(rawInput.validFrom, 'validFrom'); assertDate(rawInput.validTo, 'validTo');
  if (rawInput.validFrom > rawInput.validTo) throw new Error('授权开始日期不能晚于截止日期');
  const digest = normalizeDigest(rawInput.digest);
  const assetVersions = normalizeVersionRefs(rawInput.assetVersions);
  const kind = rawInput.kind ?? 'contract';
  const grantsRights = rawInput.grantsRights ?? kind !== 'payment_proof';
  const documentKey = `${reference.toUpperCase()}|${digest.value}`;
  const fingerprint = evidenceFingerprint({ reference, digest, licensor, assetVersions, territories, platforms, validFrom: rawInput.validFrom, validTo: rawInput.validTo, grantsRights });
  const existing = evidenceStore.list().find(item => item.documentKey === documentKey || item.submissionKey === rawInput.idempotencyKey || (!rawInput.idempotencyKey && item.submissionKey === fingerprint));
  if (existing) return { evidence: existing, duplicate: true, reason: rawInput.idempotencyKey ? 'idempotency_key' : 'same_reference_and_digest' };

  const actor = options.actor ?? rawInput.submittedBy ?? '法务控制台';
  const record: RightsEvidence = {
    id: `EV-${String(evidenceSequence++).padStart(4, '0')}`,
    kind, title: rawInput.title?.trim() || (kind === 'payment_proof' ? '付款凭证' : '授权文件'), reference, uri: rawInput.uri?.trim() || undefined, digest, licensor,
    assetVersions, territories, platforms, validFrom: rawInput.validFrom, validTo: rawInput.validTo, grantsRights,
    submittedBy: actor, submittedAt: new Date().toISOString(), idempotencyKey: rawInput.idempotencyKey, documentKey,
    submissionKey: rawInput.idempotencyKey || fingerprint,
    verification: { state: 'reference_registered', externalContentVerified: false, digestVerifiedAgainstContent: false, note: '仅登记外部文件引用和提交的摘要值；当前未连接版权方接口或对象存储，未核验文件内容。' }
  };
  const evidence = await evidenceStore.commit(() => evidenceStore.insert(record));
  if (evidence.id !== record.id) return { evidence, duplicate: true, reason: 'concurrent_same_reference_and_digest' };
  if (options.audit !== false) auditEvents.unshift({ id: `AUD-EV-${Date.now()}`, action: 'REGISTER_RIGHTS_EVIDENCE', entity: 'rights-evidence', entityId: evidence.id, actor, at: new Date().toISOString(), details: `登记${grantsRights ? '授权' : '辅助'}证据：${evidence.title}，授权方 ${licensor}，地域 ${territories.join('、')}，平台 ${platforms.join('、')}，有效期 ${rawInput.validFrom} 至 ${rawInput.validTo}；外部文件内容未核验。` });
  return { evidence, duplicate: false };
}
export async function linkEvidenceToAssetVersion(evidenceId: string, assetId: string, version?: number, actor = '法务控制台') {
  const evidence = evidenceStore.get(evidenceId);
  const ref = normalizeVersionRefs([{ assetId, version }])[0];
  if (evidence.assetVersions.some(item => item.assetId === ref.assetId && item.version === ref.version)) return { evidence, duplicate: true };
  const updated = await evidenceStore.commit(() => evidenceStore.update(evidenceId, item => { item.assetVersions.push(ref); }));
  auditEvents.unshift({ id: `AUD-EVL-${Date.now()}`, action: 'LINK_RIGHTS_EVIDENCE', entity: 'rights-evidence', entityId: evidenceId, actor, at: new Date().toISOString(), details: `证据补充关联资产版本 ${assetId}@v${ref.version}` });
  return { evidence: updated, duplicate: false };
}
export function markAssetVersionReplaced(assetId: string, version: number, actor = '法务控制台') {
  const asset = findAssetOrThrow(assetId);
  if (version >= asset.version) throw new Error('只有旧版本才能标记为被当前版本替代');
  explicitVersionReplacements.add(versionReplacementKey(assetId, version));
  evidenceStore.list().forEach(evidence => { evidence.assetVersions = evidence.assetVersions.map(ref => ref.assetId === assetId && ref.version === version ? decorateVersionRef(ref) : ref); });
  auditEvents.unshift({ id: `AUD-EVS-${Date.now()}`, action: 'EVIDENCE_SUPERSEDED', entity: 'asset', entityId: assetId, actor, at: new Date().toISOString(), details: `资产版本 ${assetId}@v${version} 已被 v${asset.version} 替代；旧证据保留审计轨迹，不自动视为新版本授权。` });
  return { assetId, version, currentVersion: asset.version };
}
export function rightsEvidenceLedger() {
  return evidenceStore.list().map(evidence => ({ ...evidence, assetVersions: evidence.assetVersions.map(decorateVersionRef) }));
}
const scopeIntersects = (licensed: string[], requested: string) => licensed.includes(GLOBAL_TERRITORY) || licensed.includes(requested);
const platformIntersects = (licensed: string[], requested: string[]) => licensed.some(item => requested.includes(item));
function isEvidenceActive(evidence: RightsEvidence, date: string) { return date >= evidence.validFrom && date <= evidence.validTo; }
function inactiveReason(evidence: RightsEvidence, date: string) { return date < evidence.validFrom ? '授权尚未生效' : `授权已于 ${evidence.validTo} 到期（到期日次日起不再覆盖）`; }

export function evaluateRightsCoverage(input: CoverageScopeInput, options: { writeAudit?: boolean; actor?: string } = {}): RightsCoverageReport {
  const date = input.date ?? today();
  assertDate(date, 'date');
  const globalTerritories = unique(input.territories ?? []);
  const globalPlatforms = unique(input.platforms ?? []);
  const items = input.assetVersions.map(target => {
    const asset = findAssetOrThrow(target.assetId);
    const version = target.version ?? asset.version;
    const territories = unique(target.territories?.length ? target.territories : globalTerritories.length ? globalTerritories : asset.territories);
    const platforms = unique(target.platforms?.length ? target.platforms : globalPlatforms.length ? globalPlatforms : asset.platforms);
    const linked = evidenceStore.list().filter(evidence => evidence.grantsRights && evidence.assetVersions.some(ref => ref.assetId === asset.id && ref.version === version));
    const supporting = evidenceStore.list().filter(evidence => !evidence.grantsRights && evidence.assetVersions.some(ref => ref.assetId === asset.id && ref.version === version));
    const pairs: CoveragePair[] = territories.flatMap(territory => platforms.map(platform => {
      const matchesScope = (evidence: RightsEvidence) => scopeIntersects(evidence.territories, territory) && evidence.platforms.includes(platform);
      const active = linked.filter(evidence => isEvidenceActive(evidence, date) && matchesScope(evidence));
      const inactive = linked.filter(evidence => !isEvidenceActive(evidence, date) && matchesScope(evidence));
      const activeAnyScope = linked.filter(evidence => isEvidenceActive(evidence, date));
      let status: CoverageStatus; let reason: string;
      if (active.length) { status = 'covered'; reason = `授权在 ${date} 有效，覆盖地域与平台`; }
      else if (inactive.length) { status = 'expired'; reason = inactive.map(item => inactiveReason(item, date)).join('；'); }
      else if (activeAnyScope.length) { status = 'scope_mismatch'; reason = '授权在有效期内，但地域或平台不覆盖该交付组合；全球地域仍需单独列明平台'; }
      else { status = 'missing'; reason = linked.length ? '未找到可授予权利的有效证据' : '缺少授权合同或补充条款证据（付款凭证本身不授予权利）'; }
      return { territory, platform, status, reason, evidenceIds: (active.length ? active : inactive.length ? inactive : activeAnyScope).map(evidence => evidence.id) };
    }));
    const statusOrder: CoverageStatus[] = ['missing', 'expired', 'scope_mismatch', 'covered'];
    const key = versionReplacementKey(asset.id, version);
    const superseded = explicitVersionReplacements.has(key);
    let status = statusOrder.find(candidate => pairs.some(pair => pair.status === candidate)) ?? 'covered';
    let reason = `${pairs.filter(pair => pair.status === 'covered').length}/${pairs.length} 个地域-平台组合已覆盖`;
    if (superseded) { status = 'scope_mismatch'; reason = `资产版本 v${version} 已被 v${asset.version} 替代，请确认新版本证据`; }
    else if (status !== 'covered') reason = pairs.find(pair => pair.status === status)?.reason ?? reason;
    return {
      assetId: asset.id, assetName: asset.name, version, currentVersion: asset.version,
      superseded, ...(superseded ? { supersededByVersion: asset.version } : {}),
      status, reason, territories, platforms, pairs,
      matchedEvidenceIds: Array.from(new Set(pairs.filter(pair => pair.status === 'covered').flatMap(pair => pair.evidenceIds))),
      expiredEvidenceIds: Array.from(new Set(pairs.filter(pair => pair.status === 'expired').flatMap(pair => pair.evidenceIds))),
      supportingEvidenceIds: supporting.map(evidence => evidence.id)
    } satisfies RightsCoverageItem;
  });
  const totals = RIGHTS_COVERAGE_STATUSES.reduce((result, status) => ({ ...result, [status]: items.filter(item => item.status === status).length }), {} as Record<CoverageStatus, number>);
  const report: RightsCoverageReport = { projectId: input.projectId, date, status: (['missing', 'expired', 'scope_mismatch', 'covered'] as CoverageStatus[]).find(status => totals[status] > 0) ?? 'covered', totals, items, verification: { state: 'reference_registered', externalContentVerified: false, digestVerifiedAgainstContent: false, note: '覆盖结论只基于已登记的证据元数据、引用和摘要，不代表外部文件内容已验证。' } };
  if (options.writeAudit !== false) auditEvents.unshift({ id: `AUD-COV-${Date.now()}`, action: 'RIGHTS_COVERAGE_CALCULATED', entity: 'rights-coverage', entityId: input.projectId || 'ad-hoc-scope', actor: options.actor ?? '法务控制台', at: new Date().toISOString(), details: `授权覆盖结论：${report.status}，已覆盖 ${totals.covered}、缺证 ${totals.missing}、已过期 ${totals.expired}、范围不匹配 ${totals.scope_mismatch}；外部文件内容未核验。` });
  return report;
}
function approvalScope(approval: Approval): CoverageScopeInput | undefined {
  if (approval.entityType === 'asset') {
    const asset = assets.find(item => item.id === approval.entityId);
    if (!asset) return undefined;
    return { projectId: approval.projectId, assetVersions: [{ assetId: asset.id, version: asset.version, territories: asset.territories, platforms: asset.platforms }] };
  }
  if (approval.entityType === 'delivery') {
    return { projectId: approval.projectId, assetVersions: assets.filter(asset => asset.projectId === approval.projectId).map(asset => ({ assetId: asset.id, version: asset.version, territories: asset.territories, platforms: asset.platforms })) };
  }
  return undefined;
}
export function approvalRightsContext(approvalId: string) {
  const approval = approvals.find(item => item.id === approvalId);
  if (!approval) return undefined;
  const scope = approvalScope(approval);
  return { approval, scope, canEvaluate: Boolean(scope), note: scope ? '该审批可按资产版本、地域、平台和日期计算证据覆盖。' : '预算审批没有可直接计算的资产交付范围。' };
}
export function calculateApprovalRightsCoverage(approvalId: string, overrides: Partial<CoverageScopeInput> = {}, actor = '法务控制台') {
  const context = approvalRightsContext(approvalId);
  if (!context) return undefined;
  if (!context.scope) return { approval: context.approval, coverage: undefined as undefined };
  const scope: CoverageScopeInput = { ...context.scope, ...overrides, projectId: context.approval.projectId, assetVersions: overrides.assetVersions ?? context.scope.assetVersions };
  const coverage = evaluateRightsCoverage(scope, { writeAudit: false, actor });
  auditEvents.unshift({ id: `AUD-APRC-${Date.now()}`, action: 'RIGHTS_COVERAGE_CALCULATED', entity: 'approval', entityId: approvalId, actor, at: new Date().toISOString(), details: `审批 ${approvalId} 授权覆盖结论：${coverage.status}，已覆盖 ${coverage.totals.covered}、缺证 ${coverage.totals.missing}、已过期 ${coverage.totals.expired}、范围不匹配 ${coverage.totals.scope_mismatch}。` });
  return { approval: context.approval, coverage };
}

await registerRightsEvidence({
  kind: 'contract', title: '北境回声多平台授权合同', reference: 'LIC-NORTHSTAR-MASTER-2026',
  digest: '9f6d2a4c7e8b31f5a0c9d6e2b74f1c8a5d0e39c6b24f71d85ca06e9f2b3d4c71', licensor: '远景国际版权',
  assetVersions: ['AST-001', { assetId: 'AST-001', version: 6 }], territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'],
  validFrom: iso(-2), validTo: iso(730), submittedBy: '法务台账初始化'
}, { audit: false, actor: '系统' });
await registerRightsEvidence({
  kind: 'amendment', title: '主预告宣传授权补充条款', reference: 'AMN-NORTHSTAR-TRAILER-2026',
  digest: '7b595a6752ce6ea2620642739f098099cfa3d238e795fcaac1bfa57ea9c93cdf', licensor: '星海艺人经纪',
  assetVersions: ['AST-002'], territories: ['CN'], platforms: ['StreamBox', '短视频'],
  validFrom: iso(-30), validTo: iso(-1), submittedBy: '法务台账初始化'
}, { audit: false, actor: '系统' });
await registerRightsEvidence({
  kind: 'payment_proof', title: '音乐同步许可首付款凭证', reference: 'PAY-CTR02-INSTALLMENT-1',
  digest: 'd34a8f61c9027e5b84d1fa6c039be75d2a64f8c10e97b5d3ca28f6401e9d7b32', licensor: '远景国际版权',
  assetVersions: ['AST-003'], territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'],
  validFrom: iso(-40), validTo: iso(52), grantsRights: false, submittedBy: '法务台账初始化'
}, { audit: false, actor: '系统' });

export function projectSummary(projectId = projects[0].id) {
  const lines = budgetLines.filter(line => line.projectId === projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return { project: projects.find(project => project.id === projectId), planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflictDetails(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: Array<{ key: string; severity: 'critical' | 'warning'; assetAId: string; assetBId: string; assetAVersion: number; assetBVersion: number; assetA: string; assetB: string; reason: string }> = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const sharedTags = a.rightsTags.filter(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes(GLOBAL_TERRITORY) || b.territories.includes(GLOBAL_TERRITORY) || a.territories.some(territory => b.territories.includes(territory));
    if (sharedTags.length && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ key: `${a.id}@v${a.version}|${b.id}@v${b.version}`, severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetAId: a.id, assetBId: b.id, assetAVersion: a.version, assetBVersion: b.version, assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${sharedTags.join('、')}` });
  }
  return conflicts;
}

export function rightsConflicts(projectId = projects[0].id) {
  return rightsConflictDetails(projectId).map(({ severity, assetA, assetB, reason }) => ({ severity, assetA, assetB, reason }));
}

export function conflictEvidenceContext(key: string) {
  const firstAssetKey = key.split('|')[0];
  const firstAssetId = firstAssetKey.split('@v')[0];
  const firstAsset = assets.find(asset => asset.id === firstAssetId);
  if (!firstAsset) return undefined;
  const conflict = rightsConflictDetails(firstAsset.projectId).find(item => item.key === key);
  if (!conflict) return undefined;
  const relatedAssetIds = [conflict.assetAId, conflict.assetBId];
  const evidence = rightsEvidenceLedger().filter(item => item.assetVersions.some(version => relatedAssetIds.includes(version.assetId)));
  const scope: CoverageScopeInput = {
    date: today(),
    assetVersions: relatedAssetIds.map(assetId => { const asset = findAssetOrThrow(assetId); return { assetId, version: asset.version, territories: asset.territories, platforms: asset.platforms }; })
  };
  return { conflict, evidence, coverageScope: scope };
}

export function approve(id: string, status: ApprovalStatus, comment = '', actor = '当前审批人') {
  const item = approvals.find(approval => approval.id === id); if (!item) return undefined;
  item.status = status; item.comment = comment;
  const scope = approvalScope(item);
  if (scope) {
    const coverage = evaluateRightsCoverage(scope, { writeAudit: false, actor });
    auditEvents.unshift({ id: `AUD-APRC-${Date.now()}`, action: 'RIGHTS_COVERAGE_CALCULATED', entity: 'approval', entityId: item.id, actor, at: new Date().toISOString(), details: `${item.title} ${status === 'approved' ? '通过前' : '处理时'}覆盖结论：${coverage.status}，已覆盖 ${coverage.totals.covered}、缺证 ${coverage.totals.missing}、已过期 ${coverage.totals.expired}、范围不匹配 ${coverage.totals.scope_mismatch}；不改变资产查询结构。` });
  }
  auditEvents.unshift({ id: `AUD-${Date.now()}`, action: status.toUpperCase(), entity: item.entityType, entityId: item.entityId, actor, at: new Date().toISOString(), details: comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}` }); return item;
}
export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) { const item: Approval = { ...input, id: `APR-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString() }; approvals.unshift(item); return item; }
export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }
