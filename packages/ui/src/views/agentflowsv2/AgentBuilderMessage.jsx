import PropTypes from 'prop-types'
import { Box, Typography, Chip, Button } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useSelector } from 'react-redux'
import { IconUser, IconRobot } from '@tabler/icons-react'
import CredentialCheckCard from './CredentialCheckCard'
import ToolSelectionCard from './ToolSelectionCard'
import TestResultCard from './TestResultCard'
import IterationProgress from './IterationProgress'

const operationTypeColors = {
    DIRECT_MUTATION: { bg: '#e8f5e9', color: '#2e7d32', label: 'Direct Edit' },
    PARTIAL_GENERATION: { bg: '#e3f2fd', color: '#1565c0', label: 'Partial Gen' },
    FULL_GENERATION: { bg: '#fce4ec', color: '#c62828', label: 'Full Gen' }
}

const AgentBuilderMessage = ({ message, onCredentialResume, onCredentialSelect, onToolSelectionSubmit, onTestAction }) => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const isUser = message.role === 'user'
    const isError = message.type === 'error'

    const opType = message.operationType ? operationTypeColors[message.operationType] : null

    const renderInlineCard = () => {
        switch (message.type) {
            case 'tool_selection':
                return <ToolSelectionCard data={message.data} onSubmit={onToolSelectionSubmit} />
            case 'credential_check':
                return <CredentialCheckCard data={message.data} onResume={onCredentialResume} onCredentialSelect={onCredentialSelect} />
            case 'test_start':
            case 'test_result':
                return <TestResultCard data={message.data} type={message.type} />
            case 'iteration_start':
                return <IterationProgress data={message.data} />
            case 'evaluation':
                return <EvaluationBadge data={message.data} />
            case 'test_failed':
                return <TestFailedActions onTestAction={onTestAction} />
            default:
                return null
        }
    }

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: isUser ? 'flex-end' : 'flex-start',
                mb: 1.5,
                px: 1
            }}
        >
            {!isUser && (
                <Box
                    sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: theme.palette.primary.light,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mr: 1,
                        mt: 0.5,
                        flexShrink: 0
                    }}
                >
                    <IconRobot size={16} color={theme.palette.primary.dark} />
                </Box>
            )}
            <Box
                sx={{
                    maxWidth: '80%',
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: isUser
                        ? theme.palette.primary.main
                        : isError
                        ? theme.palette.error.light
                        : customization.isDarkMode
                        ? theme.palette.dark.main
                        : theme.palette.grey[100],
                    color: isUser ? '#fff' : isError ? theme.palette.error.dark : theme.palette.text.primary
                }}
            >
                {opType && (
                    <Chip
                        label={opType.label}
                        size='small'
                        sx={{
                            mb: 0.5,
                            height: 20,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            bgcolor: opType.bg,
                            color: opType.color
                        }}
                    />
                )}
                {message.content && (
                    <Typography
                        variant='body2'
                        sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: 1.5
                        }}
                    >
                        {message.content}
                        {message.type === 'generating' && <BlinkingCursor />}
                    </Typography>
                )}
                {!message.content && message.type === 'generating' && (
                    <Typography variant='body2' sx={{ opacity: 0.6 }}>
                        Thinking...
                    </Typography>
                )}
                {renderInlineCard()}
            </Box>
            {isUser && (
                <Box
                    sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: theme.palette.primary.dark,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        ml: 1,
                        mt: 0.5,
                        flexShrink: 0
                    }}
                >
                    <IconUser size={16} color='#fff' />
                </Box>
            )}
        </Box>
    )
}

const BlinkingCursor = () => (
    <Box
        component='span'
        sx={{
            display: 'inline-block',
            width: 6,
            height: 14,
            bgcolor: 'currentColor',
            ml: 0.5,
            verticalAlign: 'text-bottom',
            animation: 'blink 1s step-end infinite',
            '@keyframes blink': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0 }
            }
        }}
    />
)

const TestFailedActions = ({ onTestAction }) => {
    const theme = useTheme()
    return (
        <Box sx={{ mt: 1.5, display: 'flex', gap: 1 }}>
            <Button
                size='small'
                variant='outlined'
                onClick={() => onTestAction?.('test_again')}
                sx={{
                    textTransform: 'none',
                    fontSize: '0.75rem',
                    borderColor: theme.palette.primary.main,
                    color: theme.palette.primary.main
                }}
            >
                Test Again
            </Button>
            <Button
                size='small'
                variant='contained'
                onClick={() => onTestAction?.('fix_and_resume')}
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
                Fix &amp; Resume
            </Button>
        </Box>
    )
}

TestFailedActions.propTypes = {
    onTestAction: PropTypes.func
}

const EvaluationBadge = ({ data }) => {
    const theme = useTheme()
    if (!data) return null

    const verdictConfig = {
        DONE: { color: theme.palette.success.main, label: 'Passed' },
        ITERATE: { color: theme.palette.warning.main, label: 'Needs Fix' },
        TIMEOUT: { color: theme.palette.error.main, label: 'Timed Out' }
    }

    const config = verdictConfig[data.verdict] || verdictConfig.TIMEOUT

    return (
        <Box sx={{ mt: 1 }}>
            <Chip label={config.label} size='small' sx={{ bgcolor: config.color, color: '#fff', fontWeight: 700 }} />
            {data.reason && (
                <Typography variant='caption' display='block' sx={{ mt: 0.5, opacity: 0.8 }}>
                    {data.reason}
                </Typography>
            )}
        </Box>
    )
}

EvaluationBadge.propTypes = {
    data: PropTypes.object
}

AgentBuilderMessage.propTypes = {
    message: PropTypes.shape({
        role: PropTypes.string.isRequired,
        content: PropTypes.string,
        type: PropTypes.string,
        operationType: PropTypes.string,
        data: PropTypes.object
    }).isRequired,
    onCredentialResume: PropTypes.func,
    onCredentialSelect: PropTypes.func,
    onToolSelectionSubmit: PropTypes.func,
    onTestAction: PropTypes.func
}

export default AgentBuilderMessage
