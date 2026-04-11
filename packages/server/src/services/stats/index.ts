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

        // Build up queries that will be used for all stats
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
            .select('COUNT(DISTINCT cm.id)', 'count')
            .innerJoin(ChatMessageFeedback, 'f', 'f.messageId = cm.id')
            .where(baseWhere)
        const positiveFeedbackQb = repo
            .createQueryBuilder('cm')
            .select('COUNT(DISTINCT cm.id)', 'count')
            .innerJoin(ChatMessageFeedback, 'f', 'f.messageId = cm.id')
            .where(baseWhere)
            .andWhere('f.rating = :rating', { rating: ChatMessageRatingType.THUMBS_UP })

        // When feedback filter is active, narrow all queries to sessions that contain
        // matching feedback, restrict feedback counts to selected types, and build a
        // precedingCount query (totalMessages = feedback msgs + their preceding user msgs).
        let precedingCountQb: ReturnType<typeof repo.createQueryBuilder> | null = null

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

            totalFeedbackQb.andWhere('f.rating IN (:...ratingFilter)', { ratingFilter: feedbackTypes })
            positiveFeedbackQb.andWhere('f.rating IN (:...posRatingFilter)', { posRatingFilter: feedbackTypes })

            // Anti-join: count immediate predecessors of feedback messages that aren't
            // themselves feedback messages (to avoid double-counting).
            precedingCountQb = repo
                .createQueryBuilder('prev')
                .select('COUNT(DISTINCT prev.id)', 'count')
                .innerJoin(
                    ChatMessage,
                    'fb_msg',
                    'fb_msg.chatflowid = prev.chatflowid AND fb_msg.sessionId = prev.sessionId AND fb_msg.createdDate > prev.createdDate'
                )
                .innerJoin(ChatMessageFeedback, 'fb', 'fb.messageId = fb_msg.id')
                .leftJoin(
                    ChatMessage,
                    'btwn',
                    'btwn.chatflowid = prev.chatflowid AND btwn.sessionId = prev.sessionId AND btwn.createdDate > prev.createdDate AND btwn.createdDate < fb_msg.createdDate'
                )
                .leftJoin(ChatMessageFeedback, 'prev_fb', 'prev_fb.messageId = prev.id AND prev_fb.rating IN (:...ft2)', {
                    ft2: feedbackTypes
                })
                .where(baseWhere)
                .andWhere('fb.rating IN (:...ft)', { ft: feedbackTypes })
                .andWhere('btwn.id IS NULL')
                .andWhere('prev_fb.id IS NULL')
        }

        const [totalMessagesRaw, totalSessionsRaw, totalFeedbackRaw, positiveFeedbackRaw, precedingRaw] = await Promise.all([
            totalMessagesQb.getRawOne(),
            totalSessionsQb.getRawOne(),
            totalFeedbackQb.getRawOne(),
            positiveFeedbackQb.getRawOne(),
            precedingCountQb?.getRawOne() ?? Promise.resolve(null)
        ])

        const totalMessages = precedingRaw
            ? parseInt(totalFeedbackRaw?.count ?? '0', 10) + parseInt(precedingRaw.count ?? '0', 10)
            : parseInt(totalMessagesRaw?.count ?? '0', 10)

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
