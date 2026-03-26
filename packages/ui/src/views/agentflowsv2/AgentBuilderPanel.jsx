import { useState, useEffect, useRef, useCallback } from 'react'
import { useSelector } from 'react-redux'
import { cloneDeep } from 'lodash'
import PropTypes from 'prop-types'
import { Box, Drawer, Typography, IconButton, OutlinedInput, InputAdornment, Button, Link } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { IconX, IconSend, IconArrowBackUp, IconRefresh, IconChevronDown, IconChevronUp, IconSparkles } from '@tabler/icons-react'
import PerfectScrollbar from 'react-perfect-scrollbar'

import AgentBuilderMessage from './AgentBuilderMessage'
import useAgentBuilder from '@/hooks/useAgentBuilder'
import { Dropdown } from '@/ui-component/dropdown/Dropdown'
import DocStoreInputHandler from '@/views/docstore/DocStoreInputHandler'
import { initNode, showHideInputParams } from '@/utils/genericHelper'
import { baseURL, FLOWISE_CREDENTIAL_ID } from '@/store/constant'
import assistantsApi from '@/api/assistants'
import useApi from '@/hooks/useApi'

const DRAWER_WIDTH = 400

const AgentBuilderPanel = ({ open, onClose }) => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)

    const {
        messages,
        selectedChatModel,
        isGenerating,
        previousFlowState,
        sendMessage,
        resetConversation,
        undoLastChange,
        persistModel,
        handleTestAction
    } = useAgentBuilder()

    // Model selector state
    const [modelExpanded, setModelExpanded] = useState(false)
    const [chatModelsComponents, setChatModelsComponents] = useState([])
    const [chatModelsOptions, setChatModelsOptions] = useState([])
    const [localModel, setLocalModel] = useState(selectedChatModel)

    // Input state
    const [inputValue, setInputValue] = useState('')
    const messagesEndRef = useRef(null)
    const inputRef = useRef(null)

    const getChatModelsApi = useApi(assistantsApi.getChatModels)

    const isModelConfigured = localModel && Object.keys(localModel).length > 0 && localModel.name

    // Expand model selector on first open if no model is configured
    useEffect(() => {
        if (open) {
            getChatModelsApi.request()
            if (!isModelConfigured) {
                setModelExpanded(true)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    useEffect(() => {
        if (getChatModelsApi.data) {
            setChatModelsComponents(getChatModelsApi.data)
            const options = getChatModelsApi.data.map((chatModel) => ({
                label: chatModel.label,
                name: chatModel.name,
                imageSrc: `${baseURL}/api/v1/node-icon/${chatModel.name}`
            }))
            setChatModelsOptions(options)
        }
    }, [getChatModelsApi.data])

    // Sync localModel with hook's selectedChatModel
    useEffect(() => {
        if (selectedChatModel && Object.keys(selectedChatModel).length > 0) {
            setLocalModel(selectedChatModel)
        }
    }, [selectedChatModel])

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    // Focus input when panel opens
    useEffect(() => {
        if (open && isModelConfigured && !isGenerating) {
            setTimeout(() => inputRef.current?.focus(), 200)
        }
    }, [open, isModelConfigured, isGenerating])

    const handleModelSelect = useCallback(
        (newValue) => {
            if (!newValue) {
                setLocalModel({})
                return
            }
            const foundChatComponent = chatModelsComponents.find((chatModel) => chatModel.name === newValue)
            if (foundChatComponent) {
                const chatModelId = `${foundChatComponent.name}_0`
                const clonedComponent = cloneDeep(foundChatComponent)
                const initChatModelData = initNode(clonedComponent, chatModelId)
                setLocalModel(initChatModelData)
                persistModel(initChatModelData)
            }
        },
        [chatModelsComponents, persistModel]
    )

    const handleModelDataChange = useCallback(
        ({ inputParam, newValue }) => {
            setLocalModel((prevData) => {
                const updatedData = { ...prevData }
                if (inputParam.type === 'credential') {
                    updatedData.credential = newValue
                    updatedData.inputs = { ...updatedData.inputs, [FLOWISE_CREDENTIAL_ID]: newValue }
                    if (newValue) setModelExpanded(false)
                } else {
                    updatedData.inputs = { ...updatedData.inputs, [inputParam.name]: newValue }
                }
                updatedData.inputParams = showHideInputParams(updatedData)
                persistModel(updatedData)
                return updatedData
            })
        },
        [persistModel]
    )

    const handleSend = useCallback(() => {
        const text = inputValue.trim()
        if (!text || isGenerating || !isModelConfigured) return
        setInputValue('')
        sendMessage(text)
    }, [inputValue, isGenerating, isModelConfigured, sendMessage])

    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
            }
        },
        [handleSend]
    )

    // Store credential selections from the CredentialCheckCard
    const credentialSelectionsRef = useRef({})

    const handleCredentialSelect = useCallback((selections) => {
        credentialSelectionsRef.current = selections
    }, [])

    const handleCredentialResume = useCallback(() => {
        const selections = credentialSelectionsRef.current
        const bindings = Object.entries(selections)
            .filter(([, credId]) => credId)
            .map(([credType, credId]) => ({ credentialType: credType, credentialId: credId }))

        if (bindings.length > 0) {
            sendMessage(null, { credentialBindings: bindings, credentialRescan: true })
        } else {
            sendMessage(null, { credentialRescan: true })
        }
        credentialSelectionsRef.current = {}
    }, [sendMessage])

    const handleToolSelectionSubmit = useCallback(
        (selectedTools) => {
            sendMessage(null, { selectedTools })
        },
        [sendMessage]
    )

    const handleNewConversation = useCallback(() => {
        resetConversation()
        setInputValue('')
    }, [resetConversation])

    const getModelDisplayName = () => {
        if (!localModel || !localModel.label) return ''
        const modelName = localModel.inputs?.modelName || localModel.inputs?.model || ''
        return modelName ? `${localModel.label} (${modelName})` : localModel.label
    }

    return (
        <Drawer
            anchor='right'
            open={open}
            onClose={onClose}
            variant='persistent'
            sx={{
                width: open ? DRAWER_WIDTH : 0,
                flexShrink: 0,
                '& .MuiDrawer-paper': {
                    width: DRAWER_WIDTH,
                    boxSizing: 'border-box',
                    top: '70px',
                    height: 'calc(100vh - 70px)',
                    borderLeft: `1px solid ${theme.palette.divider}`
                }
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: `1px solid ${theme.palette.divider}`
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <IconSparkles size={20} color={theme.palette.primary.main} />
                    <Typography variant='h5'>Agent Builder</Typography>
                </Box>
                <IconButton size='small' onClick={onClose}>
                    <IconX size={18} />
                </IconButton>
            </Box>

            {/* Model Selector */}
            <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
                {isModelConfigured && !modelExpanded ? (
                    // Collapsed state
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant='body2' noWrap sx={{ flex: 1 }}>
                            Using: <strong>{getModelDisplayName()}</strong>
                        </Typography>
                        <Link
                            component='button'
                            variant='caption'
                            onClick={() => setModelExpanded(true)}
                            sx={{ ml: 1, display: 'flex', alignItems: 'center', gap: 0.25 }}
                        >
                            change <IconChevronDown size={12} />
                        </Link>
                    </Box>
                ) : (
                    // Expanded state — capped so it never covers the chat area
                    <Box sx={{ maxHeight: 'calc(50vh - 70px)', overflowY: 'auto' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant='subtitle2'>
                                Select a model<span style={{ color: 'red' }}>&nbsp;*</span>
                            </Typography>
                            {isModelConfigured && (
                                <IconButton size='small' onClick={() => setModelExpanded(false)}>
                                    <IconChevronUp size={14} />
                                </IconButton>
                            )}
                        </Box>
                        <Dropdown
                            key={JSON.stringify(localModel)}
                            name='chatModel'
                            options={chatModelsOptions ?? []}
                            onSelect={handleModelSelect}
                            value={localModel ? localModel.name : 'choose an option'}
                        />
                        {localModel && Object.keys(localModel).length > 0 && (
                            <Box
                                sx={{
                                    p: 0,
                                    mt: 1,
                                    mb: 1,
                                    border: 1,
                                    borderColor: theme.palette.grey[900] + 25,
                                    borderRadius: 2
                                }}
                            >
                                {showHideInputParams(localModel)
                                    .filter((inputParam) => !inputParam.hidden && inputParam.display !== false)
                                    .map((inputParam, index) => (
                                        <DocStoreInputHandler
                                            key={index}
                                            inputParam={inputParam}
                                            data={localModel}
                                            onNodeDataChange={handleModelDataChange}
                                        />
                                    ))}
                            </Box>
                        )}
                    </Box>
                )}
            </Box>

            {/* Messages */}
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <PerfectScrollbar style={{ height: '100%', overflowX: 'hidden' }}>
                    <Box sx={{ p: 1, minHeight: '100%' }}>
                        {messages.length === 0 && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '200px',
                                    opacity: 0.5
                                }}
                            >
                                <IconSparkles size={40} stroke={1} />
                                <Typography variant='body2' sx={{ mt: 1 }}>
                                    Describe the agentflow you want to build
                                </Typography>
                            </Box>
                        )}
                        {messages.map((msg, index) => (
                            <AgentBuilderMessage
                                key={index}
                                message={msg}
                                onCredentialResume={handleCredentialResume}
                                onCredentialSelect={handleCredentialSelect}
                                onToolSelectionSubmit={handleToolSelectionSubmit}
                                onTestAction={handleTestAction}
                            />
                        ))}
                        <div ref={messagesEndRef} />
                    </Box>
                </PerfectScrollbar>
            </Box>

            {/* Footer */}
            <Box sx={{ borderTop: `1px solid ${theme.palette.divider}`, p: 1.5 }}>
                {/* Actions row */}
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <Button
                        size='small'
                        variant='outlined'
                        startIcon={<IconRefresh size={14} />}
                        onClick={handleNewConversation}
                        disabled={isGenerating || messages.length === 0}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                    >
                        New
                    </Button>
                    <Button
                        size='small'
                        variant='outlined'
                        startIcon={<IconArrowBackUp size={14} />}
                        onClick={undoLastChange}
                        disabled={isGenerating || !previousFlowState}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                    >
                        Undo
                    </Button>
                </Box>

                {/* Input */}
                <OutlinedInput
                    inputRef={inputRef}
                    fullWidth
                    multiline
                    maxRows={4}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isGenerating || !isModelConfigured}
                    placeholder={
                        !isModelConfigured
                            ? 'Select a model first...'
                            : isGenerating
                            ? 'Generating...'
                            : 'Describe what you want to build...'
                    }
                    size='small'
                    sx={{
                        '& .MuiOutlinedInput-input': {
                            fontSize: '0.875rem'
                        }
                    }}
                    endAdornment={
                        <InputAdornment position='end'>
                            <IconButton
                                size='small'
                                onClick={handleSend}
                                disabled={!inputValue.trim() || isGenerating || !isModelConfigured}
                                color='primary'
                            >
                                <IconSend size={18} />
                            </IconButton>
                        </InputAdornment>
                    }
                />
            </Box>
        </Drawer>
    )
}

AgentBuilderPanel.propTypes = {
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired
}

export default AgentBuilderPanel
