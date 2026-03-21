import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import { Box, TextField } from '@mui/material'
import { useTheme } from '@mui/material/styles'

export const DatePicker = ({ value, onChange, disabled = false, placeholder = 'YYYY-MM-DD' }) => {
    const theme = useTheme()

    // Normalise to "YYYY-MM-DD" for the native date input
    const toDateString = (val) => {
        if (!val) return ''
        const d = new Date(val)
        if (isNaN(d.getTime())) return ''
        return d.toISOString().slice(0, 10)
    }

    const [dateValue, setDateValue] = useState(toDateString(value))

    useEffect(() => {
        setDateValue(toDateString(value))
    }, [value])

    const handleChange = (e) => {
        const newValue = e.target.value // "YYYY-MM-DD" or ""
        setDateValue(newValue)
        // Propagate as ISO string (end-of-day UTC) so backend can parse it as a Date
        onChange(newValue ? new Date(newValue).toISOString() : '')
    }

    return (
        <Box sx={{ mt: 1, width: '100%' }}>
            <TextField
                fullWidth
                size='small'
                type='date'
                disabled={disabled}
                value={dateValue}
                onChange={handleChange}
                placeholder={placeholder}
                InputLabelProps={{ shrink: true }}
                sx={{
                    '& .MuiInputBase-root': {
                        '& fieldset': {
                            borderColor: theme.palette.grey[900] + 25
                        }
                    }
                }}
            />
        </Box>
    )
}

DatePicker.propTypes = {
    value: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    placeholder: PropTypes.string
}
