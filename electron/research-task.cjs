const crypto = require('node:crypto')

const TASK_STATUSES = new Set(['inbox', 'today', 'later', 'waiting', 'completed', 'abandoned', 'deferred'])
const TASK_SOURCE_TYPES = new Set(['manual', 'paper', 'annotation', 'ai_suggestion', 'run', 'anomaly', 'milestone', 'review_document'])
const TASK_APPROVAL_STATUSES = new Set(['not_required', 'proposed', 'confirmed', 'rejected'])

function legacyTaskId(sourceType, sourceId, sourceRole = 'primary') {
  const digest = crypto.createHash('sha256').update(`${sourceType}\u0000${sourceId}\u0000${sourceRole}`).digest('hex').slice(0, 24)
  return `legacy-task-${digest}`
}

function taskStatusFromActionItem(status) {
  return {
    proposed: 'waiting',
    confirmed: 'today',
    dismissed: 'abandoned',
    completed: 'completed',
  }[status] || 'inbox'
}

function taskApprovalFromActionItem(status) {
  return {
    proposed: 'proposed',
    confirmed: 'confirmed',
    dismissed: 'rejected',
    completed: 'confirmed',
  }[status] || 'proposed'
}

function taskStatusFromMilestone(status) {
  return {
    planned: 'later',
    active: 'today',
    blocked: 'waiting',
    completed: 'completed',
    archived: 'abandoned',
  }[status] || 'inbox'
}

function milestoneStatusFromTask(status) {
  return {
    inbox: 'planned',
    today: 'active',
    later: 'planned',
    waiting: 'blocked',
    completed: 'completed',
    abandoned: 'archived',
    deferred: 'planned',
  }[status]
}

function taskStatusFromReading(status) {
  if (status === 'finished') return 'completed'
  if (status === 'reading') return 'today'
  if (status === 'skimming' || status === 'title_only') return 'later'
  return 'inbox'
}

function validateTaskStatus(value) {
  if (!TASK_STATUSES.has(value)) throw new Error('科研任务状态无效。')
  return value
}

function validateTaskSourceType(value) {
  if (!TASK_SOURCE_TYPES.has(value)) throw new Error('科研任务来源类型无效。')
  return value
}

function validateTaskApprovalStatus(value) {
  if (!TASK_APPROVAL_STATUSES.has(value)) throw new Error('科研任务审批状态无效。')
  return value
}

function taskViewFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id ?? undefined,
    sourceRole: row.source_role,
    origin: row.origin,
    approvalStatus: row.approval_status,
    isFormal: Boolean(row.is_formal),
    waitCondition: row.wait_condition || '',
    deferredUntil: row.deferred_until ?? undefined,
    returnTarget: JSON.parse(row.return_target_json || '{}'),
    sourceSnapshot: JSON.parse(row.source_snapshot_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

module.exports = {
  TASK_STATUSES,
  TASK_SOURCE_TYPES,
  TASK_APPROVAL_STATUSES,
  legacyTaskId,
  taskStatusFromActionItem,
  taskApprovalFromActionItem,
  taskStatusFromMilestone,
  milestoneStatusFromTask,
  taskStatusFromReading,
  validateTaskStatus,
  validateTaskSourceType,
  validateTaskApprovalStatus,
  taskViewFromRow,
}
