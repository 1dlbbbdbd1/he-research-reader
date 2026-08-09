import type { CitationRecord, CitationStyle } from '../domain/citation/model'
import type { Claim, EvidenceCard } from '../domain/evidence/model'
import type { Experiment, ExperimentRun } from '../domain/experiment/model'
import type { KnowledgeEdge, KnowledgeNode, KnowledgeNodeType } from '../domain/knowledge/model'
import type { Paper } from '../domain/paper/model'
import type { ResearchProfile } from '../domain/research/model'
import type { ResearchTask, ResearchTaskStatus } from '../domain/task/model'
import type { DomainId } from '../domain/shared'

export interface PaperRepository { get(id: DomainId): Promise<Paper | undefined>; search(query: string): Promise<Paper[]> }
export interface EvidenceRepository { get(id: DomainId): Promise<EvidenceCard | undefined>; listForPaper(paperId: DomainId): Promise<EvidenceCard[]>; saveDraft(card: EvidenceCard): Promise<EvidenceCard>; confirm(id: DomainId): Promise<EvidenceCard> }
export interface ClaimRepository { get(id: DomainId): Promise<Claim | undefined>; listForEvidence(evidenceId: DomainId): Promise<Claim[]> }
export interface ExperimentRepository { get(id: DomainId): Promise<Experiment | undefined>; listRuns(experimentId: DomainId): Promise<ExperimentRun[]> }
export interface TaskRepository { list(status?: ResearchTaskStatus): Promise<ResearchTask[]>; save(task: ResearchTask): Promise<ResearchTask> }
export interface KnowledgeGraphRepository { query(input: { text?: string; nodeTypes?: KnowledgeNodeType[]; nodeIds?: DomainId[] }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>; propose(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): Promise<void>; confirm(input: { nodeIds: DomainId[]; edgeIds: DomainId[] }): Promise<void> }
export interface CitationService { format(record: CitationRecord, style: CitationStyle): Promise<string>; toBibTeX(record: CitationRecord): Promise<string> }
export interface ResearchProfileRepository { load(): Promise<ResearchProfile>; save(profile: ResearchProfile): Promise<ResearchProfile> }
