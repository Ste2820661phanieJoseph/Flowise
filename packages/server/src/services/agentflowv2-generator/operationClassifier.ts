export type OperationType = 'DIRECT_MUTATION' | 'PARTIAL_GENERATION' | 'FULL_GENERATION'

export interface ClassificationResult {
    type: OperationType
    targetNode?: string
    toolName?: string
}

interface FlowSnapshot {
    nodes: Array<{ id: string; data: { name?: string; label?: string } }>
    edges: Array<{ id: string; source: string; target: string }>
}

interface ToolNode {
    name: string
    description?: string
}

// Patterns for detecting direct mutation intents
const ADD_TOOL_PATTERN =
    /\b(?:add|attach|connect|include|enable)\b.*\b(?:tool|search|scraper|calculator|wikipedia|browser|code\s*interpret)/i
const REMOVE_PATTERN = /\b(?:remove|delete|drop|get rid of)\b/i
const RENAME_PATTERN = /\b(?:rename|relabel|change\s+(?:the\s+)?(?:name|label|title))\b/i

// Patterns that indicate node-level operations, NOT tool additions (gotcha #1)
// e.g., "add a tool node" or "add a new agent node"
const ADD_NODE_PATTERN = /\b(?:add|insert|create|place)\b.*\b(?:node|step|block)\b/i

/**
 * Rule-based intent classifier that routes user messages to the cheapest execution path.
 *
 * Classification tiers:
 * 1. Empty canvas → FULL_GENERATION (always)
 * 2. Keyword match + target found in flow → DIRECT_MUTATION
 * 3. Ambiguous / no match → PARTIAL_GENERATION (safe fallback)
 *
 * See Implementation Notes gotchas #1 (false positives) and #2 (tool name resolution).
 */
export const classifyOperation = (message: string, currentFlow: FlowSnapshot | null, toolNodes: ToolNode[]): ClassificationResult => {
    // If no current flow or empty canvas → always full generation
    if (!currentFlow || currentFlow.nodes.length === 0) {
        return { type: 'FULL_GENERATION' }
    }

    const lowerMessage = message.toLowerCase()

    // Check for rename intent
    if (RENAME_PATTERN.test(message)) {
        const targetNode = findReferencedNode(lowerMessage, currentFlow)
        if (targetNode) {
            return { type: 'DIRECT_MUTATION', targetNode: targetNode.id }
        }
    }

    // Check for remove/delete intent
    if (REMOVE_PATTERN.test(message)) {
        const targetNode = findReferencedNode(lowerMessage, currentFlow)
        if (targetNode) {
            return { type: 'DIRECT_MUTATION', targetNode: targetNode.id }
        }
        // Can't identify the target node — let LLM handle it
        return { type: 'PARTIAL_GENERATION' }
    }

    // Check for add tool intent — but NOT "add a tool node" (gotcha #1)
    if (ADD_TOOL_PATTERN.test(message) && !ADD_NODE_PATTERN.test(message)) {
        const toolMatch = resolveToolName(lowerMessage, toolNodes)
        if (toolMatch) {
            const agentNode = findAgentNode(lowerMessage, currentFlow)
            return {
                type: 'DIRECT_MUTATION',
                targetNode: agentNode?.id,
                toolName: toolMatch.name
            }
        }
        // Tool name not resolved — fall back to partial so LLM can figure it out (gotcha #2)
        return { type: 'PARTIAL_GENERATION' }
    }

    // Default: PARTIAL_GENERATION (safe fallback for ambiguous requests)
    return { type: 'PARTIAL_GENERATION' }
}

/**
 * Find a node in the current flow that the user is referring to.
 * Matches against node labels, node type short names, and node IDs.
 */
function findReferencedNode(lowerMessage: string, flow: FlowSnapshot): { id: string; data: { name?: string; label?: string } } | undefined {
    // Try matching by label first (more specific)
    for (const node of flow.nodes) {
        const label = node.data.label?.toLowerCase()
        if (label && lowerMessage.includes(label)) {
            return node
        }
    }

    // Try matching by node type short name
    const typeKeywords: Record<string, string> = {
        start: 'startAgentflow',
        agent: 'agentAgentflow',
        llm: 'llmAgentflow',
        tool: 'toolAgentflow',
        retriever: 'retrieverAgentflow',
        condition: 'conditionAgentflow',
        'condition agent': 'conditionAgentAgentflow',
        loop: 'loopAgentflow',
        iteration: 'iterationAgentflow',
        'human input': 'humanInputAgentflow',
        http: 'httpAgentflow',
        'direct reply': 'directReplyAgentflow',
        'custom function': 'customFunctionAgentflow'
    }

    for (const [keyword, nodeName] of Object.entries(typeKeywords)) {
        if (lowerMessage.includes(keyword)) {
            const match = flow.nodes.find((n) => n.data.name === nodeName)
            if (match) return match
        }
    }

    // Try matching by node ID
    for (const node of flow.nodes) {
        if (lowerMessage.includes(node.id.toLowerCase())) {
            return node
        }
    }

    return undefined
}

/**
 * Resolve a user's tool description to an actual tool name from the registry.
 * Uses direct name matching and common aliases (gotcha #2).
 */
function resolveToolName(lowerMessage: string, toolNodes: ToolNode[]): ToolNode | undefined {
    // Direct name match against registry
    for (const tool of toolNodes) {
        if (lowerMessage.includes(tool.name.toLowerCase())) {
            return tool
        }
    }

    // Fuzzy match against common tool aliases
    const aliases: Record<string, string[]> = {
        'web search': ['googleCustomSearch', 'serpAPI', 'searchAPI', 'braveSearchAPI', 'serper'],
        search: ['googleCustomSearch', 'serpAPI', 'searchAPI', 'braveSearchAPI', 'serper'],
        calculator: ['calculator'],
        'web scrape': ['cheerioWebScraper', 'puppeteerWebScraper'],
        scrape: ['cheerioWebScraper', 'puppeteerWebScraper'],
        wikipedia: ['wikipedia'],
        'web browse': ['webBrowser'],
        'code interpret': ['codeInterpreter'],
        request: ['requestsGet', 'requestsPost']
    }

    for (const [alias, toolNames] of Object.entries(aliases)) {
        if (lowerMessage.includes(alias)) {
            for (const toolName of toolNames) {
                const found = toolNodes.find((t) => t.name === toolName)
                if (found) return found
            }
        }
    }

    // Match against tool descriptions as last resort
    for (const tool of toolNodes) {
        if (tool.description) {
            const descWords = tool.description.toLowerCase().split(/\s+/)
            const msgWords = lowerMessage.split(/\s+/)
            const overlap = msgWords.filter((w) => w.length > 3 && descWords.includes(w))
            if (overlap.length >= 2) return tool
        }
    }

    return undefined
}

/**
 * Find the agent node the user is referring to, or default to the first agent.
 */
function findAgentNode(lowerMessage: string, flow: FlowSnapshot): { id: string; data: { name?: string; label?: string } } | undefined {
    const agentNodes = flow.nodes.filter((n) => n.data.name === 'agentAgentflow')

    // Try finding a specific agent by label
    for (const agent of agentNodes) {
        const label = agent.data.label?.toLowerCase()
        if (label && lowerMessage.includes(label)) {
            return agent
        }
    }

    // Default to the first (or only) agent node
    return agentNodes[0]
}
