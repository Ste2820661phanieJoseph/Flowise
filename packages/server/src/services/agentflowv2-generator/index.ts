import { Request } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import path from 'path'
import * as fs from 'fs'
import {
    generateAgentflowv2 as generateAgentflowv2_json,
    generateNodesEdgesChat,
    generateNodesData,
    updateEdges,
    extractResponseContent
} from 'flowise-components'
import { z } from 'zod/v3'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { sysPrompt, getCreationPrompt, getModificationPrompt } from './prompt'
import { databaseEntities } from '../../utils'
import logger from '../../utils/logger'
import { MODE } from '../../Interface'
import { SSEStreamer } from '../../utils/SSEStreamer'
import { classifyOperation } from './operationClassifier'
import { addTool, removeNode, renameNode } from './directMutations'
import { getCompactTemplates } from './templateCache'
import { validateAndFixFlow } from './validation'
import {
    scanForRequirements,
    scanToolCredentialRequirements,
    matchExistingCredentials,
    matchExistingCredentialsWithOptions,
    bindCredentials,
    bindToolCredentials
} from './credentialChecker'
import { generateTestCases, runTest, autoSaveFlow, TestResult } from './flowTester'
import { evaluate, generateFix, Verdict } from './evaluatorOptimizer'

// Define the Zod schema for Agentflowv2 data structure
const NodeType = z.object({
    id: z.string(),
    type: z.string(),
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    width: z.number(),
    height: z.number(),
    selected: z.boolean().optional(),
    positionAbsolute: z
        .object({
            x: z.number(),
            y: z.number()
        })
        .optional(),
    dragging: z.boolean().optional(),
    data: z.any().optional(),
    parentNode: z.string().optional()
})

const EdgeType = z.object({
    source: z.string(),
    sourceHandle: z.string(),
    target: z.string(),
    targetHandle: z.string(),
    data: z
        .object({
            sourceColor: z.string().optional(),
            targetColor: z.string().optional(),
            edgeLabel: z.string().optional(),
            isHumanInput: z.boolean().optional()
        })
        .optional(),
    type: z.string().optional(),
    id: z.string()
})

const AgentFlowV2Type = z
    .object({
        description: z.string().optional(),
        usecases: z.array(z.string()).optional(),
        nodes: z.array(NodeType),
        edges: z.array(EdgeType)
    })
    .describe('Generate Agentflowv2 nodes and edges')

// Type for the templates array
type AgentFlowV2Template = z.infer<typeof AgentFlowV2Type>

const getAllAgentFlow2Nodes = async () => {
    const appServer = getRunningExpressApp()
    const nodes = appServer.nodesPool.componentNodes
    const agentFlow2Nodes = []
    for (const node in nodes) {
        if (nodes[node].category === 'Agent Flows') {
            agentFlow2Nodes.push({
                name: nodes[node].name,
                label: nodes[node].label,
                description: nodes[node].description
            })
        }
    }
    return JSON.stringify(agentFlow2Nodes, null, 2)
}

const getAllToolNodes = async () => {
    const appServer = getRunningExpressApp()
    const nodes = appServer.nodesPool.componentNodes
    const toolNodes = []
    const disabled_nodes = process.env.DISABLED_NODES ? process.env.DISABLED_NODES.split(',') : []
    const removeTools = ['chainTool', 'retrieverTool', 'webBrowser', 'agentAsTool', 'chatflowTool', ...disabled_nodes]

    for (const node in nodes) {
        if (nodes[node].category.includes('Tools')) {
            if (removeTools.includes(nodes[node].name)) {
                continue
            }
            toolNodes.push({
                name: nodes[node].name,
                description: nodes[node].description
            })
        }
    }
    return JSON.stringify(toolNodes, null, 2)
}

const getAllAgentflowv2Marketplaces = async () => {
    const templates: AgentFlowV2Template[] = []
    let marketplaceDir = path.join(__dirname, '..', '..', '..', 'marketplaces', 'agentflowsv2')
    let jsonsInDir = fs.readdirSync(marketplaceDir).filter((file) => path.extname(file) === '.json')
    jsonsInDir.forEach((file) => {
        try {
            const filePath = path.join(__dirname, '..', '..', '..', 'marketplaces', 'agentflowsv2', file)
            const fileData = fs.readFileSync(filePath)
            const fileDataObj = JSON.parse(fileData.toString())
            // get rid of the node.data, remain all other properties
            const filteredNodes = fileDataObj.nodes.map((node: any) => {
                return {
                    ...node,
                    data: undefined
                }
            })

            const title = file.split('.json')[0]
            const template = {
                title,
                description: fileDataObj.description || `Template from ${file}`,
                usecases: fileDataObj.usecases || [],
                nodes: filteredNodes,
                edges: fileDataObj.edges
            }

            // Validate template against schema
            const validatedTemplate = AgentFlowV2Type.parse(template)
            templates.push({
                ...validatedTemplate,
                // @ts-ignore
                title: title
            })
        } catch (error) {
            console.error(`Error processing template file ${file}:`, error)
            // Continue with next file instead of failing completely
        }
    })

    // Format templates into the requested string format
    let formattedTemplates = ''
    templates.forEach((template: AgentFlowV2Template, index: number) => {
        formattedTemplates += `Example ${index + 1}: <<${(template as any).title}>> - ${template.description}\n`
        formattedTemplates += `"nodes": [\n`

        // Format nodes with proper indentation
        const nodesJson = JSON.stringify(template.nodes, null, 3)
        // Split by newlines and add 3 spaces to the beginning of each line except the first and last
        const nodesLines = nodesJson.split('\n')
        if (nodesLines.length > 2) {
            formattedTemplates += `   ${nodesLines[0]}\n`
            for (let i = 1; i < nodesLines.length - 1; i++) {
                formattedTemplates += `   ${nodesLines[i]}\n`
            }
            formattedTemplates += `   ${nodesLines[nodesLines.length - 1]}\n`
        } else {
            formattedTemplates += `   ${nodesJson}\n`
        }

        formattedTemplates += `]\n`
        formattedTemplates += `"edges": [\n`

        // Format edges with proper indentation
        const edgesJson = JSON.stringify(template.edges, null, 3)
        // Split by newlines and add tab to the beginning of each line except the first and last
        const edgesLines = edgesJson.split('\n')
        if (edgesLines.length > 2) {
            formattedTemplates += `\t${edgesLines[0]}\n`
            for (let i = 1; i < edgesLines.length - 1; i++) {
                formattedTemplates += `\t${edgesLines[i]}\n`
            }
            formattedTemplates += `\t${edgesLines[edgesLines.length - 1]}\n`
        } else {
            formattedTemplates += `\t${edgesJson}\n`
        }

        formattedTemplates += `]\n\n`
    })

    return formattedTemplates
}

// =========================================================================
// Tool formatting helpers
// =========================================================================

const MCP_DEFAULT_ACTIONS: Record<string, string[]> = {
    sequentialThinkingMCP: ['sequentialthinking']
}

function getMcpDefaults(toolName: string): Record<string, any> {
    const defaultActions = MCP_DEFAULT_ACTIONS[toolName]
    if (defaultActions) {
        return { mcpActions: JSON.stringify(defaultActions) }
    }
    return {}
}

/**
 * Convert an array of tool name strings into the proper agentTools format
 * expected by the agent node runtime.
 */
function formatAgentTools(toolNames: string[]): any[] {
    return toolNames.map((toolName) => ({
        agentSelectedTool: toolName,
        agentSelectedToolConfig: {
            agentSelectedTool: toolName,
            ...getMcpDefaults(toolName)
        }
    }))
}

// =========================================================================
// LLM-based tool recommendation for Agent Builder chat flow
//
// Analyzes agent nodes (their labels/system messages) and the user's request
// to recommend which tools each agent actually needs, rather than showing
// the entire tool catalog.
// =========================================================================

const RecommendedToolsSchema = z
    .array(
        z.object({
            name: z.string().describe('Tool name from the available tools list'),
            reason: z.string().describe('Brief reason why this tool is recommended for the agent(s)')
        })
    )
    .describe('List of recommended tools with reasons')

async function recommendToolsForAgents(
    agentNodes: any[],
    allTools: Array<{ name: string; description: string }>,
    userMessages: Array<{ role: string; content: string }>,
    selectedChatModel: Record<string, any>,
    componentNodes: Record<string, any>,
    initOptions: Record<string, any>
): Promise<Array<{ name: string; reason: string }>> {
    try {
        const chatModelComponent = componentNodes[selectedChatModel?.name]
        if (!chatModelComponent) {
            logger.warn('[AgentBuilder] Chat model not found for tool recommendation, skipping')
            return []
        }

        const nodeInstanceFilePath = chatModelComponent.filePath as string
        const nodeModule = await import(nodeInstanceFilePath)
        const newToolNodeInstance = new nodeModule.nodeClass()
        const model = (await newToolNodeInstance.init(selectedChatModel, '', initOptions)) as BaseChatModel

        const agentContext = agentNodes
            .map((node) => {
                const label = node.data?.label || node.data?.name || node.id
                const systemMessage = node.data?.inputs?.agentMessages?.find((m: any) => m.role === 'system')?.content || ''
                return `- Agent "${label}": ${systemMessage || '(no system message set)'}`
            })
            .join('\n')

        const lastUserMessage = userMessages
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .slice(-3)
            .join('\n')

        const toolList = allTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')

        const prompt = `You are analyzing an AI agent workflow to recommend which tools each agent needs.

## User's Request
${lastUserMessage}

## Agent Nodes in the Flow
${agentContext}

## Available Tools
${toolList}

## Task
Select ONLY the tools that are genuinely needed by the agent(s) to fulfill the user's request. Be selective — do not recommend tools that are not relevant.

Output a JSON array of objects with "name" (exact tool name from the list) and "reason" (one sentence explaining why).
Example: [{"name": "googleCustomSearch", "reason": "Agent needs web search to find current information"}]

If no tools are needed, return an empty array: []`

        const response = await model.invoke([{ role: 'system', content: prompt }])

        const responseContent = extractResponseContent(response)

        const jsonMatch = responseContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || responseContent.match(/\[[\s\S]*?\]/)
        if (!jsonMatch) {
            logger.warn('[AgentBuilder] No JSON found in tool recommendation response')
            return []
        }

        const jsonStr = jsonMatch[1] || jsonMatch[0]
        const parsed = JSON.parse(jsonStr)
        const validated = RecommendedToolsSchema.parse(parsed)

        // Filter out any tools that don't exist in the actual tool list
        const validToolNames = new Set(allTools.map((t) => t.name))
        return validated.filter((t) => validToolNames.has(t.name))
    } catch (error: any) {
        logger.warn(`[AgentBuilder] Tool recommendation failed, falling back to no recommendations: ${error.message}`)
        return []
    }
}

const generateAgentflowv2 = async (question: string, selectedChatModel: Record<string, any>) => {
    try {
        const agentFlow2Nodes = await getAllAgentFlow2Nodes()
        const toolNodes = await getAllToolNodes()
        const marketplaceTemplates = await getAllAgentflowv2Marketplaces()

        const prompt = sysPrompt
            .replace('{agentFlow2Nodes}', agentFlow2Nodes)
            .replace('{marketplaceTemplates}', marketplaceTemplates)
            .replace('{userRequest}', question)
        const options: Record<string, any> = {
            appDataSource: getRunningExpressApp().AppDataSource,
            databaseEntities: databaseEntities,
            logger: logger
        }

        let response

        if (process.env.MODE === MODE.QUEUE) {
            const predictionQueue = getRunningExpressApp().queueManager.getQueue('prediction')
            const job = await predictionQueue.addJob({
                prompt,
                question,
                toolNodes,
                selectedChatModel,
                isAgentFlowGenerator: true
            })
            logger.debug(`[server]: Generated Agentflowv2 Job added to queue: ${job.id}`)
            const queueEvents = predictionQueue.getQueueEvents()
            response = await job.waitUntilFinished(queueEvents)
        } else {
            response = await generateAgentflowv2_json(
                { prompt, componentNodes: getRunningExpressApp().nodesPool.componentNodes, toolNodes, selectedChatModel },
                question,
                options
            )
        }

        try {
            // Try to parse and validate the response if it's a string
            if (typeof response === 'string') {
                const parsedResponse = JSON.parse(response)
                const validatedResponse = AgentFlowV2Type.parse(parsedResponse)
                return validatedResponse
            }
            // If response is already an object
            else if (typeof response === 'object') {
                const validatedResponse = AgentFlowV2Type.parse(response)
                return validatedResponse
            }
            // Unexpected response type
            else {
                throw new Error(`Unexpected response type: ${typeof response}`)
            }
        } catch (parseError) {
            console.error('Failed to parse or validate response:', parseError)
            // If parsing fails, return an error object
            return {
                error: 'Failed to validate response format',
                rawResponse: response
            } as any // Type assertion to avoid type errors
        }
    } catch (error) {
        throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error: generateAgentflowv2 - ${getErrorMessage(error)}`)
    }
}

// =========================================================================
// Agent Builder — chatAgentflowv2
//
// Full pipeline: classify → generate/mutate → validate → credentials →
// test → evaluate → fix loop.
//
// IMPORTANT: Bypasses QUEUE mode. SSE streaming requires the LLM call in
// the same process as the HTTP response. Do NOT use predictionQueue.
// =========================================================================

const TOTAL_TIMEOUT_MS = 180_000 // 180 seconds

const chatAgentflowv2 = async (req: Request, sseStreamer: SSEStreamer, chatId: string, workspaceId: string) => {
    const abortController = new AbortController()
    const { signal } = abortController
    const timeoutHandle = setTimeout(() => abortController.abort(), TOTAL_TIMEOUT_MS)

    // Clean up on client disconnect (gotcha #6)
    req.on('close', () => {
        abortController.abort()
        clearTimeout(timeoutHandle)
    })

    try {
        // 1. Extract from request body
        const {
            messages,
            currentFlow,
            selectedChatModel,
            sessionId,
            credentialBindings,
            selectedTools,
            credentialRescan,
            testAction,
            testFailedVerdict,
            options: reqOptions
        } = req.body

        // 2. Set defaults
        const options = {
            autoTest: reqOptions?.autoTest ?? true,
            autoFix: reqOptions?.autoFix ?? true,
            maxIterations: reqOptions?.maxIterations ?? 3
        }

        const appServer = getRunningExpressApp()
        const componentNodes = appServer.nodesPool.componentNodes

        const initOptions = {
            appDataSource: appServer.AppDataSource,
            databaseEntities: databaseEntities,
            logger: logger
        }

        // 3. Stream start
        sseStreamer.streamStartEvent(chatId, '')

        // 4a. TOOL SELECTION RESUME — user picked tools, apply them and continue
        if (selectedTools && Array.isArray(selectedTools)) {
            const resumeNodes = currentFlow?.nodes || []
            const resumeEdges = currentFlow?.edges || []

            // Format tool names into proper agentTools objects
            const formattedTools = selectedTools.length > 0 ? formatAgentTools(selectedTools) : []

            for (const node of resumeNodes) {
                if (node.data?.name === 'agentAgentflow') {
                    if (!node.data.inputs) node.data.inputs = {}
                    node.data.inputs.agentTools = formattedTools
                }
            }

            const updatedEdges = updateEdges(resumeEdges, resumeNodes)

            sseStreamer.streamCustomEvent(chatId, 'flow_update', {
                nodes: resumeNodes,
                edges: updatedEdges,
                operationType: 'DIRECT_MUTATION',
                explanation:
                    selectedTools.length > 0
                        ? `Added ${selectedTools.length} tool(s) to agent node(s).`
                        : 'No tools selected — agent will run without tools.'
            })

            // Credential check: scan both node-level AND tool-level credential requirements
            const nodeRequirements = scanForRequirements(resumeNodes, componentNodes)
            const toolRequirements = scanToolCredentialRequirements(resumeNodes, componentNodes)
            const allRequirements = [...nodeRequirements, ...toolRequirements]

            if (allRequirements.length > 0) {
                const credMatch = await matchExistingCredentialsWithOptions(allRequirements, workspaceId)
                if (credMatch.found.size > 0) {
                    // Bind node-level credentials
                    const nodeBindings = Array.from(credMatch.found.entries())
                        .filter(([nodeId]) => nodeRequirements.some((r) => r.nodeId === nodeId))
                        .map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                    if (nodeBindings.length > 0) {
                        bindCredentials(resumeNodes, nodeBindings)
                    }

                    // Bind tool-level credentials (inside agentSelectedToolConfig)
                    const toolCredMap = new Map<string, string>()
                    for (const req of toolRequirements) {
                        const credId = credMatch.found.get(req.nodeId)
                        if (credId) toolCredMap.set(req.credentialType, credId)
                    }
                    if (toolCredMap.size > 0) {
                        bindToolCredentials(resumeNodes, componentNodes, toolCredMap)
                    }

                    const allBindings = Array.from(credMatch.found.entries()).map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                    sseStreamer.streamCredentialBoundEvent(chatId, { bindings: allBindings })
                }
                if (credMatch.missing.length > 0) {
                    sseStreamer.streamCredentialCheckEvent(chatId, {
                        status: credMatch.found.size > 0 ? 'partial' : 'missing',
                        missingCredentials: credMatch.missing,
                        availableCredentials: credMatch.available
                    })
                    sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                    clearTimeout(timeoutHandle)
                    return
                }
            }

            // Stream updated flow with credentials bound
            if (allRequirements.length > 0) {
                sseStreamer.streamCustomEvent(chatId, 'flow_update', {
                    nodes: resumeNodes,
                    edges: updatedEdges,
                    operationType: 'DIRECT_MUTATION',
                    explanation: 'Credentials bound to tools.'
                })
            }

            if (options.autoTest && !signal.aborted) {
                await runTestAndEvaluationPipeline(
                    resumeNodes,
                    updatedEdges,
                    messages,
                    selectedChatModel,
                    componentNodes,
                    initOptions,
                    options,
                    sseStreamer,
                    chatId,
                    workspaceId,
                    signal
                )
            }
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 4b. CREDENTIAL RESCAN RESUME — user added credentials externally, re-scan
        if (credentialRescan) {
            const resumeNodes = currentFlow?.nodes || []
            const resumeEdges = currentFlow?.edges || []

            const nodeRequirements = scanForRequirements(resumeNodes, componentNodes)
            const toolRequirements = scanToolCredentialRequirements(resumeNodes, componentNodes)
            const requirements = [...nodeRequirements, ...toolRequirements]
            if (requirements.length > 0) {
                const credMatch = await matchExistingCredentialsWithOptions(requirements, workspaceId)
                if (credMatch.found.size > 0) {
                    const nodeBindings = Array.from(credMatch.found.entries())
                        .filter(([nodeId]) => nodeRequirements.some((r) => r.nodeId === nodeId))
                        .map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                    if (nodeBindings.length > 0) {
                        bindCredentials(resumeNodes, nodeBindings)
                    }

                    const toolCredMap = new Map<string, string>()
                    for (const req of toolRequirements) {
                        const credId = credMatch.found.get(req.nodeId)
                        if (credId) toolCredMap.set(req.credentialType, credId)
                    }
                    if (toolCredMap.size > 0) {
                        bindToolCredentials(resumeNodes, componentNodes, toolCredMap)
                    }

                    const allBindings = Array.from(credMatch.found.entries()).map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                    sseStreamer.streamCredentialBoundEvent(chatId, { bindings: allBindings })
                }
                if (credMatch.missing.length > 0) {
                    sseStreamer.streamCredentialCheckEvent(chatId, {
                        status: credMatch.found.size > 0 ? 'partial' : 'missing',
                        missingCredentials: credMatch.missing,
                        availableCredentials: credMatch.available
                    })
                    sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                    clearTimeout(timeoutHandle)
                    return
                }

                // All credentials resolved — update the canvas with bound credentials
                sseStreamer.streamCustomEvent(chatId, 'flow_update', {
                    nodes: resumeNodes,
                    edges: resumeEdges,
                    operationType: 'DIRECT_MUTATION',
                    explanation: 'All credentials bound successfully.'
                })
            }

            if (options.autoTest && !signal.aborted) {
                await runTestAndEvaluationPipeline(
                    resumeNodes,
                    resumeEdges,
                    messages,
                    selectedChatModel,
                    componentNodes,
                    initOptions,
                    options,
                    sseStreamer,
                    chatId,
                    workspaceId,
                    signal
                )
            }
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 4c. CREDENTIAL BINDINGS RESUME (legacy) — skip generation, jump to step 10
        if (credentialBindings && Array.isArray(credentialBindings) && credentialBindings.length > 0) {
            let resumeNodes = currentFlow?.nodes || []
            const resumeEdges = currentFlow?.edges || []

            // Bind the user-provided credentials
            bindCredentials(resumeNodes, credentialBindings)
            sseStreamer.streamCredentialBoundEvent(chatId, { bindings: credentialBindings })

            // Continue to testing if autoTest is enabled
            if (options.autoTest) {
                await runTestAndEvaluationPipeline(
                    resumeNodes,
                    resumeEdges,
                    messages,
                    selectedChatModel,
                    componentNodes,
                    initOptions,
                    options,
                    sseStreamer,
                    chatId,
                    workspaceId,
                    signal
                )
            }

            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 4d. TEST AGAIN — re-run tests without AI fix (user may have manually fixed something)
        if (testAction === 'test_again') {
            const resumeNodes = currentFlow?.nodes || []
            const resumeEdges = currentFlow?.edges || []
            if (options.autoTest && !signal.aborted) {
                await runTestAndEvaluationPipeline(
                    resumeNodes,
                    resumeEdges,
                    messages,
                    selectedChatModel,
                    componentNodes,
                    initOptions,
                    options,
                    sseStreamer,
                    chatId,
                    workspaceId,
                    signal
                )
            }
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 4e. FIX AND RESUME — run one AI fix iteration then re-test
        if (testAction === 'fix_and_resume') {
            const resumeNodes = currentFlow?.nodes || []
            const resumeEdges = currentFlow?.edges || []
            const verdictToFix: Verdict = testFailedVerdict || { verdict: 'ITERATE', category: 'LOGIC', reason: 'Test failed', fixes: [] }
            await runFixAndTestPipeline(
                resumeNodes,
                resumeEdges,
                verdictToFix,
                messages,
                selectedChatModel,
                componentNodes,
                initOptions,
                options,
                sseStreamer,
                chatId,
                workspaceId,
                signal
            )
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 5. CLASSIFY operation type
        const lastUserMessage = messages[messages.length - 1]?.content || ''
        const toolNodesJson = await getAllToolNodes()
        const toolNodes = JSON.parse(toolNodesJson)
        const classification = classifyOperation(lastUserMessage, currentFlow, toolNodes)

        logger.debug(`[AgentBuilder] Classified "${lastUserMessage.substring(0, 60)}..." as ${classification.type}`)

        // 6. ROUTE BY TYPE
        let resultNodes: any[]
        let resultEdges: any[]
        let operationType = classification.type

        if (classification.type === 'DIRECT_MUTATION') {
            // ---- DIRECT MUTATION PATH (no LLM) ----
            const flowNodes = currentFlow?.nodes || []
            const flowEdges = currentFlow?.edges || []

            let mutationResult
            if (classification.toolName) {
                mutationResult = addTool(flowNodes, flowEdges, classification.toolName, classification.targetNode)
            } else if (/\b(?:remove|delete|drop|get rid of)\b/i.test(lastUserMessage) && classification.targetNode) {
                mutationResult = removeNode(flowNodes, flowEdges, classification.targetNode)
            } else if (
                /\b(?:rename|relabel|change\s+(?:the\s+)?(?:name|label|title))\b/i.test(lastUserMessage) &&
                classification.targetNode
            ) {
                // Extract the new label from the message
                const newLabel = extractNewLabel(lastUserMessage)
                mutationResult = renameNode(flowNodes, flowEdges, classification.targetNode, newLabel)
            } else {
                // Fallback: shouldn't happen if classifier is correct, treat as partial
                operationType = 'PARTIAL_GENERATION'
            }

            if (mutationResult) {
                sseStreamer.streamCustomEvent(chatId, 'flow_update', {
                    nodes: mutationResult.nodes,
                    edges: mutationResult.edges,
                    operationType: 'DIRECT_MUTATION',
                    explanation: mutationResult.explanation
                })

                // After adding a tool, check if the added tool needs credentials
                if (classification.toolName) {
                    const toolReqs = scanToolCredentialRequirements(mutationResult.nodes, componentNodes)
                    if (toolReqs.length > 0) {
                        const credMatch = await matchExistingCredentialsWithOptions(toolReqs, workspaceId)

                        // Bind any credentials we found automatically
                        if (credMatch.found.size > 0) {
                            const toolCredMap = new Map<string, string>()
                            for (const req of toolReqs) {
                                const credId = credMatch.found.get(req.nodeId)
                                if (credId) toolCredMap.set(req.credentialType, credId)
                            }
                            if (toolCredMap.size > 0) {
                                bindToolCredentials(mutationResult.nodes, componentNodes, toolCredMap)
                            }
                            const allBindings = Array.from(credMatch.found.entries()).map(([nodeId, credentialId]) => ({
                                nodeId,
                                credentialId
                            }))
                            sseStreamer.streamCredentialBoundEvent(chatId, { bindings: allBindings })
                        }

                        // Pause if any credentials are still missing
                        if (credMatch.missing.length > 0) {
                            sseStreamer.streamCredentialCheckEvent(chatId, {
                                status: credMatch.found.size > 0 ? 'partial' : 'missing',
                                missingCredentials: credMatch.missing,
                                availableCredentials: credMatch.available
                            })
                            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                            clearTimeout(timeoutHandle)
                            return
                        }
                    }
                }

                sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                clearTimeout(timeoutHandle)
                return
            }
        }

        // ---- PARTIAL / FULL GENERATION PATH (LLM) ----
        if (signal.aborted) {
            sseStreamer.streamErrorEvent(chatId, 'Request timed out')
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 7. Build system prompt
        let systemPrompt: string
        if (!currentFlow || currentFlow.nodes.length === 0) {
            // Creation turn — include compact templates
            const compactTemplates = getCompactTemplates()
            systemPrompt = getCreationPrompt() + '\n\n## Reference Templates\n' + compactTemplates
        } else {
            // Modification turn — no templates, include current flow context
            const currentFlowContext = JSON.stringify({ nodes: currentFlow.nodes, edges: currentFlow.edges }, null, 2)
            systemPrompt = getModificationPrompt(currentFlowContext)
        }

        // 8. Construct messages for LLM: [system, ...conversationHistory]
        const llmMessages = [{ role: 'system', content: systemPrompt }, ...messages]

        // 9. Call generateNodesEdgesChat with streaming
        const config = {
            componentNodes,
            selectedChatModel,
            toolNodes: toolNodesJson,
            appDataSource: appServer.AppDataSource,
            databaseEntities: databaseEntities,
            logger: logger
        }

        let chatResult
        try {
            chatResult = await generateNodesEdgesChat(config, llmMessages, {
                onToken: (token: string) => {
                    if (!signal.aborted) {
                        sseStreamer.streamTokenEvent(chatId, token)
                    }
                }
            })
        } catch (llmError: any) {
            // Retry once on validation failure (re-prompt strategy)
            if (llmError.message?.includes('flow_json') || llmError.message?.includes('parse')) {
                logger.warn(`[AgentBuilder] First LLM attempt failed, retrying: ${llmError.message}`)
                const retryMessages = [
                    ...llmMessages,
                    {
                        role: 'user',
                        content: `Your previous output had an error: ${llmError.message}\nPlease fix the issue and output the corrected flow with <explanation> and <flow_json> tags.`
                    }
                ]
                chatResult = await generateNodesEdgesChat(config, retryMessages, {
                    onToken: (token: string) => {
                        if (!signal.aborted) {
                            sseStreamer.streamTokenEvent(chatId, token)
                        }
                    }
                })
            } else {
                throw llmError
            }
        }

        let { nodes: genNodes, edges: genEdges } = chatResult

        // 10. VALIDATE + POST-PROCESS
        const validationResult = validateAndFixFlow(genNodes, genEdges, componentNodes)
        let hasBlockingErrors = validationResult.errors.length > 0

        // If blocking errors and we haven't retried yet, re-prompt once
        if (hasBlockingErrors) {
            logger.warn(`[AgentBuilder] Validation found ${validationResult.errors.length} blocking error(s), retrying`)
            const errorMessages = validationResult.errors.map((e) => `- ${e.message}`).join('\n')
            const retryMessages = [
                ...llmMessages,
                {
                    role: 'user',
                    content: `Your previous output had validation errors:\n${errorMessages}\nPlease fix these issues and output the corrected flow.`
                }
            ]
            try {
                const retryResult = await generateNodesEdgesChat(config, retryMessages, {
                    onToken: (token: string) => {
                        if (!signal.aborted) {
                            sseStreamer.streamTokenEvent(chatId, token)
                        }
                    }
                })
                const retryValidation = validateAndFixFlow(retryResult.nodes, retryResult.edges, componentNodes)
                genNodes = retryValidation.nodes
                genEdges = retryValidation.edges
                hasBlockingErrors = retryValidation.errors.length > 0
            } catch {
                // Use the original (partially valid) result
                genNodes = validationResult.nodes
                genEdges = validationResult.edges
            }
        } else {
            genNodes = validationResult.nodes
            genEdges = validationResult.edges
        }

        // Snapshot LLM-set inputs BEFORE hydration (generateNodesData mutates nodes in-place)
        const llmInputsByNodeId = new Map<string, Record<string, any>>()
        for (const node of genNodes) {
            if (node.data?.inputs && Object.keys(node.data.inputs).length > 0) {
                llmInputsByNodeId.set(node.id, JSON.parse(JSON.stringify(node.data.inputs)))
            }
        }

        // Build a lookup of original inputs from the pre-modification flow
        // so we can preserve inputs the LLM didn't explicitly output
        const originalInputsByNodeId = new Map<string, Record<string, any>>()
        if (currentFlow?.nodes) {
            for (const node of currentFlow.nodes) {
                if (node.data?.inputs && Object.keys(node.data.inputs).length > 0) {
                    originalInputsByNodeId.set(node.id, JSON.parse(JSON.stringify(node.data.inputs)))
                }
            }
        }

        // Hydrate nodes from component registry
        const hydratedResult = generateNodesData({ nodes: genNodes, edges: genEdges }, { componentNodes })
        if (hydratedResult.error) {
            throw new Error(hydratedResult.error)
        }
        resultNodes = hydratedResult.nodes
        resultEdges = hydratedResult.edges

        // Restore inputs in priority order:
        // 1. Start with original flow inputs (preserves system prompts, memory, etc.)
        // 2. Then overlay LLM-set inputs (applies the requested changes)
        for (const node of resultNodes) {
            if (!node.data.inputs) node.data.inputs = {}

            // First, restore original inputs for nodes that existed before
            const originalInputs = originalInputsByNodeId.get(node.id)
            if (originalInputs) {
                for (const [key, value] of Object.entries(originalInputs)) {
                    if (value !== undefined && value !== '') {
                        node.data.inputs[key] = value
                    }
                }
            }

            // Then, overlay LLM-set inputs (these take priority — they represent the changes)
            const llmInputs = llmInputsByNodeId.get(node.id)
            if (llmInputs) {
                for (const [key, value] of Object.entries(llmInputs)) {
                    if (value !== undefined && value !== '') {
                        node.data.inputs[key] = value
                    }
                }
            }
        }

        // Apply the Agent Builder's selected model + credential to all agent/LLM nodes
        applySelectedModelToNodes(resultNodes, selectedChatModel)

        // Fix edge colors, labels, handles
        resultEdges = updateEdges(resultEdges, resultNodes)

        // Stream flow_update (without tools assigned to agent nodes yet)
        sseStreamer.streamCustomEvent(chatId, 'flow_update', {
            nodes: resultNodes,
            edges: resultEdges,
            operationType
        })

        if (signal.aborted) {
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 11. TOOL SELECTION — if agent nodes exist, use LLM to recommend tools then prompt user
        const agentNodes = resultNodes.filter((n: any) => n.data?.name === 'agentAgentflow')
        if (agentNodes.length > 0) {
            const toolNodesForSelection = JSON.parse(toolNodesJson)

            let recommendedTools: Array<{ name: string; reason: string }> = []
            if (!signal.aborted) {
                sseStreamer.streamTokenEvent(chatId, '\n\nAnalyzing which tools your agents need...')
                recommendedTools = await recommendToolsForAgents(
                    agentNodes,
                    toolNodesForSelection,
                    messages,
                    selectedChatModel,
                    componentNodes,
                    initOptions
                )
                logger.debug(
                    `[AgentBuilder] Recommended ${recommendedTools.length} tool(s): ${recommendedTools.map((t) => t.name).join(', ')}`
                )
            }

            sseStreamer.streamToolSelectionEvent(chatId, {
                availableTools: toolNodesForSelection,
                recommendedTools,
                agentNodeIds: agentNodes.map((n: any) => n.id)
            })
            sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
            clearTimeout(timeoutHandle)
            return
        }

        // 12. CREDENTIAL MANAGEMENT + TESTING + EVALUATION
        // Credential check (both node-level and tool-level)
        const nodeReqs = scanForRequirements(resultNodes, componentNodes)
        const toolReqs = scanToolCredentialRequirements(resultNodes, componentNodes)
        const requirements = [...nodeReqs, ...toolReqs]

        if (requirements.length > 0) {
            const credMatch = await matchExistingCredentialsWithOptions(requirements, workspaceId)

            if (credMatch.missing.length > 0 && credMatch.found.size === 0) {
                sseStreamer.streamCredentialCheckEvent(chatId, {
                    status: 'missing',
                    missingCredentials: credMatch.missing,
                    availableCredentials: credMatch.available
                })
                sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                clearTimeout(timeoutHandle)
                return
            }

            if (credMatch.found.size > 0) {
                const nodeBindings = Array.from(credMatch.found.entries())
                    .filter(([nodeId]) => nodeReqs.some((r) => r.nodeId === nodeId))
                    .map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                if (nodeBindings.length > 0) {
                    bindCredentials(resultNodes, nodeBindings)
                }

                const toolCredMap = new Map<string, string>()
                for (const req of toolReqs) {
                    const credId = credMatch.found.get(req.nodeId)
                    if (credId) toolCredMap.set(req.credentialType, credId)
                }
                if (toolCredMap.size > 0) {
                    bindToolCredentials(resultNodes, componentNodes, toolCredMap)
                }

                const allBindings = Array.from(credMatch.found.entries()).map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
                sseStreamer.streamCredentialBoundEvent(chatId, { bindings: allBindings })
            }

            if (credMatch.missing.length > 0) {
                sseStreamer.streamCredentialCheckEvent(chatId, {
                    status: 'partial',
                    missingCredentials: credMatch.missing,
                    availableCredentials: credMatch.available
                })
                sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
                clearTimeout(timeoutHandle)
                return
            }
        }

        // Testing + evaluation
        if (options.autoTest && !signal.aborted) {
            await runTestAndEvaluationPipeline(
                resultNodes,
                resultEdges,
                messages,
                selectedChatModel,
                componentNodes,
                initOptions,
                options,
                sseStreamer,
                chatId,
                workspaceId,
                signal
            )
        }

        sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
    } catch (error: any) {
        logger.error(`[AgentBuilder] Pipeline error: ${getErrorMessage(error)}`)
        sseStreamer.streamErrorEvent(chatId, getErrorMessage(error))
        sseStreamer.streamCustomEvent(chatId, 'end', '[DONE]')
    } finally {
        clearTimeout(timeoutHandle)
    }
}

// =========================================================================
// Helper: Run the test + evaluation + fix iteration pipeline
// =========================================================================

async function runTestAndEvaluationPipeline(
    nodes: any[],
    edges: any[],
    messages: Array<{ role: string; content: string }>,
    selectedChatModel: Record<string, any>,
    componentNodes: Record<string, any>,
    initOptions: Record<string, any>,
    options: { autoTest: boolean; autoFix: boolean; maxIterations: number },
    sseStreamer: SSEStreamer,
    chatId: string,
    workspaceId: string,
    signal: AbortSignal
): Promise<void> {
    let currentNodes = nodes
    let currentEdges = edges

    // Auto-save the flow as a draft
    let savedFlowId: string
    try {
        savedFlowId = await autoSaveFlow(currentNodes, currentEdges, undefined, workspaceId)
    } catch (saveError: any) {
        logger.error(`[AgentBuilder] Auto-save failed: ${saveError.message}`)
        sseStreamer.streamErrorEvent(chatId, `Failed to save draft flow: ${saveError.message}`)
        return
    }

    // Generate test cases
    const lastUserMessage = messages[messages.length - 1]?.content || ''
    const nodeNames = currentNodes.map((n: any) => n.data?.label || n.data?.name || n.id)
    const description = lastUserMessage

    let testCases
    try {
        testCases = await generateTestCases(description, nodeNames, lastUserMessage, selectedChatModel, componentNodes, initOptions)
    } catch (tcError: any) {
        logger.error(`[AgentBuilder] Test case generation failed: ${tcError.message}`)
        // Use fallback test cases
        testCases = [
            { type: 'happy_path' as const, question: lastUserMessage },
            { type: 'edge_case' as const, question: '' }
        ]
    }

    // Run tests
    const testResults: TestResult[] = []
    for (const testCase of testCases) {
        if (signal.aborted) break

        const testId = `${testCase.type}-${Date.now()}`
        sseStreamer.streamTestStartEvent(chatId, {
            testId,
            type: testCase.type,
            question: testCase.question
        })

        const result = await runTest(savedFlowId, testCase, chatId, testId)
        testResults.push(result)

        sseStreamer.streamTestResultEvent(chatId, result)
    }

    if (signal.aborted) return

    // Check for credential/key errors — these can't be fixed by iteration
    const credentialError = detectCredentialError(testResults)
    if (credentialError) {
        logger.warn(`[AgentBuilder] Test failed due to credential/key issue: ${credentialError}`)

        // Scan for what credentials the flow needs
        const toolCredReqs = scanForRequirements(currentNodes, componentNodes)
        const missingTools =
            toolCredReqs.length > 0
                ? toolCredReqs
                : [
                      {
                          nodeId: 'unknown',
                          nodeName: 'Tool',
                          credentialName: 'API Key',
                          credentialType: 'unknown'
                      }
                  ]

        sseStreamer.streamCredentialCheckEvent(chatId, {
            status: 'missing',
            missingCredentials: missingTools,
            errorMessage: `Test failed due to a credentials issue: ${credentialError}. Please add the required API keys/credentials for the tools used, or remove the tool that requires them. Once done, click Resume to re-test.`
        })
        return
    }

    // Evaluate
    const credentialStatus = { allBound: true, missingCount: 0 }
    const validationStatus = { valid: true, errors: [] as string[] }

    let verdict = evaluate(testResults, credentialStatus, validationStatus)
    verdict.iteration = 0

    sseStreamer.streamEvaluationEvent(chatId, verdict)

    if (verdict.verdict === 'DONE') return

    // Pause: stream test_failed and let user decide (test again or AI fix)
    sseStreamer.streamCustomEvent(chatId, 'test_failed', {
        verdict,
        waitingForUser: true
    })
}

// =========================================================================
// Helper: Run one AI fix iteration then re-run the test pipeline
// =========================================================================

async function runFixAndTestPipeline(
    nodes: any[],
    edges: any[],
    verdict: Verdict,
    messages: Array<{ role: string; content: string }>,
    selectedChatModel: Record<string, any>,
    componentNodes: Record<string, any>,
    initOptions: Record<string, any>,
    options: { autoTest: boolean; autoFix: boolean; maxIterations: number },
    sseStreamer: SSEStreamer,
    chatId: string,
    workspaceId: string,
    signal: AbortSignal
): Promise<void> {
    let currentNodes = nodes
    let currentEdges = edges

    sseStreamer.streamIterationStartEvent(chatId, {
        iteration: 1,
        maxIterations: 1,
        category: verdict.category,
        reason: verdict.reason,
        fixes: verdict.fixes
    })

    // Capture agentTools so the fix LLM cannot remove them
    const agentToolsByNodeId = new Map<string, any[]>()
    for (const node of currentNodes) {
        if (node.data?.name === 'agentAgentflow' && Array.isArray(node.data?.inputs?.agentTools)) {
            agentToolsByNodeId.set(node.id, JSON.parse(JSON.stringify(node.data.inputs.agentTools)))
        }
    }

    // Generate fix
    let fixResult
    try {
        fixResult = await generateFix(verdict, currentNodes, currentEdges, selectedChatModel, componentNodes, initOptions)
    } catch (fixError: any) {
        logger.error(`[AgentBuilder] Fix generation failed: ${fixError.message}`)
        sseStreamer.streamErrorEvent(chatId, `Fix generation failed: ${fixError.message}`)
        return
    }

    if ((!fixResult.edges || fixResult.edges.length === 0) && currentEdges.length > 0) {
        logger.warn('[AgentBuilder] Fix returned empty edges — preserving existing edges')
        fixResult.edges = currentEdges
    }

    const fixValidation = validateAndFixFlow(fixResult.nodes, fixResult.edges, componentNodes)

    const fixInputsByNodeId = new Map<string, Record<string, any>>()
    for (const node of fixValidation.nodes) {
        if (node.data?.inputs && Object.keys(node.data.inputs).length > 0) {
            fixInputsByNodeId.set(node.id, JSON.parse(JSON.stringify(node.data.inputs)))
        }
    }

    const hydratedFix = generateNodesData({ nodes: fixValidation.nodes, edges: fixValidation.edges }, { componentNodes })
    if (hydratedFix.error) {
        logger.error(`[AgentBuilder] Fix hydration failed: ${hydratedFix.error}`)
        sseStreamer.streamErrorEvent(chatId, `Fix hydration failed: ${hydratedFix.error}`)
        return
    }

    currentNodes = hydratedFix.nodes
    currentEdges = updateEdges(hydratedFix.edges, currentNodes)

    for (const node of currentNodes) {
        if (!node.data.inputs) node.data.inputs = {}
        const llmInputs = fixInputsByNodeId.get(node.id)
        if (llmInputs) {
            for (const [key, value] of Object.entries(llmInputs)) {
                if (value !== undefined && value !== '') {
                    node.data.inputs[key] = value
                }
            }
        }
        if (node.data?.name === 'agentAgentflow') {
            const savedTools = agentToolsByNodeId.get(node.id)
            if (savedTools && savedTools.length > 0) {
                node.data.inputs.agentTools = savedTools
            }
        }
    }
    applySelectedModelToNodes(currentNodes, selectedChatModel)

    // Bind credentials
    const requirements = scanForRequirements(currentNodes, componentNodes)
    if (requirements.length > 0) {
        const credMatch = await matchExistingCredentials(requirements, workspaceId)
        if (credMatch.found.size > 0) {
            const bindings = Array.from(credMatch.found.entries()).map(([nodeId, credentialId]) => ({ nodeId, credentialId }))
            bindCredentials(currentNodes, bindings)
        }
    }

    // Stream the fixed flow to canvas
    sseStreamer.streamIterationFlowUpdateEvent(chatId, {
        iteration: 1,
        nodes: currentNodes,
        edges: currentEdges
    })

    // Re-run tests against the fixed flow
    if (!signal.aborted) {
        await runTestAndEvaluationPipeline(
            currentNodes,
            currentEdges,
            messages,
            selectedChatModel,
            componentNodes,
            initOptions,
            options,
            sseStreamer,
            chatId,
            workspaceId,
            signal
        )
    }
}

// =========================================================================
// Helper: Detect credential/API-key errors in test results
//
// Returns a descriptive message if the failure looks like a missing key or
// credential issue, or null if the error is unrelated.
// =========================================================================

const CREDENTIAL_ERROR_PATTERNS = [
    /api.?key/i,
    /api_key/i,
    /invalid.*key/i,
    /missing.*key/i,
    /unauthorized/i,
    /authentication/i,
    /\b401\b/,
    /credential/i,
    /access.?denied/i,
    /permission.?denied/i,
    /forbidden/i,
    /\b403\b/,
    /apikey/i,
    /secret.?key/i,
    /token.*invalid/i,
    /invalid.*token/i,
    /not.?authenticated/i,
    /auth.*fail/i,
    /FLOWISE_CREDENTIAL_ID/
]

function detectCredentialError(testResults: TestResult[]): string | null {
    for (const result of testResults) {
        if (result.status === 'fail' && result.error) {
            for (const pattern of CREDENTIAL_ERROR_PATTERNS) {
                if (pattern.test(result.error)) {
                    return result.error
                }
            }
        }
    }
    return null
}

// =========================================================================
// Helper: Apply the Agent Builder's selected model + credential to nodes
//
// Sets agentModel/llmModel, agentModelConfig/llmModelConfig, and credential
// on every agent and LLM node so they match the model selected in the panel.
// =========================================================================

const MODEL_NODE_TYPES: Record<string, { modelKey: string; configKey: string }> = {
    agentAgentflow: { modelKey: 'agentModel', configKey: 'agentModelConfig' },
    llmAgentflow: { modelKey: 'llmModel', configKey: 'llmModelConfig' },
    conditionAgentAgentflow: { modelKey: 'conditionAgentModel', configKey: 'conditionAgentModelConfig' },
    humanInputAgentflow: { modelKey: 'humanInputModel', configKey: 'humanInputModelConfig' }
}

function applySelectedModelToNodes(nodes: any[], selectedChatModel: Record<string, any>): void {
    if (!selectedChatModel?.name) return

    const modelName = selectedChatModel.name
    const credentialId = selectedChatModel.credential || selectedChatModel.inputs?.FLOWISE_CREDENTIAL_ID || ''

    // Build a clean model config from the selectedChatModel inputs
    const modelInputs = selectedChatModel.inputs || {}
    const modelConfig: Record<string, any> = {}
    for (const [key, value] of Object.entries(modelInputs)) {
        if (key === 'FLOWISE_CREDENTIAL_ID') continue
        if (value !== undefined && value !== '') {
            modelConfig[key] = value
        }
    }

    for (const node of nodes) {
        const nodeName = node.data?.name
        const mapping = MODEL_NODE_TYPES[nodeName]
        if (!mapping) continue

        if (!node.data.inputs) node.data.inputs = {}

        // Set model selection
        node.data.inputs[mapping.modelKey] = modelName

        // Set model config with nested model key
        node.data.inputs[mapping.configKey] = {
            ...modelConfig,
            [mapping.modelKey]: modelName,
            FLOWISE_CREDENTIAL_ID: credentialId
        }

        // Set credential via dual binding
        if (credentialId) {
            node.data.credential = credentialId
            node.data.inputs.FLOWISE_CREDENTIAL_ID = credentialId
        }
    }
}

// =========================================================================
// Helper: Extract new label from rename messages
// =========================================================================

function extractNewLabel(message: string): string {
    // Try common patterns: "rename X to Y", "rename X as Y", "change name to Y"
    const patterns = [
        /(?:rename|relabel)\s+(?:the\s+)?(?:.*?)\s+(?:to|as)\s+["']?(.+?)["']?\s*$/i,
        /(?:change\s+(?:the\s+)?(?:name|label|title)\s+(?:of\s+)?(?:.*?)\s+to)\s+["']?(.+?)["']?\s*$/i,
        /(?:to|as)\s+["'](.+?)["']\s*$/i
    ]

    for (const pattern of patterns) {
        const match = message.match(pattern)
        if (match && match[1]) {
            return match[1].trim()
        }
    }

    // Fallback: take text after the last "to"
    const toIndex = message.lastIndexOf(' to ')
    if (toIndex !== -1) {
        return message
            .substring(toIndex + 4)
            .replace(/["']/g, '')
            .trim()
    }

    return 'Renamed Node'
}

export default {
    generateAgentflowv2,
    chatAgentflowv2
}
