import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { StatusCodes } from 'http-status-codes'
import { ChatMessageRatingType, ChatType } from '../../Interface'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'

jest.mock('../../utils/getRunningExpressApp', () => ({
    getRunningExpressApp: jest.fn()
}))

import statsService from '.'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { ChatFlow } from '../../database/entities/ChatFlow'

const mockQb: any = {
    select: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn()
}

const mockMessageRepo: any = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    count: jest.fn()
}

const mockChatFlowRepo: any = {
    findOneBy: jest.fn()
}

const CHATFLOW_ID = 'cf-abc-123'
const WORKSPACE_ID = 'ws-xyz-456'

describe('statsService.getChatflowStats', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ;(getRunningExpressApp as jest.Mock).mockReturnValue({
            AppDataSource: {
                getRepository: jest.fn((entity: unknown) => {
                    if (entity === ChatFlow) return mockChatFlowRepo
                    return mockMessageRepo
                })
            }
        })

        mockChatFlowRepo.findOneBy.mockResolvedValue({ id: CHATFLOW_ID } as any)
        mockMessageRepo.count.mockResolvedValue(0)
        mockQb.getRawOne.mockResolvedValue({ count: '0' })
        mockQb.getRawMany.mockResolvedValue([])
        mockQb.select.mockReturnThis()
        mockQb.innerJoin.mockReturnThis()
        mockQb.where.mockReturnThis()
        mockQb.andWhere.mockReturnThis()
        mockMessageRepo.createQueryBuilder.mockReturnValue(mockQb)
    })

    describe('workspace authorization', () => {
        it('throws when activeWorkspaceId is not provided', async () => {
            await expect(
                statsService.getChatflowStats(CHATFLOW_ID, undefined as any, undefined, undefined, undefined, undefined)
            ).rejects.toBeInstanceOf(InternalFlowiseError)

            expect(mockChatFlowRepo.findOneBy).not.toHaveBeenCalled()
        })

        it('throws when chatflow is not found in the workspace', async () => {
            mockChatFlowRepo.findOneBy.mockResolvedValue(null)

            await expect(
                statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)
            ).rejects.toBeInstanceOf(InternalFlowiseError)

            expect(mockMessageRepo.count).not.toHaveBeenCalled()
        })

        it('looks up chatflow with the correct workspaceId', async () => {
            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)

            expect(mockChatFlowRepo.findOneBy).toHaveBeenCalledWith({
                id: CHATFLOW_ID,
                workspaceId: WORKSPACE_ID
            })
        })
    })

    describe('no filters', () => {
        it('returns the correct shape with parsed integers', async () => {
            mockMessageRepo.count.mockResolvedValue(157)
            mockQb.getRawOne
                .mockResolvedValueOnce({ count: '42' })
                .mockResolvedValueOnce({ count: '10' })
                .mockResolvedValueOnce({ count: '7' })

            const result = await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)

            expect(result).toEqual({
                totalMessages: 157,
                totalSessions: 42,
                totalFeedback: 10,
                positiveFeedback: 7
            })
        })

        it('defaults to 0 when getRawOne returns undefined', async () => {
            mockQb.getRawOne.mockResolvedValue(undefined)

            const result = await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)

            expect(result.totalSessions).toBe(0)
            expect(result.totalFeedback).toBe(0)
            expect(result.positiveFeedback).toBe(0)
        })

        it('runs 3 QueryBuilders and 1 count when no feedbackTypes filter is set', async () => {
            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)

            expect(mockMessageRepo.createQueryBuilder).toHaveBeenCalledTimes(3)
            expect(mockQb.getRawOne).toHaveBeenCalledTimes(3)
            expect(mockMessageRepo.count).toHaveBeenCalledTimes(1)
        })
    })

    describe('chatTypes filter', () => {
        it('uses In operator with the provided chatTypes', async () => {
            const chatTypes: ChatType[] = [ChatType.INTERNAL]

            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, chatTypes, undefined, undefined, undefined)

            const countWhere = mockMessageRepo.count.mock.calls[0][0].where
            expect(countWhere.chatType.type).toBe('in')
            expect(countWhere.chatType.value).toEqual(chatTypes)
        })
    })

    describe('date range filter', () => {
        it('uses Between when both startDate and endDate are provided', async () => {
            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, '2024-01-01', '2024-12-31', undefined)

            const countWhere = mockMessageRepo.count.mock.calls[0][0].where
            expect(countWhere.createdDate.type).toBe('between')
        })

        it('uses MoreThanOrEqual when only startDate is provided', async () => {
            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, '2024-01-01', undefined, undefined)

            const countWhere = mockMessageRepo.count.mock.calls[0][0].where
            expect(countWhere.createdDate.type).toBe('moreThanOrEqual')
        })

        it('uses LessThanOrEqual when only endDate is provided', async () => {
            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, '2024-12-31', undefined)

            const countWhere = mockMessageRepo.count.mock.calls[0][0].where
            expect(countWhere.createdDate.type).toBe('lessThanOrEqual')
        })
    })

    describe('feedbackTypes filter', () => {
        it('returns zeros immediately when no sessions match', async () => {
            mockQb.getRawMany.mockResolvedValue([])

            const result = await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, [
                ChatMessageRatingType.THUMBS_UP
            ])

            expect(result).toEqual({ totalMessages: 0, totalSessions: 0, totalFeedback: 0, positiveFeedback: 0 })
            expect(mockMessageRepo.count).not.toHaveBeenCalled()
            expect(mockQb.getRawOne).not.toHaveBeenCalled()
        })

        it('runs all 4 main queries when sessions match', async () => {
            mockQb.getRawMany.mockResolvedValue([{ sessionId: 's1' }, { sessionId: 's2' }])
            mockMessageRepo.count.mockResolvedValue(50)
            mockQb.getRawOne.mockResolvedValue({ count: '5' })

            const result = await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, [
                ChatMessageRatingType.THUMBS_UP
            ])

            expect(result.totalMessages).toBe(50)
            expect(result.totalSessions).toBe(5)
            expect(mockMessageRepo.count).toHaveBeenCalledTimes(1)
            expect(mockQb.getRawOne).toHaveBeenCalledTimes(3)
        })

        it('passes the feedbackTypes to the sessionId subquery', async () => {
            mockQb.getRawMany.mockResolvedValue([{ sessionId: 's1' }])

            await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, [
                ChatMessageRatingType.THUMBS_DOWN
            ])

            const feedbackCall = mockQb.andWhere.mock.calls.find((call: string[]) => call[0].includes('feedbackTypes'))
            expect(feedbackCall).toBeDefined()
            expect(feedbackCall![1]).toEqual(expect.objectContaining({ feedbackTypes: [ChatMessageRatingType.THUMBS_DOWN] }))
        })
    })

    describe('error handling', () => {
        it('wraps unexpected errors as InternalFlowiseError with 500 status', async () => {
            mockMessageRepo.count.mockRejectedValue(new Error('DB connection lost'))

            let caught: any
            try {
                await statsService.getChatflowStats(CHATFLOW_ID, WORKSPACE_ID, undefined, undefined, undefined, undefined)
            } catch (e) {
                caught = e
            }

            expect(caught).toBeInstanceOf(InternalFlowiseError)
            expect(caught.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR)
            expect(caught.message).toContain('statsService.getChatflowStats')
        })
    })
})
