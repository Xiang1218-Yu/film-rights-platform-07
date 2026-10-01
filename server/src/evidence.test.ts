import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assets, auditEvents, type Asset } from './domain.js';
import {
  ALL_PLATFORMS,
  _armCommitFailures,
  appraiseCoverageForApproval,
  assetEvidence,
  attachCoverageToApproval,
  attestEvidence,
  evaluateCoverage,
  GLOBAL_TERRITORY,
  LedgerError,
  listPendingWrites,
  registerAssetVersion,
  registerEvidence,
  retryPendingWrite,
} from './evidence.js';

const today = () => new Date().toISOString().slice(0, 10);
const offsetDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const digestOf = (seed: string) => `sha256:${crypto.createHash('sha256').update(seed).digest('hex')}`;
let tempSeq = 0;
function makeAsset(overrides: Partial<Asset> = {}): Asset {
  tempSeq += 1;
  const asset: Asset = {
    id: `AST-T${tempSeq}`, projectId: 'PRJ-001', name: `临时资产 ${tempSeq}`, type: 'master', version: 1,
    status: 'review', owner: '测试', checksum: 'sha256:0000', territories: ['CN', 'US'],
    platforms: ['影院', 'StreamBox'], availableFrom: offsetDate(-1), availableTo: offsetDate(365), rightsTags: [],
    ...overrides,
  };
  assets.push(asset);
  return asset;
}
const baseInput = (assetId: string, seed: string, over: Record<string, unknown> = {}) => ({
  projectId: 'PRJ-001',
  reference: `contract://test/${seed}?n=${Math.random()}`,
  referenceType: 'contract' as const,
  digest: digestOf(seed),
  granter: `测试授权方 ${seed}`,
  territories: ['CN', 'US'],
  platforms: ['影院', 'StreamBox'],
  validFrom: offsetDate(-10),
  validTo: offsetDate(60),
  assetRefs: [{ assetId, version: 1 }],
  registeredBy: '测试法务',
  ...over,
});
const auditCodes = () => new Set(auditEvents.map(event => event.action));

test('登记的证据初始为 claimed，不凭空视为已验证；法务核验摘要一致后才计入覆盖', () => {
  const asset = makeAsset();
  const { record } = registerEvidence(baseInput(asset.id, 'claimed-flow'));
  assert.equal(record.digestStatus, 'claimed');
  let conclusion = evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: today() });
  assert.equal(conclusion.overallStatus, 'missing');
  assert.ok(conclusion.warnings.some(message => message.includes('claimed')));

  // 录入与原件不一致的摘要 → mismatch，仍然不参与覆盖
  attestEvidence(record.id, digestOf('tampered-file'), '测试法务');
  assert.equal(attestEvidence(record.id, digestOf('tampered-file'), '测试法务').digestStatus, 'mismatch');
  conclusion = evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: today() });
  assert.equal(conclusion.overallStatus, 'missing');

  // 法务对原件复核，摘要一致 → verified → covered
  attestEvidence(record.id, digestOf('claimed-flow'), '测试法务');
  conclusion = evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: today() });
  assert.equal(conclusion.overallStatus, 'covered');
  assert.deepEqual(conclusion.counts, { covered: 1, missing: 0, expired: 0, mismatch: 0 });
  assert.ok(auditCodes().has('EVIDENCE_REGISTER'));
  assert.ok(auditCodes().has('EVIDENCE_ATTEST'));
});

test('同一证据重复提交（无 token 的完全相同内容）只产生一条记录，无 token 时换引用即视为新证据', () => {
  const asset = makeAsset();
  const input = baseInput(asset.id, 'dedup', { reference: 'contract://test/dedup-fixed' });
  const first = registerEvidence(input);
  const second = registerEvidence({ ...input });
  assert.equal(second.duplicated, true);
  assert.equal(second.record.id, first.record.id);
  assert.equal(assetEvidence(asset.id).evidence.filter(item => item.id === first.record.id).length, 1);
});

test('clientToken 重放幂等：网络重试不会登记两条；带不同内容复用 token 被拒绝', () => {
  const asset = makeAsset();
  const token = `tok-${Math.random()}`;
  const input = baseInput(asset.id, 'token-idem', { clientToken: token });
  const first = registerEvidence(input);
  // 客户端没等到响应、用同一 token 原样重试：只产生一条
  const replay = registerEvidence({ ...input });
  assert.equal(first.record.id, replay.record.id);
  // 同一 token 绑定了不同内容：拒绝，防止重试串单
  assert.throws(() => registerEvidence({ ...input, granter: '换了授权方的内容' }), (error: unknown) => error instanceof LedgerError && error.code === 'TOKEN_CONTENT_CONFLICT');
});

test('台账写入连续失败后进入待重试日志，恢复后补提交成功，重复补提交不产生重复记录', () => {
  const asset = makeAsset();
  const token = `tok-fail-${Math.random()}`;
  const input = baseInput(asset.id, 'fail-retry', { clientToken: token });
  _armCommitFailures(3);
  let pendingToken: string | undefined;
  assert.throws(() => registerEvidence(input), (error: unknown) => {
    if (!(error instanceof LedgerError)) return false;
    pendingToken = error.retryToken;
    return error.code === 'LEDGER_WRITE_PENDING' && error.status === 503;
  });
  assert.equal(pendingToken, token);
  assert.equal(listPendingWrites().some(item => item.token === token), true);

  // 故障恢复，补提交成功
  const retried = retryPendingWrite(token);
  assert.equal(retried.duplicated, false);
  assert.equal(listPendingWrites().some(item => item.token === token), false);

  // 再次用同一 token 补提交（客户端没等到响应）→ 返回同一条，不重复
  const again = retryPendingWrite(token);
  assert.equal(again.duplicated, true);
  assert.equal(again.record.id, retried.record.id);
  assert.equal(assetEvidence(asset.id).evidence.filter(item => item.id === retried.record.id).length, 1);
});

test('一条证据可覆盖多个资产版本', () => {
  const a = makeAsset();
  const b = makeAsset();
  const { record } = registerEvidence(baseInput(a.id, 'multi-asset', { reference: `contract://multi/${Math.random()}`, assetRefs: [{ assetId: a.id, version: 1 }, { assetId: b.id, version: 1 }] }));
  attestEvidence(record.id, digestOf('multi-asset'), '测试法务');
  for (const asset of [a, b]) {
    const conclusion = evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: today() });
    assert.equal(conclusion.overallStatus, 'covered');
  }
});

test('全球地域与具体平台并存：地域通配但平台受限，未列平台判为范围不匹配', () => {
  const asset = makeAsset();
  const { record } = registerEvidence(baseInput(asset.id, 'global-cn', {
    reference: `contract://global/${Math.random()}`,
    territories: [GLOBAL_TERRITORY],
    platforms: ['影院'],
  }));
  attestEvidence(record.id, digestOf('global-cn'), '测试法务');
  const cinema = evaluateCoverage({ assetId: asset.id, territories: ['DE'], platforms: ['影院'], date: today() });
  const stream = evaluateCoverage({ assetId: asset.id, territories: ['DE'], platforms: ['StreamBox'], date: today() });
  assert.equal(cinema.overallStatus, 'covered');
  assert.equal(stream.overallStatus, 'mismatch');
  assert.ok(stream.cells[0].reasons.some(reason => reason.message.includes('平台 StreamBox')));
});

test('全平台许可用 *，任意平台都覆盖；地域不通配时未列地域判不匹配', () => {
  const asset = makeAsset();
  const { record } = registerEvidence(baseInput(asset.id, 'all-platforms', {
    reference: `contract://allp/${Math.random()}`,
    territories: ['CN'],
    platforms: [ALL_PLATFORMS],
  }));
  attestEvidence(record.id, digestOf('all-platforms'), '测试法务');
  assert.equal(evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['短视频'], date: today() }).overallStatus, 'covered');
  assert.equal(evaluateCoverage({ assetId: asset.id, territories: ['US'], platforms: ['短视频'], date: today() }).overallStatus, 'mismatch');
});

test('日期恰好到期：validTo 当日仍覆盖，次日判已过期；生效日前判缺证', () => {
  const asset = makeAsset();
  const boundary = offsetDate(20);
  const { record } = registerEvidence(baseInput(asset.id, 'boundary', {
    reference: `contract://boundary/${Math.random()}`,
    validFrom: offsetDate(5), validTo: boundary,
  }));
  attestEvidence(record.id, digestOf('boundary'), '测试法务');
  assert.equal(evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: boundary }).overallStatus, 'covered');
  assert.equal(evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: offsetDate(21) }).overallStatus, 'expired');
  assert.equal(evaluateCoverage({ assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: offsetDate(4) }).overallStatus, 'missing');
});

test('旧版本被新版本替代：旧证据不自动继承，必须为新版本重新提交', () => {
  const asset = makeAsset();
  const { record } = registerEvidence(baseInput(asset.id, 'v1-license'));
  attestEvidence(record.id, digestOf('v1-license'), '测试法务');
  registerAssetVersion({ assetId: asset.id, version: 2, supersedesVersion: 1, registeredBy: '后期制片' });

  const v1 = evaluateCoverage({ assetId: asset.id, version: 1, territories: ['CN'], platforms: ['影院'], date: today() });
  assert.equal(v1.overallStatus, 'covered');

  const v2 = evaluateCoverage({ assetId: asset.id, version: 2, territories: ['CN'], platforms: ['影院'], date: today() });
  assert.equal(v2.overallStatus, 'missing');
  assert.equal(v2.supersededVersion, 1);
  assert.ok(v2.warnings.some(message => message.includes('不自动继承')));
  assert.ok(v2.warnings.some(message => message.includes(record.id)));

  // 为新版本补证据后覆盖
  const renewed = registerEvidence(baseInput(asset.id, 'v2-license', { reference: `contract://v2/${Math.random()}`, assetRefs: [{ assetId: asset.id, version: 2 }] }));
  attestEvidence(renewed.record.id, digestOf('v2-license'), '测试法务');
  assert.equal(evaluateCoverage({ assetId: asset.id, version: 2, territories: ['CN'], platforms: ['影院'], date: today() }).overallStatus, 'covered');
  assert.ok(auditCodes().has('ASSET_VERSION_REGISTER'));
});

test('同一交付范围内多地域多平台逐格计算：covered/expired/mismatch 可并存', () => {
  const asset = makeAsset();
  const expiring = offsetDate(-1);
  const r1 = registerEvidence(baseInput(asset.id, 'mix-expired', { reference: `contract://mix1/${Math.random()}`, territories: ['CN'], platforms: ['影院'], validFrom: offsetDate(-30), validTo: expiring }));
  attestEvidence(r1.record.id, digestOf('mix-expired'), '测试法务');
  const r2 = registerEvidence(baseInput(asset.id, 'mix-us', { reference: `contract://mix2/${Math.random()}`, territories: ['US'], platforms: ['StreamBox'] }));
  attestEvidence(r2.record.id, digestOf('mix-us'), '测试法务');
  const conclusion = evaluateCoverage({ assetId: asset.id, territories: ['CN', 'US'], platforms: ['影院', 'StreamBox'], date: today() });
  const byCell = new Map(conclusion.cells.map(cell => [`${cell.territory}/${cell.platform}`, cell.status]));
  assert.equal(byCell.get('CN/影院'), 'expired');
  assert.equal(byCell.get('US/StreamBox'), 'covered');
  assert.equal(byCell.get('CN/StreamBox'), 'mismatch');
  assert.equal(byCell.get('US/影院'), 'mismatch');
  assert.equal(conclusion.overallStatus, 'expired');
  assert.deepEqual(conclusion.counts, { covered: 1, missing: 0, expired: 1, mismatch: 2 });
});

test('覆盖结论可附到审批并进入审计链；非 covered 结论可发起补证审批', () => {
  const asset = makeAsset();
  const target = { assetId: asset.id, territories: ['CN'], platforms: ['影院'], date: today() };
  const snapshot = attachCoverageToApproval('APR-02', target, '法务负责人');
  assert.equal(snapshot.conclusion.overallStatus, 'missing');
  assert.equal(snapshot.approvalId, 'APR-02');
  assert.ok(auditCodes().has('COVERAGE_EVALUATE'));
  assert.match(auditEvents[0].details, /覆盖结论 MISSING/);

  const followUp = appraiseCoverageForApproval('APR-02', target, '法务负责人', 'request-evidence', '请补母版授权');
  assert.ok(followUp.followUpApprovalId);
  assert.ok(auditCodes().has('COVERAGE_FOLLOWUP'));
});

test('登记校验：摘要格式、有效期、资产归属等非法输入被拒绝', () => {
  const asset = makeAsset();
  assert.throws(() => registerEvidence(baseInput(asset.id, 'bad-digest', { digest: 'sha256:abc' })), /64位十六进制/);
  assert.throws(() => registerEvidence(baseInput(asset.id, 'bad-date', { validTo: offsetDate(-100) })), /止日不能早于起日/);
  assert.throws(() => registerEvidence(baseInput(asset.id, 'bad-territory', { territories: [] })), /许可地域/);
  assert.throws(() => registerEvidence(baseInput('AST-NOPE', 'bad-asset')), /不存在/);
  assert.throws(() => registerEvidence(baseInput(asset.id, 'no-refs', { assetRefs: [] })), /至少要关联一个资产版本/);
});

test('assetEvidence 区分证据是否适用于当前版本', () => {
  const asset = makeAsset();
  const r1 = registerEvidence(baseInput(asset.id, 'current-flag'));
  registerAssetVersion({ assetId: asset.id, version: 2, supersedesVersion: 1, registeredBy: '后期制片' });
  const ledger = assetEvidence(asset.id);
  assert.equal(ledger.asset.version, 2);
  const evidence = ledger.evidence.find(item => item.id === r1.record.id);
  assert.equal(evidence?.appliesToCurrentVersion, false);
  assert.ok(ledger.lineage.some(item => item.version === 2 && item.supersedesVersion === 1));
});
