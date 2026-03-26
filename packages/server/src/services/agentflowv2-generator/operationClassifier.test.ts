import { classifyOperation } from './operationClassifier'

// Mock flow with common node types
const mockFlow = {
    nodes: [
        { id: 'startAgentflow_0', data: { name: 'startAgentflow', label: 'Start' } },
        { id: 'agentAgentflow_1', data: { name: 'agentAgentflow', label: 'Web Agent' } },
        { id: 'llmAgentflow_2', data: { name: 'llmAgentflow', label: 'Summarizer' } },
        { id: 'conditionAgentAgentflow_3', data: { name: 'conditionAgentAgentflow', label: 'Route Intent' } },
        { id: 'httpAgentflow_4', data: { name: 'httpAgentflow', label: 'API Call' } }
    ],
    edges: [
        { id: 'e1', source: 'startAgentflow_0', target: 'agentAgentflow_1' },
        { id: 'e2', source: 'agentAgentflow_1', target: 'llmAgentflow_2' }
    ]
}

const mockToolNodes = [
    { name: 'googleCustomSearch', description: 'Search the web using Google Custom Search' },
    { name: 'serpAPI', description: 'Search engine results page API' },
    { name: 'calculator', description: 'Perform mathematical calculations' },
    { name: 'cheerioWebScraper', description: 'Scrape web pages using Cheerio' },
    { name: 'wikipedia', description: 'Search and retrieve Wikipedia articles' },
    { name: 'codeInterpreter', description: 'Execute code in a sandboxed environment' }
]

describe('operationClassifier', () => {
    // -----------------------------------------------------------------------
    // FULL_GENERATION — empty canvas
    // -----------------------------------------------------------------------
    describe('FULL_GENERATION (empty canvas)', () => {
        it('should return FULL_GENERATION when currentFlow is null', () => {
            const result = classifyOperation('Create a web search agent', null, mockToolNodes)
            expect(result.type).toBe('FULL_GENERATION')
        })

        it('should return FULL_GENERATION when currentFlow has no nodes', () => {
            const result = classifyOperation('Build me a chatbot', { nodes: [], edges: [] }, mockToolNodes)
            expect(result.type).toBe('FULL_GENERATION')
        })

        it('should return FULL_GENERATION for any message on empty canvas', () => {
            const result = classifyOperation('Add a tool', { nodes: [], edges: [] }, mockToolNodes)
            expect(result.type).toBe('FULL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // DIRECT_MUTATION — add tool
    // -----------------------------------------------------------------------
    describe('DIRECT_MUTATION — add tool', () => {
        it('should detect "add web search tool to the agent"', () => {
            const result = classifyOperation('Add web search tool to the agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBe('googleCustomSearch')
            expect(result.targetNode).toBe('agentAgentflow_1')
        })

        it('should detect "attach calculator to Web Agent"', () => {
            const result = classifyOperation('attach calculator to Web Agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBe('calculator')
        })

        it('should detect "enable web scraper tool"', () => {
            const result = classifyOperation('enable web scraper tool', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBe('cheerioWebScraper')
        })

        it('should detect "add wikipedia tool"', () => {
            const result = classifyOperation('add wikipedia tool', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBe('wikipedia')
        })

        it('should detect "include search tool on the agent"', () => {
            const result = classifyOperation('include search tool on the agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBeDefined()
        })

        it('should fall back to PARTIAL when tool name not found', () => {
            const result = classifyOperation('add email sender tool to agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // DIRECT_MUTATION — remove node
    // -----------------------------------------------------------------------
    describe('DIRECT_MUTATION — remove node', () => {
        it('should detect "remove the LLM node"', () => {
            const result = classifyOperation('remove the llm node', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('llmAgentflow_2')
        })

        it('should detect "delete the Summarizer"', () => {
            const result = classifyOperation('delete the Summarizer', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('llmAgentflow_2')
        })

        it('should detect "get rid of the HTTP node"', () => {
            const result = classifyOperation('get rid of the http node', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('httpAgentflow_4')
        })

        it('should detect "drop the API Call node"', () => {
            const result = classifyOperation('drop the API Call node', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('httpAgentflow_4')
        })

        it('should fall back to PARTIAL when target node not found for remove', () => {
            const result = classifyOperation('remove the email node', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // DIRECT_MUTATION — rename node
    // -----------------------------------------------------------------------
    describe('DIRECT_MUTATION — rename node', () => {
        it('should detect "rename the agent to Email Handler"', () => {
            const result = classifyOperation('rename the agent to Email Handler', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('agentAgentflow_1')
        })

        it('should detect "change the name of Summarizer"', () => {
            const result = classifyOperation('change the name of Summarizer', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('llmAgentflow_2')
        })

        it('should detect "relabel the Web Agent"', () => {
            const result = classifyOperation('relabel the Web Agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('agentAgentflow_1')
        })

        it('should detect "change the label of Route Intent"', () => {
            const result = classifyOperation('change the label of Route Intent', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('conditionAgentAgentflow_3')
        })
    })

    // -----------------------------------------------------------------------
    // PARTIAL_GENERATION — ambiguous / structural changes
    // -----------------------------------------------------------------------
    describe('PARTIAL_GENERATION (ambiguous / structural)', () => {
        it('should return PARTIAL for "add a condition node after the agent"', () => {
            const result = classifyOperation('add a condition node after the agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should return PARTIAL for "insert a human approval step"', () => {
            const result = classifyOperation('insert a human approval step', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should return PARTIAL for "connect the LLM to the HTTP node"', () => {
            const result = classifyOperation('connect the LLM to the HTTP node', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should return PARTIAL for "make the agent loop back if the answer is wrong"', () => {
            const result = classifyOperation('make the agent loop back if the answer is wrong', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should return PARTIAL for "restructure the flow to use parallel branches"', () => {
            const result = classifyOperation('restructure the flow to use parallel branches', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // Edge cases — gotcha #1 (false positives)
    // -----------------------------------------------------------------------
    describe('Edge cases — gotcha #1 (false positives)', () => {
        it('should NOT treat "add a tool node that processes images" as add-tool', () => {
            // This is about adding a new toolAgentflow NODE, not adding a tool to an agent
            const result = classifyOperation('add a tool node that processes images', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should NOT treat "add a new agent node" as add-tool', () => {
            const result = classifyOperation('add a new agent node', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should NOT treat "create a tool step for data processing" as add-tool', () => {
            const result = classifyOperation('create a tool step for data processing', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should NOT treat "place a search block after the agent" as add-tool', () => {
            const result = classifyOperation('place a search block after the agent', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // Edge cases — various
    // -----------------------------------------------------------------------
    describe('Edge cases — misc', () => {
        it('should handle mixed case messages', () => {
            const result = classifyOperation('REMOVE the LLM node', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
        })

        it('should handle node ID references', () => {
            const result = classifyOperation('delete agentAgentflow_1', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.targetNode).toBe('agentAgentflow_1')
        })

        it('should return PARTIAL for vague requests with existing flow', () => {
            const result = classifyOperation('make it better', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })

        it('should handle empty message with existing flow', () => {
            const result = classifyOperation('', mockFlow, mockToolNodes)
            expect(result.type).toBe('PARTIAL_GENERATION')
        })
    })

    // -----------------------------------------------------------------------
    // Return type structure
    // -----------------------------------------------------------------------
    describe('Return structure', () => {
        it('should always include type field', () => {
            const cases: [string, typeof mockFlow | null][] = [
                ['create a flow', null],
                ['add search tool', mockFlow],
                ['do something', mockFlow]
            ]
            for (const [msg, flow] of cases) {
                const result = classifyOperation(msg, flow, mockToolNodes)
                expect(result.type).toBeDefined()
                expect(['DIRECT_MUTATION', 'PARTIAL_GENERATION', 'FULL_GENERATION']).toContain(result.type)
            }
        })

        it('should include toolName for add-tool mutations', () => {
            const result = classifyOperation('add calculator tool', mockFlow, mockToolNodes)
            expect(result.type).toBe('DIRECT_MUTATION')
            expect(result.toolName).toBe('calculator')
        })

        it('should include targetNode for remove mutations', () => {
            const result = classifyOperation('remove the Summarizer', mockFlow, mockToolNodes)
            expect(result.targetNode).toBe('llmAgentflow_2')
        })
    })
})
