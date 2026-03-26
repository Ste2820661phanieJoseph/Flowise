import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { extractResponseContent, ICommonObject } from 'flowise-components'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { utilBuildChatflow } from '../../utils/buildChatflow'

export interface TestCase {
    type: 'happy_path' | 'edge_case'
    question: string
}

export interface TestResult {
    testId: string
    type: 'happy_path' | 'edge_case'
    status: 'pass' | 'fail'
    question: string
    response?: string
    error?: string
}

/**
 * Generate exactly 2 test cases using the selected chat model:
 * 1. HAPPY PATH — straightforward usage of the workflow
 * 2. EDGE CASE — unusual or boundary input
 */
export const generateTestCases = async (
    description: string,
    nodeNames: string[],
    userRequest: string,
    chatModel: Record<string, any>,
    componentNodes: Record<string, any>,
    options: ICommonObject
): Promise<TestCase[]> => {
    const chatModelComponent = componentNodes[chatModel?.name]
    if (!chatModelComponent) {
        throw new Error('Chat model component not found for test generation')
    }

    const nodeInstanceFilePath = chatModelComponent.filePath as string
    const nodeModule = await import(nodeInstanceFilePath)
    const nodeInstance = new nodeModule.nodeClass()
    const model = (await nodeInstance.init(chatModel, '', options)) as BaseChatModel

    const prompt = `Given the workflow purpose and nodes, generate exactly 2 test cases:
1. HAPPY PATH — a straightforward question that tests the main functionality
2. EDGE CASE — an unusual or boundary input that tests error handling or unexpected usage

Workflow description: ${description}
User's original request: ${userRequest}
Nodes in the workflow: ${nodeNames.join(', ')}

Output a JSON array with exactly 2 objects. Each object must have "type" (either "happy_path" or "edge_case") and "question" (a string the user would type).

Output ONLY the JSON array, no other text.
Example: [{"type":"happy_path","question":"What is the weather today?"},{"type":"edge_case","question":""}]`

    const messages = [
        { role: 'system', content: 'You are a test case generator. Output only valid JSON arrays.' },
        { role: 'user', content: prompt }
    ]

    const response = await model.invoke(messages)
    const responseContent = extractResponseContent(response)

    // Parse JSON from response
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
        // Fallback test cases
        return [
            { type: 'happy_path', question: userRequest },
            { type: 'edge_case', question: '' }
        ]
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]) as TestCase[]
        if (Array.isArray(parsed) && parsed.length >= 2) {
            return parsed.slice(0, 2).map((tc) => ({
                type: tc.type === 'edge_case' ? 'edge_case' : 'happy_path',
                question: tc.question || ''
            }))
        }
    } catch {
        // Fallback
    }

    return [
        { type: 'happy_path', question: userRequest },
        { type: 'edge_case', question: '' }
    ]
}

/**
 * Run a single test case against a saved flow using utilBuildChatflow.
 * The flow must be saved to DB first (utilBuildChatflow loads by ID).
 */
export const runTest = async (flowId: string, testCase: TestCase, sessionId: string, testId?: string): Promise<TestResult> => {
    testId = testId || `${testCase.type}-${Date.now()}`

    try {
        // Build a mock request object that utilBuildChatflow expects
        const mockReq = {
            params: { id: flowId },
            body: {
                question: testCase.question,
                chatId: sessionId,
                overrideConfig: { sessionId }
            },
            headers: {},
            protocol: 'http',
            get: (header: string) => {
                if (header === 'x-forwarded-proto') return 'http'
                if (header === 'host') return 'localhost:3000'
                return undefined
            },
            files: [],
            io: undefined
        } as any

        const result = await utilBuildChatflow(mockReq, true)

        // PASS = non-empty response without error
        if (result && !result.error) {
            const responseText = typeof result === 'string' ? result : result.text || result.json || JSON.stringify(result)
            return {
                testId,
                type: testCase.type,
                status: 'pass',
                question: testCase.question,
                response: responseText
            }
        } else {
            return {
                testId,
                type: testCase.type,
                status: 'fail',
                question: testCase.question,
                error: result?.error || 'Empty response'
            }
        }
    } catch (error: any) {
        return {
            testId,
            type: testCase.type,
            status: 'fail',
            question: testCase.question,
            error: error.message || 'Test execution failed'
        }
    }
}

/**
 * Auto-save the generated flow to the database as a draft.
 * If flowId is provided, updates existing; otherwise creates new.
 * IMPORTANT: utilBuildChatflow loads by ID, so flow must be saved before testing.
 */
export const autoSaveFlow = async (nodes: any[], edges: any[], flowId?: string, workspaceId?: string): Promise<string> => {
    const appServer = getRunningExpressApp()

    const flowData = JSON.stringify({ nodes, edges })

    if (flowId) {
        // Update existing chatflow
        const existingFlow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({ id: flowId })
        if (existingFlow) {
            existingFlow.flowData = flowData
            existingFlow.deployed = false
            await appServer.AppDataSource.getRepository(ChatFlow).save(existingFlow)
            return flowId
        }
    }

    // Create new draft chatflow
    const newChatFlow = new ChatFlow()
    newChatFlow.name = 'Agent Builder Draft'
    newChatFlow.flowData = flowData
    newChatFlow.deployed = false
    newChatFlow.type = 'AGENTFLOW'
    if (workspaceId) {
        newChatFlow.workspaceId = workspaceId
    }

    const chatflow = appServer.AppDataSource.getRepository(ChatFlow).create(newChatFlow)
    const saved = await appServer.AppDataSource.getRepository(ChatFlow).save(chatflow)

    return saved.id
}
