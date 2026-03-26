/**
 * Integration test for chatAgentflowv2 pipeline.
 *
 * Mocks the LLM and external dependencies, then verifies the full SSE event
 * sequence through each pipeline path.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

// Mock the express app singleton
const mockComponentNodes: Record<string, any> = {
    startAgentflow: {
        name: 'startAgentflow',
        label: 'Start',
        description: 'Start node',
        category: 'Agent Flows',
        inputs: [],
        outputs: [{ label: 'Output', name: 'startAgentflow' }],
        filePath: 'mock-path'
    },
    agentAgentflow: {
        name: 'agentAgentflow',
        label: 'Agent',
        description: 'AI Agent node',
        category: 'Agent Flows',
        inputs: [{ name: 'agentTools', label: 'Tools', type: 'string' }],
        outputs: [{ label: 'Output', name: 'agentAgentflow' }],
        credential: { label: 'Credential', credentialNames: ['openAIApi'] },
        filePath: 'mock-path'
    },
    llmAgentflow: {
        name: 'llmAgentflow',
        label: 'LLM',
        description: 'LLM node',
        category: 'Agent Flows',
        inputs: [],
        outputs: [{ label: 'Output', name: 'llmAgentflow' }],
        filePath: 'mock-path'
    },
    googleCustomSearch: {
        name: 'googleCustomSearch',
        label: 'Google Custom Search',
        description: 'Search the web',
        category: 'Tools',
        inputs: [],
        filePath: 'mock-path'
    }
}

jest.mock('../../utils/getRunningExpressApp', () => ({
    getRunningExpressApp: () => ({
        nodesPool: { componentNodes: mockComponentNodes },
        AppDataSource: { getRepository: jest.fn() },
        queueManager: null
    })
}))

// Mock flowise-components
jest.mock('flowise-components', () => ({
    generateNodesEdgesChat: jest.fn(),
    generateNodesData: jest.fn((result: any) => ({
        nodes: result.nodes.map((n: any) => ({
            ...n,
            data: {
                ...n.data,
                id: n.id,
                name: n.data?.name,
                label: n.data?.label,
                inputs: n.data?.inputs || {},
                inputParams: [],
                inputAnchors: [],
                outputAnchors: [{ id: `${n.id}-output-${n.data?.name}`, label: n.data?.label, name: n.data?.name }],
                color: '#7B61FF'
            }
        })),
        edges: result.edges
    })),
    generateSelectedTools: jest.fn((nodes: any) => nodes),
    updateEdges: jest.fn((edges: any, nodes: any) =>
        edges.map((e: any) => ({
            ...e,
            data: {
                ...e.data,
                sourceColor: '#7B61FF',
                targetColor: '#4ECDC4'
            }
        }))
    ),
    initNode: jest.fn((nodeData: any, nodeId: string) => ({
        ...nodeData,
        id: nodeId
    })),
    extractResponseContent: jest.fn((content: any) => (typeof content === 'string' ? content : content?.content || ''))
}))

// Mock credential checker
jest.mock('./credentialChecker', () => ({
    scanForRequirements: jest.fn(() => []),
    matchExistingCredentials: jest.fn(async () => ({ found: new Map(), missing: [] })),
    bindCredentials: jest.fn((nodes: any) => nodes)
}))

// Mock flow tester
jest.mock('./flowTester', () => ({
    generateTestCases: jest.fn(async () => [
        { type: 'happy_path', question: 'Hello' },
        { type: 'edge_case', question: '' }
    ]),
    runTest: jest.fn(async (_flowId: string, testCase: any) => ({
        testId: `${testCase.type}-${Date.now()}`,
        type: testCase.type,
        status: 'pass',
        question: testCase.question,
        response: 'Test passed'
    })),
    autoSaveFlow: jest.fn(async () => 'mock-flow-id')
}))

// Mock evaluator
jest.mock('./evaluatorOptimizer', () => ({
    evaluate: jest.fn(() => ({ verdict: 'DONE' })),
    generateFix: jest.fn(async () => ({ nodes: [], edges: [] }))
}))

// Mock templateCache
jest.mock('./templateCache', () => ({
    getCompactTemplates: jest.fn(() => 'Simple: start → agent')
}))

// Mock validation
jest.mock('./validation', () => ({
    validateAndFixFlow: jest.fn((nodes: any, edges: any) => ({
        nodes,
        edges,
        warnings: [],
        errors: []
    }))
}))

// Mock directMutations — initNode import
jest.mock('./directMutations', () => ({
    addTool: jest.fn((nodes: any, edges: any, toolName: string) => ({
        nodes,
        edges,
        explanation: `Added tool "${toolName}" to the agent.`
    })),
    removeNode: jest.fn((nodes: any, edges: any, nodeId: string) => ({
        nodes: nodes.filter((n: any) => n.id !== nodeId),
        edges: edges.filter((e: any) => e.source !== nodeId && e.target !== nodeId),
        explanation: `Removed node "${nodeId}".`
    })),
    renameNode: jest.fn((nodes: any, edges: any, nodeId: string, newLabel: string) => ({
        nodes: nodes.map((n: any) => (n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n)),
        edges,
        explanation: `Renamed "${nodeId}" to "${newLabel}".`
    }))
}))

// Mock logger — expose methods both at top level and under `default` for ESM→CJS interop
const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}
jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: mockLogger
}))

// Mock databaseEntities
jest.mock('../../utils', () => ({
    databaseEntities: {}
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const { generateNodesEdgesChat } = require('flowise-components') as { generateNodesEdgesChat: jest.Mock }
import { scanForRequirements, matchExistingCredentials, bindCredentials } from './credentialChecker'
import { evaluate } from './evaluatorOptimizer'
import { SSEStreamer } from '../../utils/SSEStreamer'

// Import the service under test
import agentflowv2Service from './index'

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Collects SSE events written to a mock response */
class MockSSECollector {
    events: Array<{ event: string; data: any }> = []
    private sseStreamer: SSEStreamer
    private chatId: string
    private mockRes: any

    constructor() {
        this.sseStreamer = new SSEStreamer()
        this.chatId = `test-${Date.now()}`
        this.mockRes = {
            write: jest.fn((chunk: string) => {
                // Parse SSE format: "message:\ndata:{...}\n\n"
                const dataMatch = chunk.match(/data:(.+)\n/)
                if (dataMatch) {
                    try {
                        const parsed = JSON.parse(dataMatch[1])
                        this.events.push(parsed)
                    } catch {
                        // Ignore parse errors
                    }
                }
            }),
            end: jest.fn(),
            headersSent: false
        }
        this.sseStreamer.addClient(this.chatId, this.mockRes)
    }

    get streamer() {
        return this.sseStreamer
    }
    get id() {
        return this.chatId
    }
    get response() {
        return this.mockRes
    }

    getEventTypes(): string[] {
        return this.events.map((e) => e.event)
    }

    getEvent(eventType: string) {
        return this.events.find((e) => e.event === eventType)
    }

    getAllEvents(eventType: string) {
        return this.events.filter((e) => e.event === eventType)
    }
}

function createMockReq(body: Record<string, any>): any {
    const listeners: Record<string, Function[]> = {}
    return {
        body,
        on: jest.fn((event: string, cb: Function) => {
            if (!listeners[event]) listeners[event] = []
            listeners[event].push(cb)
        }),
        _emit: (event: string) => {
            for (const cb of listeners[event] || []) cb()
        }
    }
}

// ---------------------------------------------------------------------------
// Mock flow data
// ---------------------------------------------------------------------------

const MOCK_CURRENT_FLOW = {
    nodes: [
        {
            id: 'startAgentflow_0',
            type: 'agentFlow',
            position: { x: 100, y: 200 },
            width: 300,
            height: 65,
            data: { name: 'startAgentflow', label: 'Start' }
        },
        {
            id: 'agentAgentflow_1',
            type: 'agentFlow',
            position: { x: 400, y: 200 },
            width: 300,
            height: 65,
            data: { name: 'agentAgentflow', label: 'Web Agent', inputs: { agentTools: [] } }
        }
    ],
    edges: [
        {
            id: 'e1',
            type: 'agentFlow',
            source: 'startAgentflow_0',
            sourceHandle: 'startAgentflow_0-output-startAgentflow',
            target: 'agentAgentflow_1',
            targetHandle: 'agentAgentflow_1-input-agentAgentflow'
        }
    ]
}

const MOCK_SELECTED_CHAT_MODEL = {
    id: 'chatOpenAI_0',
    name: 'chatOpenAI',
    label: 'ChatOpenAI',
    inputs: { modelName: 'gpt-4o' },
    credential: 'cred-id'
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chatAgentflowv2 — Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // Reset mock implementations to defaults after each test
        ;(scanForRequirements as jest.Mock).mockReturnValue([])
        ;(matchExistingCredentials as jest.Mock).mockResolvedValue({ found: new Map(), missing: [] })
        ;(bindCredentials as jest.Mock).mockImplementation((nodes: any) => nodes)
        ;(evaluate as jest.Mock).mockReturnValue({ verdict: 'DONE' })
    })

    // -----------------------------------------------------------------------
    // DIRECT_MUTATION path
    // -----------------------------------------------------------------------
    describe('DIRECT_MUTATION path', () => {
        it('should produce start → flow_update → end for add-tool mutation', async () => {
            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Add web search tool to the agent' }],
                currentFlow: MOCK_CURRENT_FLOW,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes[0]).toBe('start')
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')

            // No token events for direct mutations
            expect(eventTypes).not.toContain('token')

            // flow_update should have explanation
            const flowUpdate = collector.getEvent('flow_update')
            expect(flowUpdate?.data?.operationType).toBe('DIRECT_MUTATION')
            expect(flowUpdate?.data?.explanation).toBeDefined()
        })

        it('should produce start → flow_update → end for remove-node mutation', async () => {
            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Remove the Web Agent' }],
                currentFlow: MOCK_CURRENT_FLOW,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes[0]).toBe('start')
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')
        })

        it('should produce start → flow_update → end for rename mutation', async () => {
            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Rename the Web Agent to Email Handler' }],
                currentFlow: MOCK_CURRENT_FLOW,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes[0]).toBe('start')
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')
        })
    })

    // -----------------------------------------------------------------------
    // FULL GENERATION path (LLM)
    // -----------------------------------------------------------------------
    describe('FULL_GENERATION path', () => {
        it('should produce start → tokens → flow_update → evaluation(DONE) → end', async () => {
            // Mock the LLM to return a known valid flow
            const mockLLMNodes = [
                {
                    id: 'startAgentflow_0',
                    type: 'agentFlow',
                    position: { x: 100, y: 200 },
                    width: 300,
                    height: 65,
                    data: { name: 'startAgentflow', label: 'Start' }
                },
                {
                    id: 'agentAgentflow_1',
                    type: 'agentFlow',
                    position: { x: 400, y: 200 },
                    width: 300,
                    height: 65,
                    data: { name: 'agentAgentflow', label: 'Search Agent' }
                }
            ]
            const mockLLMEdges = [
                {
                    id: 'e1',
                    type: 'agentFlow',
                    source: 'startAgentflow_0',
                    sourceHandle: 'startAgentflow_0-output-startAgentflow',
                    target: 'agentAgentflow_1',
                    targetHandle: 'agentAgentflow_1-input-agentAgentflow'
                }
            ]

            ;(generateNodesEdgesChat as jest.Mock).mockResolvedValue({
                explanation: 'Created a search agent workflow',
                nodes: mockLLMNodes,
                edges: mockLLMEdges
            })

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent that searches the web' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes[0]).toBe('start')
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')

            // Verify flow_update payload has nodes and edges
            const flowUpdate = collector.getEvent('flow_update')
            expect(flowUpdate?.data?.nodes).toBeDefined()
            expect(flowUpdate?.data?.edges).toBeDefined()
        })

        it('should include test and evaluation events when autoTest is true', async () => {
            const mockLLMNodes = [
                {
                    id: 'startAgentflow_0',
                    type: 'agentFlow',
                    position: { x: 100, y: 200 },
                    width: 300,
                    height: 65,
                    data: { name: 'startAgentflow', label: 'Start' }
                },
                {
                    id: 'agentAgentflow_1',
                    type: 'agentFlow',
                    position: { x: 400, y: 200 },
                    width: 300,
                    height: 65,
                    data: { name: 'agentAgentflow', label: 'Agent' }
                }
            ]
            const mockLLMEdges = [
                {
                    id: 'e1',
                    type: 'agentFlow',
                    source: 'startAgentflow_0',
                    sourceHandle: 'startAgentflow_0-output-startAgentflow',
                    target: 'agentAgentflow_1',
                    targetHandle: 'agentAgentflow_1-input-agentAgentflow'
                }
            ]

            ;(generateNodesEdgesChat as jest.Mock).mockResolvedValue({
                explanation: 'Created an agent',
                nodes: mockLLMNodes,
                edges: mockLLMEdges
            })

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id,
                options: { autoTest: true, autoFix: true }
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes).toContain('test_start')
            expect(eventTypes).toContain('test_result')
            expect(eventTypes).toContain('evaluation')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')

            // Should have 2 test_start events (happy + edge)
            expect(collector.getAllEvents('test_start')).toHaveLength(2)
            expect(collector.getAllEvents('test_result')).toHaveLength(2)

            // Evaluation should be DONE
            const evalEvent = collector.getEvent('evaluation')
            expect(evalEvent?.data?.verdict).toBe('DONE')
        })

        it('should skip tests when autoTest is false', async () => {
            ;(generateNodesEdgesChat as jest.Mock).mockResolvedValue({
                explanation: 'Created a flow',
                nodes: [
                    {
                        id: 'startAgentflow_0',
                        type: 'agentFlow',
                        position: { x: 100, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'startAgentflow', label: 'Start' }
                    }
                ],
                edges: []
            })

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create a flow' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id,
                options: { autoTest: false }
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes).not.toContain('test_start')
            expect(eventTypes).not.toContain('test_result')
            expect(eventTypes).not.toContain('evaluation')
        })
    })

    // -----------------------------------------------------------------------
    // Credential resume path
    // -----------------------------------------------------------------------
    describe('Credential resume path', () => {
        it('should skip generation and bind credentials when credentialBindings present', async () => {
            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent' }],
                currentFlow: MOCK_CURRENT_FLOW,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id,
                credentialBindings: [{ nodeId: 'agentAgentflow_1', credentialId: 'cred-123' }]
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes[0]).toBe('start')
            expect(eventTypes).toContain('credential_bound')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')

            // Should NOT have generated (no tokens, no flow_update)
            expect(eventTypes).not.toContain('token')

            // bindCredentials should have been called
            expect(bindCredentials).toHaveBeenCalledWith(expect.any(Array), [{ nodeId: 'agentAgentflow_1', credentialId: 'cred-123' }])
        })
    })

    // -----------------------------------------------------------------------
    // Credential check path (missing credentials)
    // -----------------------------------------------------------------------
    describe('Credential check path', () => {
        it('should emit credential_check and end when credentials are missing', async () => {
            ;(generateNodesEdgesChat as jest.Mock).mockResolvedValue({
                explanation: 'Created a flow',
                nodes: [
                    {
                        id: 'startAgentflow_0',
                        type: 'agentFlow',
                        position: { x: 100, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'startAgentflow', label: 'Start' }
                    },
                    {
                        id: 'agentAgentflow_1',
                        type: 'agentFlow',
                        position: { x: 400, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'agentAgentflow', label: 'Agent' }
                    }
                ],
                edges: [
                    {
                        id: 'e1',
                        type: 'agentFlow',
                        source: 'startAgentflow_0',
                        sourceHandle: 'startAgentflow_0-output-startAgentflow',
                        target: 'agentAgentflow_1',
                        targetHandle: 'agentAgentflow_1-input-agentAgentflow'
                    }
                ]
            })

            // Mock credentials: all missing
            ;(scanForRequirements as jest.Mock).mockReturnValue([
                { nodeId: 'agentAgentflow_1', nodeName: 'agentAgentflow', credentialName: 'OpenAI API', credentialType: 'openAIApi' }
            ])
            ;(matchExistingCredentials as jest.Mock).mockResolvedValue({
                found: new Map(),
                missing: [
                    {
                        nodeId: 'agentAgentflow_1',
                        nodeName: 'agentAgentflow',
                        credentialName: 'OpenAI API',
                        credentialType: 'openAIApi'
                    }
                ]
            })

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes).toContain('flow_update')
            expect(eventTypes).toContain('credential_check')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')

            // Should NOT have test events (pipeline stops at credential check)
            expect(eventTypes).not.toContain('test_start')
        })
    })

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------
    describe('Error handling', () => {
        it('should stream error event when LLM fails', async () => {
            ;(generateNodesEdgesChat as jest.Mock).mockRejectedValue(new Error('LLM API key invalid'))

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()
            expect(eventTypes).toContain('error')
            expect(eventTypes[eventTypes.length - 1]).toBe('end')
        })
    })

    // -----------------------------------------------------------------------
    // Iteration loop
    // -----------------------------------------------------------------------
    describe('Evaluation iteration loop', () => {
        it('should iterate when evaluate returns ITERATE, then stop on DONE', async () => {
            ;(generateNodesEdgesChat as jest.Mock).mockResolvedValue({
                explanation: 'Created a flow',
                nodes: [
                    {
                        id: 'startAgentflow_0',
                        type: 'agentFlow',
                        position: { x: 100, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'startAgentflow', label: 'Start' }
                    },
                    {
                        id: 'agentAgentflow_1',
                        type: 'agentFlow',
                        position: { x: 400, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'agentAgentflow', label: 'Agent' }
                    }
                ],
                edges: [
                    {
                        id: 'e1',
                        type: 'agentFlow',
                        source: 'startAgentflow_0',
                        sourceHandle: 'startAgentflow_0-output-startAgentflow',
                        target: 'agentAgentflow_1',
                        targetHandle: 'agentAgentflow_1-input-agentAgentflow'
                    }
                ]
            })

            // First evaluate returns ITERATE, second returns DONE
            ;(evaluate as jest.Mock)
                .mockReturnValueOnce({
                    verdict: 'ITERATE',
                    category: 'LOGIC',
                    reason: 'Happy path test failed',
                    fixes: ['Fix the flow']
                })
                .mockReturnValueOnce({ verdict: 'DONE' })

            // Mock generateFix to return a valid flow
            const { generateFix } = require('./evaluatorOptimizer')
            ;(generateFix as jest.Mock).mockResolvedValue({
                nodes: [
                    {
                        id: 'startAgentflow_0',
                        type: 'agentFlow',
                        position: { x: 100, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'startAgentflow', label: 'Start' }
                    },
                    {
                        id: 'agentAgentflow_1',
                        type: 'agentFlow',
                        position: { x: 400, y: 200 },
                        width: 300,
                        height: 65,
                        data: { name: 'agentAgentflow', label: 'Agent (Fixed)' }
                    }
                ],
                edges: [
                    {
                        id: 'e1',
                        type: 'agentFlow',
                        source: 'startAgentflow_0',
                        sourceHandle: 'startAgentflow_0-output-startAgentflow',
                        target: 'agentAgentflow_1',
                        targetHandle: 'agentAgentflow_1-input-agentAgentflow'
                    }
                ]
            })

            const collector = new MockSSECollector()
            const req = createMockReq({
                messages: [{ role: 'user', content: 'Create an agent' }],
                currentFlow: null,
                selectedChatModel: MOCK_SELECTED_CHAT_MODEL,
                sessionId: collector.id,
                options: { autoTest: true, autoFix: true, maxIterations: 3 }
            })

            await agentflowv2Service.chatAgentflowv2(req, collector.streamer, collector.id, '')

            const eventTypes = collector.getEventTypes()

            // Should have iteration events
            expect(eventTypes).toContain('iteration_start')
            expect(eventTypes).toContain('iteration_flow_update')

            // Should have 2 evaluation events (first ITERATE, then DONE)
            const evalEvents = collector.getAllEvents('evaluation')
            expect(evalEvents.length).toBeGreaterThanOrEqual(2)
            expect(evalEvents[0].data.verdict).toBe('ITERATE')
            expect(evalEvents[evalEvents.length - 1].data.verdict).toBe('DONE')

            expect(eventTypes[eventTypes.length - 1]).toBe('end')
        })
    })
})
