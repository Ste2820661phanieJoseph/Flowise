import credentialsService from '../credentials'
import logger from '../../utils/logger'

export interface CredentialRequirement {
    nodeId: string
    nodeName: string
    credentialName: string
    credentialType: string
}

export interface CredentialOption {
    id: string
    name: string
    credentialType: string
}

export interface CredentialMatchResult {
    found: Map<string, string> // nodeId → credentialId
    missing: CredentialRequirement[]
}

export interface CredentialMatchResultWithOptions extends CredentialMatchResult {
    available: Record<string, CredentialOption[]> // credentialType → list of existing credentials
}

/**
 * Walk each node and look up component schema in componentNodes registry.
 * Returns an array of credential requirements for nodes that need credentials.
 */
export const scanForRequirements = (nodes: any[], componentNodes: Record<string, any>): CredentialRequirement[] => {
    const requirements: CredentialRequirement[] = []

    for (const node of nodes) {
        const nodeName = node.data?.name
        if (!nodeName) continue

        const componentDef = componentNodes[nodeName]
        if (!componentDef) continue

        // Check if the component definition has a credential property
        if (componentDef.credential && componentDef.credential.credentialNames?.length > 0) {
            for (const credType of componentDef.credential.credentialNames) {
                requirements.push({
                    nodeId: node.id,
                    nodeName: nodeName,
                    credentialName: componentDef.credential.label || 'Credential',
                    credentialType: credType
                })
            }
        }
    }

    return requirements
}

/**
 * Scan tools attached to agent nodes for credential requirements.
 * Tools are stored in node.data.inputs.agentTools as objects with
 * { agentSelectedTool: "toolName", agentSelectedToolConfig: {...} }.
 */
export const scanToolCredentialRequirements = (nodes: any[], componentNodes: Record<string, any>): CredentialRequirement[] => {
    const requirements: CredentialRequirement[] = []
    const seen = new Set<string>()

    for (const node of nodes) {
        if (node.data?.name !== 'agentAgentflow') continue

        const agentTools = node.data?.inputs?.agentTools
        if (!Array.isArray(agentTools)) continue

        for (const toolEntry of agentTools) {
            const toolName = typeof toolEntry === 'string' ? toolEntry : toolEntry?.agentSelectedTool
            if (!toolName) continue

            // Avoid duplicate requirements for the same tool across agents
            const key = `${node.id}:${toolName}`
            if (seen.has(key)) continue
            seen.add(key)

            const toolDef = componentNodes[toolName]
            if (!toolDef) continue

            if (toolDef.credential && toolDef.credential.credentialNames?.length > 0) {
                for (const credType of toolDef.credential.credentialNames) {
                    requirements.push({
                        nodeId: node.id,
                        nodeName: toolName,
                        credentialName: toolDef.credential.label || 'Credential',
                        credentialType: credType
                    })
                }
            }
        }
    }

    return requirements
}

/**
 * Match credential requirements against existing credentials in the workspace.
 * Returns found bindings and missing requirements.
 */
export const matchExistingCredentials = async (
    requirements: CredentialRequirement[],
    workspaceId: string
): Promise<CredentialMatchResult> => {
    const found = new Map<string, string>()
    const missing: CredentialRequirement[] = []

    if (requirements.length === 0) {
        return { found, missing }
    }

    // Get unique credential types needed
    const uniqueCredTypes = [...new Set(requirements.map((r) => r.credentialType))]

    let existingCredentials: any[] = []
    try {
        existingCredentials = await credentialsService.getAllCredentials(uniqueCredTypes, workspaceId)
    } catch (err: any) {
        logger.warn(`[AgentBuilder] Failed to fetch credentials (workspaceId=${workspaceId || '(empty)'}): ${err.message}`)
        return { found, missing: requirements }
    }

    // Build a lookup: credentialName → credentialId (first match)
    const credentialsByType = new Map<string, string>()
    for (const cred of existingCredentials) {
        if (!credentialsByType.has(cred.credentialName)) {
            credentialsByType.set(cred.credentialName, cred.id)
        }
    }

    // Match requirements to existing credentials
    for (const req of requirements) {
        const credId = credentialsByType.get(req.credentialType)
        if (credId) {
            found.set(req.nodeId, credId)
        } else {
            missing.push(req)
        }
    }

    return { found, missing }
}

/**
 * Enhanced version that also returns all available credentials per type,
 * so the UI can present them as selectable options.
 */
export const matchExistingCredentialsWithOptions = async (
    requirements: CredentialRequirement[],
    workspaceId: string
): Promise<CredentialMatchResultWithOptions> => {
    const found = new Map<string, string>()
    const missing: CredentialRequirement[] = []
    const available: Record<string, CredentialOption[]> = {}

    if (requirements.length === 0) {
        return { found, missing, available }
    }

    const uniqueCredTypes = [...new Set(requirements.map((r) => r.credentialType))]

    // Fetch ALL credentials in the workspace (not just matching types)
    // so we can show the user what's available
    let existingCredentials: any[] = []
    try {
        existingCredentials = await credentialsService.getAllCredentials(uniqueCredTypes, workspaceId)
    } catch (err: any) {
        logger.warn(`[AgentBuilder] Failed to fetch credentials (workspaceId=${workspaceId || '(empty)'}): ${err.message}`)
    }

    // Build lookup: credentialType → first credentialId
    const credentialsByType = new Map<string, string>()
    for (const cred of existingCredentials) {
        // Build available options per credential type
        if (!available[cred.credentialName]) {
            available[cred.credentialName] = []
        }
        available[cred.credentialName].push({
            id: cred.id,
            name: cred.name || cred.credentialName,
            credentialType: cred.credentialName
        })

        if (!credentialsByType.has(cred.credentialName)) {
            credentialsByType.set(cred.credentialName, cred.id)
        }
    }

    for (const req of requirements) {
        const credId = credentialsByType.get(req.credentialType)
        if (credId) {
            found.set(req.nodeId, credId)
        } else {
            missing.push(req)
        }
    }

    return { found, missing, available }
}

/**
 * Bind credentials to nodes with DUAL BINDING:
 * - node.data.credential = credentialId
 * - node.data.inputs.credential = credentialId
 * - For agentflow LLM nodes: also set node.data.inputs.llmModelConfig.FLOWISE_CREDENTIAL_ID
 */
export const bindCredentials = (nodes: any[], bindings: Array<{ nodeId: string; credentialId: string }>): any[] => {
    const bindingMap = new Map(bindings.map((b) => [b.nodeId, b.credentialId]))

    for (const node of nodes) {
        const credentialId = bindingMap.get(node.id)
        if (!credentialId) continue

        // DUAL BINDING: set both paths
        node.data.credential = credentialId

        if (!node.data.inputs) {
            node.data.inputs = {}
        }
        node.data.inputs.credential = credentialId

        // For agentflow LLM nodes, also set llmModelConfig credential
        if (node.data.name === 'agentAgentflow' || node.data.name === 'llmAgentflow') {
            if (!node.data.inputs.llmModelConfig) {
                node.data.inputs.llmModelConfig = {}
            }
            node.data.inputs.llmModelConfig.FLOWISE_CREDENTIAL_ID = credentialId
        }
    }

    return nodes
}

/**
 * Bind credentials to tools embedded in agent nodes.
 * Sets FLOWISE_CREDENTIAL_ID inside each tool's agentSelectedToolConfig.
 *
 * @param credentialsByType Map of credentialType → credentialId
 */
export const bindToolCredentials = (nodes: any[], componentNodes: Record<string, any>, credentialsByType: Map<string, string>): void => {
    for (const node of nodes) {
        if (node.data?.name !== 'agentAgentflow') continue

        const agentTools = node.data?.inputs?.agentTools
        if (!Array.isArray(agentTools)) continue

        for (const toolEntry of agentTools) {
            const toolName = typeof toolEntry === 'string' ? toolEntry : toolEntry?.agentSelectedTool
            if (!toolName || typeof toolEntry === 'string') continue

            const toolDef = componentNodes[toolName]
            if (!toolDef?.credential?.credentialNames?.length) continue

            for (const credType of toolDef.credential.credentialNames) {
                const credId = credentialsByType.get(credType)
                if (credId) {
                    if (!toolEntry.agentSelectedToolConfig) {
                        toolEntry.agentSelectedToolConfig = { agentSelectedTool: toolName }
                    }
                    toolEntry.agentSelectedToolConfig.FLOWISE_CREDENTIAL_ID = credId
                    break
                }
            }
        }
    }
}
