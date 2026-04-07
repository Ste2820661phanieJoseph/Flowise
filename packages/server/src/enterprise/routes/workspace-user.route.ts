import express from 'express'
import { WorkspaceUserController } from '../controllers/workspace-user.controller'
import { IdentityManager } from '../../IdentityManager'
import { checkAnyPermission, checkPermission } from '../rbac/PermissionCheck'

const router = express.Router()
const workspaceUserController = new WorkspaceUserController()

// no feature flag because user with lower plan can read invited workspaces with higher plan
router.get('/', checkAnyPermission('workspace:add-user,workspace:unlink-user,users:manage'), workspaceUserController.read)

router.post(
    '/',
    IdentityManager.checkFeatureByPlan('feat:workspaces'),
    checkPermission('workspace:add-user'),
    workspaceUserController.create
)

router.put(
    '/',
    IdentityManager.checkFeatureByPlan('feat:workspaces'),
    checkPermission('workspace:add-user'),
    workspaceUserController.update
)

router.delete(
    '/',
    IdentityManager.checkFeatureByPlan('feat:workspaces'),
    checkPermission('workspace:unlink-user'),
    workspaceUserController.delete
)

export default router
