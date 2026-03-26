import { useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Typography, Button, Checkbox, FormControlLabel, Chip, Collapse } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconTool, IconCheck, IconStar, IconChevronDown, IconChevronUp } from '@tabler/icons-react'

const ToolSelectionCard = ({ data, onSubmit, disabled }) => {
    const theme = useTheme()
    const availableTools = data?.availableTools || []
    const recommendedTools = data?.recommendedTools || []
    const recommendedNames = new Set(recommendedTools.map((t) => t.name))
    const reasonByName = Object.fromEntries(recommendedTools.map((t) => [t.name, t.reason]))

    const [selected, setSelected] = useState(() => recommendedTools.map((t) => t.name))
    const [submitted, setSubmitted] = useState(false)
    const [showOtherTools, setShowOtherTools] = useState(true)

    const recommended = availableTools.filter((t) => recommendedNames.has(t.name))
    const others = availableTools.filter((t) => !recommendedNames.has(t.name))
    const hasRecommendations = recommended.length > 0

    const handleToggle = (toolName) => {
        setSelected((prev) => (prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]))
    }

    const handleSelectAllRecommended = () => {
        const allRecommendedSelected = recommended.every((t) => selected.includes(t.name))
        if (allRecommendedSelected) {
            setSelected((prev) => prev.filter((n) => !recommendedNames.has(n)))
        } else {
            setSelected((prev) => [...new Set([...prev, ...recommended.map((t) => t.name)])])
        }
    }

    const handleSubmit = () => {
        setSubmitted(true)
        if (onSubmit) {
            onSubmit(selected)
        }
    }

    if (submitted) {
        return (
            <Box
                sx={{
                    mt: 1,
                    p: 1.5,
                    border: `1px solid ${theme.palette.success.light}`,
                    borderRadius: 1.5,
                    bgcolor: theme.palette.success.light + '15'
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconCheck size={16} color={theme.palette.success.dark} />
                    <Typography variant='subtitle2' fontWeight={600}>
                        {selected.length > 0 ? `${selected.length} tool(s) selected` : 'No tools selected — agent will run without tools'}
                    </Typography>
                </Box>
            </Box>
        )
    }

    const renderToolRow = (tool, isRecommended) => (
        <Box
            key={tool.name}
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                px: 1,
                py: 0.25,
                borderBottom: `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 'none' },
                '&:hover': { bgcolor: theme.palette.action.hover },
                cursor: 'pointer',
                ...(isRecommended && {
                    bgcolor: theme.palette.warning.light + '08'
                })
            }}
            onClick={() => handleToggle(tool.name)}
        >
            <FormControlLabel
                control={
                    <Checkbox
                        checked={selected.includes(tool.name)}
                        size='small'
                        sx={{ p: 0.5 }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => handleToggle(tool.name)}
                    />
                }
                label={
                    <Box sx={{ ml: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant='body2' fontWeight={600} sx={{ fontSize: '0.8rem', lineHeight: 1.3 }}>
                                {tool.name}
                            </Typography>
                            {isRecommended && <IconStar size={12} color={theme.palette.warning.main} fill={theme.palette.warning.main} />}
                        </Box>
                        {isRecommended && reasonByName[tool.name] && (
                            <Typography
                                variant='caption'
                                sx={{
                                    display: 'block',
                                    lineHeight: 1.2,
                                    fontSize: '0.7rem',
                                    color: theme.palette.warning.dark,
                                    fontStyle: 'italic'
                                }}
                            >
                                {reasonByName[tool.name]}
                            </Typography>
                        )}
                        {!isRecommended && tool.description && (
                            <Typography
                                variant='caption'
                                color='text.secondary'
                                sx={{ display: 'block', lineHeight: 1.2, fontSize: '0.7rem' }}
                            >
                                {tool.description.length > 100 ? tool.description.substring(0, 100) + '...' : tool.description}
                            </Typography>
                        )}
                    </Box>
                }
                sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
            />
        </Box>
    )

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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <IconTool size={16} color={theme.palette.info.dark} />
                <Typography variant='subtitle2' fontWeight={600}>
                    Select Tools for Agent
                </Typography>
            </Box>

            {hasRecommendations ? (
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
                    We analyzed your flow and pre-selected the tools your agents need. Review and adjust as needed.
                </Typography>
            ) : (
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
                    Choose which tools the agent should have access to. You can skip this to run the agent without tools.
                </Typography>
            )}

            {/* Recommended tools section */}
            {hasRecommendations && (
                <>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <IconStar size={12} color={theme.palette.warning.main} fill={theme.palette.warning.main} />
                            <Typography variant='caption' fontWeight={600} sx={{ fontSize: '0.7rem' }}>
                                Recommended ({recommended.length})
                            </Typography>
                        </Box>
                        <Button
                            size='small'
                            onClick={handleSelectAllRecommended}
                            sx={{ textTransform: 'none', fontSize: '0.65rem', p: 0, minWidth: 0 }}
                        >
                            {recommended.every((t) => selected.includes(t.name)) ? 'Deselect All' : 'Select All'}
                        </Button>
                    </Box>
                    <Box
                        sx={{
                            maxHeight: 180,
                            overflowY: 'auto',
                            border: `1px solid ${theme.palette.warning.light}`,
                            borderRadius: 1,
                            bgcolor: theme.palette.background.paper
                        }}
                    >
                        {recommended.map((tool) => renderToolRow(tool, true))}
                    </Box>
                </>
            )}

            {/* Other tools section */}
            {others.length > 0 && (
                <Box sx={{ mt: hasRecommendations ? 1.5 : 0 }}>
                    {hasRecommendations ? (
                        <Button
                            size='small'
                            variant='outlined'
                            onClick={() => setShowOtherTools(!showOtherTools)}
                            startIcon={showOtherTools ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                            sx={{
                                textTransform: 'none',
                                fontSize: '0.7rem',
                                mb: 0.5
                            }}
                        >
                            {showOtherTools ? 'Hide' : 'Browse'} other tools ({others.length})
                        </Button>
                    ) : (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                            <Button
                                size='small'
                                onClick={() => {
                                    if (selected.length === availableTools.length) setSelected([])
                                    else setSelected(availableTools.map((t) => t.name))
                                }}
                                sx={{ textTransform: 'none', fontSize: '0.7rem', p: 0, minWidth: 0 }}
                            >
                                {selected.length === availableTools.length ? 'Deselect All' : 'Select All'}
                            </Button>
                        </Box>
                    )}

                    <Collapse in={!hasRecommendations || showOtherTools}>
                        <Box
                            sx={{
                                maxHeight: 200,
                                overflowY: 'auto',
                                border: `1px solid ${theme.palette.divider}`,
                                borderRadius: 1,
                                bgcolor: theme.palette.background.paper
                            }}
                        >
                            {others.map((tool) => renderToolRow(tool, false))}
                        </Box>
                    </Collapse>
                </Box>
            )}

            {selected.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((name) => (
                        <Chip
                            key={name}
                            label={name}
                            size='small'
                            onDelete={() => handleToggle(name)}
                            color={recommendedNames.has(name) ? 'warning' : 'default'}
                            variant={recommendedNames.has(name) ? 'filled' : 'outlined'}
                            sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                    ))}
                </Box>
            )}

            <Button
                variant='contained'
                size='small'
                onClick={handleSubmit}
                disabled={disabled}
                sx={{
                    mt: 1,
                    textTransform: 'none',
                    fontSize: '0.75rem'
                }}
            >
                {selected.length > 0 ? `Add ${selected.length} Tool(s)` : 'Skip — No Tools'}
            </Button>
        </Box>
    )
}

ToolSelectionCard.propTypes = {
    data: PropTypes.shape({
        availableTools: PropTypes.arrayOf(
            PropTypes.shape({
                name: PropTypes.string,
                description: PropTypes.string
            })
        ),
        recommendedTools: PropTypes.arrayOf(
            PropTypes.shape({
                name: PropTypes.string,
                reason: PropTypes.string
            })
        ),
        agentNodeIds: PropTypes.arrayOf(PropTypes.string)
    }),
    onSubmit: PropTypes.func,
    disabled: PropTypes.bool
}

export default ToolSelectionCard
