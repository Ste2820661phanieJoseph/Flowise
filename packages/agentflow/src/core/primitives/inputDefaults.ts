/**
 * Returns the appropriate default value for an input based on its type.
 * If a `defaultValue` is provided, it is returned as-is.
 *
 * Accepts plain parameters so it stays decoupled from any domain type
 * (InputParam, CredentialSchemaInput, etc.).
 */
export function getDefaultValueForType(inputType: string, options?: Array<{ name: string } | string>, defaultValue?: unknown): unknown {
    if (defaultValue !== undefined) return defaultValue

    switch (inputType) {
        case 'boolean':
            return false
        case 'number':
            return 0
        case 'json':
            return '{}'
        case 'array':
            return []
        case 'options': {
            const first = options?.[0]
            if (!first) return ''
            return typeof first === 'string' ? first : first.name
        }
        case 'string':
        case 'password':
        default:
            return ''
    }
}
