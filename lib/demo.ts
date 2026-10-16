type LabeledRecord = { isDemo: boolean };
export function hasDemoContext(workspace: {
  metrics: LabeledRecord[];
  channels: LabeledRecord[];
  knowledge: LabeledRecord[];
  memories: LabeledRecord[];
  experiments: LabeledRecord[];
  approvals: LabeledRecord[];
  alerts: LabeledRecord[];
  messages: LabeledRecord[];
}): boolean {
  return [
    workspace.metrics,
    workspace.channels,
    workspace.knowledge,
    workspace.memories,
    workspace.experiments,
    workspace.approvals,
    workspace.alerts,
    workspace.messages,
  ].some((records) => records.some((record) => record.isDemo));
}
