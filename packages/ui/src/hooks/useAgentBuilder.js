import { useState, useCallback, useRef, useContext } from 'react'
import { useDispatch } from 'react-redux'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { flowContext } from '@/store/context/ReactFlowContext'
import { baseURL } from '@/store/constant'
import { SET_DIRTY } from '@/store/actions'

const LOCALSTORAGE_KEY = 'agentBuilder_selectedChatModel'
const MAX_TURN_PAIRS = 10
const MAX_MESSAGES = MAX_TURN_PAIRS * 2

const getPersistedModel = () => {
    try {
        const stored = localStorage.getItem(LOCALSTORAGE_KEY)
        return stored ? JSON.parse(stored) : {}
    } catch {
        return {}
    }
}

const useAgentBuilder = () => {
    const dispatch = useDispatch()
    const { reactFlowInstance } = useContext(flowContext)

    const [messages, setMessages] = useState([])
    const [selectedChatModel, setSelectedChatModel] = useState(getPersistedModel)
    const [isGenerating, setIsGenerating] = useState(false)
    const [previousFlowState, setPreviousFlowState] = useState(null)
    const [credentialWaiting, setCredentialWaiting] = useState(null)
    const [testFailedWaiting, setTestFailedWaiting] = useState(null)
    const [sessionId] = useState(() => crypto.randomUUID())

    // Track the latest generated flow for credential resume
    const generatedFlowRef = useRef(null)
    const abortControllerRef = useRef(null)

    const persistModel = useCallback((model) => {
        setSelectedChatModel(model)
        try {
            localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(model))
        } catch {
            // localStorage full or unavailable
        }
    }, [])

    const getCurrentFlowSnapshot = useCallback(() => {
        if (!reactFlowInstance) return null
        const rfNodes = reactFlowInstance.getNodes()
        const rfEdges = reactFlowInstance.getEdges()
        if (rfNodes.length === 0) return null

        const nodes = rfNodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: node.position,
            width: node.width,
            height: node.height,
            parentNode: node.parentNode,
            data: {
                name: node.data.name,
                label: node.data.label,
                inputs: node.data.inputs ? { ...node.data.inputs } : {},
                credential: node.data.credential
            }
        }))
        const edges = rfEdges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            sourceHandle: edge.sourceHandle,
            target: edge.target,
            targetHandle: edge.targetHandle,
            data: edge.data
        }))
        return { nodes, edges }
    }, [reactFlowInstance])

    const capMessages = useCallback((msgs) => {
        if (msgs.length <= MAX_MESSAGES) return msgs
        // Keep the most recent MAX_MESSAGES messages
        return msgs.slice(msgs.length - MAX_MESSAGES)
    }, [])

    const appendMessage = useCallback(
        (msg) => {
            setMessages((prev) => capMessages([...prev, msg]))
        },
        [capMessages]
    )

    const updateLastAssistantMessage = useCallback((updater) => {
        setMessages((prev) => {
            const updated = [...prev]
            for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === 'assistant') {
                    updated[i] = typeof updater === 'function' ? updater(updated[i]) : { ...updated[i], ...updater }
                    break
                }
            }
            return updated
        })
    }, [])

    const applyFlowToCanvas = useCallback(
        (flowData) => {
            if (!reactFlowInstance || !flowData) return
            reactFlowInstance.setNodes(flowData.nodes || [])
            reactFlowInstance.setEdges(flowData.edges || [])
            dispatch({ type: SET_DIRTY })
            // fitView after layout settles
            setTimeout(() => {
                reactFlowInstance.fitView({ duration: 500 })
            }, 100)
        },
        [reactFlowInstance, dispatch]
    )

    const sendMessage = useCallback(
        async (text, resumePayload = null) => {
            if (isGenerating) return
            if (!text && !resumePayload) return

            // If this is a fresh message (not a resume), append user message
            if (!resumePayload) {
                appendMessage({ role: 'user', content: text })
            }

            setIsGenerating(true)
            setCredentialWaiting(null)
            setTestFailedWaiting(null)

            // Capture pre-generation snapshot for undo
            const preSnapshot = getCurrentFlowSnapshot()

            // Build conversation history for the request
            const conversationHistory = capMessages([...messages, ...(!resumePayload ? [{ role: 'user', content: text }] : [])]).map(
                (m) => ({ role: m.role, content: m.content })
            )

            // For resume flows, use the generated flow (not pre-generation snapshot)
            const currentFlow = resumePayload ? generatedFlowRef.current : getCurrentFlowSnapshot()

            const body = {
                messages: conversationHistory,
                currentFlow,
                selectedChatModel,
                sessionId
            }
            if (resumePayload) {
                Object.assign(body, resumePayload)
            }

            abortControllerRef.current = new AbortController()

            try {
                await fetchEventSource(`${baseURL}/api/v1/agentflowv2-generator/chat`, {
                    openWhenHidden: true,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-request-from': 'internal'
                    },
                    body: JSON.stringify(body),
                    signal: abortControllerRef.current.signal,
                    async onopen(response) {
                        if (!response.ok) {
                            throw new Error(`Server returned ${response.status}`)
                        }
                    },
                    onmessage(ev) {
                        try {
                            const payload = JSON.parse(ev.data)
                            handleSSEEvent(payload, preSnapshot)
                        } catch {
                            // malformed event data, skip
                        }
                    },
                    onerror(err) {
                        setIsGenerating(false)
                        appendMessage({
                            role: 'assistant',
                            content: err?.message || 'Connection error. Please try again.',
                            type: 'error'
                        })
                        throw err // stop retrying
                    }
                })
            } catch {
                // fetchEventSource throws on abort or onerror
                setIsGenerating(false)
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isGenerating, messages, selectedChatModel, sessionId, reactFlowInstance]
    )

    const handleSSEEvent = useCallback(
        (payload, preSnapshot) => {
            switch (payload.event) {
                case 'start':
                    setIsGenerating(true)
                    appendMessage({ role: 'assistant', content: '', type: 'generating' })
                    break

                case 'token':
                    updateLastAssistantMessage((msg) => ({
                        ...msg,
                        content: (msg.content || '') + payload.data
                    }))
                    break

                case 'flow_update': {
                    const flowData = payload.data
                    // Store for undo
                    setPreviousFlowState(preSnapshot)
                    // Store generated flow for credential resume
                    generatedFlowRef.current = { nodes: flowData.nodes, edges: flowData.edges }
                    // Apply to canvas
                    applyFlowToCanvas(flowData)
                    // Update assistant message with operation type
                    updateLastAssistantMessage((msg) => {
                        const updates = { operationType: flowData.operationType }
                        // For direct mutations, the explanation comes in the flow_update
                        if (flowData.explanation && !msg.content) {
                            updates.content = flowData.explanation
                        }
                        return { ...msg, ...updates }
                    })
                    break
                }

                case 'tool_selection': {
                    const recCount = payload.data?.recommendedTools?.length || 0
                    const toolMsg =
                        recCount > 0
                            ? `I've identified ${recCount} tool(s) your agent${
                                  payload.data?.agentNodeIds?.length > 1 ? 's' : ''
                              } will need. Review the recommendations below:`
                            : 'Your agent needs tools. Please select which tools to add:'
                    appendMessage({
                        role: 'assistant',
                        content: toolMsg,
                        type: 'tool_selection',
                        data: payload.data
                    })
                    setIsGenerating(false)
                    break
                }

                case 'credential_check':
                    setCredentialWaiting(payload.data)
                    appendMessage({
                        role: 'assistant',
                        content: 'Some credentials are missing. Please add them in Flowise and click Resume.',
                        type: 'credential_check',
                        data: payload.data
                    })
                    setIsGenerating(false)
                    break

                case 'credential_bound':
                    setCredentialWaiting(null)
                    updateLastAssistantMessage((msg) => {
                        if (msg.type === 'credential_check') {
                            return { ...msg, type: 'credential_bound', content: 'Credentials applied successfully.' }
                        }
                        return msg
                    })
                    break

                case 'test_start':
                    appendMessage({
                        role: 'assistant',
                        content: `Running test: ${payload.data.question}`,
                        type: 'test_start',
                        data: payload.data
                    })
                    break

                case 'test_result':
                    updateLastAssistantMessage((msg) => {
                        if (msg.type === 'test_start' && msg.data?.testId === payload.data.testId) {
                            return { ...msg, type: 'test_result', data: payload.data }
                        }
                        return msg
                    })
                    break

                case 'evaluation':
                    appendMessage({
                        role: 'assistant',
                        content:
                            payload.data.verdict === 'DONE'
                                ? 'All checks passed!'
                                : payload.data.verdict === 'TIMEOUT'
                                ? 'Evaluation timed out.'
                                : `Needs improvement: ${payload.data.reason}`,
                        type: 'evaluation',
                        data: payload.data
                    })
                    break

                case 'iteration_start':
                    appendMessage({
                        role: 'assistant',
                        content: `Fixing attempt ${payload.data.iteration}/${payload.data.maxIterations}`,
                        type: 'iteration_start',
                        data: payload.data
                    })
                    break

                case 'iteration_flow_update': {
                    const iterFlowData = payload.data
                    generatedFlowRef.current = { nodes: iterFlowData.nodes, edges: iterFlowData.edges }
                    applyFlowToCanvas(iterFlowData)
                    break
                }

                case 'test_failed':
                    setTestFailedWaiting(payload.data)
                    appendMessage({
                        role: 'assistant',
                        content: payload.data?.verdict?.reason
                            ? `Test failed: ${payload.data.verdict.reason}`
                            : 'Tests failed. You can fix the issue manually and test again, or let the AI attempt a fix.',
                        type: 'test_failed',
                        data: payload.data
                    })
                    setIsGenerating(false)
                    break

                case 'error':
                    appendMessage({
                        role: 'assistant',
                        content: typeof payload.data === 'string' ? payload.data : 'An error occurred.',
                        type: 'error'
                    })
                    setIsGenerating(false)
                    break

                case 'end':
                    // Finalize the last assistant message
                    updateLastAssistantMessage((msg) => ({
                        ...msg,
                        type: msg.type === 'generating' ? 'complete' : msg.type
                    }))
                    setIsGenerating(false)
                    break

                default:
                    break
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applyFlowToCanvas, appendMessage, updateLastAssistantMessage]
    )

    const resetConversation = useCallback(() => {
        setMessages([])
        setPreviousFlowState(null)
        setCredentialWaiting(null)
        setTestFailedWaiting(null)
        generatedFlowRef.current = null
    }, [])

    const handleTestAction = useCallback(
        (action) => {
            const verdictData = testFailedWaiting
            setTestFailedWaiting(null)
            const resumePayload = { testAction: action }
            if (action === 'fix_and_resume' && verdictData?.verdict) {
                resumePayload.testFailedVerdict = verdictData.verdict
            }
            sendMessage(null, resumePayload)
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [testFailedWaiting, sendMessage]
    )

    const undoLastChange = useCallback(() => {
        if (!previousFlowState || !reactFlowInstance) return
        reactFlowInstance.setNodes(previousFlowState.nodes || [])
        reactFlowInstance.setEdges(previousFlowState.edges || [])
        dispatch({ type: SET_DIRTY })
        setTimeout(() => {
            reactFlowInstance.fitView({ duration: 500 })
        }, 100)
        setPreviousFlowState(null)
    }, [previousFlowState, reactFlowInstance, dispatch])

    const cancelGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        setIsGenerating(false)
    }, [])

    return {
        messages,
        selectedChatModel,
        isGenerating,
        previousFlowState,
        credentialWaiting,
        testFailedWaiting,
        sendMessage,
        resetConversation,
        undoLastChange,
        cancelGeneration,
        persistModel,
        getCurrentFlowSnapshot,
        handleTestAction
    }
}

export default useAgentBuilder
