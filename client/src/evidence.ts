// 授权证据台账：前端共享类型与接口封装
export type DigestStatus = 'claimed' | 'verified' | 'mismatch';
export type CoverageStatus = 'covered' | 'missing' | 'expired' | 'mismatch';

export interface EvidenceRecord {
  id: string;
  projectId: string;
  reference: string;
  referenceType: 'contract' | 'amendment' | 'payment' | 'certificate' | 'other';
  digest: string;
  digestStatus: DigestStatus;
  granter: string;
  scope: { territories: string[]; platforms: string[] };
  validFrom: string;
  validTo: string;
  assetRefs: { assetId: string; version: number | null }[];
  registeredBy: string;
  registeredAt: string;
  attestedAt?: string;
  attestedBy?: string;
  appliesToCurrentVersion?: boolean;
  duplicated?: boolean;
}

export interface VersionLineage { assetId: string; version: number; supersedesVersion: number | null; registeredAt: string }
export interface PendingWrite { token: string; attempts: number; lastError: string; firstFailedAt: string; payload: { reference: string; granter: string } }

export interface AssetLedger {
  asset: { id: string; name: string; version: number; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string };
  lineage: VersionLineage[];
  evidence: EvidenceRecord[];
  pendingWrites: (PendingWrite & { token: string })[];
}

export interface CoverageReason { evidenceId: string; digestStatus: DigestStatus; status: string; message: string }
export interface CoverageCell { territory: string; platform: string; date: string; status: CoverageStatus; reasons: CoverageReason[] }
export interface CoverageConclusion {
  assetId: string; assetName: string; version: number; supersededVersion: number | null;
  target: { territories: string[]; platforms: string[]; date: string };
  overallStatus: CoverageStatus;
  counts: Record<CoverageStatus, number>;
  cells: CoverageCell[];
  warnings: string[];
  evaluatedAt: string;
}

export interface LedgerApiError extends Error { code?: string; retryToken?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `台账请求失败 (${response.status})`) as LedgerApiError;
    error.code = body.code;
    error.retryToken = body.retryToken;
    throw error;
  }
  return body as T;
}

export const evidenceApi = {
  assetLedger: (assetId: string) => request<AssetLedger>(`/assets/${assetId}/evidence`),
  register: (payload: unknown) => request<EvidenceRecord>('/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  attest: (id: string, observedDigest: string, actor: string) => request<EvidenceRecord>(`/evidence/${id}/attest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observedDigest, actor }) }),
  retryPending: (token: string) => request<EvidenceRecord & { pendingToken?: string }>(`/evidence-pending/${token}/retry`, { method: 'POST' }),
  evaluate: (target: unknown) => request<CoverageConclusion>('/coverage/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) }),
  attachToApproval: (approvalId: string, target: unknown, actor: string) =>
    request<{ id: string }>(`/approvals/${approvalId}/coverage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, actor }) }),
  requestEvidenceFollowUp: (approvalId: string, target: unknown, actor: string, comment: string) =>
    request<{ snapshot: { id: string }; followUpApprovalId?: string }>(`/approvals/${approvalId}/coverage-decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, actor, decision: 'request-evidence', comment }) }),
};

export const statusLabel: Record<CoverageStatus, string> = {
  covered: '已覆盖',
  missing: '缺证',
  expired: '已过期',
  mismatch: '范围不匹配',
};
export const digestLabel: Record<DigestStatus, string> = { claimed: '待核验', verified: '已核验', mismatch: '核验不一致' };
export const referenceTypeLabel: Record<EvidenceRecord['referenceType'], string> = {
  contract: '授权合同', amendment: '补充条款', payment: '付款凭证', certificate: '版权证明', other: '其他',
};
