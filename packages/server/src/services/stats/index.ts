import { StatusCodes } from 'http-status-codes'
import { Between, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm'
import { ChatMessageRatingType, ChatType } from '../../Interface'
import { ChatMessage } from '../../database/entities/ChatMessage'
import { ChatMessageFeedback } from '../../database/entities/ChatMessageFeedback'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

// get stats for showing in chatflow
const getChatflowStats = async (
    chatflowid: string,
    activeWorkspaceId: string,
    chatTypes: ChatType[] | undefined,
    startDate?: string,
    endDate?: string,
    feedbackTypes?: ChatMessageRatingType[]
): Promise<any> => {
    try {
        if (!activeWorkspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.UNAUTHORIZED,
                `Error: statsService.getChatflowStats - activeWorkspaceId not provided!`
            )
        }

        const appServer = getRunningExpressApp()

        const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
            id: chatflowid,
            workspaceId: activeWorkspaceId
        })
        if (!chatflow)
            throw new InternalFlowiseError(
                StatusCodes.FORBIDDEN,
                `Error: statsService.getChatflowStats - chatflow ${chatflowid} not found in workspace!`
            )

        const repo = appServer.AppDataSource.getRepository(ChatMessage)

        const baseWhere: FindOptionsWhere<ChatMessage> = { chatflowid }
        if (chatTypes && chatTypes.length > 0) baseWhere.chatType = In(chatTypes)
        if (startDate && endDate) baseWhere.createdDate = Between(new Date(startDate), new Date(endDate))
        else if (startDate) baseWhere.createdDate = MoreThanOrEqual(new Date(startDate))
        else if (endDate) baseWhere.createdDate = LessThanOrEqual(new Date(endDate))

        // (sessions that contain at least one message with that feedback rating)
        if (feedbackTypes && feedbackTypes.length > 0) {
            const rows = await repo
                .createQueryBuilder('cm2')
                .select('DISTINCT(cm2.sessionId)', 'sessionId')
                .innerJoin(ChatMessageFeedback, 'f2', 'f2.messageId = cm2.id')
                .where('cm2.chatflowid = :chatflowid', { chatflowid })
                .andWhere('f2.rating IN (:...feedbackTypes)', { feedbackTypes })
                .getRawMany()

            const qualifyingSessionIds = rows.map((r) => r.sessionId)

            // No matching sessions - return zeros immediately
            if (qualifyingSessionIds.length === 0) {
                return { totalMessages: 0, totalSessions: 0, totalFeedback: 0, positiveFeedback: 0 }
            }

            baseWhere.sessionId = In(qualifyingSessionIds)
        }

        const totalSessionsQb = repo.createQueryBuilder('cm').select('COUNT(DISTINCT(cm.sessionId))', 'count').where(baseWhere)

        const totalFeedbackQb = repo
            .createQueryBuilder('cm')
            .select('COUNT(*)', 'count')
            .innerJoin(ChatMessageFeedback, 'f', 'f.messageId = cm.id')
            .where(baseWhere)

        const positiveFeedbackQb = repo
            .createQueryBuilder('cm')
            .select('COUNT(*)', 'count')
            .innerJoin(ChatMessageFeedback, 'f', 'f.messageId = cm.id')
            .where(baseWhere)
            .andWhere('f.rating = :rating', { rating: ChatMessageRatingType.THUMBS_UP })

        const [totalMessages, totalSessionsRaw, totalFeedbackRaw, positiveFeedbackRaw] = await Promise.all([
            repo.count({ where: baseWhere }),
            totalSessionsQb.getRawOne(),
            totalFeedbackQb.getRawOne(),
            positiveFeedbackQb.getRawOne()
        ])

        return {
            totalMessages,
            totalSessions: parseInt(totalSessionsRaw?.count ?? '0', 10),
            totalFeedback: parseInt(totalFeedbackRaw?.count ?? '0', 10),
            positiveFeedback: parseInt(positiveFeedbackRaw?.count ?? '0', 10)
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: statsService.getChatflowStats - ${getErrorMessage(error)}`
        )
    }
}

export default {
    getChatflowStats
}
