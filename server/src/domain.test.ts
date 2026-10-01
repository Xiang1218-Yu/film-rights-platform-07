import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approve,
  auditEvents,
  calculateApprovalRightsCoverage,
  conflictEvidenceContext,
  evaluateRightsCoverage,
  evidenceStore,
  linkEvidenceToAssetVersion,
  markAssetVersionReplaced,
  projectSummary,
  registerRightsEvidence,
  rightsConflictDetails,
  rightsConflicts,
  rightsEvidenceLedger,
  scheduleEvidenceLedgerFailureForTest
} from './domain.js';

const digestA = 'a111111111111111111111111111111111111111111111111111111111111111';
const digestB = '9152d3c8f1ed6f2d4476c8ed0aae40e76e6bdc295415167796598d3125a4169c';
const digestC = '11cab297baeb247e608d51f777782f4a3aa99d13b0f672a92540026d3ea3582f';
const today = () => new Date().toISOString().slice(0, 10);
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const seedKey = (suffix: string) => ({ assetVersions: ['AST-002'], territories: ['CN'], platforms: ['StreamBox'], validFrom: future(-5), validTo: future(20), licensor: '测试授权方', digest: digestA, reference: `TEST-${suffix}` });

test('budget summary exposes forecast variance and high risk lines', () => {
  const summary = projectSummary('PRJ-001');
  assert.equal(summary.lines.length, 4);
  assert.ok(summary.forecast > summary.planned);
  assert.equal(summary.highRiskLines.length, 1);
});

test('rights conflict engine detects overlapping licensed assets', () => {
  const conflicts = rightsConflicts('PRJ-001');
  assert.ok(conflicts.length >= 1);
  assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可')));
});

test('approval changes are auditable and stateful', () => {
  const before = projectSummary('PRJ-001').approvals.find(item => item.id === 'APR-01');
  assert.equal(before?.status, 'pending');
  const result = approve('APR-01', 'approved', '预算已复核');
  assert.equal(result?.status, 'approved');
  assert.equal(result?.comment, '预算已复核');
});

test('rights evidence can cover several asset versions and duplicate submission is idempotent', async () => {
  const input = { ...seedKey('MULTI'), reference: 'TEST-MULTI-ASSET', assetVersions: ['AST-002', { assetId: 'AST-002', version: 2 }] };
  const first = await registerRightsEvidence(input, { audit: true, actor: '测试法务' });
  const second = await registerRightsEvidence(input, { audit: true, actor: '测试法务' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.evidence.id, first.evidence.id);
  assert.equal(second.evidence.verification.externalContentVerified, false);
  assert.equal(second.evidence.assetVersions.length, 2);
  const report = evaluateRightsCoverage({ date: today(), assetVersions: [{ assetId: 'AST-002', version: 2, territories: ['CN'], platforms: ['StreamBox'] }] }, { writeAudit: false });
  assert.equal(report.items[0].status, 'covered');
});

test('same reference and digest remains one document even with another idempotency key', async () => {
  const input = { ...seedKey('DOC'), reference: 'TEST-DOC-DUP', digest: `f${'6'.repeat(63)}`, assetVersions: ['AST-002', { assetId: 'AST-002', version: 4 }] };
  const first = await registerRightsEvidence(input, { audit: false });
  const resubmitted = await registerRightsEvidence({ ...input, idempotencyKey: 'client-retry-1', territories: ['US'] }, { audit: false });
  assert.equal(first.evidence.assetVersions.length, 1);
  assert.equal(resubmitted.duplicate, true);
  assert.equal(resubmitted.evidence.id, first.evidence.id);
  assert.deepEqual(resubmitted.evidence.territories, ['CN']);
});

test('global territory does not bypass explicit platform scope', async () => {
  await registerRightsEvidence({ ...seedKey('GLOBAL'), reference: 'TEST-GLOBAL-SCOPE', digest: digestB, territories: ['全球'], platforms: ['StreamBox'] }, { audit: false });
  const report = evaluateRightsCoverage({ date: today(), assetVersions: [{ assetId: 'AST-002', version: 4, territories: ['US'], platforms: ['短视频'] }] }, { writeAudit: false });
  assert.equal(report.items[0].status, 'scope_mismatch');
  assert.ok(report.items[0].reason.includes('平台'));
});

test('the exact valid-to date remains covered while the next day expires', async () => {
  await registerRightsEvidence({ ...seedKey('BOUNDARY'), reference: 'TEST-DATE-BOUNDARY', digest: digestC, assetVersions: ['AST-004'], validTo: today() }, { audit: false });
  const onLastDay = evaluateRightsCoverage({ date: today(), assetVersions: [{ assetId: 'AST-004', version: 3, territories: ['CN'], platforms: ['StreamBox'] }] }, { writeAudit: false });
  const afterLastDay = evaluateRightsCoverage({ date: future(1), assetVersions: [{ assetId: 'AST-004', version: 3, territories: ['CN'], platforms: ['StreamBox'] }] }, { writeAudit: false });
  assert.equal(onLastDay.items[0].status, 'covered');
  assert.equal(afterLastDay.items[0].status, 'expired');
});

test('old asset versions remain explicitly superseded and do not automatically cover the new version', () => {
  markAssetVersionReplaced('AST-001', 6, '测试法务');
  const oldVersion = evaluateRightsCoverage({ date: today(), assetVersions: [{ assetId: 'AST-001', version: 6, territories: ['CN'], platforms: ['StreamBox'] }] }, { writeAudit: false });
  assert.equal(oldVersion.items[0].superseded, true);
  assert.equal(oldVersion.items[0].status, 'scope_mismatch');
  const evidence = rightsEvidenceLedger().find(item => item.reference === 'LIC-NORTHSTAR-MASTER-2026');
  assert.ok(evidence?.assetVersions.find(ref => ref.assetId === 'AST-001' && ref.version === 6)?.supersededByVersion);
});

test('payment proof without a granting contract remains missing evidence', () => {
  const report = evaluateRightsCoverage({ date: today(), assetVersions: [{ assetId: 'AST-003', version: 2, territories: ['CN'], platforms: ['StreamBox'] }] }, { writeAudit: false });
  assert.equal(report.items[0].status, 'missing');
  assert.deepEqual(report.items[0].supportingEvidenceIds.length >= 1, true);
});

test('ledger write failures are retried without creating duplicate evidence', async () => {
  scheduleEvidenceLedgerFailureForTest(1);
  const before = evidenceStore.list().length;
  const result = await registerRightsEvidence({ ...seedKey('RETRY'), reference: 'TEST-RETRY-WRITE', digest: 'a444444411111111111111111111111111111111111111111111111111111111' }, { audit: false });
  assert.equal(result.duplicate, false);
  assert.equal(evidenceStore.list().length, before + 1);
});

test('evidence can be attached to another asset version after discovery', async () => {
  const evidence = (await registerRightsEvidence({ ...seedKey('LINK'), reference: 'TEST-LINK-LATER', digest: '8d9d6623980e3cbdf7e66bfc528fc3dc131813b309058fb75c372c2dd7d991b8', assetVersions: [{ assetId: 'AST-002', version: 1 }] }, { audit: false })).evidence;
  const linked = await linkEvidenceToAssetVersion(evidence.id, 'AST-002', 2, '测试法务');
  const repeated = await linkEvidenceToAssetVersion(evidence.id, 'AST-002', 2, '测试法务');
  assert.equal(linked.duplicate, false);
  assert.equal(repeated.duplicate, true);
});

test('conflict and approval contexts expose related evidence and write auditable coverage', () => {
  const conflict = rightsConflictDetails('PRJ-001').find(item => item.assetAId === 'AST-001' || item.assetBId === 'AST-001');
  assert.ok(conflict);
  const context = conflictEvidenceContext(conflict!.key);
  assert.ok(context?.evidence.some(item => item.reference === 'LIC-NORTHSTAR-MASTER-2026'));
  const auditBefore = auditEvents.length;
  const approvalCoverage = calculateApprovalRightsCoverage('APR-02', {}, '测试法务');
  assert.equal(approvalCoverage?.coverage.items[0].assetId, 'AST-001');
  assert.ok(auditEvents.length > auditBefore);
  assert.ok(auditEvents.some(item => item.entityId === 'APR-02' && item.action === 'RIGHTS_COVERAGE_CALCULATED'));
});
