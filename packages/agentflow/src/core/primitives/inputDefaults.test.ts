import { getDefaultValueForType } from './inputDefaults'

const makeInput = (overrides: Record<string, unknown> = {}) => ({
    type: 'string' as string,
    ...overrides
})

describe('getDefaultValueForType', () => {
    it('returns input.default when defined', () => {
        expect(getDefaultValueForType(makeInput({ type: 'string', default: 'custom' }))).toBe('custom')
    })

    it('returns input.default even when it is a falsy value', () => {
        expect(getDefaultValueForType(makeInput({ type: 'number', default: 0 }))).toBe(0)
        expect(getDefaultValueForType(makeInput({ type: 'boolean', default: false }))).toBe(false)
        expect(getDefaultValueForType(makeInput({ type: 'string', default: '' }))).toBe('')
    })

    it('returns false for boolean', () => {
        expect(getDefaultValueForType(makeInput({ type: 'boolean' }))).toBe(false)
    })

    it('returns 0 for number', () => {
        expect(getDefaultValueForType(makeInput({ type: 'number' }))).toBe(0)
    })

    it("returns '{}' for json", () => {
        expect(getDefaultValueForType(makeInput({ type: 'json' }))).toBe('{}')
    })

    it('returns [] for array', () => {
        expect(getDefaultValueForType(makeInput({ type: 'array' }))).toEqual([])
    })

    it('returns first option name for object options', () => {
        expect(
            getDefaultValueForType(
                makeInput({
                    type: 'options',
                    options: [
                        { label: 'First', name: 'first' },
                        { label: 'Second', name: 'second' }
                    ]
                })
            )
        ).toBe('first')
    })

    it('returns first option value for string options', () => {
        expect(getDefaultValueForType(makeInput({ type: 'options', options: ['alpha', 'beta'] }))).toBe('alpha')
    })

    it("returns '' for options with no options", () => {
        expect(getDefaultValueForType(makeInput({ type: 'options' }))).toBe('')
        expect(getDefaultValueForType(makeInput({ type: 'options', options: [] }))).toBe('')
    })

    it("returns '' for string", () => {
        expect(getDefaultValueForType(makeInput({ type: 'string' }))).toBe('')
    })

    it("returns '' for password", () => {
        expect(getDefaultValueForType(makeInput({ type: 'password' }))).toBe('')
    })

    it("returns '' for unknown type", () => {
        expect(getDefaultValueForType(makeInput({ type: 'somethingElse' }))).toBe('')
    })

    it('works with InputParam-shaped objects', () => {
        // InputParam has id, name, label, type, etc.
        const inputParam = { id: 'p1', name: 'field', label: 'Field', type: 'boolean' }
        expect(getDefaultValueForType(inputParam)).toBe(false)
    })

    it('works with CredentialSchemaInput-shaped objects', () => {
        const credInput = { label: 'API Key', name: 'apiKey', type: 'password' }
        expect(getDefaultValueForType(credInput)).toBe('')
    })
})
