import type { CredentialSchemaInput } from '@/core/types'

import { getDefaultValueForType } from './credentialDefaults'

const makeInput = (overrides: Partial<CredentialSchemaInput> = {}): CredentialSchemaInput => ({
    label: 'Test',
    name: 'test',
    type: 'string',
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

    it('returns first option name for options with options present', () => {
        const input = makeInput({
            type: 'options',
            options: [
                { label: 'First', name: 'first' },
                { label: 'Second', name: 'second' }
            ]
        })
        expect(getDefaultValueForType(input)).toBe('first')
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
        expect(getDefaultValueForType(makeInput({ type: 'unknown' as CredentialSchemaInput['type'] }))).toBe('')
    })
})
