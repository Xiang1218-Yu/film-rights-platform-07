import { useCallback, useEffect, useMemo, useState } from 'react';

type Project = { id: string; title: string; status: string; deliveryDate: string };
type Asset = { id: string; name: string; type: string; version: number; status: string; availableTo: string; territories: string[]; platforms: string[] };
type Summary = {
  planned: number; forecast: number; actual: number; variance: number; utilization: number; committed: number; contractExposure: number;
  assetCount: number; pendingApprovals: number;
  highRiskLines: { subcategory: string; forecast: number; planned: number }[];
  lines: { id: string; category: string; subcategory: string; planned: number; forecast: number; actual: number; risk: string }[];
  contracts: { vendor: string; scope: string; committed: number; paid: number; milestones: { name: string; due: string; status: string }[] }[];
  assets: Asset[];
  approvals: Approval[];
  project: Project;
};
type Approval = { id: string; title: string; status: string; approver: string; entityType: string; entityId: string };
type Conflict = { key: string; severity: string; assetAId: string; assetBId: string; assetAVersion: number; assetBVersion: number; assetA: string; assetB: string; reason: string };
type EvidenceKind = 'contract' | 'amendment' | 'payment_proof' | 'other';
type AssetVersionRef = { assetId: string; version: number; currentVersion?: number; assetName?: string; supersededByVersion?: number };
type RightsEvidence = {
  id: string; kind: EvidenceKind; title: string; reference: string; uri?: string; licensor: string;
  digest: { algorithm: string; value: string }; assetVersions: AssetVersionRef[]; territories: string[]; platforms: string[];
  validFrom: string; validTo: string; grantsRights: boolean; submittedBy: string; submittedAt: string;
  verification: { state: string; externalContentVerified: boolean; digestVerifiedAgainstContent: boolean; note: string };
};
type CoverageStatus = 'covered' | 'missing' | 'expired' | 'scope_mismatch';
type CoveragePair = { territory: string; platform: string; status: CoverageStatus; reason: string; evidenceIds: string[] };
type CoverageItem = { assetId: string; assetName: string; version: number; currentVersion: number; superseded: boolean; supersededByVersion?: number; status: CoverageStatus; reason: string; territories: string[]; platforms: string[]; pairs: CoveragePair[]; matchedEvidenceIds: string[]; expiredEvidenceIds: string[]; supportingEvidenceIds: string[] };
type CoverageReport = { date: string; status: CoverageStatus; totals: Record<CoverageStatus, number>; items: CoverageItem[]; verification: { note: string } };
type CoverageScope = { projectId?: string; date?: string; territories?: string[]; platforms?: string[]; assetVersions: Array<{ assetId: string; version?: number; territories?: string[]; platforms?: string[] }> };
type AuditItem = { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string };
type EvidenceContext = { source: 'conflict' | 'approval' | 'asset'; title: string; scope?: CoverageScope; note: string; approvalId?: string; conflictKey?: string; evidence?: RightsEvidence[] };
type EvidenceForm = { kind: EvidenceKind; title: string; reference: string; digest: string; licensor: string; assetVersions: string; territories: string; platforms: string; validFrom: string; validTo: string; grantsRights: boolean };

const money = (n: number) => `¥${(n / 10000).toFixed(0)}万`;
const api = '/api';
const statusLabel: Record<CoverageStatus, string> = { covered: '已覆盖', missing: '缺证', expired: '已过期', scope_mismatch: '范围不匹配' };
const kindLabel: Record<EvidenceKind, string> = { contract: '授权合同', amendment: '补充条款', payment_proof: '付款凭证', other: '其他证据' };
const dateOffset = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const splitList = (value: string) => value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
const emptyForm = (): EvidenceForm => ({ kind: 'contract', title: '', reference: '', digest: '', licensor: '', assetVersions: 'AST-001@v7', territories: 'CN, HK, SG', platforms: '影院, StreamBox', validFrom: dateOffset(-1), validTo: dateOffset(365), grantsRights: true });

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `请求失败 (${response.status})`);
  return body as T;
}
function scopeForAssets(projectId: string, assets: Asset[], date = dateOffset(0)): CoverageScope {
  return { projectId, date, assetVersions: assets.map(asset => ({ assetId: asset.id, version: asset.version, territories: asset.territories, platforms: asset.platforms })) };
}
function parseAssetVersions(value: string) {
  return splitList(value).map(item => {
    const match = item.match(/^(AST-[^@\s]+)(?:@v?(\d+))?$/i);
    if (!match) throw new Error(`资产版本格式不正确：${item}，请使用 AST-001@v7`);
    return { assetId: match[1].toUpperCase(), ...(match[2] ? { version: Number(match[2]) } : {}) };
  });
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [evidence, setEvidence] = useState<RightsEvidence[]>([]);
  const [coverage, setCoverage] = useState<CoverageReport>();
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [evidenceContext, setEvidenceContext] = useState<EvidenceContext>();
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<EvidenceForm>(emptyForm);

  const calculateCoverage = useCallback(async (scope: CoverageScope, writeAudit: boolean) => request<CoverageReport>('/rights-coverage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, writeAudit })
  }), []);

  const load = useCallback(async (id = 'PRJ-001') => {
    setLoading(true); setError('');
    try {
      const items = await request<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c, allEvidence, auditList] = await Promise.all([
        request<Summary>(`/projects/${active.id}/summary`),
        request<Conflict[]>(`/projects/${active.id}/rights-conflicts/details`),
        request<RightsEvidence[]>('/rights-evidence'),
        request<AuditItem[]>('/audit-events')
      ]);
      const projectAssetIds = new Set(s.assets.map(asset => asset.id));
      const projectEvidence = allEvidence.filter(item => item.assetVersions.some(ref => projectAssetIds.has(ref.assetId)));
      const report = await calculateCoverage(scopeForAssets(active.id, s.assets), false);
      setProjects(items); setSelected(active.id); setSummary(s); setConflicts(c); setEvidence(projectEvidence); setCoverage(report); setAudits(auditList); setEvidenceContext(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接制作服务');
    } finally { setLoading(false); }
  }, [calculateCoverage]);

  useEffect(() => { void load(); }, [load]);

  const refreshAudit = async () => setAudits(await request<AuditItem[]>('/audit-events'));
  const approve = async (id: string) => {
    try {
      await request(`/approvals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', comment: '在控制台完成复核；覆盖结论已写入审计链' }) });
      setMessage('审批已通过，授权覆盖结论和审批动作已写入审计事件');
      await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审批操作失败'); }
  };
  const openConflictEvidence = async (conflict: Conflict) => {
    try {
      const context = await request<{ evidence: RightsEvidence[]; coverageScope: CoverageScope }>(`/rights-conflicts/${encodeURIComponent(conflict.key)}/evidence-context`);
      setTab('rights');
      setEvidenceContext({ source: 'conflict', conflictKey: conflict.key, title: `冲突证据：${conflict.assetA} ↔ ${conflict.assetB}`, scope: context.coverageScope, evidence: context.evidence, note: conflict.reason });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法打开冲突证据上下文'); }
  };
  const openApprovalEvidence = async (approval: Approval) => {
    setTab('rights');
    try {
      const context = await request<{ scope?: CoverageScope; canEvaluate: boolean; note: string }>(`/approvals/${approval.id}/rights-context`);
      const ids = new Set((context.scope?.assetVersions ?? []).map(item => item.assetId));
      setEvidenceContext({ source: 'approval', approvalId: approval.id, title: `审批证据：${approval.title}`, scope: context.scope, note: context.note, evidence: evidence.filter(item => item.assetVersions.some(ref => ids.has(ref.assetId))) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法打开审批证据上下文'); }
  };
  const openAssetEvidence = (asset: Asset) => {
    setTab('rights');
    setEvidenceContext({ source: 'asset', title: `资产证据：${asset.name} v${asset.version}`, scope: scopeForAssets(selected, [asset]), note: '按该资产版本登记的地域、平台和当前日期计算覆盖。', evidence: evidence.filter(item => item.assetVersions.some(ref => ref.assetId === asset.id && ref.version === asset.version)) });
  };
  const calculateContextCoverage = async () => {
    if (!evidenceContext?.scope) return;
    try {
      let report: CoverageReport;
      if (evidenceContext.approvalId) {
        const result = await request<{ coverage: CoverageReport }>(`/approvals/${evidenceContext.approvalId}/rights-coverage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        report = result.coverage;
      } else {
        report = await calculateCoverage(evidenceContext.scope, true);
      }
      setCoverage(report); await refreshAudit(); setMessage(`覆盖结论“${statusLabel[report.status]}”已写入审计链`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '覆盖计算失败'); }
  };
  const recalculateProjectCoverage = async (writeAudit: boolean) => {
    if (!summary) return;
    try { setCoverage(await calculateCoverage(scopeForAssets(selected, summary.assets), writeAudit)); if (writeAudit) { await refreshAudit(); setMessage('项目覆盖结论已写入审计链'); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : '覆盖计算失败'); }
  };
  const submitEvidence = async () => {
    try {
      const payload = {
        ...form,
        digest: form.digest.trim(),
        assetVersions: parseAssetVersions(form.assetVersions),
        territories: splitList(form.territories),
        platforms: splitList(form.platforms),
        submittedBy: '法务控制台'
      };
      const result = await request<{ evidence: RightsEvidence; duplicate: boolean; reason?: string }>('/rights-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      setMessage(result.duplicate ? `同一证据已存在：${result.evidence.id}，未重复写入` : `证据 ${result.evidence.id} 已登记，并写入审计链`);
      setForm(emptyForm()); await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '证据登记失败'); }
  };
  const markReplaced = async (asset: Asset) => {
    try {
      await request(`/asset-versions/${asset.id}/${asset.version}/replaced`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: '法务控制台' }) });
      setMessage(`已登记 ${asset.id}@v${asset.version} 被新版本替代；旧证据不会自动覆盖新版本`);
      await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '版本替代登记失败'); }
  };
  const variancePct = useMemo(() => summary ? Math.round(summary.variance / summary.planned * 100) : 0, [summary]);
  const contextEvidence = evidenceContext?.evidence ?? [];

  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{error || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端和 API 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  return <main>
    <header><div><div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div><h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1><p>将预算承诺、供应商付款、资产版本与授权证据串成可审计的交付链路；外部文件只登记引用和摘要，不把文件内容当作已验证。</p></div><div className="header-actions"><select value={selected} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select><span className="live"><i /> LIVE CONTROL</span></div></header>
    {message && <div className="toast" onClick={() => setMessage('')}>{message} ×</div>}{error && <div className="toast error-toast" onClick={() => setError('')}>{error} ×</div>}

    <section className="kpis"><div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div><div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>版本与供应商承诺</span></div><div><small>EVIDENCE LEDGER</small><b>{evidence.length}<em> 份</em></b><span>合同 / 补充条款 / 付款凭证引用</span></div><div><small>RIGHTS QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{coverage ? `缺证 ${coverage.totals.missing} / 过期 ${coverage.totals.expired} / 不匹配 ${coverage.totals.scope_mismatch}` : `${conflicts.length} 条冲突 / ${summary.pendingApprovals} 个审批`}</span></div></section>
    <nav className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button><button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button><button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>授权证据台账</button><span>交付日 {summary.project.deliveryDate}</span></nav>

    {tab === 'overview' && <div className="grid"><section className="panel hero"><div className="panel-head"><div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div><span className="badge amber">{summary.project.status.toUpperCase()}</span></div><div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div><div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div><div className="split"><div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div><div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div><div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div></div></section>
      <section className="panel"><div className="panel-head"><h3>待审批队列</h3><span>{summary.approvals.filter(a => a.status === 'pending').length} PENDING</span></div>{summary.approvals.map(a => <div className="approval" key={a.id}><span className={`status ${a.status}`} /><div><b>{a.title}</b><small>{a.approver} · {a.id} · {a.entityType}</small></div><button className="secondary" onClick={() => void openApprovalEvidence(a)}>证据</button>{a.status === 'pending' ? <button onClick={() => void approve(a.id)}>通过</button> : <em>已完成</em>}</div>)}</section>
      <section className="panel wide"><div className="panel-head"><h3>交付风险雷达</h3><span>从冲突或审批直接进入证据版本</span></div>{conflicts.length ? conflicts.map(c => <div className="risk-row" key={c.key}><strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong><div><b>{c.assetA} v{c.assetAVersion}</b><small>↔ {c.assetB} v{c.assetBVersion} · {c.reason}</small></div><button className="secondary" onClick={() => void openConflictEvidence(c)}>查看证据</button></div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}</section></div>}

    {tab === 'budget' && <div className="grid"><section className="panel wide"><div className="panel-head"><h3>预算版本 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div><div className="table"><div className="tr th budget-grid"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>{summary.lines.map(line => <div className="tr budget-grid" key={line.id}><span><b>{line.category}</b><small>{line.subcategory}</small></span><span>{money(line.planned)}</span><span>{money(line.planned)}</span><span>{money(line.actual)}</span><span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span><span className={`risk ${line.risk}`}>{line.risk}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h3>供应商付款里程碑</h3></div>{summary.contracts.map(c => <div className="contract" key={c.vendor}><b>{c.vendor}</b><small>{c.scope}</small><div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div><span>{money(c.paid)} / {money(c.committed)}</span><em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点</em></div>)}</section></div>}

    {tab === 'rights' && <div className="grid">
      <section className="panel wide coverage-panel"><div className="panel-head"><div><div className="eyebrow">DELIVERY SCOPE / {coverage?.date}</div><h3>授权覆盖计算</h3></div><div className="actions"><button className="secondary" onClick={() => void recalculateProjectCoverage(false)}>重新计算</button><button onClick={() => void recalculateProjectCoverage(true)}>写入审计结论</button></div></div>
        {coverage && <div className="coverage-summary"><span className={`coverage ${coverage.status}`}>{statusLabel[coverage.status]}</span><b>已覆盖 {coverage.totals.covered}</b><b className="bad">缺证 {coverage.totals.missing}</b><b className="expired">已过期 {coverage.totals.expired}</b><b className="mismatch">不匹配 {coverage.totals.scope_mismatch}</b><small>{coverage.verification.note}</small></div>}
        <div className="coverage-list">{coverage?.items.map(item => <div className="coverage-item" key={`${item.assetId}-${item.version}`}><div><b>{item.assetName} <em>v{item.version}</em>{item.superseded && <span className="superseded">已被 v{item.supersededByVersion} 替代</span>}</b><small>{item.territories.join('、')} · {item.platforms.join('、')}</small><small>{item.reason}</small></div><span className={`coverage ${item.status}`}>{statusLabel[item.status]}</span></div>)}</div>
      </section>

      {evidenceContext && <section className="panel wide context-panel"><div className="panel-head"><div><div className="eyebrow">EVIDENCE CONTEXT / {evidenceContext.source}</div><h3>{evidenceContext.title}</h3></div><button className="secondary" onClick={() => setEvidenceContext(undefined)}>关闭上下文</button></div><p>{evidenceContext.note}</p>{evidenceContext.scope && <div className="scope-box">{evidenceContext.scope.assetVersions.map(target => <span key={`${target.assetId}-${target.version ?? 'current'}`}>{target.assetId}@{target.version ? `v${target.version}` : 'current'} · {(target.territories ?? []).join('、')} · {(target.platforms ?? []).join('、')}</span>)}</div>}<div className="actions"><button onClick={() => void calculateContextCoverage()} disabled={!evidenceContext.scope}>{evidenceContext.approvalId ? '计算审批覆盖并入审计' : '计算覆盖并入审计'}</button></div>{contextEvidence.length > 0 && <div className="evidence-mini-list">{contextEvidence.map(item => <span key={item.id}>{item.id} · {item.title} · {item.validFrom}→{item.validTo}</span>)}</div>}</section>}

      <section className="panel wide"><div className="panel-head"><h3>登记授权证据</h3><span>仅保存引用与提交的 SHA-256 摘要</span></div><div className="evidence-form">
        <label>类型<select value={form.kind} onChange={e => { const kind = e.target.value as EvidenceKind; setForm({ ...form, kind, grantsRights: kind !== 'payment_proof' }); }}><option value="contract">授权合同</option><option value="amendment">补充条款</option><option value="payment_proof">付款凭证</option><option value="other">其他</option></select></label>
        <label>证据标题<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例如：多平台授权合同补充条款" /></label>
        <label>证据引用 *<input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="CONTRACT-2026-001 / 版权方邮件编号" /></label>
        <label>授权方 *<input value={form.licensor} onChange={e => setForm({ ...form, licensor: e.target.value })} /></label>
        <label className="wide">SHA-256 摘要 *<input value={form.digest} onChange={e => setForm({ ...form, digest: e.target.value })} placeholder="64 位十六进制，可带 sha256: 前缀" /></label>
        <label className="wide">资产版本 *<input value={form.assetVersions} onChange={e => setForm({ ...form, assetVersions: e.target.value })} placeholder="AST-001@v7, AST-001@v6" /></label>
        <label>地域 *<input value={form.territories} onChange={e => setForm({ ...form, territories: e.target.value })} placeholder="全球 或 CN, US, HK" /></label>
        <label>平台 *<input value={form.platforms} onChange={e => setForm({ ...form, platforms: e.target.value })} placeholder="影院, StreamBox, 短视频" /></label>
        <label>生效日<input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} /></label>
        <label>到期日（当天仍覆盖）<input type="date" value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} /></label>
        <label className="checkbox"><input type="checkbox" checked={form.grantsRights} onChange={e => setForm({ ...form, grantsRights: e.target.checked })} /> 该文件授予许可权利（付款凭证通常不勾选）</label>
        <button onClick={() => void submitEvidence()}>登记证据并写审计</button>
      </div><p className="verification-note">系统不会拉取外部文件，也不会声称摘要已与文件内容比对；接入版权方接口或对象存储后才能升级为内容已验证。</p></section>

      <section className="panel wide"><div className="panel-head"><h3>证据台账</h3><span>{evidence.length} registered references</span></div><div className="evidence-table">{evidence.map(item => <article key={item.id}><div className="evidence-head"><b>{item.title}</b><span className={`kind ${item.grantsRights ? 'grant' : 'support'}`}>{item.grantsRights ? '授予权利' : '辅助证据'}</span></div><small>{item.id} · {kindLabel[item.kind]} · {item.reference}</small><small>授权方：{item.licensor}</small><small>有效期：{item.validFrom} 至 {item.validTo}（到期日当天覆盖）</small><small>范围：{item.territories.join('、')} / {item.platforms.join('、')}</small><div className="version-tags">{item.assetVersions.map(ref => <span key={`${ref.assetId}-${ref.version}`}>{ref.assetId}@v{ref.version}{ref.supersededByVersion ? ` → v${ref.supersededByVersion}` : ''}</span>)}</div><small className="unverified">外部内容未验证 · {item.digest.algorithm}:{item.digest.value.slice(0, 10)}…</small></article>)}</div></section>

      <section className="panel"><div className="panel-head"><h3>资产版本</h3><span>{summary.assets.length} versions</span></div>{summary.assets.map(a => <div className="asset-row" key={a.id}><div><b>{a.name}</b><small>v{a.version} · {a.territories.join('、')} · {a.platforms.join('、')}</small></div><span className="row-actions"><button className="secondary" onClick={() => openAssetEvidence(a)}>证据</button><button className="secondary" onClick={() => { const oldVersion = window.prompt(`将哪个旧版本标记为被 v${a.version} 替代？`); if (oldVersion) void markReplaced({ ...a, version: Number(oldVersion) }); }}>标记旧版替代</button></span></div>)}</section>
      <section className="panel"><div className="panel-head"><h3>审批 / 审计链</h3><span>证据与覆盖变更</span></div><div className="audit-list">{audits.filter(a => a.action.includes('RIGHTS') || a.action.includes('EVIDENCE') || a.action === 'APPROVED' || a.action === 'REJECTED').slice(0, 10).map(a => <div key={a.id}><b>{a.action}</b><small>{a.entity} / {a.entityId} · {a.actor}</small><small>{a.details}</small></div>)}</div></section>
    </div>}
    <footer>FrameLedger · 内存证据元数据 + REST API · 现有 /assets 查询形状保持不变 · 可替换为对象存储、版权方验真和持久化台账</footer>
  </main>;
}
