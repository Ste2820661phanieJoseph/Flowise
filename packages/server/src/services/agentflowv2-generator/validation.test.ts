import { validateAndFixFlow } from './validation'

// Mock component registry
const mockComponentNodes: Record<string, any> = {
    startAgentflow: { name: 'startAgentflow', label: 'Start', category: 'Agent Flows' },
    agentAgentflow: { name: 'agentAgentflow', label: 'Agent', category: 'Agent Flows' },
    llmAgentflow: { name: 'llmAgentflow', label: 'LLM', category: 'Agent Flows' },
    conditionAgentflow: { name: 'conditionAgentflow', label: 'Condition', category: 'Agent Flows' },
    conditionAgentAgentflow: { name: 'conditionAgentAgentflow', label: 'Condition Agent', category: 'Agent Flows' },
    toolAgentflow: { name: 'toolAgentflow', label: 'Tool', category: 'Agent Flows' },
    retrieverAgentflow: { name: 'retrieverAgentflow', label: 'Retriever', category: 'Agent Flows' },
    loopAgentflow: { name: 'loopAgentflow', label: 'Loop', category: 'Agent Flows' },
    iterationAgentflow: { name: 'iterationAgentflow', label: 'Iteration', category: 'Agent Flows' },
    humanInputAgentflow: { name: 'humanInputAgentflow', label: 'Human Input', category: 'Agent Flows' },
    httpAgentflow: { name: 'httpAgentflow', label: 'HTTP', category: 'Agent Flows' },
    directReplyAgentflow: { name: 'directReplyAgentflow', label: 'Direct Reply', category: 'Agent Flows' },
    customFunctionAgentflow: { name: 'customFunctionAgentflow', label: 'Custom Function', category: 'Agent Flows' },
    executeFlowAgentflow: { name: 'executeFlowAgentflow', label: 'Execute Flow', category: 'Agent Flows' },
    stickyNoteAgentflow: { name: 'stickyNoteAgentflow', label: 'Sticky Note', category: 'Agent Flows' }
}

const makeNode = (id: string, name: string, label: string, pos = { x: 0, y: 0 }) => ({
    id,
    type: 'agentFlow',
    position: pos,
    width: 300,
    height: 65,
    data: { name, label }
})

const makeEdge = (source: string, target: string) => ({
    id: `${source}-output-${target}-input`,
    type: 'agentFlow',
    source,
    sourceHandle: `${source}-output-${source.split('_')[0]}`,
    target,
    targetHandle: `${target}-input-${target.split('_')[0]}`,
    data: { isHumanInput: false }
})

describe('validation', () => {
    // -----------------------------------------------------------------------
    // Layer 3: Node existence check
    // -----------------------------------------------------------------------
    describe('Layer 3 — node existence check', () => {
        it('should remove hallucinated node types', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('emailAgentflow_1', 'emailAgentflow', 'Send Email', { x: 400, y: 200 }) // doesn't exist
            ]
            const edges = [makeEdge('startAgentflow_0', 'emailAgentflow_1')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            expect(result.nodes.find((n) => n.id === 'emailAgentflow_1')).toBeUndefined()
            expect(result.warnings.some((w) => w.message.includes('emailAgentflow'))).toBe(true)
        })

        it('should remove edges connected to hallucinated nodes', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('fakeNode_1', 'fakeNode', 'Fake', { x: 400, y: 200 })
            ]
            const edges = [makeEdge('startAgentflow_0', 'fakeNode_1')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            expect(result.edges).toHaveLength(0)
        })

        it('should keep valid nodes unchanged', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 })
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            expect(result.nodes).toHaveLength(2)
            expect(result.edges).toHaveLength(1)
        })

        it('should handle nodes with no data.name', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                { id: 'broken_1', type: 'agentFlow', position: { x: 400, y: 200 }, width: 300, height: 65, data: {} as any }
            ]
            const edges = [makeEdge('startAgentflow_0', 'broken_1')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)

            expect(result.nodes.find((n) => n.id === 'broken_1')).toBeUndefined()
            expect(result.warnings.some((w) => w.message.includes('no data.name'))).toBe(true)
        })

        it('should allow stickyNoteAgentflow even if not in registry', () => {
            const minimalRegistry = { startAgentflow: mockComponentNodes.startAgentflow }
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('stickyNoteAgentflow_1', 'stickyNoteAgentflow', 'Note', { x: 400, y: 400 })
            ]

            const result = validateAndFixFlow(nodes, [], minimalRegistry)

            expect(result.nodes).toHaveLength(2)
        })
    })

    // -----------------------------------------------------------------------
    // Layer 6: autoFix
    // -----------------------------------------------------------------------
    describe('Layer 6 — autoFix', () => {
        it('should remove hanging edges (source/target node missing)', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 })
            ]
            const edges = [
                makeEdge('startAgentflow_0', 'agentAgentflow_1'),
                makeEdge('startAgentflow_0', 'nonExistentNode_99') // hanging
            ]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            expect(result.edges).toHaveLength(1)
            expect(result.warnings.some((w) => w.message.includes('hanging edge'))).toBe(true)
        })

        it('should deduplicate node IDs', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent 1', { x: 400, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent 2', { x: 700, y: 200 }) // duplicate ID
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            const ids = result.nodes.map((n) => n.id)
            const uniqueIds = new Set(ids)
            expect(uniqueIds.size).toBe(ids.length) // all unique
            expect(result.warnings.some((w) => w.message.includes('duplicate node ID'))).toBe(true)
        })

        it('should fix overlapping positions', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent 1', { x: 400, y: 200 }),
                makeNode('llmAgentflow_2', 'llmAgentflow', 'LLM', { x: 400, y: 200 }) // same position
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1'), makeEdge('startAgentflow_0', 'llmAgentflow_2')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`)
            const uniquePositions = new Set(positions)
            expect(uniquePositions.size).toBe(positions.length)
        })

        it('should remove extra start nodes (keep first)', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start 1', { x: 100, y: 200 }),
                makeNode('startAgentflow_1', 'startAgentflow', 'Start 2', { x: 100, y: 400 }),
                makeNode('agentAgentflow_2', 'agentAgentflow', 'Agent', { x: 400, y: 200 })
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_2'), makeEdge('startAgentflow_1', 'agentAgentflow_2')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            const startNodes = result.nodes.filter((n) => n.data.name === 'startAgentflow')
            expect(startNodes).toHaveLength(1)
            expect(startNodes[0].id).toBe('startAgentflow_0')
            expect(result.warnings.some((w) => w.message.includes('extra start node'))).toBe(true)
        })
    })

    // -----------------------------------------------------------------------
    // Layer 4: Flow structure validation
    // -----------------------------------------------------------------------
    describe('Layer 4 — flow structure', () => {
        it('should report error for empty flow', () => {
            const result = validateAndFixFlow([], [], mockComponentNodes)
            expect(result.errors.some((e) => e.message.includes('empty'))).toBe(true)
        })

        it('should report error for missing start node', () => {
            const nodes = [makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 })]
            const result = validateAndFixFlow(nodes, [], mockComponentNodes)
            expect(result.errors.some((e) => e.message.includes('start node'))).toBe(true)
        })

        it('should report warning for disconnected nodes', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 })
            ]
            // No edges — both disconnected

            const result = validateAndFixFlow(nodes, [], mockComponentNodes)
            expect(result.warnings.some((w) => w.message.includes('not connected'))).toBe(true)
        })
    })

    // -----------------------------------------------------------------------
    // Layer 5: Constraints
    // -----------------------------------------------------------------------
    describe('Layer 5 — constraints', () => {
        it('should report error for nested iteration nodes (via parentNode)', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                {
                    ...makeNode('iterationAgentflow_1', 'iterationAgentflow', 'Outer', { x: 400, y: 200 }),
                    type: 'iteration'
                },
                {
                    ...makeNode('iterationAgentflow_2', 'iterationAgentflow', 'Inner', { x: 450, y: 250 }),
                    parentNode: 'iterationAgentflow_1'
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'iterationAgentflow_1')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)
            expect(result.errors.some((e) => e.message.includes('Nested iteration'))).toBe(true)
        })

        it('should report error for human input inside iteration (via parentNode)', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                {
                    ...makeNode('iterationAgentflow_1', 'iterationAgentflow', 'Iteration', { x: 400, y: 200 }),
                    type: 'iteration'
                },
                {
                    ...makeNode('humanInputAgentflow_2', 'humanInputAgentflow', 'Approval', { x: 450, y: 250 }),
                    parentNode: 'iterationAgentflow_1'
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'iterationAgentflow_1')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)
            expect(result.errors.some((e) => e.message.includes('Human input node is not supported'))).toBe(true)
        })
    })

    // -----------------------------------------------------------------------
    // directReplyAgentflow checks
    // -----------------------------------------------------------------------
    describe('directReplyAgentflow — message check and auto-fix', () => {
        it('should warn when directReplyMessage is empty', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 }),
                {
                    ...makeNode('directReplyAgentflow_2', 'directReplyAgentflow', 'Reply', { x: 700, y: 200 }),
                    data: { name: 'directReplyAgentflow', label: 'Reply', inputs: { directReplyMessage: '' } }
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1'), makeEdge('agentAgentflow_1', 'directReplyAgentflow_2')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)

            // The constraint layer should emit a warning about empty directReplyMessage
            expect(result.warnings.some((w) => w.message.includes('directReplyMessage'))).toBe(true)
        })

        it('should auto-fill directReplyMessage from preceding node ID', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Web Search Agent', { x: 400, y: 200 }),
                {
                    ...makeNode('directReplyAgentflow_2', 'directReplyAgentflow', 'Reply', { x: 700, y: 200 }),
                    data: { name: 'directReplyAgentflow', label: 'Reply', inputs: {} }
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1'), makeEdge('agentAgentflow_1', 'directReplyAgentflow_2')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)

            const replyNode = result.nodes.find((n) => n.id === 'directReplyAgentflow_2')
            expect(replyNode?.data?.inputs?.directReplyMessage).toBe('{{ agentAgentflow_1 }}')
            expect(result.warnings.some((w) => w.message.includes('Auto-fix') && w.message.includes('directReplyMessage'))).toBe(true)
        })

        it('should not auto-fill directReplyMessage when already set', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 }),
                {
                    ...makeNode('directReplyAgentflow_2', 'directReplyAgentflow', 'Reply', { x: 700, y: 200 }),
                    data: { name: 'directReplyAgentflow', label: 'Reply', inputs: { directReplyMessage: '{{ $flow.state.result }}' } }
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1'), makeEdge('agentAgentflow_1', 'directReplyAgentflow_2')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)

            const replyNode = result.nodes.find((n) => n.id === 'directReplyAgentflow_2')
            expect(replyNode?.data?.inputs?.directReplyMessage).toBe('{{ $flow.state.result }}')
            expect(result.warnings.some((w) => w.message.includes('Auto-fix') && w.message.includes('directReplyMessage'))).toBe(false)
        })

        it('should auto-fill from start node ID when directly connected', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                {
                    ...makeNode('directReplyAgentflow_1', 'directReplyAgentflow', 'Reply', { x: 400, y: 200 }),
                    data: { name: 'directReplyAgentflow', label: 'Reply', inputs: {} }
                }
            ]
            const edges = [makeEdge('startAgentflow_0', 'directReplyAgentflow_1')]

            const result = validateAndFixFlow(nodes as any, edges, mockComponentNodes)

            const replyNode = result.nodes.find((n) => n.id === 'directReplyAgentflow_1')
            expect(replyNode?.data?.inputs?.directReplyMessage).toBe('{{ startAgentflow_0 }}')
        })
    })

    // -----------------------------------------------------------------------
    // Combined: valid flow
    // -----------------------------------------------------------------------
    describe('valid flow — no errors', () => {
        it('should pass a simple valid flow with no warnings or errors', () => {
            const nodes = [
                makeNode('startAgentflow_0', 'startAgentflow', 'Start', { x: 100, y: 200 }),
                makeNode('agentAgentflow_1', 'agentAgentflow', 'Agent', { x: 400, y: 200 })
            ]
            const edges = [makeEdge('startAgentflow_0', 'agentAgentflow_1')]

            const result = validateAndFixFlow(nodes, edges, mockComponentNodes)

            expect(result.errors).toHaveLength(0)
            expect(result.nodes).toHaveLength(2)
            expect(result.edges).toHaveLength(1)
        })
    })
})
