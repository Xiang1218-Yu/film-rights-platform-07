import express from 'express';
import { approve, assets, budgetLines, contracts, createApproval, dashboard, projectSummary, projects, rightsConflicts } from './domain.js';
import {
  LedgerError,
  appraiseCoverageForApproval,
  assetEvidence,
  attachCoverageToApproval,
  approvalCoverage,
  attestEvidence,
  evaluateCoverage,
  getEvidence,
  listPendingWrites,
  projectEvidence,
  registerAssetVersion,
  registerEvidence,
  retryPendingWrite,
} from './evidence.js';

const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/projects/:id/evidence', (req, res) => res.json(projectEvidence(req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });

// ---- 授权证据台账 ----
app.get('/api/assets/:id/evidence', (req, res) => { try { res.json(assetEvidence(req.params.id)); } catch (error) { sendLedgerError(res, error); } });
app.post('/api/evidence', (req, res) => {
  try {
    const result = registerEvidence(req.body);
    res.status(result.duplicated ? 200 : 201).json({ ...result.record, duplicated: result.duplicated });
  } catch (error) { sendLedgerError(res, error); }
});
app.post('/api/evidence/:id/attest', (req, res) => {
  try { res.json(attestEvidence(req.params.id, req.body.observedDigest, req.body.actor || '法务复核人')); }
  catch (error) { sendLedgerError(res, error); }
});
app.post('/api/evidence-pending/:token/retry', (req, res) => {
  try { const result = retryPendingWrite(req.params.token); res.status(result.duplicated ? 200 : 201).json({ ...result.record, duplicated: result.duplicated, pendingToken: result.pendingToken }); }
  catch (error) { sendLedgerError(res, error); }
});
app.get('/api/evidence-pending', (req, res) => res.json(listPendingWrites(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
app.post('/api/assets/:id/versions', (req, res) => {
  try { res.status(201).json(registerAssetVersion({ assetId: req.params.id, version: req.body.version, supersedesVersion: req.body.supersedesVersion, registeredBy: req.body.registeredBy })); }
  catch (error) { sendLedgerError(res, error); }
});
app.post('/api/coverage/evaluate', (req, res) => {
  try { res.json(evaluateCoverage(req.body)); } catch (error) { sendLedgerError(res, error); }
});
app.post('/api/approvals/:id/coverage', (req, res) => {
  try { res.status(201).json(attachCoverageToApproval(req.params.id, req.body.target, req.body.actor || '法务控制台')); }
  catch (error) { sendLedgerError(res, error); }
});
app.get('/api/approvals/:id/coverage', (req, res) => { const result = approvalCoverage(req.params.id); if (!result) return res.status(404).json({ message: '该审批尚未附带覆盖结论' }); res.json(result); });
app.post('/api/approvals/:id/coverage-decision', (req, res) => {
  try { res.status(201).json(appraiseCoverageForApproval(req.params.id, req.body.target, req.body.actor || '法务控制台', req.body.decision, req.body.comment || '')); }
  catch (error) { sendLedgerError(res, error); }
});
app.get('/api/evidence/:id', (req, res) => { const result = getEvidence(req.params.id); if (!result) return res.status(404).json({ message: '证据不存在' }); res.json(result); });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

function sendLedgerError(res: express.Response, error: unknown) {
  if (error instanceof LedgerError) return res.status(error.status).json({ message: error.message, code: error.code, retryToken: error.retryToken });
  console.error(error);
  res.status(500).json({ message: '台账服务内部错误', code: 'LEDGER_INTERNAL' });
}

const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
