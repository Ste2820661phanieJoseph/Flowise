import PropTypes from 'prop-types'
import { Box, Typography, CircularProgress } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconCheck, IconX } from '@tabler/icons-react'

const TestResultCard = ({ data, type }) => {
    const theme = useTheme()

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
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{
                        display: 'block',
                        mt: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%'
                    }}
                >
                    A: {data.response}
                </Typography>
            )}

            {!isRunning && !isPassed && data.error && (
                <Typography variant='caption' color='error' sx={{ display: 'block', mt: 0.5 }}>
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
