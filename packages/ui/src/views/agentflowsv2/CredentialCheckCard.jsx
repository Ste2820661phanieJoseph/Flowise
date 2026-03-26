import { useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Typography, Button, List, ListItem, ListItemText, ListItemIcon, Select, MenuItem, FormControl } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconKey, IconAlertTriangle, IconPlayerPlay, IconExternalLink } from '@tabler/icons-react'

const CredentialCheckCard = ({ data, onResume, onCredentialSelect }) => {
    const theme = useTheme()
    const [resumed, setResumed] = useState(false)
    const missingCredentials = data?.missingCredentials || []
    const availableCredentials = data?.availableCredentials || {}
    const errorMessage = data?.errorMessage

    // Track user selections for missing credentials: { credentialType: credentialId }
    const [selections, setSelections] = useState({})

    const handleSelectionChange = (credentialType, credentialId) => {
        setSelections((prev) => ({ ...prev, [credentialType]: credentialId }))
    }

    const handleResume = () => {
        setResumed(true)
        // If user selected credentials, pass them along
        const selectedBindings = Object.entries(selections)
            .filter(([, credId]) => credId)
            .map(([, credId]) => credId)

        if (onCredentialSelect && selectedBindings.length > 0) {
            onCredentialSelect(selections)
        }
        if (onResume) {
            onResume()
        }
    }

    const hasAvailableOptions = Object.keys(availableCredentials).length > 0
    const hasSelectableOptions = missingCredentials.some((cred) => availableCredentials[cred.credentialType]?.length > 0)

    return (
        <Box
            sx={{
                mt: 1,
                p: 1.5,
                border: `1px solid ${theme.palette.warning.light}`,
                borderRadius: 1.5,
                bgcolor: theme.palette.warning.light + '15'
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <IconAlertTriangle size={16} color={theme.palette.warning.dark} />
                <Typography variant='subtitle2' fontWeight={600}>
                    Credentials Required
                </Typography>
            </Box>

            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
                {errorMessage ||
                    'The following tools need API credentials to work. Select from existing credentials or add new ones in the Credentials page.'}
            </Typography>

            <List dense disablePadding>
                {missingCredentials.map((cred, index) => {
                    const options = availableCredentials[cred.credentialType] || []
                    return (
                        <ListItem
                            key={index}
                            disablePadding
                            sx={{
                                mb: 0.75,
                                flexDirection: 'column',
                                alignItems: 'flex-start'
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                <ListItemIcon sx={{ minWidth: 28 }}>
                                    <IconKey size={14} color={theme.palette.text.secondary} />
                                </ListItemIcon>
                                <ListItemText
                                    primary={
                                        <Typography variant='body2' sx={{ fontSize: '0.8rem' }}>
                                            <strong>{cred.nodeName}</strong>
                                            {' — '}
                                            <em>{cred.credentialName}</em>
                                        </Typography>
                                    }
                                />
                            </Box>
                            {options.length > 0 && (
                                <FormControl size='small' fullWidth sx={{ ml: 3.5, mt: 0.5, maxWidth: 'calc(100% - 28px)' }}>
                                    <Select
                                        value={selections[cred.credentialType] || ''}
                                        onChange={(e) => handleSelectionChange(cred.credentialType, e.target.value)}
                                        displayEmpty
                                        sx={{ fontSize: '0.75rem', height: 32 }}
                                    >
                                        <MenuItem value='' sx={{ fontSize: '0.75rem' }}>
                                            <em>Select a credential...</em>
                                        </MenuItem>
                                        {options.map((opt) => (
                                            <MenuItem key={opt.id} value={opt.id} sx={{ fontSize: '0.75rem' }}>
                                                {opt.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                            {options.length === 0 && (
                                <Typography
                                    variant='caption'
                                    sx={{
                                        ml: 3.5,
                                        mt: 0.25,
                                        color: theme.palette.error.main,
                                        fontSize: '0.7rem'
                                    }}
                                >
                                    No matching credentials found — please add one
                                </Typography>
                            )}
                        </ListItem>
                    )
                })}
            </List>

            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center' }}>
                <Button
                    variant='contained'
                    size='small'
                    startIcon={<IconPlayerPlay size={14} />}
                    onClick={handleResume}
                    disabled={resumed}
                    sx={{
                        textTransform: 'none',
                        fontSize: '0.75rem'
                    }}
                >
                    {resumed ? 'Checking...' : hasSelectableOptions ? 'Apply & Resume' : 'Resume'}
                </Button>
                <Button
                    variant='text'
                    size='small'
                    startIcon={<IconExternalLink size={14} />}
                    href='/credentials'
                    target='_blank'
                    sx={{
                        textTransform: 'none',
                        fontSize: '0.7rem',
                        color: theme.palette.text.secondary
                    }}
                >
                    Manage Credentials
                </Button>
            </Box>
        </Box>
    )
}

CredentialCheckCard.propTypes = {
    data: PropTypes.shape({
        missingCredentials: PropTypes.arrayOf(
            PropTypes.shape({
                nodeId: PropTypes.string,
                nodeName: PropTypes.string,
                credentialName: PropTypes.string,
                credentialType: PropTypes.string
            })
        ),
        availableCredentials: PropTypes.object,
        errorMessage: PropTypes.string
    }),
    onResume: PropTypes.func,
    onCredentialSelect: PropTypes.func
}

export default CredentialCheckCard
