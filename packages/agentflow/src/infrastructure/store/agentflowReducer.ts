import type { AgentflowAction, AgentflowState, FlowNode, NodeData } from '@/core/types'

// Node types that size to content; strip stored width/height so they stay content-sized
const CONTENT_SIZED_NODE_TYPES = new Set(['agentFlow', 'stickyNote'])

/**
 * Migrate node data from the old SDK field names to the current ones.
 * Old format: inputs=InputParam[], inputValues=Record<string,unknown>
 * New format: inputParams=InputParam[], inputs=Record<string,unknown>
 */
function migrateNodeData(data: NodeData): NodeData {
    const d = data as Record<string, unknown>
    if ('inputValues' in d && !('inputParams' in d)) {
        const { inputs, inputValues, ...rest } = d
        return { ...rest, inputParams: inputs, inputs: inputValues } as NodeData
    }
    return data
}

export function normalizeNodes(nodes: FlowNode[]): FlowNode[] {
    return nodes.map((node) => {
        const migratedData = migrateNodeData(node.data)
        if (CONTENT_SIZED_NODE_TYPES.has(node.type)) {
            const { width: _width, height: _height, ...rest } = { ...node, data: migratedData }
            return rest as FlowNode
        }
        return { ...node, data: migratedData }
    })
}

export const initialState: AgentflowState = {
    nodes: [],
    edges: [],
    chatflow: null,
    isDirty: false,
    reactFlowInstance: null,
    editingNodeId: null,
    editDialogProps: null
}

export function agentflowReducer(state: AgentflowState, action: AgentflowAction): AgentflowState {
    switch (action.type) {
        case 'SET_NODES':
            return { ...state, nodes: normalizeNodes(action.payload) }
        case 'SET_EDGES':
            return { ...state, edges: action.payload }
        case 'SET_CHATFLOW':
            return { ...state, chatflow: action.payload }
        case 'SET_DIRTY':
            return { ...state, isDirty: action.payload }
        case 'SET_REACTFLOW_INSTANCE':
            return { ...state, reactFlowInstance: action.payload }
        case 'OPEN_EDIT_DIALOG':
            return {
                ...state,
                editingNodeId: action.payload.nodeId,
                editDialogProps: action.payload.dialogProps
            }
        case 'CLOSE_EDIT_DIALOG':
            return {
                ...state,
                editingNodeId: null,
                editDialogProps: null
            }
        case 'RESET':
            return initialState
        default:
            return state
    }
}
