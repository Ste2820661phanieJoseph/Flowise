/**
 * MUI Theme Factory for Agentflow
 *
 * Creates a Material-UI theme with custom design tokens.
 * Supports both light and dark modes.
 */

import './types' // Import type extensions

import { createTheme, type Theme } from '@mui/material/styles'

import { tokens } from './tokens'

export function createAgentflowTheme(isDarkMode: boolean): Theme {
    const mode = isDarkMode ? 'dark' : 'light'

    return createTheme({
        palette: {
            mode,
            primary: {
                light: '#e3f2fd',
                main: tokens.colors.nodes.agent,
                dark: '#1e88e5'
            },
            secondary: {
                light: '#ede7f6',
                main: '#673ab7',
                dark: '#5e35b1'
            },
            success: {
                light: '#cdf5d8',
                main: '#00e676',
                dark: '#00c853'
            },
            error: {
                light: '#f3d2d2',
                main: '#f44336',
                dark: '#c62828'
            },
            warning: {
                light: '#fff8e1',
                main: '#ffe57f',
                dark: '#ffc107'
            },
            background: {
                default: tokens.colors.background.canvas[mode],
                paper: tokens.colors.background.card[mode]
            },
            divider: tokens.colors.border.default[mode],
            text: {
                primary: tokens.colors.text.primary[mode],
                secondary: tokens.colors.text.secondary[mode]
            },
            // Custom card color (now type-safe thanks to types.ts)
            card: {
                main: tokens.colors.background.card[mode]
            },
            warningBanner: {
                background: tokens.colors.semantic.warningBg,
                text: tokens.colors.semantic.warningText
            }
        },
        typography: {
            h4: { fontSize: '1rem', fontWeight: 600 },
            h5: { fontSize: '0.875rem', fontWeight: 600 },
            h6: { fontSize: '0.75rem', fontWeight: 500 },
            subtitle1: { fontSize: '0.875rem', fontWeight: 500 },
            body1: { fontSize: '0.875rem', fontWeight: 400 },
            body2: { fontSize: '0.75rem', fontWeight: 400 }
        },
        components: {
            MuiPaper: {
                defaultProps: {
                    elevation: 0
                },
                styleOverrides: {
                    root: {
                        backgroundImage: 'none'
                    }
                }
            }
        },
        spacing: 8, // MUI's default base unit
        shape: {
            borderRadius: tokens.borderRadius.md
        }
    })
}
