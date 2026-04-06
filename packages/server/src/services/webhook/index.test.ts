import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'

const mockGetChatflowById = jest.fn()

jest.mock('../chatflows', () => ({
    __esModule: true,
    default: { getChatflowById: mockGetChatflowById }
}))

import webhookService from './index'

const makeChatflow = (startInputType: string) => ({
    id: 'test-id',
    flowData: JSON.stringify({
        nodes: [
            {
                id: 'startAgentflow_0',
                data: {
                    name: 'startAgentflow',
                    inputs: { startInputType }
                }
            }
        ],
        edges: []
    })
})

describe('validateWebhookChatflow', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('throws 404 when chatflow is not found', async () => {
        mockGetChatflowById.mockResolvedValue(null)

        await expect(webhookService.validateWebhookChatflow('missing-id')).rejects.toMatchObject({
            statusCode: StatusCodes.NOT_FOUND
        })
    })

    it('throws 404 when chatflow is not configured as a webhook trigger', async () => {
        mockGetChatflowById.mockResolvedValue(makeChatflow('chatInput'))

        await expect(webhookService.validateWebhookChatflow('some-id')).rejects.toMatchObject({
            statusCode: StatusCodes.NOT_FOUND
        })
    })

    it('resolves without error for a valid webhook chatflow', async () => {
        mockGetChatflowById.mockResolvedValue(makeChatflow('webhookTrigger'))

        await expect(webhookService.validateWebhookChatflow('some-id')).resolves.toBeUndefined()
    })

    it('throws 500 for unexpected errors from getChatflowById', async () => {
        mockGetChatflowById.mockRejectedValue(new Error('db connection failed'))

        await expect(webhookService.validateWebhookChatflow('some-id')).rejects.toMatchObject({
            statusCode: StatusCodes.INTERNAL_SERVER_ERROR
        })
    })

    it('preserves InternalFlowiseError without wrapping', async () => {
        const original = new InternalFlowiseError(StatusCodes.NOT_FOUND, 'already an internal error')
        mockGetChatflowById.mockRejectedValue(original)

        await expect(webhookService.validateWebhookChatflow('some-id')).rejects.toBe(original)
    })
})
