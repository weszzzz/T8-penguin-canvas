export type HistoryMediaKind = 'image' | 'video' | 'audio' | 'text' | 'model3d' | 'other';
export type HistoryKindFilter = 'all' | HistoryMediaKind;
export interface GenerationHistoryOutput {
  assetId: string;
  contentHash: string | null;
  kind: HistoryMediaKind;
  title: string;
  outputOrdinal: number;
  availability: string;
  mediaUrl: string | null;
  evidence: 'host-recorded' | 'legacy-record' | 'local-recovery';
}
export interface GenerationHistoryGroup {
  recovered?: boolean;
  id: string;
  createdAt: number;
  nodeId: string | null;
  nodeEntityUid: string | null;
  nodeType: string;
  sourceNodeExists: boolean;
  provider: string | null;
  model: string | null;
  promptPreview: string;
  snapshotAvailable: boolean;
  inputArchive?: GenerationHistoryInputArchive;
  referenceRecoveries?: Array<{ referenceIndex: number; assetId: string; entityUid: string; contentHash: string; kind: string }>;
  outputCount: number;
  outputOffset: number;
  hasMoreOutputs: boolean;
  outputs: GenerationHistoryOutput[];
}
export interface GenerationHistoryQuery {
  projectId: string;
  canvasId: string;
  nodeId?: string;
  nodeEntityUid?: string;
  kind?: HistoryKindFilter;
  cursor?: string;
  limit?: number;
  groupId?: string;
  outputOffset?: number;
  includeInput?: boolean;
}

export type GenerationHistoryInputArchive = {
  status: 'unavailable'; reason: string;
} | {
  status: 'available'; schema: 't8-generation-input-archive-v1'; digest: string;
  binding: { projectId: string; canvasId: string; nodeId: string; nodeEntityUid: string | null };
  references?: { status: 'unavailable'; reason: string } | {
    status: 'captured'; entries: Array<{ path: Array<string | number> } & (
      { status: 'unresolved'; reason: string } | { status: 'bound'; assetId: string; entityUid: string; contentHash: string; kind: string }
    )>;
  };
  snapshot: { schema: string; credentialsOmitted?: boolean;
    node: { id: string; type: string; data: Record<string, unknown> };
    upstreamNodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    incomingEdges: Array<Record<string, unknown>>;
  };
};

export interface HistorySettingsReview {
  prompt: string;
  fields: Array<{ key: string; label: string; before: string; after: string; beforeDefault?: boolean; afterDefault?: boolean; advanced?: boolean }>;
  referenceWarning: boolean;
  resolvedFrontendInputs?: boolean;
  inputKind?: 'standard-image' | 'budget-image' | 'fal-image' | 'banana-image' | 'standard-video' | 'fal-video';
  references?: Array<{ kind: string; url: string; label: string }>;
  apply: () => Promise<void>;
}
export interface GenerationHistoryPage {
  schema: 't8-generation-history-v1';
  scope: { projectId: string; canvasId: string; nodeId: string | null; nodeEntityUid: string | null; kind: HistoryKindFilter };
  groups: GenerationHistoryGroup[];
  total: number;
  counts: Record<HistoryKindFilter, number>;
  nextCursor: string | null;
}

export interface GenerationHistorySourceIdentity {
  projectId: string;
  canvasId: string;
  nodeEntityUid: string;
}
