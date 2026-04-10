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

        // TypeORM 0.3.x QueryBuilder accepts FindOptionsWhere objects (including FindOperators
        // like In/Between) in .where() — the same WHERE clause machinery used by repo.find().
        const totalMessagesQb = repo.createQueryBuilder('cm').select('COUNT(*)', 'count').where(baseWhere)
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

        if (feedbackTypes && feedbackTypes.length > 0) {
            const sessionSubQb = repo
                .createQueryBuilder()
                .subQuery()
                .select('DISTINCT cm2.sessionId')
                .from(ChatMessage, 'cm2')
                .innerJoin(ChatMessageFeedback, 'f2', 'f2.messageId = cm2.id')
                .where(baseWhere)
                .andWhere('f2.rating IN (:...feedbackTypes)', { feedbackTypes })

            const subSql = sessionSubQb.getQuery()
            const subParams = sessionSubQb.getParameters()

            for (const qb of [totalMessagesQb, totalSessionsQb, totalFeedbackQb, positiveFeedbackQb]) {
                qb.andWhere(`cm.sessionId IN ${subSql}`)
                qb.setParameters(subParams)
            }
        }

        const [totalMessagesRaw, totalSessionsRaw, totalFeedbackRaw, positiveFeedbackRaw] = await Promise.all([
            totalMessagesQb.getRawOne(),
            totalSessionsQb.getRawOne(),
            totalFeedbackQb.getRawOne(),
            positiveFeedbackQb.getRawOne()
        ])

        return {
            totalMessages: parseInt(totalMessagesRaw?.count ?? '0', 10),
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
