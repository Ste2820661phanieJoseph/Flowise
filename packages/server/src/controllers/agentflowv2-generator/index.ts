import { Request, Response, NextFunction } from 'express'
import agentflowv2Service from '../../services/agentflowv2-generator'
import { SSEStreamer } from '../../utils/SSEStreamer'

const generateAgentflowv2 = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body.question || !req.body.selectedChatModel) {
            throw new Error('Question and selectedChatModel are required')
        }
        const apiResponse = await agentflowv2Service.generateAgentflowv2(req.body.question, req.body.selectedChatModel)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const chatAgentflowv2 = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Validate required fields
        if (!req.body.messages || !Array.isArray(req.body.messages)) {
            return res.status(400).json({ message: 'Missing required field: messages' })
        }
        if (!req.body.selectedChatModel) {
            return res.status(400).json({ message: 'Missing required field: selectedChatModel' })
        }

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        res.flushHeaders()

        // Create SSEStreamer and register client
        const sseStreamer = new SSEStreamer()
        const chatId = req.body.sessionId || `agentbuilder-${Date.now()}`
        sseStreamer.addClient(chatId, res)

        // Extract workspaceId from authenticated user context
        const workspaceId = (req as any).user?.activeWorkspaceId || (req as any).workspaceId || ''

        // Call the pipeline — errors are streamed as SSE events, not thrown
        await agentflowv2Service.chatAgentflowv2(req, sseStreamer, chatId, workspaceId)

        // End the response after the pipeline completes
        res.end()
    } catch (error: any) {
        // If headers haven't been sent, return a standard error
        if (!res.headersSent) {
            return next(error)
        }
        // Headers already sent (SSE mode) — try to stream the error
        try {
            const errorPayload = JSON.stringify({ event: 'error', data: error.message || 'Internal server error' })
            res.write('message:\ndata:' + errorPayload + '\n\n')
            const endPayload = JSON.stringify({ event: 'end', data: '[DONE]' })
            res.write('message:\ndata:' + endPayload + '\n\n')
        } catch {
            // Response already closed
        }
        res.end()
    }
}

export default {
    generateAgentflowv2,
    chatAgentflowv2
}
