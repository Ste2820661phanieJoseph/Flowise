import path from 'path'
import * as fs from 'fs'

let cachedTemplates: string | null = null

/**
 * Returns a compact string representation of all marketplace templates.
 * Reads and distills 13 marketplace JSONs into ~1-2K tokens on first call,
 * then serves from memory cache on subsequent calls.
 */
export const getCompactTemplates = (): string => {
    if (cachedTemplates !== null) return cachedTemplates

    const marketplaceDir = path.join(__dirname, '..', '..', '..', 'marketplaces', 'agentflowsv2')
    const jsonFiles = fs.readdirSync(marketplaceDir).filter((f) => path.extname(f) === '.json')

    const patterns: string[] = []

    for (const file of jsonFiles) {
        try {
            const filePath = path.join(marketplaceDir, file)
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            const title = file.replace('.json', '')
            const description = data.description || ''
            const pattern = distillFlowPattern(data.nodes || [], data.edges || [])
            patterns.push(`${title}: ${description}\n  ${pattern}`)
        } catch {
            // Skip malformed files
        }
    }

    cachedTemplates = patterns.join('\n')
    return cachedTemplates
}

/**
 * Reset the cached templates (useful for testing or when nodesPool changes).
 */
export const clearTemplateCache = (): void => {
    cachedTemplates = null
}

const NODE_TYPE_SHORT: Record<string, string> = {
    startAgentflow: 'start',
    agentAgentflow: 'agent',
    llmAgentflow: 'llm',
    toolAgentflow: 'tool',
    retrieverAgentflow: 'retriever',
    conditionAgentflow: 'condition',
    conditionAgentAgentflow: 'conditionAgent',
    loopAgentflow: 'loop',
    iterationAgentflow: 'iteration',
    humanInputAgentflow: 'humanInput',
    httpAgentflow: 'http',
    directReplyAgentflow: 'directReply',
    customFunctionAgentflow: 'customFunction',
    executeFlowAgentflow: 'executeFlow',
    stickyNoteAgentflow: 'stickyNote'
}

function getCompactNodeName(node: any): string {
    const name = node.data?.name || ''
    const label = node.data?.label || ''
    const shortType = NODE_TYPE_SHORT[name] || name

    // Add label context if it provides meaningful info beyond the type
    if (label && label !== name && !label.match(/^(Start|Sticky Note)/i)) {
        return `${shortType}(${label})`
    }
    return shortType
}

function distillFlowPattern(nodes: any[], edges: any[]): string {
    // Build adjacency list
    const adj: Record<string, string[]> = {}
    const nodeMap: Record<string, string> = {}

    for (const node of nodes) {
        adj[node.id] = []
        nodeMap[node.id] = getCompactNodeName(node)
    }

    for (const edge of edges) {
        if (adj[edge.source]) {
            adj[edge.source].push(edge.target)
        }
    }

    // Find start node
    const startNode = nodes.find((n: any) => n.data?.name === 'startAgentflow')
    if (!startNode) return '(no start node)'

    return traceFlow(startNode.id, adj, nodeMap, new Set())
}

function traceFlow(nodeId: string, adj: Record<string, string[]>, nodeMap: Record<string, string>, visited: Set<string>): string {
    if (visited.has(nodeId)) return `↩${nodeMap[nodeId] || nodeId}`
    visited.add(nodeId)

    const name = nodeMap[nodeId] || nodeId
    if (name === 'stickyNote') return ''

    const children = (adj[nodeId] || []).filter((id) => nodeMap[id] !== 'stickyNote')

    if (children.length === 0) return name
    if (children.length === 1) {
        const childPattern = traceFlow(children[0], adj, nodeMap, new Set(visited))
        return childPattern ? `${name} → ${childPattern}` : name
    }

    // Multiple children = branching
    const branches = children.map((c) => traceFlow(c, adj, nodeMap, new Set(visited))).filter(Boolean)
    return `${name} → [${branches.join(' | ')}]`
}
