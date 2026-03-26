import { scanForRequirements, matchExistingCredentials, bindCredentials } from './credentialChecker'

const mockGetAllCredentials = jest.fn()

// Mock credentials service — __esModule flag ensures default import resolves correctly
jest.mock('../credentials', () => ({
    __esModule: true,
    default: {
        getAllCredentials: (...args: any[]) => mockGetAllCredentials(...args)
    }
}))

describe('credentialChecker', () => {
    // ----- scanForRequirements -----

    describe('scanForRequirements', () => {
        const componentNodes: Record<string, any> = {
            agentAgentflow: {
                name: 'agentAgentflow',
                credential: {
                    label: 'Connect Credential',
                    name: 'credential',
                    type: 'credential',
                    credentialNames: ['openAIApi']
                }
            },
            startAgentflow: {
                name: 'startAgentflow'
                // No credential property
            },
            llmAgentflow: {
                name: 'llmAgentflow',
                credential: {
                    label: 'Connect Credential',
                    name: 'credential',
                    type: 'credential',
                    credentialNames: ['anthropicApi', 'openAIApi']
                }
            }
        }

        it('finds credential requirements for nodes that need them', () => {
            const nodes = [
                { id: 'startAgentflow_0', data: { name: 'startAgentflow' } },
                { id: 'agentAgentflow_1', data: { name: 'agentAgentflow' } }
            ]

            const requirements = scanForRequirements(nodes, componentNodes)
            expect(requirements).toHaveLength(1)
            expect(requirements[0]).toEqual({
                nodeId: 'agentAgentflow_1',
                nodeName: 'agentAgentflow',
                credentialName: 'Connect Credential',
                credentialType: 'openAIApi'
            })
        })

        it('returns multiple requirements for nodes with multiple credential types', () => {
            const nodes = [{ id: 'llmAgentflow_1', data: { name: 'llmAgentflow' } }]

            const requirements = scanForRequirements(nodes, componentNodes)
            expect(requirements).toHaveLength(2)
            expect(requirements[0].credentialType).toBe('anthropicApi')
            expect(requirements[1].credentialType).toBe('openAIApi')
        })

        it('returns empty array when no nodes need credentials', () => {
            const nodes = [{ id: 'startAgentflow_0', data: { name: 'startAgentflow' } }]

            const requirements = scanForRequirements(nodes, componentNodes)
            expect(requirements).toHaveLength(0)
        })

        it('skips nodes with unknown component names', () => {
            const nodes = [{ id: 'unknown_0', data: { name: 'unknownNode' } }]

            const requirements = scanForRequirements(nodes, componentNodes)
            expect(requirements).toHaveLength(0)
        })
    })

    // ----- matchExistingCredentials -----

    describe('matchExistingCredentials', () => {
        it('matches existing credentials by credential type', async () => {
            mockGetAllCredentials.mockResolvedValue([{ id: 'cred-123', credentialName: 'openAIApi' }])

            const requirements = [
                { nodeId: 'agent_1', nodeName: 'agentAgentflow', credentialName: 'Connect Credential', credentialType: 'openAIApi' }
            ]

            const result = await matchExistingCredentials(requirements, 'workspace-1')
            expect(result.found.size).toBe(1)
            expect(result.found.get('agent_1')).toBe('cred-123')
            expect(result.missing).toHaveLength(0)
        })

        it('reports missing credentials when none exist', async () => {
            mockGetAllCredentials.mockResolvedValue([])

            const requirements = [
                { nodeId: 'agent_1', nodeName: 'agentAgentflow', credentialName: 'Connect Credential', credentialType: 'openAIApi' }
            ]

            const result = await matchExistingCredentials(requirements, 'workspace-1')
            expect(result.found.size).toBe(0)
            expect(result.missing).toHaveLength(1)
            expect(result.missing[0].credentialType).toBe('openAIApi')
        })

        it('returns empty results for empty requirements', async () => {
            const result = await matchExistingCredentials([], 'workspace-1')
            expect(result.found.size).toBe(0)
            expect(result.missing).toHaveLength(0)
        })
    })

    // ----- bindCredentials -----

    describe('bindCredentials', () => {
        it('sets dual binding: data.credential AND data.inputs.credential', () => {
            const nodes = [
                { id: 'agent_1', data: { name: 'agentAgentflow', inputs: {} } },
                { id: 'start_0', data: { name: 'startAgentflow', inputs: {} } }
            ]

            const result = bindCredentials(nodes, [{ nodeId: 'agent_1', credentialId: 'cred-123' }])

            const agentNode = result.find((n: any) => n.id === 'agent_1')
            expect(agentNode.data.credential).toBe('cred-123')
            expect(agentNode.data.inputs.credential).toBe('cred-123')

            // Start node should be unchanged
            const startNode = result.find((n: any) => n.id === 'start_0')
            expect(startNode.data.credential).toBeUndefined()
        })

        it('sets llmModelConfig.FLOWISE_CREDENTIAL_ID for agent and LLM nodes', () => {
            const nodes = [
                { id: 'agent_1', data: { name: 'agentAgentflow', inputs: {} } },
                { id: 'llm_2', data: { name: 'llmAgentflow', inputs: {} } }
            ]

            const result = bindCredentials(nodes, [
                { nodeId: 'agent_1', credentialId: 'cred-a' },
                { nodeId: 'llm_2', credentialId: 'cred-b' }
            ])

            expect(result[0].data.inputs.llmModelConfig.FLOWISE_CREDENTIAL_ID).toBe('cred-a')
            expect(result[1].data.inputs.llmModelConfig.FLOWISE_CREDENTIAL_ID).toBe('cred-b')
        })

        it('creates inputs object if it does not exist', () => {
            const nodes = [{ id: 'agent_1', data: { name: 'agentAgentflow' } }]

            const result = bindCredentials(nodes, [{ nodeId: 'agent_1', credentialId: 'cred-123' }])

            expect(result[0].data.inputs.credential).toBe('cred-123')
        })
    })
})
