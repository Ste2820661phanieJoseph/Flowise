import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import marketplacesService from '../../services/marketplaces'

// Get all templates for marketplaces
const getAllTemplates = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const apiResponse = await marketplacesService.getAllTemplates()
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const deleteCustomTemplate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: marketplacesService.deleteCustomTemplate - id not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: marketplacesController.deleteCustomTemplate - workspace ${workspaceId} not found!`
            )
        }
        const apiResponse = await marketplacesService.deleteCustomTemplate(req.params.id, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getAllCustomTemplates = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const apiResponse = await marketplacesService.getAllCustomTemplates(req.user?.activeWorkspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const saveCustomTemplate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body
        if (!body || !(body.chatflowId || body.tool) || !body.name) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: marketplacesService.saveCustomTemplate - body not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: marketplacesController.saveCustomTemplate - workspace ${workspaceId} not found!`
            )
        }
        // Explicit allowlist — id/workspaceId/timestamps must not be overrideable by client
        const templateBody: Record<string, unknown> = {}
        if (body.name !== undefined) templateBody.name = body.name
        if (body.description !== undefined) templateBody.description = body.description
        if (body.badge !== undefined) templateBody.badge = body.badge
        if (body.usecases !== undefined) templateBody.usecases = body.usecases
        if (body.type !== undefined) templateBody.type = body.type
        if (body.chatflowId !== undefined) templateBody.chatflowId = body.chatflowId
        if (body.tool !== undefined) templateBody.tool = body.tool
        templateBody.workspaceId = workspaceId
        const apiResponse = await marketplacesService.saveCustomTemplate(templateBody)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

export default {
    getAllTemplates,
    getAllCustomTemplates,
    saveCustomTemplate,
    deleteCustomTemplate
}
