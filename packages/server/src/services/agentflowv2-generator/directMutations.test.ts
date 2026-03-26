import { addTool, removeNode, renameNode } from './directMutations'

// Mock getRunningExpressApp
jest.mock('../../utils/getRunningExpressApp', () => ({
    getRunningExpressApp: () => ({
        nodesPool: {
            componentNodes: {
                googleCustomSearch: {
                    name: 'googleCustomSearch',
                    label: 'Google Custom Search',
                    category: 'Tools',
                    inputs: [],
                    outputs: []
                },
                calculator: {
                    name: 'calculator',
                    label: 'Calculator',
                    category: 'Tools',
                    inputs: [],
                    outputs: []
                },
                serpAPI: {
                    name: 'serpAPI',
                    label: 'Serp API',
                    category: 'Tools',
                    inputs: [],
                    outputs: []
                }
            }
        }
    })
}))

// Mock initNode from flowise-components
jest.mock('flowise-components', () => ({
    initNode: (nodeData: any, nodeId: string) => ({
        ...nodeData,
        id: nodeId,
        inputParams: [],
        inputAnchors: [],
        outputAnchors: [],
        inputs: {},
        outputs: {}
    })
}))

// Test fixtures
const createMockFlow = () => ({
    nodes: [
        {
            id: 'startAgentflow_0',
            type: 'agentFlow',
            position: { x: 100, y: 200 },
            width: 300,
            height: 65,
            data: { name: 'startAgentflow', label: 'Start', inputs: {} }
        },
        {
            id: 'agentAgentflow_1',
            type: 'agentFlow',
            position: { x: 400, y: 200 },
            width: 300,
            height: 65,
            data: {
                name: 'agentAgentflow',
                label: 'Web Agent',
                inputs: { agentTools: ['serpAPI'] }
            }
        },
        {
            id: 'llmAgentflow_2',
            type: 'agentFlow',
            position: { x: 700, y: 200 },
            width: 300,
            height: 65,
            data: { name: 'llmAgentflow', label: 'Summarizer', inputs: {} }
        }
    ],
    edges: [
        {
            id: 'e1',
            type: 'agentFlow',
            source: 'startAgentflow_0',
            sourceHandle: 'startAgentflow_0-output-startAgentflow',
            target: 'agentAgentflow_1',
            targetHandle: 'agentAgentflow_1-input-agentAgentflow',
            data: { isHumanInput: false }
        },
        {
            id: 'e2',
            type: 'agentFlow',
            source: 'agentAgentflow_1',
            sourceHandle: 'agentAgentflow_1-output-agentAgentflow',
            target: 'llmAgentflow_2',
            targetHandle: 'llmAgentflow_2-input-llmAgentflow',
            data: { isHumanInput: false }
        }
    ]
})

describe('directMutations', () => {
    // -----------------------------------------------------------------------
    // addTool
    // -----------------------------------------------------------------------
    describe('addTool', () => {
        it('should add a tool to the specified agent node', () => {
            const { nodes, edges } = createMockFlow()
            const result = addTool(nodes, edges, 'googleCustomSearch', 'agentAgentflow_1')

            expect(result.explanation).toContain('Added tool')
            expect(result.explanation).toContain('googleCustomSearch')

            const agent = result.nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(agent?.data.inputs.agentTools).toContain('googleCustomSearch')
        })

        it('should default to the first agent node when no targetNodeId given', () => {
            const { nodes, edges } = createMockFlow()
            const result = addTool(nodes, edges, 'calculator')

            const agent = result.nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(agent?.data.inputs.agentTools).toContain('calculator')
        })

        it('should not duplicate an already-added tool', () => {
            const { nodes, edges } = createMockFlow()
            const result = addTool(nodes, edges, 'serpAPI', 'agentAgentflow_1')

            expect(result.explanation).toContain('already added')
            const agent = result.nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(agent?.data.inputs.agentTools.filter((t: string) => t === 'serpAPI')).toHaveLength(1)
        })

        it('should return error explanation when agent node not found', () => {
            const { nodes, edges } = createMockFlow()
            const result = addTool(nodes, edges, 'calculator', 'nonExistentNode')

            expect(result.explanation).toContain('Could not find an agent node')
        })

        it('should return error explanation when tool not in registry', () => {
            const { nodes, edges } = createMockFlow()
            const result = addTool(nodes, edges, 'nonExistentTool', 'agentAgentflow_1')

            expect(result.explanation).toContain('not found in the component registry')
        })

        it('should initialize agentTools array if it does not exist', () => {
            const { nodes, edges } = createMockFlow()
            // Remove agentTools from the agent
            const agent = nodes.find((n) => n.id === 'agentAgentflow_1')!
            delete agent.data.inputs.agentTools

            const result = addTool(nodes, edges, 'calculator', 'agentAgentflow_1')
            const updatedAgent = result.nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(updatedAgent?.data.inputs.agentTools).toContain('calculator')
        })

        it('should not mutate the original nodes', () => {
            const { nodes, edges } = createMockFlow()
            const originalAgent = nodes.find((n) => n.id === 'agentAgentflow_1')!
            const originalToolCount = originalAgent.data.inputs.agentTools?.length ?? 0

            addTool(nodes, edges, 'calculator', 'agentAgentflow_1')

            expect(originalAgent.data.inputs.agentTools?.length ?? 0).toBe(originalToolCount)
        })
    })

    // -----------------------------------------------------------------------
    // removeNode
    // -----------------------------------------------------------------------
    describe('removeNode', () => {
        it('should remove a node and its connected edges', () => {
            const { nodes, edges } = createMockFlow()
            const result = removeNode(nodes, edges, 'llmAgentflow_2')

            expect(result.nodes.find((n) => n.id === 'llmAgentflow_2')).toBeUndefined()
            expect(result.edges.find((e) => e.target === 'llmAgentflow_2')).toBeUndefined()
            expect(result.explanation).toContain('Removed')
            expect(result.explanation).toContain('Summarizer')
        })

        it('should remove all edges connected to the removed node', () => {
            const { nodes, edges } = createMockFlow()
            const result = removeNode(nodes, edges, 'agentAgentflow_1')

            // Both edges connect to agentAgentflow_1
            expect(result.edges).toHaveLength(0)
            expect(result.explanation).toContain('2 connected edge(s)')
        })

        it('should not allow removing the start node', () => {
            const { nodes, edges } = createMockFlow()
            const result = removeNode(nodes, edges, 'startAgentflow_0')

            expect(result.explanation).toContain('Cannot remove the start node')
            expect(result.nodes).toHaveLength(3) // all nodes preserved
        })

        it('should return error when node not found', () => {
            const { nodes, edges } = createMockFlow()
            const result = removeNode(nodes, edges, 'nonExistent')

            expect(result.explanation).toContain('not found')
            expect(result.nodes).toHaveLength(3)
        })

        it('should preserve other nodes and edges', () => {
            const { nodes, edges } = createMockFlow()
            const result = removeNode(nodes, edges, 'llmAgentflow_2')

            expect(result.nodes).toHaveLength(2)
            expect(result.nodes.find((n) => n.id === 'startAgentflow_0')).toBeDefined()
            expect(result.nodes.find((n) => n.id === 'agentAgentflow_1')).toBeDefined()
            // Edge from start to agent should be preserved
            expect(result.edges.find((e) => e.source === 'startAgentflow_0')).toBeDefined()
        })
    })

    // -----------------------------------------------------------------------
    // renameNode
    // -----------------------------------------------------------------------
    describe('renameNode', () => {
        it('should rename a node label', () => {
            const { nodes, edges } = createMockFlow()
            const result = renameNode(nodes, edges, 'agentAgentflow_1', 'Email Handler')

            const renamed = result.nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(renamed?.data.label).toBe('Email Handler')
            expect(result.explanation).toContain('Renamed')
            expect(result.explanation).toContain('Web Agent')
            expect(result.explanation).toContain('Email Handler')
        })

        it('should return error when node not found', () => {
            const { nodes, edges } = createMockFlow()
            const result = renameNode(nodes, edges, 'nonExistent', 'New Name')

            expect(result.explanation).toContain('not found')
        })

        it('should not mutate the original nodes', () => {
            const { nodes, edges } = createMockFlow()
            renameNode(nodes, edges, 'agentAgentflow_1', 'New Name')

            const original = nodes.find((n) => n.id === 'agentAgentflow_1')
            expect(original?.data.label).toBe('Web Agent')
        })

        it('should preserve all edges unchanged', () => {
            const { nodes, edges } = createMockFlow()
            const result = renameNode(nodes, edges, 'agentAgentflow_1', 'New Name')

            expect(result.edges).toHaveLength(edges.length)
        })
    })
})
