import type { CreateSessionResponse, SessionState, ScorecardResponse, Rule, TargetEnv, TriageResult, TransformPlanStep } from './types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${url}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function createSession(file: File, useCase = ''): Promise<CreateSessionResponse> {
  const body = new FormData()
  body.append('file', file)
  body.append('use_case', useCase)
  return request('/api/v1/sessions', { method: 'POST', body })
}

export async function getSession(id: string): Promise<SessionState> {
  return request(`/api/v1/sessions/${id}`)
}

export async function approveRules(
  sessionId: string,
  approvedRules: Rule[],
  rejectedIds: string[]
): Promise<{ accepted: boolean; message: string }> {
  return request(`/api/v1/sessions/${sessionId}/rules/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved_rules: approvedRules, rejected_rule_ids: rejectedIds }),
  })
}

export async function decideTransformation(
  sessionId: string,
  transformationId: string,
  approved: boolean,
  modification?: Record<string, unknown>
): Promise<{ accepted: boolean; transformation_id: string; applied: boolean; transformation_log: unknown[] }> {
  return request(`/api/v1/sessions/${sessionId}/transformations/${transformationId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved, modification }),
  })
}

export async function approveTriage(
  sessionId: string,
  acceptedThresholdChanges: { rule_id: string; new_threshold: number }[],
  rejectedRuleIds: string[]
): Promise<{ accepted: boolean; message: string; rules_amended: number; rules_removed: number }> {
  return request(`/api/v1/sessions/${sessionId}/triage/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accepted_threshold_changes: acceptedThresholdChanges,
      rejected_rule_ids: rejectedRuleIds,
    }),
  })
}

export async function generatePipeline(
  sessionId: string,
  targetEnv: TargetEnv
): Promise<{ accepted: boolean; message: string; session_id: string }> {
  return request(`/api/v1/sessions/${sessionId}/pipeline/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_env: targetEnv }),
  })
}

export async function getScorecard(sessionId: string): Promise<ScorecardResponse> {
  return request(`/api/v1/sessions/${sessionId}/scorecard`)
}

export function getPipelineDownloadUrl(sessionId: string): string {
  return `/api/v1/sessions/${sessionId}/pipeline/download`
}

export function getAIStreamUrl(sessionId: string): string {
  // Connect directly to FastAPI to avoid Next.js dev-proxy buffering SSE.
  // FastAPI has allow_origins=["*"] so no CORS issue.
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
  return `${base}/api/v1/sessions/${sessionId}/investigation/stream`
}

export async function approvePlan(
  sessionId: string,
  steps: TransformPlanStep[]
): Promise<{ accepted: boolean; message: string; steps_count: number }> {
  return request(`/api/v1/sessions/${sessionId}/plan/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps }),
  })
}

export async function resolveEscalation(
  sessionId: string,
  action: string,
  instruction?: string,
  modifiedParams?: Record<string, unknown>
): Promise<{ accepted: boolean; message: string }> {
  return request(`/api/v1/sessions/${sessionId}/execution/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, instruction, modified_params: modifiedParams }),
  })
}
