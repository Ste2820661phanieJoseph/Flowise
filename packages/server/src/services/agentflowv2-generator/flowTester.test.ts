import { generateTestCases, runTest, autoSaveFlow, TestCase } from './flowTester'

// Mock dependencies
jest.mock('../../utils/getRunningExpressApp', () => ({
    getRunningExpressApp: jest.fn(() => ({
        AppDataSource: {
            getRepository: jest.fn(() => ({
                findOneBy: jest.fn(),
                create: jest.fn((entity: any) => entity),
                save: jest.fn((entity: any) => ({ ...entity, id: 'saved-flow-id' }))
            }))
        }
    }))
}))

jest.mock('../../utils/buildChatflow', () => ({
    utilBuildChatflow: jest.fn()
}))

jest.mock('../../utils', () => ({
    databaseEntities: {}
}))

jest.mock('../../utils/logger', () => ({
    default: { debug: jest.fn(), info: jest.fn(), error: jest.fn() }
}))

import { utilBuildChatflow } from '../../utils/buildChatflow'
const mockUtilBuildChatflow = utilBuildChatflow as jest.Mock

describe('flowTester', () => {
    // ----- generateTestCases -----

    describe('generateTestCases', () => {
        it('returns 2 test cases with correct types when LLM responds properly', async () => {
            const mockResponse = JSON.stringify([
                { type: 'happy_path', question: 'What is AI?' },
                { type: 'edge_case', question: '' }
            ])

            const mockModel = {
                invoke: jest.fn().mockResolvedValue({ content: mockResponse })
            }

            const MockNodeClass = jest.fn().mockImplementation(() => ({
                init: jest.fn().mockResolvedValue(mockModel)
            }))

            // Mock dynamic import
            jest.doMock('mock-chat-model-path', () => ({ nodeClass: MockNodeClass }), { virtual: true })

            const componentNodes = {
                chatOpenAI: {
                    name: 'chatOpenAI',
                    filePath: 'mock-chat-model-path'
                }
            }

            const chatModel = { name: 'chatOpenAI', inputs: { modelName: 'gpt-4o' } }

            const result = await generateTestCases(
                'A web search agent',
                ['startAgentflow', 'agentAgentflow'],
                'Create an agent that searches the web',
                chatModel,
                componentNodes,
                {}
            )

            expect(result).toHaveLength(2)
            expect(result[0].type).toBe('happy_path')
            expect(result[1].type).toBe('edge_case')
            expect(result[0].question).toBe('What is AI?')
        })

        it('returns fallback test cases when LLM response is malformed', async () => {
            const mockModel = {
                invoke: jest.fn().mockResolvedValue({ content: 'not valid json' })
            }

            const MockNodeClass = jest.fn().mockImplementation(() => ({
                init: jest.fn().mockResolvedValue(mockModel)
            }))

            jest.doMock('mock-chat-model-path-2', () => ({ nodeClass: MockNodeClass }), { virtual: true })

            const componentNodes = {
                chatOpenAI: { name: 'chatOpenAI', filePath: 'mock-chat-model-path-2' }
            }

            const result = await generateTestCases(
                'A web search agent',
                ['startAgentflow'],
                'Search the web',
                { name: 'chatOpenAI' },
                componentNodes,
                {}
            )

            expect(result).toHaveLength(2)
            expect(result[0].type).toBe('happy_path')
            expect(result[0].question).toBe('Search the web')
            expect(result[1].type).toBe('edge_case')
        })
    })

    // ----- runTest -----

    describe('runTest', () => {
        it('returns pass when utilBuildChatflow returns a valid response', async () => {
            mockUtilBuildChatflow.mockResolvedValue({ text: 'Here are the search results...' })

            const testCase: TestCase = { type: 'happy_path', question: 'Search for cats' }
            const sessionId = `agent-builder-test-flow1-${Date.now()}`

            const result = await runTest('flow-123', testCase, sessionId)

            expect(result.status).toBe('pass')
            expect(result.type).toBe('happy_path')
            expect(result.response).toBeDefined()
        })

        it('returns fail when utilBuildChatflow returns an error', async () => {
            mockUtilBuildChatflow.mockResolvedValue({ error: 'Node execution failed' })

            const testCase: TestCase = { type: 'edge_case', question: '' }
            const sessionId = `agent-builder-test-flow1-${Date.now()}`

            const result = await runTest('flow-123', testCase, sessionId)

            expect(result.status).toBe('fail')
            expect(result.type).toBe('edge_case')
            expect(result.error).toBeDefined()
        })

        it('returns fail when utilBuildChatflow throws', async () => {
            mockUtilBuildChatflow.mockRejectedValue(new Error('Connection timeout'))

            const testCase: TestCase = { type: 'happy_path', question: 'Test question' }
            const sessionId = `agent-builder-test-flow1-${Date.now()}`

            const result = await runTest('flow-123', testCase, sessionId)

            expect(result.status).toBe('fail')
            expect(result.error).toBe('Connection timeout')
        })
    })

    // ----- autoSaveFlow -----

    describe('autoSaveFlow', () => {
        it('saves a new draft flow and returns the flow ID', async () => {
            const nodes = [{ id: 'start_0', type: 'agentFlow', data: { name: 'startAgentflow' } }]
            const edges: any[] = []

            const result = await autoSaveFlow(nodes, edges, undefined, 'workspace-1')

            expect(result).toBe('saved-flow-id')
        })
    })
})
