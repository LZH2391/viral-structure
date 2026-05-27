function buildFunctionSlotLibraryGraph(libraryArtifact) {
  const analysis = libraryArtifact?.functionSlotAtomizationAnalysis ?? libraryArtifact;
  if (!analysis?.artifactId) throw new Error("function slot library graph missing artifactId");

  const nodes = [];
  const edges = [];
  const artifactId = analysis.artifactId;
  const rootId = graphId("library", artifactId);

  pushNode(nodes, {
    id: rootId,
    type: "libraryItem",
    label: "LibraryItem",
    group: "library",
    data: {
      artifactId,
      sampleVideoId: analysis.sampleVideoId ?? null,
      traceId: analysis.traceId ?? null,
      status: analysis.status ?? null,
      createdAt: analysis.createdAt ?? null,
    },
  });

  const slots = analysis.slotMap?.slots ?? [];
  const atomGroups = [
    ["script", analysis.atomInventory?.scriptAtoms ?? []],
    ["rhythm", analysis.atomInventory?.rhythmAtoms ?? []],
    ["packaging", analysis.atomInventory?.packagingAtoms ?? []],
  ];
  const atomById = new Map();
  for (const [atomType, atoms] of atomGroups) {
    for (const atom of atoms) atomById.set(atom.id, { ...atom, atomType });
  }

  for (const slot of slots) {
    const slotNodeId = graphId("slot", artifactId, slot.slotId);
    pushNode(nodes, {
      id: slotNodeId,
      type: "slotInstance",
      label: slot.slotName ?? slot.slotId,
      group: slot.needReview ? "slotReview" : "slot",
      data: {
        stableId: `${artifactId}:${slot.slotId}`,
        slotId: slot.slotId,
        slotOrder: slot.slotOrder ?? null,
        slotType: slot.slotType ?? null,
        viewerStateBefore: slot.viewerStateBefore ?? null,
        viewerStateAfter: slot.viewerStateAfter ?? null,
        persuasionTask: slot.persuasionTask ?? null,
        sourceRefs: slot.sourceRefs ?? null,
        confidence: slot.confidence ?? null,
        needReview: Boolean(slot.needReview),
      },
    });
    pushEdge(edges, rootId, slotNodeId, "library_contains_slot", "contains");

    for (const atomId of [...(slot.scriptAtomIds ?? []), ...(slot.rhythmAtomIds ?? []), ...(slot.packagingAtomIds ?? [])]) {
      const atom = atomById.get(atomId);
      if (!atom) continue;
      const atomNodeId = graphId("atom", artifactId, atomId);
      pushNode(nodes, {
        id: atomNodeId,
        type: "atomInstance",
        label: atom.label ?? atom.id,
        group: atom.atomType,
        data: {
          atomId: atom.id,
          atomType: atom.atomType,
          slotId: slot.slotId,
          slotType: slot.slotType ?? atom.slot ?? null,
          function: atom.function ?? null,
          claimType: atom.claimType ?? null,
          pace: atom.pace ?? null,
          densityType: atom.densityType ?? null,
          proofType: atom.proofType ?? atom.claimType ?? null,
          visualProofType: atom.visualProofType ?? null,
          sourceRefs: atom.sourceRefs ?? null,
          confidence: atom.confidence ?? null,
          needReview: Boolean(atom.needReview),
        },
      });
      pushEdge(edges, slotNodeId, atomNodeId, "slot_contains_atom", atom.atomType);
    }
  }

  const orderedSlots = [...slots].sort((left, right) => Number(left.slotOrder ?? 0) - Number(right.slotOrder ?? 0));
  for (let index = 0; index < orderedSlots.length - 1; index += 1) {
    pushEdge(edges, graphId("slot", artifactId, orderedSlots[index].slotId), graphId("slot", artifactId, orderedSlots[index + 1].slotId), "slot_next", "next");
  }

  for (const binding of analysis.bindingGraph?.bindings ?? []) {
    const bindingNodeId = graphId("binding", artifactId, binding.id);
    pushNode(nodes, {
      id: bindingNodeId,
      type: "binding",
      label: `${binding.id} ${binding.type ?? ""}`.trim(),
      group: `binding:${binding.type ?? "unknown"}`,
      data: {
        bindingId: binding.id,
        bindingType: binding.type ?? null,
        rule: binding.rule ?? null,
        riskIfBroken: binding.riskIfBroken ?? null,
        confidence: binding.confidence ?? null,
      },
    });
    pushEdge(edges, rootId, bindingNodeId, "library_contains_binding", binding.type ?? "binding");
    for (const slotId of binding.slotIds ?? []) {
      pushEdge(edges, bindingNodeId, graphId("slot", artifactId, slotId), "binding_targets_slot", binding.type ?? "binding");
    }
    for (const atomId of binding.atomIds ?? []) {
      pushEdge(edges, bindingNodeId, graphId("atom", artifactId, atomId), "binding_targets_atom", binding.type ?? "binding");
    }
  }

  const conceptIds = new Set();
  for (const slot of slots) {
    if (!slot.slotType) continue;
    const conceptId = graphId("slotConcept", slot.slotType);
    if (!conceptIds.has(conceptId)) {
      conceptIds.add(conceptId);
      pushNode(nodes, {
        id: conceptId,
        type: "slotConcept",
        label: slot.slotType,
        group: "concept",
        data: { slotType: slot.slotType, status: "future_extension" },
      });
    }
    pushEdge(edges, conceptId, graphId("slot", artifactId, slot.slotId), "slot_instance_of_concept", "instance");
  }

  return {
    schemaVersion: "function_slot_library_graph.v1",
    artifactId,
    sampleVideoId: analysis.sampleVideoId ?? null,
    traceId: analysis.traceId ?? null,
    nodes,
    edges,
    summary: {
      slotCount: slots.length,
      atomCount: atomById.size,
      bindingCount: analysis.bindingGraph?.bindings?.length ?? 0,
      conceptCount: conceptIds.size,
    },
  };
}

function pushNode(nodes, node) {
  if (nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function pushEdge(edges, source, target, type, label) {
  edges.push({
    id: graphId("edge", type, source, target, String(edges.length + 1)),
    source,
    target,
    type,
    label,
  });
}

function graphId(...parts) {
  return parts.map((part) => String(part).replace(/[^A-Za-z0-9_.:-]/g, "_")).join(":");
}

module.exports = {
  buildFunctionSlotLibraryGraph,
};
