export type ResearchEntityKind = 'project' | 'milestone' | 'run' | 'artifact' | 'record' | 'source' | 'bibliography'

export type ResearchEntityRef = {
  kind: string
  id: string
  tag: string
}

export type AcceptanceCriterionStatus = {
  id: string
  label: string
  state: 'satisfied' | 'missing'
  satisfied: boolean
  evidenceRefs: ResearchEntityRef[]
}

export type ResearchSuggestedAction = {
  id: string
  actionType: 'define_direction' | 'define_milestone' | 'close_run' | 'relink_artifact' | 'resolve_blocker' | 'review_anomaly' | 'satisfy_criterion'
  title: string
  rationale: string
  sourceRefs: ResearchEntityRef[]
  requiresConfirmation: true
  writesFormalRecord: false
}

export type ResearchWorkspaceSynthesis = {
  project: {
    id: string
    name: string
    mode: string
    stage: string
    researchQuestion: string
    currentHypothesis: string
  }
  isExplorationEmpty: boolean
  lastActivity: null | {
    kind: string
    id: string
    title: string
    at: string
    sourceRef?: ResearchEntityRef
  }
  resume: {
    headline: string
    lastActivity: ResearchWorkspaceSynthesis['lastActivity']
    milestoneId: string | null
    unfinishedRunCount: number
    blockerCount: number
    anomalyCount: number
  }
  currentMilestone: null | {
    id: string
    title: string
    status: string
    description: string
    dueAt: string
    sourceRef?: ResearchEntityRef
  }
  activeMilestone: null | {
    id: string
    title: string
    status: 'active'
    sourceRef?: ResearchEntityRef
  }
  acceptance: {
    satisfied: AcceptanceCriterionStatus[]
    missing: AcceptanceCriterionStatus[]
  }
  unfinishedRuns: Array<{
    id: string
    title: string
    outcome: string
    reasons: string[]
    startedAt: string
    updatedAt: string
    sourceRef?: ResearchEntityRef
  }>
  blockers: Array<{
    kind: string
    id: string
    title: string
    detail: string
    sourceRef?: ResearchEntityRef
  }>
  anomalies: Array<{
    kind: 'run'
    id: string
    title: string
    detail: string
    sourceRef?: ResearchEntityRef
    at: string
  }>
  nextCandidates: Array<{
    id: string
    kind: 'recorded_next_step' | 'planned_run' | 'acceptance_gap'
    title: string
    rationale: string
    epistemicType: 'fact' | 'user_observation'
    sourceRefs: ResearchEntityRef[]
  }>
  suggestedActions: ResearchSuggestedAction[]
}

export type TraceableReportItem = {
  epistemicType: 'fact' | 'user_observation' | 'suggestion'
  content: string
  sourceRefs: ResearchEntityRef[]
}

export type TraceableResearchReport = {
  markdown: string
  sections: Array<{
    id: 'new-evidence' | 'test-results' | 'failed-tests' | 'artifacts' | 'decisions' | 'blockers' | 'next'
    title: string
    items: TraceableReportItem[]
  }>
  sourceRefs: ResearchEntityRef[]
}

export type ClaimEvidenceAudit = {
  claims: Array<{
    id: string
    text: string
    status: 'supported' | 'partial' | 'unsupported'
    requirements: string[]
    missing: string[]
    resolvedEvidence: ResearchEntityRef[]
    brokenRefs: ResearchEntityRef[]
    connectedArtifacts: Array<{
      id: string
      role: string
      existsState: string
      sourceRef?: ResearchEntityRef
    }>
  }>
  counts: { supported: number; partial: number; unsupported: number }
}

export type ResearchWorkspaceInput = {
  project?: Record<string, unknown>
  milestones?: Array<Record<string, unknown>>
  runs?: Array<Record<string, unknown>>
  artifacts?: Array<Record<string, unknown>>
  records?: Array<Record<string, unknown>>
}

export function synthesizeResearchWorkspace(workspace?: ResearchWorkspaceInput): ResearchWorkspaceSynthesis
export function suggestResearchActions(workspaceOrSummary?: ResearchWorkspaceInput | ResearchWorkspaceSynthesis): ResearchSuggestedAction[]
export function generateTraceableResearchReport(
  workspace?: ResearchWorkspaceInput,
  options?: { from?: string; to?: string; title?: string },
): TraceableResearchReport
export function auditClaimEvidence(input?: {
  claims?: Array<Record<string, unknown>>
  bibliography?: Array<Record<string, unknown>>
  bibliographicItems?: Array<Record<string, unknown>>
  runs?: Array<Record<string, unknown>>
  artifacts?: Array<Record<string, unknown>>
}): ClaimEvidenceAudit
