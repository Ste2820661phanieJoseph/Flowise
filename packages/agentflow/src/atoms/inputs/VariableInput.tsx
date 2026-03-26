import { useEffect, useMemo, useRef } from 'react'

import { Box } from '@mui/material'
import { styled } from '@mui/material/styles'
import { mergeAttributes } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import { createLowlight } from 'lowlight'

import { CustomMention } from '@/core/primitives/customMention'
import { tokens } from '@/core/theme/tokens'

import { createSuggestionConfig } from './suggestionConfig'
import type { SuggestionItem } from './SuggestionDropdown'

export type { SuggestionItem }

const lowlight = createLowlight()
lowlight.register('javascript', javascript)
lowlight.register('json', json)
lowlight.register('python', python)
lowlight.register('typescript', typescript)

/**
 * Detect if content is legacy HTML (from old getHTML() storage) vs markdown.
 * Matches the isHtmlContent check in packages/ui/src/ui-component/input/RichInput.jsx:20-23.
 */
const isHtmlContent = (content: string): boolean => {
    return /<(?:p|div|span|h[1-6]|ul|ol|li|br|code|pre|blockquote|table|strong|em)\b/i.test(content)
}

export interface VariableInputProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    /** Number of visible text rows. When set, renders as a multiline editor and uses markdown serialization. */
    rows?: number
    /** Available variables for autocomplete when typing `{{` */
    suggestionItems?: SuggestionItem[]
}

/* ── Styled wrapper matching RichTextEditor styling ── */

const StyledEditorContent = styled(EditorContent, {
    shouldForwardProp: (prop) => !['rows', 'disabled'].includes(prop as string)
})<{ rows?: number; disabled?: boolean }>(({ theme, rows, disabled }) => {
    const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
    const sh = tokens.colors.syntaxHighlight

    return {
        '& .ProseMirror': {
            padding: '10px 14px',
            height: rows ? `${rows * tokens.typography.rowHeightRem}rem` : `${tokens.typography.singleLineHeightRem}rem`,
            overflowY: rows ? 'auto' : 'hidden',
            overflowX: rows ? 'auto' : 'hidden',
            lineHeight: rows ? `${tokens.typography.rowHeightRem}em` : `${tokens.typography.singleLineLineHeightEm}em`,
            fontWeight: 500,
            color: disabled ? theme.palette.action.disabled : theme.palette.grey[900],
            border: `1px solid ${theme.palette.grey[900]}25`,
            borderRadius: '10px',
            backgroundColor:
                (theme.palette as { textBackground?: { main: string } }).textBackground?.main ?? theme.palette.background.paper,
            boxSizing: 'border-box',
            whiteSpace: rows ? 'pre-wrap' : 'nowrap',

            '&:hover': {
                borderColor: disabled ? `${theme.palette.grey[900]}25` : theme.palette.text.primary,
                cursor: disabled ? 'default' : 'text'
            },
            '&:focus': {
                borderColor: disabled ? `${theme.palette.grey[900]}25` : theme.palette.primary.main,
                outline: 'none'
            },

            // Placeholder
            '& p.is-editor-empty:first-of-type::before': {
                content: 'attr(data-placeholder)',
                float: 'left',
                color: disabled ? theme.palette.action.disabled : theme.palette.text.primary,
                opacity: disabled ? 0.6 : 0.4,
                pointerEvents: 'none',
                height: 0
            },

            // Mention (variable) chip styling
            '& .mention': {
                backgroundColor: mode === 'dark' ? 'rgba(97, 175, 254, 0.2)' : 'rgba(25, 118, 210, 0.08)',
                borderRadius: '4px',
                padding: '1px 4px',
                fontWeight: 600,
                color: theme.palette.primary.main,
                whiteSpace: 'nowrap'
            },

            // Block element spacing
            '& p, & h1, & h2, & h3, & h4, & h5, & h6, & ul, & ol, & pre, & blockquote': {
                margin: '0.75em 0'
            },
            '& > :first-of-type': { marginTop: '0.25em' },
            '& > :last-of-type': { marginBottom: '0.25em' },

            // List indentation
            '& ul, & ol': { paddingLeft: '1.5em' },
            '& li': { marginBottom: '0.25em' },
            '& li > p': { margin: '0.25em 0' },

            // Code block styling
            '& pre': {
                backgroundColor: sh.background[mode],
                color: sh.text[mode],
                borderRadius: '8px',
                padding: '0.75em 1em',
                overflow: 'auto',
                '& code': { fontFamily: 'monospace', fontSize: '0.9em' }
            },

            // Syntax highlight colors
            '& .hljs-comment, & .hljs-quote': { color: sh.comment[mode] },
            '& .hljs-variable, & .hljs-template-variable, & .hljs-attr': { color: sh.variable[mode] },
            '& .hljs-number, & .hljs-literal': { color: sh.number[mode] },
            '& .hljs-string, & .hljs-regexp': { color: sh.string[mode] },
            '& .hljs-title, & .hljs-section, & .hljs-selector-id': { color: sh.title[mode] },
            '& .hljs-keyword, & .hljs-selector-tag, & .hljs-built_in': { color: sh.keyword[mode] },
            '& .hljs-operator, & .hljs-symbol': { color: sh.operator[mode] },
            '& .hljs-punctuation': { color: sh.punctuation[mode] }
        }
    }
})

/**
 * A TipTap-based text input with `{{ variable }}` mention support.
 *
 * When the user types `{{`, a suggestion dropdown appears anchored to the cursor
 * with available variables. Selecting a variable inserts it as a styled mention chip
 * that renders as `{{variableName}}` in the output text.
 *
 * Serialization matches the UI's RichInput behavior:
 * - Multiline fields (rows > 0): markdown via getMarkdown() — enables full round-tripping
 *   with the original Flowise UI which also uses markdown for multiline fields
 * - Single-line fields (no rows): HTML via getHTML()
 *
 * This is the agentflow equivalent of the UI package's RichInput component.
 */
export function VariableInput({ value, onChange, placeholder, disabled = false, rows, suggestionItems }: VariableInputProps) {
    // Multiline fields use markdown serialization to match UI's RichInput behavior
    const useMarkdown = !!rows

    const onChangeRef = useRef(onChange)
    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    const suggestionConfig = useMemo(
        () => (suggestionItems?.length ? createSuggestionConfig(suggestionItems) : undefined),
        [suggestionItems]
    )

    const extensions = useMemo(
        () => [
            Markdown,
            StarterKit.configure({
                codeBlock: false,
                ...(!useMarkdown && { link: false })
            }),
            CodeBlockLowlight.configure({ lowlight, enableTabIndentation: true, tabSize: 2 }),
            ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
            ...(suggestionConfig
                ? [
                      CustomMention.configure({
                          HTMLAttributes: { class: 'mention' },
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          renderHTML({ options, node }: any) {
                              return [
                                  'span',
                                  mergeAttributes({ class: 'mention' }, options.HTMLAttributes),
                                  `${options.suggestion?.char ?? '{{'} ${node.attrs.label ?? node.attrs.id} }}`
                              ]
                          },
                          suggestion: suggestionConfig,
                          deleteTriggerWithBackspace: true
                      })
                  ]
                : [])
        ],
        [placeholder, suggestionConfig, useMarkdown]
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = useEditor({
        extensions,
        content: '',
        editable: !disabled,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onUpdate: ({ editor: ed }: any) => {
            if (useMarkdown) {
                try {
                    onChangeRef.current(ed.getMarkdown())
                } catch {
                    onChangeRef.current(ed.getHTML())
                }
            } else {
                onChangeRef.current(ed.getHTML())
            }
        }
    })

    // Load initial content after editor is ready, detecting HTML vs markdown
    // Matches packages/ui/src/ui-component/input/RichInput.jsx:171-178
    useEffect(() => {
        if (editor && value) {
            if (!useMarkdown || isHtmlContent(value)) {
                editor.commands.setContent(value)
            } else {
                editor.commands.setContent(value, { contentType: 'markdown' })
            }
        }
    }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

    // Sync editable state
    useEffect(() => {
        if (editor) editor.setEditable(!disabled)
    }, [editor, disabled])

    return (
        <Box data-testid='variable-input' sx={{ mt: 1 }}>
            <StyledEditorContent editor={editor} rows={rows} disabled={disabled} />
        </Box>
    )
}
