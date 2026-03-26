import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { extractResponseContent, ICommonObject } from 'flowise-components'
import { TestResult } from './flowTester'

export type VerdictType = 'DONE' | 'ITERATE' | 'TIMEOUT'
export type CategoryType = 'CREDENTIAL' | 'STRUCTURE' | 'LOGIC' | 'INCOMPLETE'

export interface Verdict {
    verdict: VerdictType
    category?: CategoryType
    reason?: string
    fixes?: string[]
    iteration?: number
}

export interface CredentialStatus {
    allBound: boolean
    missingCount: number
}

export interface ValidationStatus {
    valid: boolean
    errors?: string[]
}

/**
 * Evaluate test results against Definition of Done:
 * - Flow saved to DB
 * - Happy-path test PASS
 * - Edge-case test PASS (or no 500 error)
 * - Credentials bound
 * - Validation passes
 */
export const evaluate = (testResults: TestResult[], credentialStatus: CredentialStatus, validationStatus: ValidationStatus): Verdict => {
    // Check credentials
    if (!credentialStatus.allBound && credentialStatus.missingCount > 0) {
        return {
            verdict: 'ITERATE',
            category: 'CREDENTIAL',
            reason: `${credentialStatus.missingCount} credential(s) not bound`,
            fixes: ['Bind missing credentials before testing']
        }
    }

    // Check validation
    if (!validationStatus.valid) {
        return {
            verdict: 'ITERATE',
            category: 'STRUCTURE',
            reason: `Flow validation failed: ${validationStatus.errors?.join(', ') || 'unknown errors'}`,
            fixes: ['Fix structural validation errors in the flow']
        }
    }

    // Check test results
    const happyPath = testResults.find((r) => r.type === 'happy_path')
    const edgeCase = testResults.find((r) => r.type === 'edge_case')

    if (happyPath && happyPath.status === 'fail') {
        return {
            verdict: 'ITERATE',
            category: 'LOGIC',
            reason: `Happy path test failed: ${happyPath.error || 'unknown error'}`,
            fixes: [
                'Review node connections and ensure the flow can handle the primary use case',
                'Check that all required node inputs are configured'
            ]
        }
    }

    if (edgeCase && edgeCase.status === 'fail') {
        // Edge case failure is acceptable if it's not a 500 error
        const is500 = edgeCase.error?.includes('500') || edgeCase.error?.includes('Internal Server Error')
        if (is500) {
            return {
                verdict: 'ITERATE',
                category: 'LOGIC',
                reason: `Edge case test caused server error: ${edgeCase.error}`,
                fixes: ['Add error handling for unexpected inputs', 'Ensure the flow degrades gracefully on edge cases']
            }
        }
    }

    // All checks passed
    return {
        verdict: 'DONE'
    }
}

/**
 * Generate a fix for the flow using the LLM.
 * Uses the modification system prompt since the flow already exists.
 */
export const generateFix = async (
    verdict: Verdict,
    currentNodes: any[],
    currentEdges: any[],
    chatModel: Record<string, any>,
    componentNodes: Record<string, any>,
    options: ICommonObject
): Promise<{ nodes: any[]; edges: any[] }> => {
    const chatModelComponent = componentNodes[chatModel?.name]
    if (!chatModelComponent) {
        throw new Error('Chat model component not found for fix generation')
    }

    const nodeInstanceFilePath = chatModelComponent.filePath as string
    const nodeModule = await import(nodeInstanceFilePath)
    const nodeInstance = new nodeModule.nodeClass()
    const model = (await nodeInstance.init(chatModel, '', options)) as BaseChatModel

    // Send a compact view of the flow to avoid exceeding context limits
    const compactNodes = currentNodes.map((n: any) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        width: n.width,
        height: n.height,
        ...(n.parentNode ? { parentNode: n.parentNode, extent: n.extent } : {}),
        data: {
            name: n.data?.name,
            label: n.data?.label,
            ...(n.data?.inputs ? { inputs: n.data.inputs } : {})
        }
    }))
    const compactEdges = currentEdges.map((e: any) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        type: e.type || 'agentFlow'
    }))
    const currentFlowJson = JSON.stringify({ nodes: compactNodes, edges: compactEdges }, null, 2)

    const prompt = `You are fixing an existing Flowise Agentflow V2 workflow that has issues.

## Failure Information
- Category: ${verdict.category}
- Reason: ${verdict.reason}
- Suggested fixes: ${verdict.fixes?.join('; ') || 'none'}

## Current Flow
${currentFlowJson}

## Rules
1. PRESERVE all existing node IDs — do not rename them
2. PRESERVE all nodes that are not related to the issue
3. Output the COMPLETE updated nodes AND edges arrays — do NOT omit edges
4. Fix ONLY the issue described above — do not make unrelated changes
5. Every edge must have: id, source, sourceHandle, target, targetHandle, type ("agentFlow")

## Response Format
Output ONLY valid JSON with "nodes" and "edges" arrays. No explanation needed.
Example: {"nodes": [...], "edges": [...]}`

    const messages = [
        { role: 'system', content: 'You are a workflow repair agent. Output only valid JSON.' },
        { role: 'user', content: prompt }
    ]

    const response = await model.invoke(messages)
    const responseContent = extractResponseContent(response)

    // Extract JSON from response
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        throw new Error('No JSON found in fix response')
    }

    try {
        const parsed = JSON.parse(jsonMatch[0])
        if (!parsed.nodes || !parsed.edges) {
            throw new Error('Fix response missing nodes or edges')
        }
        return { nodes: parsed.nodes, edges: parsed.edges }
    } catch (error: any) {
        throw new Error(`Failed to parse fix response: ${error.message}`)
    }
}
