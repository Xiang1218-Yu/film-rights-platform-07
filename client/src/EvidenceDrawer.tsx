import { useCallback, useEffect, useState } from 'react';
import {
  CoverageStatus,
  digestLabel,
  EvidenceRecord,
  evidenceApi,
  referenceTypeLabel,
  statusLabel,
  type AssetLedger,
  type CoverageConclusion,
  type LedgerApiError,
} from './evidence';

interface ApprovalContext { id: string; title: string; target?: { territories: string[]; platforms: string[]; date: string } }

interface Props {
  assetId: string;
  projectId: string;
  deliveryDate: string;
  actor: string;
  approval?: ApprovalContext;
  onClose: () => void;
  onChanged: () => void;
}

const joinList = (items: string[]) => items.join('、') || '—';
const statusClass = (status: CoverageStatus) => `coverage-pill ${status}`;
const shortDigest = (digest: string) => (digest.length > 22 ? `${digest.slice(0, 15)}…${digest.slice(-6)}` : digest);
const today = () => new Date().toISOString().slice(0, 10);
const uuidToken = () => (crypto.randomUUID ? crypto.randomUUID() : `tok-${Date.now()}-${Math.random()}`);

const emptyForm = (ledger: AssetLedger) => ({
  granter: '', referenceType: 'contract' as EvidenceRecord['referenceType'], reference: '', digest: '',
  territories: ledger.asset.territories.join(', '), platforms: ledger.asset.platforms.join(', '),
  validFrom: today(), validTo: ledger.asset.availableTo,
  versions: String(ledger.asset.version), registeredBy: '法务控制台',
});

export default function EvidenceDrawer({ assetId, projectId, deliveryDate, actor, approval, onClose, onChanged }: Props) {
  const [ledger, setLedger] = useState<AssetLedger>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [territories, setTerritories] = useState('');
  const [platforms, setPlatforms] = useState('');
  const [date, setDate] = useState(deliveryDate);
  const [conclusion, setConclusion] = useState<CoverageConclusion>();
  const [snapshotId, setSnapshotId] = useState('');
  const [attestTargets, setAttestTargets] = useState<Record<string, string>>({});

  const [form, setForm] = useState<ReturnType<typeof emptyForm> | undefined>(undefined);
  const [formToken, setFormToken] = useState(uuidToken());
  const [pendingToken, setPendingToken] = useState('');

  const reload = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const next = await evidenceApi.assetLedger(assetId);
      setLedger(next);
      setForm(current => ({
        ...emptyForm(next),
        granter: current?.granter ?? '', reference: current?.reference ?? '',
        digest: current?.digest ?? '', registeredBy: current?.registeredBy ?? '法务控制台',
      }));
      if (!territories) {
        const initial = approval?.target;
        setTerritories((initial?.territories ?? next.asset.territories).join(', '));
        setPlatforms((initial?.platforms ?? next.asset.platforms).join(', '));
        if (initial?.date) setDate(initial.date);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法加载证据台账'); }
    finally { setBusy(false); }
  }, [assetId, approval, territories]);

  useEffect(() => { void reload(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [assetId]);

  const parseList = (raw: string) => raw.split(/[,，、\s]+/).map(item => item.trim()).filter(Boolean);
  const buildTarget = () => ({ assetId, territories: parseList(territories), platforms: parseList(platforms), date });

  const evaluate = async () => {
    setError(''); setSnapshotId(''); setBusy(true);
    try { setConclusion(await evidenceApi.evaluate(buildTarget())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '覆盖计算失败'); }
    finally { setBusy(false); }
  };

  const saveToApproval = async () => {
    if (!approval) return;
    setBusy(true); setError('');
    try {
      const result = await evidenceApi.attachToApproval(approval.id, buildTarget(), actor);
      setSnapshotId(result.id); setNotice('覆盖结论快照已随审批留存，审计链已写入 COVERAGE_EVALUATE'); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '写入审批失败'); }
    finally { setBusy(false); }
  };

  const requestFollowUp = async () => {
    if (!approval) return;
    setBusy(true); setError('');
    try {
      const result = await evidenceApi.requestEvidenceFollowUp(approval.id, buildTarget(), actor, '覆盖结论非已覆盖，请补充授权证据');
      setNotice(`已发起补证审批 ${result.followUpApprovalId ?? ''}`); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发起补证审批失败'); }
    finally { setBusy(false); }
  };

  const submitRegister = async (token = formToken) => {
    if (!form) return;
    setBusy(true); setError(''); setPendingToken('');
    const payload = {
      projectId,
      reference: form.reference, referenceType: form.referenceType, digest: form.digest.trim(), granter: form.granter,
      territories: parseList(form.territories), platforms: parseList(form.platforms),
      validFrom: form.validFrom, validTo: form.validTo, registeredBy: form.registeredBy,
      assetRefs: parseList(form.versions).map(version => ({ assetId, version: Number(version) })),
      clientToken: token,
    };
    try {
      const record = await evidenceApi.register(payload);
      setNotice(record.duplicated ? `该证据此前已登记（${record.id}），未重复写入` : `证据 ${record.id} 已登记，状态为“待核验”，须法务比对原件摘要`);
      setFormToken(uuidToken());
      await reload(true); onChanged();
    } catch (reason) {
      const ledgerError = reason as LedgerApiError;
      if (ledgerError.code === 'LEDGER_WRITE_PENDING' && ledgerError.retryToken) setPendingToken(ledgerError.retryToken);
      setError(ledgerError.message || '登记失败');
    } finally { setBusy(false); }
  };

  const retryWrite = async () => {
    if (!pendingToken) return;
    setBusy(true); setError('');
    try {
      const record = await evidenceApi.retryPending(pendingToken);
      if (record.pendingToken) setNotice(`补提交仍失败，可继续重试（token ${record.pendingToken}）`);
      else { setPendingToken(''); setNotice(`补提交成功，证据 ${record.id} 已入账`); await reload(true); onChanged(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '补提交失败'); }
    finally { setBusy(false); }
  };

  const attest = async (recordId: string) => {
    const observed = attestTargets[recordId]?.trim() ?? '';
    if (!/^sha256:[0-9a-fA-F]{64}$/.test(observed)) { setError('请录入原件的 sha256:<64位十六进制> 摘要再核验'); return; }
    setBusy(true); setError('');
    try {
      const result = await evidenceApi.attest(recordId, observed, actor);
      setNotice(`证据 ${recordId} 核验结果：${digestLabel[result.digestStatus]}`);
      await reload(true); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '核验失败'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={event => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">RIGHTS EVIDENCE LEDGER / 授权证据台账</div>
            <h2>{ledger?.asset.name ?? assetId} <span>v{ledger?.asset.version}</span></h2>
            {approval && <small>审批上下文：{approval.title} · {approval.id}</small>}
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>

        {notice && <div className="drawer-toast" onClick={() => setNotice('')}>{notice} ×</div>}
        {error && <div className="drawer-toast error-toast" onClick={() => setError('')}>{error} ×</div>}

        {!ledger ? <div className="loading">正在加载证据台账…</div> : (
          <div className="drawer-body">
            {!!ledger.lineage.length && (
              <div className="lineage">
                <small>版本谱系</small>
                <span>{ledger.lineage.map(item => `v${item.version}${item.supersedesVersion ? ` 替代 v${item.supersedesVersion}` : ''}`).join('；')}</span>
              </div>
            )}

            {ledger.pendingWrites.length > 0 && (
              <section className="drawer-panel pending-panel">
                <h3>待重试写入（{ledger.pendingWrites.length}）</h3>
                {ledger.pendingWrites.map(item => (
                  <div className="pending-row" key={item.token}>
                    <div><b>{item.payload.granter || '未命名授权方'}</b><small>{item.payload.reference} · 已尝试 {item.attempts} 次 · token {item.token.slice(0, 18)}…</small></div>
                    <button disabled={busy} onClick={() => { setPendingToken(item.token); void retryWrite(); }}>补提交</button>
                  </div>
                ))}
              </section>
            )}

            <section className="drawer-panel">
              <h3>待交付范围覆盖核算</h3>
              <small style={{ display: 'block', marginBottom: 10 }}>按“地域 × 平台 × 日期”逐格判定：已覆盖 / 缺证 / 已过期 / 范围不匹配（到期日含当日）。只有经法务核验的证据才参与结论。</small>
              <div className="form-grid">
                <label>地域（逗号分隔，全球填“全球”）<input value={territories} onChange={e => setTerritories(e.target.value)} /></label>
                <label>平台（全平台填 *）<input value={platforms} onChange={e => setPlatforms(e.target.value)} /></label>
                <label>目标日期<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
              </div>
              <div className="drawer-actions">
                <button className="primary" disabled={busy} onClick={evaluate}>计算覆盖结论</button>
                {approval && <button disabled={busy || !conclusion} onClick={saveToApproval}>存入审批覆盖结论</button>}
                {approval && conclusion && conclusion.overallStatus !== 'covered' && <button className="warn" disabled={busy} onClick={requestFollowUp}>发起补证审批</button>}
                {snapshotId && <em className="ok-inline">已留存快照 {snapshotId}</em>}
              </div>
              {conclusion && (
                <div className="conclusion">
                  <div className="conclusion-head">
                    <span className={statusClass(conclusion.overallStatus)}>{statusLabel[conclusion.overallStatus]}</span>
                    <small>{conclusion.assetName} v{conclusion.version} @ {conclusion.target.date}</small>
                    <span className="counts">已覆盖 {conclusion.counts.covered} · 缺证 {conclusion.counts.missing} · 已过期 {conclusion.counts.expired} · 不匹配 {conclusion.counts.mismatch}</span>
                  </div>
                  <div className="cell-grid">
                    {conclusion.cells.map(cell => (
                      <div className={`cell ${cell.status}`} key={`${cell.territory}-${cell.platform}`}>
                        <b>{cell.territory} / {cell.platform}</b>
                        <span className={statusClass(cell.status)}>{statusLabel[cell.status]}</span>
                        <small>{cell.reasons.slice(0, 2).map(reason => `${reason.evidenceId}: ${reason.message}`).join('；')}</small>
                      </div>
                    ))}
                  </div>
                  {conclusion.warnings.length > 0 && <ul className="warnings">{conclusion.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
                </div>
              )}
            </section>

            <section className="drawer-panel">
              <h3>证据清单（{ledger.evidence.length}）</h3>
              {ledger.evidence.length === 0 && <div className="empty">尚无证据登记。rightsTags 不等于已取得权利，请登记授权合同 / 补充条款 / 付款凭证。</div>}
              {ledger.evidence.map(item => (
                <div className={`evidence-card ${item.digestStatus} ${item.appliesToCurrentVersion ? '' : 'not-current'}`} key={item.id}>
                  <div className="evidence-head">
                    <b>{item.granter}</b>
                    <span className={`digest-pill ${item.digestStatus}`}>{digestLabel[item.digestStatus]}</span>
                    {!item.appliesToCurrentVersion && <span className="digest-pill old">仅关联旧版本</span>}
                  </div>
                  <div className="evidence-meta">
                    <small>{referenceTypeLabel[item.referenceType]} · {item.id}</small>
                    <small className="reference" title={item.reference}>{item.reference}</small>
                    <small title={item.digest}>摘要 {shortDigest(item.digest)}</small>
                    <small>地域：{item.scope.territories.includes('全球') ? '全球（通配）' : joinList(item.scope.territories)}</small>
                    <small>平台：{item.scope.platforms.includes('*') ? '全平台（*）' : joinList(item.scope.platforms)}</small>
                    <small>有效期：{item.validFrom} ~ {item.validTo}（含到期日）</small>
                    <small>关联：{item.assetRefs.map(ref => `${ref.assetId}@${ref.version === null ? '当前' : `v${ref.version}`}`).join('、')}</small>
                    <small>登记：{item.registeredBy}{item.attestedBy ? ` · 核验：${item.attestedBy}` : ''}</small>
                  </div>
                  <div className="attest-row">
                    <input placeholder="录入原件 sha256 摘要供法务比对" value={attestTargets[item.id] ?? ''} onChange={e => setAttestTargets(current => ({ ...current, [item.id]: e.target.value }))} />
                    <button disabled={busy} onClick={() => void attest(item.id)}>核验摘要</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="drawer-panel">
              <h3>登记新证据</h3>
              <small style={{ display: 'block', marginBottom: 10 }}>仅保存证据引用与登记方自报摘要；系统不抓取外部文件，摘要核验一致前状态为“待核验”，不计入覆盖结论。</small>
              <div className="form-grid">
                {(() => { const f = form!; return <>
                <label>授权方<input value={f.granter} onChange={e => setForm({ ...f, granter: e.target.value })} /></label>
                <label>证据类型<select value={f.referenceType} onChange={e => setForm({ ...f, referenceType: e.target.value as EvidenceRecord['referenceType'] })}>{Object.entries(referenceTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="wide">证据引用（URI，如 contract://CTR-02/grant?sig=…）<input value={f.reference} onChange={e => setForm({ ...f, reference: e.target.value })} /></label>
                <label className="wide">摘要校验值 sha256:&lt;64hex&gt;<input value={f.digest} onChange={e => setForm({ ...f, digest: e.target.value })} placeholder="sha256:" /></label>
                <label>许可地域<input value={f.territories} onChange={e => setForm({ ...f, territories: e.target.value })} /></label>
                <label>许可平台<input value={f.platforms} onChange={e => setForm({ ...f, platforms: e.target.value })} /></label>
                <label>生效日<input type="date" value={f.validFrom} onChange={e => setForm({ ...f, validFrom: e.target.value })} /></label>
                <label>到期日（含当日）<input type="date" value={f.validTo} onChange={e => setForm({ ...f, validTo: e.target.value })} /></label>
                <label>关联资产版本（可多个，逗号分隔）<input value={f.versions} onChange={e => setForm({ ...f, versions: e.target.value })} /></label>
                <label>登记人<input value={f.registeredBy} onChange={e => setForm({ ...f, registeredBy: e.target.value })} /></label>
                </>; })()}
              </div>
              <div className="drawer-actions">
                <button className="primary" disabled={busy} onClick={() => void submitRegister()}>登记证据</button>
                {pendingToken && <button className="warn" disabled={busy} onClick={() => void retryWrite()}>台账写入失败，点此补提交（{pendingToken.slice(0, 14)}…）</button>}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
