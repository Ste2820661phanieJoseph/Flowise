import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import moment from 'moment'

// material-ui
import {
    Box,
    Paper,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography
} from '@mui/material'
import { useTheme, styled } from '@mui/material/styles'
import { tableCellClasses } from '@mui/material/TableCell'
import { useSelector } from 'react-redux'

// project imports
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import MainCard from '@/ui-component/cards/MainCard'
import ItemCard from '@/ui-component/cards/ItemCard'
import { baseURL, gridSpacing } from '@/store/constant'
import AssistantEmptySVG from '@/assets/images/assistant_empty.svg'
import ErrorBoundary from '@/ErrorBoundary'
import { StyledPermissionButton } from '@/ui-component/button/RBACButtons'
import AgentListMenu from '@/ui-component/button/AgentListMenu'
import ConfirmDialog from '@/ui-component/dialog/ConfirmDialog'

// API
import chatflowsApi from '@/api/chatflows'

// Hooks
import useApi from '@/hooks/useApi'

// icons
import { IconPlus, IconLayoutGrid, IconList } from '@tabler/icons-react'

// ==============================|| HELPERS ||============================== //

// Extract agent info from chatflow's flowData
const parseAgentFromFlowData = (agent) => {
    try {
        if (!agent.flowData) return { name: agent.name, instruction: '', modelName: '' }
        const flowData = JSON.parse(agent.flowData)
        const agentNode = flowData.nodes?.find((n) => n.data?.name === 'agentAgentflow')
        if (agentNode) {
            const inputs = agentNode.data?.inputs || {}
            const instruction = inputs.agentMessages?.[0]?.content || ''
            const modelName = inputs.agentModel || ''
            return { name: agent.name, instruction, modelName }
        }
        // Old format: try toolAgent node
        const toolAgentNode = flowData.nodes?.find((n) => n.data?.name === 'toolAgent')
        if (toolAgentNode) {
            const instruction = toolAgentNode.data?.inputs?.systemMessage || ''
            const chatModelNode = flowData.nodes?.find((n) => n.data?.category === 'Chat Models')
            const modelName = chatModelNode?.data?.name || ''
            return { name: agent.name, instruction, modelName }
        }
        return { name: agent.name, instruction: '', modelName: '' }
    } catch {
        return { name: agent.name || 'Untitled', instruction: '', modelName: '' }
    }
}

// ==============================|| STYLED TABLE COMPONENTS ||============================== //

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,

    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}))

const StyledTableRow = styled(TableRow)(() => ({
    '&:last-child td, &:last-child th': {
        border: 0
    }
}))

// ==============================|| AGENTS ||============================== //

const Agents = () => {
    const navigate = useNavigate()
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)

    const getAllAgentsApi = useApi(chatflowsApi.getAllAgentflows)

    const [isLoading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [agents, setAgents] = useState([])

    const [search, setSearch] = useState('')
    const [view, setView] = useState(localStorage.getItem('agentDisplayStyle') || 'card')
    const [order, setOrder] = useState(localStorage.getItem('agent_order') || 'desc')
    const [orderBy, setOrderBy] = useState(localStorage.getItem('agent_orderBy') || 'updatedDate')

    const onSearchChange = (event) => {
        setSearch(event.target.value)
    }

    const handleChange = (event, nextView) => {
        if (nextView === null) return
        localStorage.setItem('agentDisplayStyle', nextView)
        setView(nextView)
    }

    const handleRequestSort = (property) => {
        const isAsc = orderBy === property && order === 'asc'
        const newOrder = isAsc ? 'desc' : 'asc'
        setOrder(newOrder)
        setOrderBy(property)
        localStorage.setItem('agent_order', newOrder)
        localStorage.setItem('agent_orderBy', property)
    }

    const addNew = () => {
        navigate('/agents/new')
    }

    function filterAgents(agent) {
        if (!search) return true
        return agent.name && agent.name.toLowerCase().indexOf(search.toLowerCase()) > -1
    }

    const getImages = (agent) => {
        const images = []
        const parsed = parseAgentFromFlowData(agent)
        if (parsed.modelName) {
            images.push({ imageSrc: `${baseURL}/api/v1/node-icon/${parsed.modelName}` })
        }
        return images
    }

    const getInstruction = (agent) => {
        return parseAgentFromFlowData(agent).instruction
    }

    const getModelName = (agent) => {
        return parseAgentFromFlowData(agent).modelName
    }

    const getSortedData = (data) => {
        if (!data) return []
        return [...data].filter(filterAgents).sort((a, b) => {
            if (orderBy === 'name') {
                return order === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')
            } else if (orderBy === 'updatedDate') {
                return order === 'asc'
                    ? new Date(a.updatedDate) - new Date(b.updatedDate)
                    : new Date(b.updatedDate) - new Date(a.updatedDate)
            }
            return 0
        })
    }

    const refreshAgents = () => {
        getAllAgentsApi.request('AGENT')
    }

    useEffect(() => {
        refreshAgents()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        setLoading(getAllAgentsApi.loading)
    }, [getAllAgentsApi.loading])

    useEffect(() => {
        if (getAllAgentsApi.error) setError(getAllAgentsApi.error)
    }, [getAllAgentsApi.error])

    // Set agents from chatflows API (returns both ASSISTANT and AGENT types)
    useEffect(() => {
        const agentList = getAllAgentsApi.data?.data || getAllAgentsApi.data || []
        setAgents(agentList)
    }, [getAllAgentsApi.data])

    const total = agents.length

    return (
        <>
            <MainCard>
                {error ? (
                    <ErrorBoundary error={error} />
                ) : (
                    <Stack flexDirection='column' sx={{ gap: 3 }}>
                        <ViewHeader
                            onSearchChange={onSearchChange}
                            search={true}
                            searchPlaceholder='Search Agents'
                            title='Agents'
                            description='Create agent that can interact and perform tasks autonomously'
                        >
                            <ToggleButtonGroup
                                sx={{ borderRadius: 2, maxHeight: 40 }}
                                value={view}
                                color='primary'
                                disabled={total === 0}
                                exclusive
                                onChange={handleChange}
                            >
                                <ToggleButton
                                    sx={{
                                        borderColor: theme.palette.grey[900] + 25,
                                        borderRadius: 2,
                                        color: theme?.customization?.isDarkMode ? 'white' : 'inherit'
                                    }}
                                    variant='contained'
                                    value='card'
                                    title='Card View'
                                >
                                    <IconLayoutGrid />
                                </ToggleButton>
                                <ToggleButton
                                    sx={{
                                        borderColor: theme.palette.grey[900] + 25,
                                        borderRadius: 2,
                                        color: theme?.customization?.isDarkMode ? 'white' : 'inherit'
                                    }}
                                    variant='contained'
                                    value='list'
                                    title='List View'
                                >
                                    <IconList />
                                </ToggleButton>
                            </ToggleButtonGroup>
                            <StyledPermissionButton
                                permissionId={'agents:create'}
                                variant='contained'
                                sx={{ borderRadius: 2, height: 40 }}
                                onClick={addNew}
                                startIcon={<IconPlus />}
                            >
                                Add New
                            </StyledPermissionButton>
                        </ViewHeader>

                        {isLoading && (
                            <Box display='grid' gridTemplateColumns='repeat(3, 1fr)' gap={gridSpacing}>
                                <Skeleton variant='rounded' height={160} />
                                <Skeleton variant='rounded' height={160} />
                                <Skeleton variant='rounded' height={160} />
                            </Box>
                        )}
                        {!isLoading && total > 0 && (
                            <>
                                {!view || view === 'card' ? (
                                    <Box display='grid' gridTemplateColumns='repeat(3, 1fr)' gap={gridSpacing}>
                                        {agents.filter(filterAgents).map((agent, index) => (
                                            <ItemCard
                                                data={{
                                                    name: agent.name,
                                                    description: getInstruction(agent)
                                                }}
                                                images={getImages(agent)}
                                                key={index}
                                                onClick={() => navigate(`/agents/${agent.id}`)}
                                            />
                                        ))}
                                    </Box>
                                ) : (
                                    <TableContainer
                                        sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }}
                                        component={Paper}
                                    >
                                        <Table sx={{ minWidth: 650 }} size='small' aria-label='agents table'>
                                            <TableHead
                                                sx={{
                                                    backgroundColor: customization.isDarkMode
                                                        ? theme.palette.common.black
                                                        : theme.palette.grey[100],
                                                    height: 56
                                                }}
                                            >
                                                <TableRow>
                                                    <StyledTableCell style={{ width: '30%' }}>
                                                        <TableSortLabel
                                                            active={orderBy === 'name'}
                                                            direction={order}
                                                            onClick={() => handleRequestSort('name')}
                                                        >
                                                            Name
                                                        </TableSortLabel>
                                                    </StyledTableCell>
                                                    <StyledTableCell style={{ width: '10%' }}>Model</StyledTableCell>
                                                    <StyledTableCell style={{ width: '35%' }}>Instruction</StyledTableCell>
                                                    <StyledTableCell style={{ width: '15%' }}>
                                                        <TableSortLabel
                                                            active={orderBy === 'updatedDate'}
                                                            direction={order}
                                                            onClick={() => handleRequestSort('updatedDate')}
                                                        >
                                                            Last Modified
                                                        </TableSortLabel>
                                                    </StyledTableCell>
                                                    <StyledTableCell style={{ width: '10%' }}>Actions</StyledTableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {getSortedData(agents).map((agent, index) => {
                                                    const images = getImages(agent)
                                                    return (
                                                        <StyledTableRow
                                                            key={index}
                                                            sx={{
                                                                cursor: 'pointer',
                                                                '&:hover': { backgroundColor: theme.palette.action.hover }
                                                            }}
                                                            onClick={() => navigate(`/agents/${agent.id}`)}
                                                        >
                                                            <StyledTableCell>
                                                                <Tooltip title={agent.name || ''}>
                                                                    <Typography
                                                                        sx={{
                                                                            display: '-webkit-box',
                                                                            fontSize: 14,
                                                                            fontWeight: 500,
                                                                            WebkitLineClamp: 2,
                                                                            WebkitBoxOrient: 'vertical',
                                                                            textOverflow: 'ellipsis',
                                                                            overflow: 'hidden',
                                                                            color: '#2196f3'
                                                                        }}
                                                                    >
                                                                        {agent.name || 'Untitled'}
                                                                    </Typography>
                                                                </Tooltip>
                                                            </StyledTableCell>
                                                            <StyledTableCell>
                                                                {images.length > 0 && (
                                                                    <Tooltip title={getModelName(agent) || ''}>
                                                                        <Box
                                                                            sx={{
                                                                                width: 30,
                                                                                height: 30,
                                                                                borderRadius: '50%',
                                                                                backgroundColor: customization.isDarkMode
                                                                                    ? theme.palette.common.white
                                                                                    : theme.palette.grey[300] + 75
                                                                            }}
                                                                        >
                                                                            <img
                                                                                style={{
                                                                                    width: '100%',
                                                                                    height: '100%',
                                                                                    padding: 5,
                                                                                    objectFit: 'contain'
                                                                                }}
                                                                                alt=''
                                                                                src={images[0].imageSrc}
                                                                            />
                                                                        </Box>
                                                                    </Tooltip>
                                                                )}
                                                            </StyledTableCell>
                                                            <StyledTableCell>
                                                                <Typography
                                                                    sx={{
                                                                        display: '-webkit-box',
                                                                        fontSize: 14,
                                                                        WebkitLineClamp: 2,
                                                                        WebkitBoxOrient: 'vertical',
                                                                        textOverflow: 'ellipsis',
                                                                        overflow: 'hidden',
                                                                        color: theme.palette.text.secondary
                                                                    }}
                                                                >
                                                                    {getInstruction(agent) || ''}
                                                                </Typography>
                                                            </StyledTableCell>
                                                            <StyledTableCell>
                                                                <Typography sx={{ fontSize: 14 }}>
                                                                    {moment(agent.updatedDate).format('MMMM D, YYYY')}
                                                                </Typography>
                                                            </StyledTableCell>
                                                            <StyledTableCell onClick={(e) => e.stopPropagation()}>
                                                                <AgentListMenu
                                                                    agent={agent}
                                                                    setError={setError}
                                                                    onRefresh={refreshAgents}
                                                                />
                                                            </StyledTableCell>
                                                        </StyledTableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                )}
                            </>
                        )}
                        {!isLoading && total === 0 && (
                            <Stack sx={{ alignItems: 'center', justifyContent: 'center' }} flexDirection='column'>
                                <Box sx={{ p: 2, height: 'auto' }}>
                                    <img
                                        style={{ objectFit: 'cover', height: '20vh', width: 'auto' }}
                                        src={AssistantEmptySVG}
                                        alt='AssistantEmptySVG'
                                    />
                                </Box>
                                <div>No Agents Added Yet</div>
                            </Stack>
                        )}
                    </Stack>
                )}
            </MainCard>
            <ConfirmDialog />
        </>
    )
}

export default Agents
