import { StatusCodes } from 'http-status-codes'
import { IReactFlowObject } from '../../Interface'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import chatflowsService from '../chatflows'

const validateWebhookChatflow = async (chatflowId: string, workspaceId?: string): Promise<void> => {
    try {
        const chatflow = await chatflowsService.getChatflowById(chatflowId, workspaceId)
        if (!chatflow) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
        }

        const parsedFlowData: IReactFlowObject = JSON.parse(chatflow.flowData)

        const startNode = parsedFlowData.nodes.find((node) => node.data.name === 'startAgentflow')

        const startInputType = startNode?.data?.inputs?.startInputType

        if (startInputType !== 'webhookTrigger') {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} is not configured as a webhook trigger`)
        }
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: webhookService.validateWebhookChatflow - ${getErrorMessage(error)}`
        )
    }
}

export default {
    validateWebhookChatflow
}
