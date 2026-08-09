import type { DomainId, EntityTimestamps, HumanReviewState } from '../shared'

export type Experiment = EntityTimestamps & {
  id: DomainId
  name: string
  objective: string
  status: 'planned' | 'active' | 'completed' | 'blocked' | 'archived'
  paperIds: DomainId[]
  datasetIds: DomainId[]
  codeIds: DomainId[]
  claimIds: DomainId[]
}

export type ExperimentRun = EntityTimestamps & {
  id: DomainId
  experimentId: DomainId
  runNumber: number
  occurredAt: string
  environment: Record<string, string>
  parameters: Record<string, string | number | boolean>
  datasetIds: DomainId[]
  resultSummary: string
  artifactIds: DomainId[]
  conclusion: string
  reviewState: HumanReviewState
}
