export type ResearchResumeInput = {
  activeView?: string
  sourceId?: string
  pageNumber?: number
  readerMode?: string
  activeRunId?: string
}

export type TodayResearchSummary = {
  lastWork: { kind: string; title: string; detail: string; sourceId?: string; pageNumber?: number; runId?: string }
  nextStep: { title: string; source: string; runId?: string; recordId?: string; milestoneId?: string }
  paper: { title: string; detail: string; sourceId?: string; pageNumber?: number }
  blocker: { title: string; detail: string; kind: string; runId?: string }
  pendingAI: { title: string; detail: string; count: number; packId?: string }
  activeRun?: { id: string; title: string; outcome: string; nextStep?: string }
  missingArtifactCount: number
  resumeViewLabel: string
}

export function formatResearchAbsence(previousActiveAt?: string, currentAt?: string): {
  firstVisit: boolean
  durationLabel: string
  message: string
}

export function buildTodayResearch(input?: Record<string, unknown>): TodayResearchSummary
