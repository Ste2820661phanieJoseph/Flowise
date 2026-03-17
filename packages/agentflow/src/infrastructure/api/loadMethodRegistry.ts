import type { CredentialsApi } from './credentials'
import type { EmbeddingsApi } from './embeddings'
import type { ChatModelsApi } from './models'
import type { NodesApi } from './nodes'
import type { RuntimeStateApi } from './runtimeState'
import type { StoresApi } from './stores'
import type { ToolsApi } from './tools'

export interface ApiServices {
    chatModelsApi: ChatModelsApi
    toolsApi: ToolsApi
    credentialsApi: CredentialsApi
    storesApi: StoresApi
    embeddingsApi: EmbeddingsApi
    runtimeStateApi: RuntimeStateApi
    nodesApi: NodesApi
}

/**
 * Registry that maps `loadMethod` string keys — as declared on node `InputParam` definitions
 * (e.g. `{ loadMethod: 'listTools' }`) — to functions that fetch the corresponding options
 * from the Flowise API.
 *
 * Each entry receives the shared {@link ApiServices} instance and an optional `params` object,
 * and must return a `Promise` of the option values to populate the node's dropdown.
 *
 * ### Built-in entries
 * - `listModels` — fetches available chat models via `POST /node-load-method/agentAgentflow`
 * - `listTools` — fetches available tool components via `POST /node-load-method/toolAgentflow`
 * - `listStores` — fetches document stores via `POST /node-load-method/agentAgentflow`
 * - `listVectorStores` — fetches vector stores via `POST /node-load-method/agentAgentflow`
 * - `listEmbeddings` — fetches embedding models via `POST /node-load-method/agentAgentflow`
 * - `listRuntimeStateKeys` — fetches runtime state keys via `POST /node-load-method/agentAgentflow`
 * - `listCredentials` — fetches credentials filtered by `params.name` via `GET /credentials?credentialName=<name>`
 * - `listActions` — fetches available actions for a node (e.g. Composio, MCP tools) via `POST /node-load-method/{nodeName}`;
 *   requires `params.nodeName` and accepts optional `params.inputs` forwarded as `currentNode.inputs`
 * - `listTables` — fetches available tables for a node (e.g. AWSDynamoDBKVStorage) via `POST /node-load-method/{nodeName}`;
 *   requires `params.nodeName` and accepts optional `params.inputs` forwarded as `currentNode.inputs`
 *
 */
export const loadMethodRegistry: Record<string, (_apis: ApiServices, _params?: Record<string, unknown>) => Promise<unknown>> = {
    listModels: (apis, params) => {
        const nodeName = params?.nodeName as string | undefined
        if (nodeName) {
            return apis.nodesApi.loadNodeMethod(nodeName, 'listModels')
        }
        return apis.chatModelsApi.getChatModels()
    },
    listTools: (apis, params) => apis.toolsApi.getAllTools(params?.nodeName as string | undefined),
    listToolInputArgs: (apis, params) =>
        apis.toolsApi.getToolInputArgs((params?.inputs as Record<string, unknown>) ?? {}, params?.nodeName as string | undefined),
    listStores: (apis) => apis.storesApi.getStores(),
    listVectorStores: (apis) => apis.storesApi.getVectorStores(),
    listEmbeddings: (apis) => apis.embeddingsApi.getEmbeddings(),
    listRuntimeStateKeys: (apis) => apis.runtimeStateApi.getRuntimeStateKeys(),
    listRegions: (apis, params) => {
        const nodeName = params?.nodeName
        if (typeof nodeName !== 'string') {
            return Promise.reject(new Error('`listRegions` requires a string `nodeName` parameter.'))
        }
        return apis.nodesApi.loadNodeMethod(nodeName, 'listRegions')
    },
    listCredentials: (apis, params) => {
        const name = params?.name
        if (typeof name !== 'string') {
            return Promise.reject(new Error('`listCredentials` requires a string `name` parameter.'))
        }
        return apis.credentialsApi.getCredentialsByName(name)
    },
    listActions: (apis, params) => {
        const nodeName = params?.nodeName
        if (typeof nodeName !== 'string') {
            return Promise.reject(new Error('`listActions` requires a string `nodeName` parameter.'))
        }
        const inputs = (params?.inputs as Record<string, unknown>) ?? {}
        return apis.nodesApi.loadNodeMethod(nodeName, 'listActions', { currentNode: { inputs } })
    },
    listTables: (apis, params) => {
        const nodeName = params?.nodeName
        if (typeof nodeName !== 'string') {
            return Promise.reject(new Error('`listTables` requires a string `nodeName` parameter.'))
        }
        const inputs = (params?.inputs as Record<string, unknown>) ?? {}
        return apis.nodesApi.loadNodeMethod(nodeName, 'listTables', { currentNode: { inputs } })
    }
}

/**
 * Looks up a load method handler by its string key.
 *
 * Returns `undefined` if no handler is registered for the given name,
 * which callers should treat as a no-op or fallback.
 *
 * @param name - The `loadMethod` key declared on a node `InputParam`
 */
export function getLoadMethod(name: string): ((_apis: ApiServices, _params?: Record<string, unknown>) => Promise<unknown>) | undefined {
    return loadMethodRegistry[name]
}
