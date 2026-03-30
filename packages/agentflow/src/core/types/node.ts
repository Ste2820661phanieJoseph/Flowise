// ============================================================================
// Node & Edge Data Types
// ============================================================================

/**
 * Raw shape returned by GET /api/v1/nodes.
 * `inputs` here is a schema array (InputParam[]), matching the API response.
 * Use initNode() to transform this into a NodeData for the canvas.
 */
export interface ApiNodeData {
    name: string
    label: string
    type?: string
    category?: string
    description?: string
    version?: number
    baseClasses?: string[]
    inputs?: InputParam[] // Schema array from API
    outputs?: NodeOutput[]
    color?: string
    icon?: string
    hideInput?: boolean
    badge?: string
    tags?: string[]
    documentation?: string
    credential?: { credentialNames?: string[]; label?: string; type?: string; optional?: boolean }
    [key: string]: unknown
}

export interface NodeData {
    id: string
    name: string
    label: string
    type?: string
    category?: string
    description?: string
    version?: number
    baseClasses?: string[]
    inputParams?: InputParam[] // Parameter definitions (was: inputs)
    inputs?: Record<string, unknown> // Actual values entered by users (was: inputValues)
    outputs?: NodeOutput[]
    inputAnchors?: InputAnchor[]
    outputAnchors?: OutputAnchor[]
    // Visual properties
    color?: string
    icon?: string
    selected?: boolean
    hideInput?: boolean
    // Metadata from component definition
    badge?: string
    tags?: string[]
    documentation?: string
    // Status properties
    status?: 'INPROGRESS' | 'FINISHED' | 'ERROR' | 'STOPPED' | 'TERMINATED'
    error?: string
    warning?: string
    hint?: string
    validationErrors?: string[]
    [key: string]: unknown
}

export interface NodeInput {
    label: string
    name: string
    type: string
    optional?: boolean
}

export interface NodeOutput {
    label: string
    name: string
    type: string
}

export interface InputAnchor {
    id: string
    name: string
    label: string
    type: string
    optional?: boolean
    description?: string
}

export interface OutputAnchor {
    id: string
    name: string
    label: string
    type: string
    description?: string
}

export interface InputParam {
    id: string
    name: string
    label: string
    type: string
    default?: unknown
    optional?: boolean
    options?: Array<{ label: string; name: string; description?: string } | string>
    placeholder?: string
    rows?: number
    description?: string
    acceptVariable?: boolean
    additionalParams?: boolean
    show?: Record<string, unknown>
    hide?: Record<string, unknown>
    display?: boolean
    minItems?: number
    maxItems?: number // No agentflow nodes set this today — supported for forward-compat
    array?: InputParam[] // Sub-field definitions for array-type params
    loadMethod?: string // Registry key for async option loading (asyncOptions / asyncMultiOptions)
    loadConfig?: boolean // When true, renders a config accordion beneath the async dropdown for the selected component
    credentialNames?: string[] // If set, bypasses loadMethod and fetches matching credentials
    codeLanguage?: string // Language hint for code editor (e.g. 'javascript', 'python', 'json')
    codeExample?: string // Example code snippet shown via an "Example" button
}

export interface NodeConfigEntry {
    node: string
    nodeId: string
    label: string
    name: string
    type: string
    enabled?: boolean
    schema?: Record<string, string> | Array<{ name: string; type: string }>
}

export interface EdgeData {
    sourceColor?: string
    targetColor?: string
    edgeLabel?: string
    isHumanInput?: boolean
    [key: string]: unknown
}
