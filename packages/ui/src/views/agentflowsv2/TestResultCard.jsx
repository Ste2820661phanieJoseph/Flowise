import { useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Typography, CircularProgress, Collapse, IconButton } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconCheck, IconX, IconChevronDown, IconChevronUp } from '@tabler/icons-react'

const TestResultCard = ({ data, type }) => {
    const theme = useTheme()
    const [responseExpanded, setResponseExpanded] = useState(false)

    if (!data) return null

    const isRunning = type === 'test_start'
    const isPassed = data.status === 'pass'

    return (
        <Box
            sx={{
                mt: 1,
                p: 1.5,
                border: `1px solid ${
                    isRunning ? theme.palette.divider : isPassed ? theme.palette.success.light : theme.palette.error.light
                }`,
                borderRadius: 1.5,
                bgcolor: isRunning ? 'transparent' : isPassed ? theme.palette.success.light + '15' : theme.palette.error.light + '15'
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isRunning ? (
                    <CircularProgress size={16} />
                ) : isPassed ? (
                    <IconCheck size={16} color={theme.palette.success.main} />
                ) : (
                    <IconX size={16} color={theme.palette.error.main} />
                )}
                <Typography variant='subtitle2' fontWeight={600}>
                    {isRunning ? 'Running Test...' : isPassed ? 'Test Passed' : 'Test Failed'}
                </Typography>
                {data.type && (
                    <Typography variant='caption' color='text.secondary'>
                        ({data.type === 'happy_path' ? 'Happy Path' : 'Edge Case'})
                    </Typography>
                )}
            </Box>

            {data.question && (
                <Typography variant='body2' sx={{ mt: 0.5, fontStyle: 'italic' }}>
                    Q: {data.question}
                </Typography>
            )}

            {!isRunning && isPassed && data.response && (
                <Box sx={{ mt: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                            variant='caption'
                            color='text.secondary'
                            sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                            A: {data.response}
                        </Typography>
                        <IconButton size='small' onClick={() => setResponseExpanded((v) => !v)} sx={{ p: 0.25, flexShrink: 0 }}>
                            {responseExpanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                        </IconButton>
                    </Box>
                    <Collapse in={responseExpanded}>
                        <Typography
                            variant='caption'
                            color='text.secondary'
                            component='pre'
                            sx={{
                                display: 'block',
                                mt: 0.5,
                                p: 0.75,
                                bgcolor: 'rgba(0,0,0,0.04)',
                                borderRadius: 1,
                                fontFamily: 'monospace',
                                fontSize: '0.7rem',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                maxHeight: 200,
                                overflowY: 'auto'
                            }}
                        >
                            {data.response}
                        </Typography>
                    </Collapse>
                </Box>
            )}

            {!isRunning && !isPassed && data.error && (
                <Typography variant='caption' color='error' sx={{ display: 'block', mt: 0.5, wordBreak: 'break-word' }}>
                    Error: {data.error}
                </Typography>
            )}
        </Box>
    )
}

TestResultCard.propTypes = {
    data: PropTypes.shape({
        testId: PropTypes.string,
        type: PropTypes.string,
        status: PropTypes.string,
        question: PropTypes.string,
        response: PropTypes.string,
        error: PropTypes.string
    }),
    type: PropTypes.oneOf(['test_start', 'test_result'])
}

export default TestResultCard
