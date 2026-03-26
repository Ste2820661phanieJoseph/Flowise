import PropTypes from 'prop-types'
import { Box, Typography, LinearProgress, Chip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconTool } from '@tabler/icons-react'

const IterationProgress = ({ data }) => {
    const theme = useTheme()

    if (!data) return null

    const { iteration = 1, maxIterations = 3, category, reason } = data
    const progress = (iteration / maxIterations) * 100

    return (
        <Box
            sx={{
                mt: 1,
                p: 1.5,
                border: `1px solid ${theme.palette.info.light}`,
                borderRadius: 1.5,
                bgcolor: theme.palette.info.light + '15'
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <IconTool size={16} color={theme.palette.info.main} />
                <Typography variant='subtitle2' fontWeight={600}>
                    Fixing attempt {iteration}/{maxIterations}
                </Typography>
                {category && (
                    <Chip
                        label={category}
                        size='small'
                        sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            bgcolor: theme.palette.info.main,
                            color: '#fff'
                        }}
                    />
                )}
            </Box>

            <LinearProgress
                variant='determinate'
                value={progress}
                sx={{
                    height: 4,
                    borderRadius: 2,
                    mb: 0.5,
                    '& .MuiLinearProgress-bar': {
                        borderRadius: 2,
                        bgcolor: theme.palette.info.main
                    }
                }}
            />

            {reason && (
                <Typography variant='caption' color='text.secondary'>
                    {reason}
                </Typography>
            )}
        </Box>
    )
}

IterationProgress.propTypes = {
    data: PropTypes.shape({
        iteration: PropTypes.number,
        maxIterations: PropTypes.number,
        category: PropTypes.string,
        reason: PropTypes.string,
        fixes: PropTypes.array
    })
}

export default IterationProgress
