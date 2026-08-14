export type FrequentWorkflowEntry = {
  kind: 'workflow' | 'capability'
  id: string
  useCount: number
  lastUsedAt: string
}

export function rankFrequentWorkflows(
  runs: Array<{ conversationWorkflowId?: string; capabilityPackId?: string; createdAt?: string; updatedAt?: string }>,
  workflows: Array<{ id: string; featured?: boolean }>,
  capabilityPacks: Array<{ id: string }>,
  limit?: number,
): FrequentWorkflowEntry[]

