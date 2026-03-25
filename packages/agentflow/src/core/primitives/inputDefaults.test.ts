import { getDefaultValueForType } from './inputDefaults'

describe('getDefaultValueForType', () => {
    it('returns defaultValue when defined', () => {
        expect(getDefaultValueForType('string', undefined, 'custom')).toBe('custom')
    })

    it('returns defaultValue even when it is a falsy value', () => {
        expect(getDefaultValueForType('number', undefined, 0)).toBe(0)
        expect(getDefaultValueForType('boolean', undefined, false)).toBe(false)
        expect(getDefaultValueForType('string', undefined, '')).toBe('')
    })

    it('returns false for boolean', () => {
        expect(getDefaultValueForType('boolean')).toBe(false)
    })

    it('returns 0 for number', () => {
        expect(getDefaultValueForType('number')).toBe(0)
    })

    it("returns '{}' for json", () => {
        expect(getDefaultValueForType('json')).toBe('{}')
    })

    it('returns [] for array', () => {
        expect(getDefaultValueForType('array')).toEqual([])
    })

    it('returns first option name for object options', () => {
        expect(getDefaultValueForType('options', [{ name: 'first' }, { name: 'second' }])).toBe('first')
    })

    it('returns first option value for string options', () => {
        expect(getDefaultValueForType('options', ['alpha', 'beta'])).toBe('alpha')
    })

    it("returns '' for options with no options", () => {
        expect(getDefaultValueForType('options')).toBe('')
        expect(getDefaultValueForType('options', [])).toBe('')
    })

    it("returns '' for string", () => {
        expect(getDefaultValueForType('string')).toBe('')
    })

    it("returns '' for password", () => {
        expect(getDefaultValueForType('password')).toBe('')
    })

    it("returns '' for unknown type", () => {
        expect(getDefaultValueForType('somethingElse')).toBe('')
    })
})
