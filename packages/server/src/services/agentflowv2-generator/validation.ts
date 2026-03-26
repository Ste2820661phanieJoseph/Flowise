// =============================================================================
// Flow Validation — Layers 3-6
//
// Layer 3: Node existence check (verify node types against component registry)
// Layer 4: Flow validation (structure checks — via validateFlow from agentflow pkg)
// Layer 5: Constraint validation (business rules — via checkNodePlacementConstraints)
// Layer 6: Auto-fix (recover from fixable issues without re-prompting)
//
// NOTE: Layers 4 & 5 require @flowiseai/agentflow. If not resolvable, add
// "@flowiseai/agentflow": "workspace:*" to packages/server/package.json
// =============================================================================

interface FlowNode {
    id: string
    type: string
    position: { x: number; y: number }
    width: number
    height: number
    data: Record<string, any>
    parentNode?: string
    extent?: string
}

interface FlowEdge {
    id: string
    type: string
    source: string
    sourceHandle: string
    target: string
    targetHandle: string
    data?: Record<string, any>
}

interface ValidationWarning {
    message: string
    type: 'warning' | 'error'
    nodeId?: string
}

export interface ValidationResult {
    nodes: FlowNode[]
    edges: FlowEdge[]
    warnings: ValidationWarning[]
    errors: ValidationWarning[]
}

/**
 * Main validation entry point. Runs layers 3-6 in sequence and returns
 * the cleaned-up flow with any warnings/errors collected.
 */
export const validateAndFixFlow = (nodes: FlowNode[], edges: FlowEdge[], componentNodes: Record<string, any>): ValidationResult => {
    const warnings: ValidationWarning[] = []
    const errors: ValidationWarning[] = []

    // Layer 3: Node existence check
    let { nodes: validNodes, edges: validEdges, warnings: existenceWarnings } = checkNodeExistence(nodes, edges, componentNodes)
    warnings.push(...existenceWarnings)

    // Layer 4: Flow structure validation
    const structureErrors = validateFlowStructure(validNodes, validEdges)
    for (const err of structureErrors) {
        if (err.type === 'error') {
            errors.push(err)
        } else {
            warnings.push(err)
        }
    }

    // Layer 5: Constraint validation
    const constraintErrors = checkConstraints(validNodes)
    for (const err of constraintErrors) {
        if (err.type === 'error') {
            errors.push(err)
        } else {
            warnings.push(err)
        }
    }

    // Layer 6: Auto-fix recoverable issues
    const fixed = autoFix(validNodes, validEdges)
    validNodes = fixed.nodes
    validEdges = fixed.edges
    warnings.push(...fixed.warnings)

    return {
        nodes: validNodes,
        edges: validEdges,
        warnings,
        errors
    }
}

// ---------------------------------------------------------------------------
// Layer 3: Node Existence Check
// Verify every node.data.name exists in the component registry.
// Remove invalid nodes + their edges, collect warnings.
// ---------------------------------------------------------------------------

function checkNodeExistence(
    nodes: FlowNode[],
    edges: FlowEdge[],
    componentNodes: Record<string, any>
): { nodes: FlowNode[]; edges: FlowEdge[]; warnings: ValidationWarning[] } {
    const warnings: ValidationWarning[] = []
    const invalidNodeIds = new Set<string>()

    for (const node of nodes) {
        const nodeName = node.data?.name
        if (!nodeName) {
            warnings.push({
                message: `Node "${node.id}" has no data.name — removed.`,
                type: 'warning',
                nodeId: node.id
            })
            invalidNodeIds.add(node.id)
            continue
        }

        // Skip sticky notes — they don't need to be in the registry
        if (nodeName === 'stickyNoteAgentflow') continue

        if (!componentNodes[nodeName]) {
            warnings.push({
                message: `Unknown node type "${nodeName}" (node "${node.id}") — removed.`,
                type: 'warning',
                nodeId: node.id
            })
            invalidNodeIds.add(node.id)
        }
    }

    if (invalidNodeIds.size === 0) {
        return { nodes, edges, warnings }
    }

    const validNodes = nodes.filter((n) => !invalidNodeIds.has(n.id))
    const validEdges = edges.filter((e) => !invalidNodeIds.has(e.source) && !invalidNodeIds.has(e.target))

    return { nodes: validNodes, edges: validEdges, warnings }
}

// ---------------------------------------------------------------------------
// Layer 4: Flow Structure Validation
// Checks: empty flow, missing start, multiple starts, cycles, disconnected
// nodes, hanging edges.
// ---------------------------------------------------------------------------

function validateFlowStructure(nodes: FlowNode[], edges: FlowEdge[]): ValidationWarning[] {
    const errors: ValidationWarning[] = []

    // Empty flow
    if (nodes.length === 0) {
        errors.push({ message: 'Flow is empty — add at least one node', type: 'error' })
        return errors
    }

    // Start node checks
    const startNodes = nodes.filter((n) => n.data?.name === 'startAgentflow')
    if (startNodes.length === 0) {
        errors.push({ message: 'Flow must have a start node', type: 'error' })
    }
    if (startNodes.length > 1) {
        errors.push({ message: 'Flow can only have one start node', type: 'error' })
    }

    // Disconnected nodes
    const connectedNodeIds = new Set<string>()
    for (const edge of edges) {
        connectedNodeIds.add(edge.source)
        connectedNodeIds.add(edge.target)
    }
    for (const node of nodes) {
        if (node.data?.name === 'stickyNoteAgentflow') continue
        if (!connectedNodeIds.has(node.id)) {
            errors.push({
                message: `Node "${node.data?.label || node.id}" is not connected to anything`,
                type: 'warning',
                nodeId: node.id
            })
        }
    }

    // Hanging edges
    const nodeIds = new Set(nodes.map((n) => n.id))
    for (const edge of edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            errors.push({
                message: `Hanging edge "${edge.id}" — source or target node missing`,
                type: 'warning'
            })
        }
    }

    // Cycle detection (ignoring loop nodes — those are intentional)
    if (detectCycle(nodes, edges)) {
        errors.push({ message: 'Flow contains a cycle without a loop node', type: 'error' })
    }

    return errors
}

function detectCycle(nodes: FlowNode[], edges: FlowEdge[]): boolean {
    // Build adjacency list, excluding edges that target a loop node's source
    const loopTargets = new Set<string>()
    for (const node of nodes) {
        if (node.data?.name === 'loopAgentflow') {
            loopTargets.add(node.id)
        }
    }

    const graph: Record<string, string[]> = {}
    for (const node of nodes) {
        graph[node.id] = []
    }
    for (const edge of edges) {
        // Skip edges INTO loop nodes (those are intentional back-edges)
        if (loopTargets.has(edge.target)) continue
        if (graph[edge.source]) {
            graph[edge.source].push(edge.target)
        }
    }

    // DFS with colors: 0=unvisited, 1=in-progress, 2=done
    const colors: Record<string, number> = {}
    for (const node of nodes) {
        colors[node.id] = 0
    }

    function dfs(nodeId: string): boolean {
        colors[nodeId] = 1
        for (const neighbor of graph[nodeId] || []) {
            if (colors[neighbor] === 1) return true
            if (colors[neighbor] === 0 && dfs(neighbor)) return true
        }
        colors[nodeId] = 2
        return false
    }

    for (const node of nodes) {
        if (colors[node.id] === 0 && dfs(node.id)) return true
    }
    return false
}

// ---------------------------------------------------------------------------
// Layer 5: Constraint Validation
// Business rules: single start, no nested iterations, no human input in
// iteration.
// ---------------------------------------------------------------------------

function checkConstraints(nodes: FlowNode[]): ValidationWarning[] {
    const errors: ValidationWarning[] = []

    // Find iteration nodes and their bounds
    const iterationNodes = nodes.filter((n) => n.type === 'iteration' || n.data?.name === 'iterationAgentflow')

    for (const node of nodes) {
        // Check: no nested iterations
        if (node.data?.name === 'iterationAgentflow' && node.parentNode) {
            const parent = nodes.find((n) => n.id === node.parentNode)
            if (parent && (parent.type === 'iteration' || parent.data?.name === 'iterationAgentflow')) {
                errors.push({
                    message: 'Nested iteration nodes are not supported',
                    type: 'error',
                    nodeId: node.id
                })
            }
        }

        // Check: directReplyAgentflow must have a non-empty directReplyMessage
        if (node.data?.name === 'directReplyAgentflow') {
            const msg = node.data?.inputs?.directReplyMessage
            if (!msg || (typeof msg === 'string' && msg.trim() === '')) {
                errors.push({
                    message: `directReplyAgentflow node "${
                        node.data?.label || node.id
                    }" has no directReplyMessage — chat will show an empty response. Set it to reference the previous node's output using its ID (e.g., {{ agentAgentflow_1 }}).`,
                    type: 'warning',
                    nodeId: node.id
                })
            }
        }

        // Check: no human input inside iteration
        if (node.data?.name === 'humanInputAgentflow' && node.parentNode) {
            const parent = nodes.find((n) => n.id === node.parentNode)
            if (parent && (parent.type === 'iteration' || parent.data?.name === 'iterationAgentflow')) {
                errors.push({
                    message: 'Human input node is not supported inside Iteration node',
                    type: 'error',
                    nodeId: node.id
                })
            }
        }

        // Also check by position (if parentNode not set but node is inside iteration bounds)
        if ((node.data?.name === 'iterationAgentflow' || node.data?.name === 'humanInputAgentflow') && !node.parentNode) {
            for (const iterNode of iterationNodes) {
                if (iterNode.id === node.id) continue
                const w = iterNode.width || 300
                const h = iterNode.height || 250
                if (
                    node.position.x >= iterNode.position.x &&
                    node.position.x <= iterNode.position.x + w &&
                    node.position.y >= iterNode.position.y &&
                    node.position.y <= iterNode.position.y + h
                ) {
                    if (node.data?.name === 'iterationAgentflow') {
                        errors.push({
                            message: 'Nested iteration nodes are not supported',
                            type: 'error',
                            nodeId: node.id
                        })
                    }
                    if (node.data?.name === 'humanInputAgentflow') {
                        errors.push({
                            message: 'Human input node is not supported inside Iteration node',
                            type: 'error',
                            nodeId: node.id
                        })
                    }
                }
            }
        }
    }

    return errors
}

// ---------------------------------------------------------------------------
// Layer 6: Auto-Fix
// Fix recoverable issues without re-prompting the LLM.
// See Flow Validation.md for the exact autoFix specification.
// ---------------------------------------------------------------------------

function autoFix(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[]; edges: FlowEdge[]; warnings: ValidationWarning[] } {
    const warnings: ValidationWarning[] = []
    let resultNodes = [...nodes]
    let resultEdges = [...edges]

    // 1. Remove edges referencing non-existent nodes
    const nodeIds = new Set(resultNodes.map((n) => n.id))
    const beforeEdgeCount = resultEdges.length
    resultEdges = resultEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    const removedEdges = beforeEdgeCount - resultEdges.length
    if (removedEdges > 0) {
        warnings.push({ message: `Auto-fix: removed ${removedEdges} hanging edge(s)`, type: 'warning' })
    }

    // 2. Deduplicate node IDs (rename second occurrence)
    const seenIds = new Set<string>()
    for (const node of resultNodes) {
        if (seenIds.has(node.id)) {
            const oldId = node.id
            node.id = `${node.data?.name || 'node'}_${Date.now()}`
            warnings.push({ message: `Auto-fix: renamed duplicate node ID "${oldId}" to "${node.id}"`, type: 'warning' })

            // Update edges that reference the old ID
            for (const edge of resultEdges) {
                if (edge.source === oldId) {
                    edge.source = node.id
                    edge.sourceHandle = edge.sourceHandle?.replace(oldId, node.id)
                }
                if (edge.target === oldId) {
                    edge.target = node.id
                    edge.targetHandle = edge.targetHandle?.replace(oldId, node.id)
                }
            }
        }
        seenIds.add(node.id)
    }

    // 3. Fix overlapping positions (nodes at the exact same position)
    const positionMap = new Map<string, FlowNode[]>()
    for (const node of resultNodes) {
        const key = `${node.position.x},${node.position.y}`
        if (!positionMap.has(key)) positionMap.set(key, [])
        positionMap.get(key)!.push(node)
    }
    for (const [, overlapping] of positionMap) {
        if (overlapping.length > 1) {
            // Spread overlapping nodes vertically
            for (let i = 1; i < overlapping.length; i++) {
                overlapping[i].position.y += i * 100
            }
            warnings.push({
                message: `Auto-fix: adjusted ${overlapping.length} overlapping nodes at same position`,
                type: 'warning'
            })
        }
    }

    // 4. Auto-fill empty directReplyMessage from the preceding node's ID
    for (const node of resultNodes) {
        if (node.data?.name !== 'directReplyAgentflow') continue
        const msg = node.data?.inputs?.directReplyMessage
        if (msg && typeof msg === 'string' && msg.trim() !== '') continue

        const incomingEdge = resultEdges.find((e) => e.target === node.id)
        if (!incomingEdge) continue

        const sourceNode = resultNodes.find((n) => n.id === incomingEdge.source)
        if (!sourceNode) continue

        const sourceId = sourceNode.id
        if (!node.data.inputs) node.data.inputs = {}
        node.data.inputs.directReplyMessage = `{{ ${sourceId} }}`
        warnings.push({
            message: `Auto-fix: set directReplyMessage on "${node.data?.label || node.id}" to "{{ ${sourceId} }}"`,
            type: 'warning',
            nodeId: node.id
        })
    }

    // 5. Remove extra start nodes (keep first)
    const startNodes = resultNodes.filter((n) => n.data?.name === 'startAgentflow')
    if (startNodes.length > 1) {
        const extraStarts = startNodes.slice(1)
        const extraStartIds = new Set(extraStarts.map((n) => n.id))
        resultNodes = resultNodes.filter((n) => !extraStartIds.has(n.id))
        resultEdges = resultEdges.filter((e) => !extraStartIds.has(e.source) && !extraStartIds.has(e.target))
        warnings.push({
            message: `Auto-fix: removed ${extraStarts.length} extra start node(s)`,
            type: 'warning'
        })
    }

    return { nodes: resultNodes, edges: resultEdges, warnings }
}
