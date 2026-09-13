import type { GenerationHistorySourceIdentity } from '../types/generationHistory';

// Check at click time as well as in the history response: a visible card can
// outlive a deletion/replacement or canvas switch without a network refresh.
export function matchesGenerationHistorySource(
  node: { id: string; entityUid?: string } | undefined,
  nodeId: string,
  expected: GenerationHistorySourceIdentity,
  current: { projectId: string | null; canvasId: string | null },
): boolean {
  return Boolean(node && expected.nodeEntityUid && node.id === nodeId
    && node.entityUid === expected.nodeEntityUid
    && current.projectId === expected.projectId && current.canvasId === expected.canvasId);
}
