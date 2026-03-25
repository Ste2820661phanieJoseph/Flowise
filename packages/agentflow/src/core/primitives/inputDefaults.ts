/**
 * Minimal shape accepted by getDefaultValueForType.
 * Both InputParam and CredentialSchemaInput satisfy this interface.
 */
interface TypedInput {
    type: string
    default?: unknown
    options?: Array<{ name: string } | string>
}

/**
 * Returns the appropriate default value for an input based on its type.
 * If the input already defines a `default`, that value is returned as-is.
 *
 * Works with any input shape that has `type`, optional `default`, and optional `options`
 * (e.g. InputParam, CredentialSchemaInput).
 */
export function getDefaultValueForType(input: TypedInput | undefined | null): unknown {
    if (!input) return ''
    if (input.default !== undefined) return input.default

    switch (input.type) {
        case 'boolean':
            return false
        case 'number':
            return 0
        case 'json':
            return '{}'
        case 'array':
            return []
        case 'options': {
            const first = input.options?.[0]
            if (!first) return ''
            return typeof first === 'string' ? first : first.name
        }
        case 'string':
        case 'password':
        default:
            return ''
    }
}
