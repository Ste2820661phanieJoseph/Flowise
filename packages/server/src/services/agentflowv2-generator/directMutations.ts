import { cloneDeep } from 'lodash'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

// initNode is exported from flowise-components source but not yet in compiled type declarations.
// Stream B (task B2) will add it to the public API. Until then, import dynamically.
const { initNode } = require('flowise-components') as { initNode: (nodeData: Record<string, any>, nodeId: string) => Record<string, any> }

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

export interface MutationResult {
    nodes: FlowNode[]
    edges: FlowEdge[]
    explanation: string
}

/**
 * Add a tool to an agent node's agentTools array.
 * Resolves the tool from the component registry via initNode().
 */
export const addTool = (nodes: FlowNode[], edges: FlowEdge[], toolName: string, targetNodeId?: string): MutationResult => {
    const resultNodes = cloneDeep(nodes)
    const resultEdges = cloneDeep(edges)

    // Find the target agent node
    let targetNode: FlowNode | undefined
    if (targetNodeId) {
        targetNode = resultNodes.find((n) => n.id === targetNodeId)
    } else {
        targetNode = resultNodes.find((n) => n.data.name === 'agentAgentflow')
    }

    if (!targetNode) {
        return {
            nodes: resultNodes,
            edges: resultEdges,
            explanation: `Could not find an agent node to add the tool "${toolName}" to.`
        }
    }

    // Verify the tool exists in the component registry
    const appServer = getRunningExpressApp()
    const componentNodes = appServer.nodesPool.componentNodes
    if (!componentNodes[toolName]) {
        return {
            nodes: resultNodes,
            edges: resultEdges,
            explanation: `Tool "${toolName}" not found in the component registry.`
        }
    }

    // Initialize the tool to validate it (uses initNode from flowise-components)
    const toolNodeData = cloneDeep(componentNodes[toolName])
    const toolNodeId = `${toolName}_0`
    initNode(toolNodeData, toolNodeId)

    // Add tool to the agent's agentTools array
    if (!targetNode.data.inputs) {
        targetNode.data.inputs = {}
    }
    if (!Array.isArray(targetNode.data.inputs.agentTools)) {
        targetNode.data.inputs.agentTools = []
    }

    // Check if tool is already added
    const alreadyAdded = targetNode.data.inputs.agentTools.some((t: any) => t === toolName || t?.name === toolName)
    if (alreadyAdded) {
        return {
            nodes: resultNodes,
            edges: resultEdges,
            explanation: `Tool "${toolName}" is already added to ${targetNode.data.label || targetNode.id}.`
        }
    }

    targetNode.data.inputs.agentTools.push(toolName)

    return {
        nodes: resultNodes,
        edges: resultEdges,
        explanation: `Added tool "${toolName}" to ${targetNode.data.label || targetNode.id}.`
    }
}

/**
 * Remove a node and all its connected edges from the flow.
 */
export const removeNode = (nodes: FlowNode[], edges: FlowEdge[], nodeId: string): MutationResult => {
    const targetNode = nodes.find((n) => n.id === nodeId)
    if (!targetNode) {
        return {
            nodes: cloneDeep(nodes),
            edges: cloneDeep(edges),
            explanation: `Node "${nodeId}" not found in the flow.`
        }
    }

    // Don't allow removing the start node
    if (targetNode.data.name === 'startAgentflow') {
        return {
            nodes: cloneDeep(nodes),
            edges: cloneDeep(edges),
            explanation: 'Cannot remove the start node. Every flow must have exactly one start node.'
        }
    }

    const label = targetNode.data.label || targetNode.id
    const resultNodes = nodes.filter((n) => n.id !== nodeId)
    const resultEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
    const removedEdgeCount = edges.length - resultEdges.length

    return {
        nodes: cloneDeep(resultNodes),
        edges: cloneDeep(resultEdges),
        explanation: `Removed "${label}" and its ${removedEdgeCount} connected edge(s).`
    }
}

/**
 * Rename a node's label.
 */
export const renameNode = (nodes: FlowNode[], edges: FlowEdge[], nodeId: string, newLabel: string): MutationResult => {
    const resultNodes = cloneDeep(nodes)
    const resultEdges = cloneDeep(edges)

    const targetNode = resultNodes.find((n) => n.id === nodeId)
    if (!targetNode) {
        return {
            nodes: resultNodes,
            edges: resultEdges,
            explanation: `Node "${nodeId}" not found in the flow.`
        }
    }

    const oldLabel = targetNode.data.label || targetNode.id
    targetNode.data.label = newLabel

    return {
        nodes: resultNodes,
        edges: resultEdges,
        explanation: `Renamed "${oldLabel}" to "${newLabel}".`
    }
}
