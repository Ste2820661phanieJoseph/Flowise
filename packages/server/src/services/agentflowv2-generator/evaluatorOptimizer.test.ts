import { evaluate, CredentialStatus, ValidationStatus } from './evaluatorOptimizer'
import { TestResult } from './flowTester'

describe('evaluatorOptimizer', () => {
    // ----- evaluate -----

    describe('evaluate', () => {
        const passingCredentials: CredentialStatus = { allBound: true, missingCount: 0 }
        const passingValidation: ValidationStatus = { valid: true }

        it('returns DONE when all checks pass', () => {
            const testResults: TestResult[] = [
                { testId: 'hp-1', type: 'happy_path', status: 'pass', question: 'What is AI?', response: 'AI is...' },
                { testId: 'ec-1', type: 'edge_case', status: 'pass', question: '', response: 'Please provide a question' }
            ]

            const verdict = evaluate(testResults, passingCredentials, passingValidation)
            expect(verdict.verdict).toBe('DONE')
        })

        it('returns DONE when edge case fails without 500 error', () => {
            const testResults: TestResult[] = [
                { testId: 'hp-1', type: 'happy_path', status: 'pass', question: 'What is AI?', response: 'AI is...' },
                { testId: 'ec-1', type: 'edge_case', status: 'fail', question: '', error: 'Empty input not handled' }
            ]

            const verdict = evaluate(testResults, passingCredentials, passingValidation)
            expect(verdict.verdict).toBe('DONE')
        })

        it('returns ITERATE with CREDENTIAL category when credentials are missing', () => {
            const missingCredentials: CredentialStatus = { allBound: false, missingCount: 2 }

            const verdict = evaluate([], missingCredentials, passingValidation)
            expect(verdict.verdict).toBe('ITERATE')
            expect(verdict.category).toBe('CREDENTIAL')
            expect(verdict.reason).toContain('2 credential(s)')
        })

        it('returns ITERATE with STRUCTURE category when validation fails', () => {
            const failingValidation: ValidationStatus = { valid: false, errors: ['Missing start node', 'Cycle detected'] }

            const verdict = evaluate([], passingCredentials, failingValidation)
            expect(verdict.verdict).toBe('ITERATE')
            expect(verdict.category).toBe('STRUCTURE')
            expect(verdict.reason).toContain('Missing start node')
        })

        it('returns ITERATE with LOGIC category when happy path test fails', () => {
            const testResults: TestResult[] = [
                { testId: 'hp-1', type: 'happy_path', status: 'fail', question: 'What is AI?', error: 'Node execution failed' }
            ]

            const verdict = evaluate(testResults, passingCredentials, passingValidation)
            expect(verdict.verdict).toBe('ITERATE')
            expect(verdict.category).toBe('LOGIC')
            expect(verdict.reason).toContain('Happy path test failed')
        })

        it('returns ITERATE with LOGIC category when edge case returns 500', () => {
            const testResults: TestResult[] = [
                { testId: 'hp-1', type: 'happy_path', status: 'pass', question: 'What is AI?', response: 'AI is...' },
                { testId: 'ec-1', type: 'edge_case', status: 'fail', question: '', error: '500 Internal Server Error' }
            ]

            const verdict = evaluate(testResults, passingCredentials, passingValidation)
            expect(verdict.verdict).toBe('ITERATE')
            expect(verdict.category).toBe('LOGIC')
            expect(verdict.reason).toContain('server error')
        })

        it('checks credentials before validation before tests (priority order)', () => {
            const missingCredentials: CredentialStatus = { allBound: false, missingCount: 1 }
            const failingValidation: ValidationStatus = { valid: false, errors: ['Bad structure'] }
            const failingTests: TestResult[] = [{ testId: 'hp-1', type: 'happy_path', status: 'fail', question: 'test', error: 'fail' }]

            const verdict = evaluate(failingTests, missingCredentials, failingValidation)
            // Credentials checked first
            expect(verdict.category).toBe('CREDENTIAL')
        })
    })
})
