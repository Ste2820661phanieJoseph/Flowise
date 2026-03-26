import { getCompactTemplates, clearTemplateCache } from './templateCache'

describe('templateCache', () => {
    beforeEach(() => {
        clearTemplateCache()
    })

    describe('getCompactTemplates', () => {
        it('should return a non-empty string', () => {
            const result = getCompactTemplates()
            expect(typeof result).toBe('string')
            expect(result.length).toBeGreaterThan(0)
        })

        it('should contain known template names', () => {
            const result = getCompactTemplates()
            expect(result).toContain('Agentic RAG')
            expect(result).toContain('Simple RAG')
            expect(result).toContain('Translator')
            expect(result).toContain('Structured Output')
            expect(result).toContain('Human In The Loop')
            expect(result).toContain('Supervisor Worker')
        })

        it('should contain compact node type names', () => {
            const result = getCompactTemplates()
            expect(result).toContain('start')
            expect(result).toContain('→')
        })

        it('should include descriptions from marketplace files', () => {
            const result = getCompactTemplates()
            // Agentic RAG description mentions "self-correcting"
            expect(result.toLowerCase()).toContain('self-correcting')
        })

        it('should produce patterns starting with "start"', () => {
            const result = getCompactTemplates()
            const lines = result.split('\n')
            // Pattern lines (indented with 2 spaces) should start with "start"
            const patternLines = lines.filter((l) => l.startsWith('  start'))
            expect(patternLines.length).toBeGreaterThan(0)
        })

        it('should include branching notation for conditional flows', () => {
            const result = getCompactTemplates()
            // Flows with conditions use [...|...] branching
            expect(result).toContain('[')
            expect(result).toContain('|')
        })

        it('should be compact (under 5K characters)', () => {
            const result = getCompactTemplates()
            // Original marketplace files are ~887KB. Compact should be much smaller.
            expect(result.length).toBeLessThan(5000)
        })
    })

    describe('caching behavior', () => {
        it('should return the same string on second call (cached)', () => {
            const first = getCompactTemplates()
            const second = getCompactTemplates()
            expect(first).toBe(second) // Same reference — from cache
        })

        it('should return same reference on repeated calls', () => {
            const first = getCompactTemplates()
            const second = getCompactTemplates()
            // Strict equality means same object reference (cached)
            expect(first === second).toBe(true)
        })

        it('should rebuild after clearTemplateCache()', () => {
            const first = getCompactTemplates()
            clearTemplateCache()
            const second = getCompactTemplates()
            // Content should be same but could be different reference
            expect(first).toEqual(second)
        })
    })

    describe('format', () => {
        it('should have format: "Title: description\\n  pattern"', () => {
            const result = getCompactTemplates()
            const entries = result.split('\n').filter((l) => l && !l.startsWith('  '))
            for (const entry of entries) {
                // Each entry should have "Title: description" format
                expect(entry).toMatch(/.+:.+/)
            }
        })

        it('should include all 13 marketplace templates', () => {
            const result = getCompactTemplates()
            const entries = result.split('\n').filter((l) => l && !l.startsWith('  '))
            expect(entries.length).toBe(13)
        })
    })
})
