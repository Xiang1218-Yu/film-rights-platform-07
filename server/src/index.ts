import express from 'express';
import {
  approve,
  approvalRightsContext,
  assets,
  budgetLines,
  calculateApprovalRightsCoverage,
  conflictEvidenceContext,
  contracts,
  createApproval,
  dashboard,
  auditEvents,
  evaluateRightsCoverage,
  linkEvidenceToAssetVersion,
  markAssetVersionReplaced,
  projectSummary,
  projects,
  registerRightsEvidence,
  rightsConflictDetails,
  rightsConflicts,
  rightsEvidenceLedger
} from './domain.js';

const app = express();
app.use(express.json());

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/rights-conflicts/details', (req, res) => res.json(rightsConflictDetails(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));

app.get('/api/rights-evidence', (req, res) => {
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
  const version = typeof req.query.version === 'string' ? Number(req.query.version) : undefined;
  let result = rightsEvidenceLedger();
  if (assetId) result = result.filter(item => item.assetVersions.some(ref => ref.assetId === assetId && (!Number.isFinite(version) || ref.version === version)));
  res.json(result);
});
app.post('/api/rights-evidence', async (req, res) => {
  try {
    const result = await registerRightsEvidence(req.body, { actor: req.body.submittedBy ?? '法务控制台' });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : '证据登记失败' });
  }
});
app.post('/api/rights-evidence/:id/asset-versions', async (req, res) => {
  try { res.json(await linkEvidenceToAssetVersion(req.params.id, req.body.assetId, req.body.version, req.body.actor ?? '法务控制台')); }
  catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : '证据关联失败' }); }
});
app.post('/api/asset-versions/:assetId/:version/replaced', (req, res) => {
  try { res.json(markAssetVersionReplaced(req.params.assetId, Number(req.params.version), req.body?.actor ?? '法务控制台')); }
  catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : '版本替代登记失败' }); }
});
app.post('/api/rights-coverage', (req, res) => {
  const { writeAudit = true, actor: bodyActor, ...scope } = req.body;
  try { res.json(evaluateRightsCoverage(scope, { writeAudit, actor: bodyActor ?? '法务控制台' })); }
  catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : '覆盖计算失败' }); }
});
app.get('/api/rights-conflicts/:key/evidence-context', (req, res) => {
  const context = conflictEvidenceContext(decodeURIComponent(req.params.key));
  if (!context) return res.status(404).json({ message: '冲突不存在' });
  res.json(context);
});
app.get('/api/approvals/:id/rights-context', (req, res) => {
  const context = approvalRightsContext(req.params.id);
  if (!context) return res.status(404).json({ message: '审批不存在' });
  res.json(context);
});
app.post('/api/approvals/:id/rights-coverage', (req, res) => {
  try {
    const result = calculateApprovalRightsCoverage(req.params.id, req.body ?? {}, req.body?.actor ?? '法务控制台');
    if (!result) return res.status(404).json({ message: '审批不存在' });
    res.json(result);
  } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : '审批覆盖计算失败' }); }
});

app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment, req.body.actor ?? '当前审批人'); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });
app.get('/api/audit-events', (_req, res) => res.json(auditEvents));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

const port = Number(process.env.PORT || 4104);
app.listen(port, () => console.log(`film rights API listening on ${port}`));
