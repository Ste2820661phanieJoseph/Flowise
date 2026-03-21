import { StatusCodes } from 'http-status-codes'
import { v4 as uuidv4 } from 'uuid'
import { ScheduleRecord, ScheduleTriggerType } from '../../database/entities/ScheduleRecord'
import { ScheduleTriggerLog, ScheduleTriggerStatus } from '../../database/entities/ScheduleTriggerLog'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import logger from '../../utils/logger'
import { DataSource } from 'typeorm'

export interface CreateScheduleInput {
    triggerType: ScheduleTriggerType
    targetId: string
    nodeId?: string
    cronExpression: string
    timezone?: string
    enabled?: boolean
    defaultInput?: string
    endDate?: Date
    workspaceId: string
}

export interface UpdateScheduleInput {
    cronExpression?: string
    timezone?: string
    enabled?: boolean
    defaultInput?: string
    endDate?: Date | null
}

/**
 * A fallback cron expression used when the provided one is invalid,
 * to prevent the schedule from being deleted and to allow users
 * to fix the cron expression without losing the schedule record.
 * The beat will skip execution if it detects this fallback expression, and will log an error for visibility.
 */
const FALLBACK_CRON_EXPRESSION = '0 0 * * *' // daily at midnight UTC
const FALLBACK_TIMEZONE = 'UTC'

/* Schedule batch size for processing schedules in batches */
const SCHEDULE_BATCH_SIZE = 100

/**
 * Validates a cron expression and returns parsed info.
 * Uses a lightweight regex-based check without external dependencies.
 *
 * Supports standard 5-field cron: minute hour day month weekday
 */
export const validateCronExpression = (expression: string, timezone: string = 'UTC'): { valid: boolean; error?: string } => {
    if (!expression || typeof expression !== 'string') {
        return { valid: false, error: 'Cron expression must be a non-empty string' }
    }

    const trimmed = expression.trim()
    const fields = trimmed.split(/\s+/)

    if (fields.length !== 5 && fields.length !== 6) {
        return {
            valid: false,
            error: 'Cron expression must have 5 fields (minute hour day month weekday) or 6 fields (second minute hour day month weekday)'
        }
    }

    // Validate timezone
    try {
        Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
        return { valid: false, error: `Invalid timezone: ${timezone}` }
    }

    // Returns true if s is a valid integer in [min, max] or a valid range "start-end"
    const isValidRangeOrNumber = (s: string, min: number, max: number): boolean => {
        const dashIdx = s.indexOf('-')
        if (dashIdx !== -1) {
            const startStr = s.slice(0, dashIdx)
            const endStr = s.slice(dashIdx + 1)
            if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) return false
            const start = parseInt(startStr, 10)
            const end = parseInt(endStr, 10)
            return start >= min && start <= max && end >= min && end <= max && start <= end
        }
        if (!/^\d+$/.test(s)) return false
        const n = parseInt(s, 10)
        return n >= min && n <= max
    }

    // Validate a single cron field: supports *, numbers, ranges (n-m), steps (*/s, n/s, n-m/s), and comma-separated lists
    const validateCronField = (field: string, min: number, max: number): boolean => {
        const parts = field.split(',')
        if (parts.some((p) => p === '')) return false // catches leading/trailing/consecutive commas

        for (const part of parts) {
            const slashIdx = part.indexOf('/')
            if (slashIdx !== -1) {
                const base = part.slice(0, slashIdx)
                const stepStr = part.slice(slashIdx + 1)
                if (!/^\d+$/.test(stepStr)) return false
                const step = parseInt(stepStr, 10)
                if (step < 1) return false
                // Base must be *, a plain number, or a range
                if (base !== '*' && !isValidRangeOrNumber(base, min, max)) return false
            } else if (part !== '*') {
                if (!isValidRangeOrNumber(part, min, max)) return false
            }
        }
        return true
    }

    // Per-position field ranges [min, max]: minute hour day-of-month month day-of-week
    const fieldRanges: Array<[number, number]> = [
        [0, 59], // minutes (or seconds when 6-field)
        [0, 23], // hours
        [1, 31], // day of month
        [1, 12], // month
        [0, 7] // day of week (0 and 7 both represent Sunday)
    ]

    // For 6-field cron, prepend an extra seconds range (same as minutes: 0-59)
    const ranges: Array<[number, number]> = fields.length === 6 ? [[0, 59], ...fieldRanges] : fieldRanges
    for (let i = 0; i < fields.length; i++) {
        if (!validateCronField(fields[i], ranges[i][0], ranges[i][1])) {
            return { valid: false, error: `Invalid cron field at position ${i + 1}: "${fields[i]}"` }
        }
    }

    return { valid: true }
}

const createOrUpdateSchedule = async (input: CreateScheduleInput): Promise<ScheduleRecord> => {
    try {
        const appServer = getRunningExpressApp()
        const repo = appServer.AppDataSource.getRepository(ScheduleRecord)

        const validation = validateCronExpression(input.cronExpression, input.timezone ?? FALLBACK_TIMEZONE)
        const cronExpression = validation.valid ? input.cronExpression : FALLBACK_CRON_EXPRESSION
        const timezone = validation.valid ? input.timezone ?? FALLBACK_TIMEZONE : FALLBACK_TIMEZONE

        // Upsert: find existing record for this target + triggerType
        let existing = await repo.findOne({
            where: {
                targetId: input.targetId,
                triggerType: input.triggerType,
                workspaceId: input.workspaceId
            }
        })

        if (existing) {
            existing.cronExpression = cronExpression
            existing.timezone = timezone
            if (input.enabled !== undefined) existing.enabled = input.enabled
            if (input.defaultInput !== undefined) existing.defaultInput = input.defaultInput
            if (input.nodeId !== undefined) existing.nodeId = input.nodeId
            existing.endDate = input.endDate ?? null
            existing.nextRunAt = computeNextRunAt(cronExpression, timezone) ?? null
            const saved = await repo.save(existing)
            logger.debug(`[ScheduleService]: Updated schedule ${saved.id} for ${input.triggerType}:${input.targetId}`)
            return saved
        }

        const record = repo.create({
            id: uuidv4(),
            triggerType: input.triggerType,
            targetId: input.targetId,
            nodeId: input.nodeId,
            cronExpression: cronExpression,
            timezone: timezone,
            enabled: input.enabled !== undefined ? input.enabled : validation.valid, // default to enabled if valid, disabled if invalid
            defaultInput: input.defaultInput,
            endDate: input.endDate,
            nextRunAt: computeNextRunAt(cronExpression, timezone) ?? undefined,
            workspaceId: input.workspaceId
        })

        const saved = await repo.save(record)
        logger.debug(`[ScheduleService]: Created schedule ${saved.id} for ${input.triggerType}:${input.targetId}`)
        return saved
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: scheduleService.createOrUpdateSchedule - ${getErrorMessage(error)}`
        )
    }
}

/**
 * Deletes the schedule record for a given target and trigger type.
 * NOTE: The log should be retained for historical/audit purposes, even if the schedule is deleted.
 */
const deleteScheduleForTarget = async (
    targetId: string,
    triggerType: ScheduleTriggerType,
    workspaceId: string
): Promise<ScheduleRecord | void> => {
    try {
        const appServer = getRunningExpressApp()
        const repo = appServer.AppDataSource.getRepository(ScheduleRecord)
        const record = await repo.findOne({ where: { targetId, triggerType, workspaceId } })
        if (!record) return
        await repo.delete(record.id)
        logger.debug(`[ScheduleService]: Deleted schedule for ${triggerType}:${targetId}`)
        return record
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: scheduleService.deleteScheduleForTarget - ${getErrorMessage(error)}`
        )
    }
}

const getEnabledSchedulesBatch = async (skip: number = 0, take: number = SCHEDULE_BATCH_SIZE): Promise<ScheduleRecord[]> => {
    try {
        const appServer = getRunningExpressApp()
        return await appServer.AppDataSource.getRepository(ScheduleRecord).find({
            where: { enabled: true },
            order: { createdDate: 'ASC' },
            skip,
            take
        })
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: scheduleService.getEnabledSchedulesBatch - ${getErrorMessage(error)}`
        )
    }
}

// ---------------------------------------------------------------------------
// Cron field helpers (used by computeNextRunAt)
// ---------------------------------------------------------------------------
function _matchCronField(field: string, value: number, min: number): boolean {
    if (field === '*') return true
    for (const part of field.split(',')) {
        if (part.includes('/')) {
            const [rangeStr, stepStr] = part.split('/')
            const step = parseInt(stepStr, 10)
            if (isNaN(step)) continue
            if (rangeStr === '*') {
                if ((value - min) % step === 0) return true
            } else if (rangeStr.includes('-')) {
                const [start, end] = rangeStr.split('-').map(Number)
                if (value >= start && value <= end && (value - start) % step === 0) return true
            } else {
                if (value === parseInt(rangeStr, 10)) return true
            }
        } else if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number)
            if (value >= start && value <= end) return true
        } else {
            if (value === parseInt(part, 10)) return true
        }
    }
    return false
}

interface _ParsedCronFields {
    minuteField: string
    hourField: string
    domField: string
    monthField: string
    dowField: string
}

/** Parse a cron expression once so fields can be reused across many date checks. */
function _parseCronFields(expression: string): _ParsedCronFields {
    const fields = expression.trim().split(/\s+/)
    const offset = fields.length === 6 ? 1 : 0
    return {
        minuteField: fields[0 + offset],
        hourField: fields[1 + offset],
        domField: fields[2 + offset],
        monthField: fields[3 + offset],
        dowField: fields[4 + offset]
    }
}

/**
 * Check whether a pre-parsed cron matches `date`, using a pre-built Intl.DateTimeFormat for TZ conversion.
 * Both `parsed` and `fmt` should be created once outside any hot loop.
 */
function _cronMatchesParsed(parsed: _ParsedCronFields, date: Date, fmt: Intl.DateTimeFormat): boolean {
    let minute: number, hour: number, dom: number, month: number, dow: number
    try {
        const parts = fmt.formatToParts(date)
        const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
        const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
        minute = get('minute')
        hour = get('hour') % 24
        dom = get('day')
        month = get('month')
        dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayStr)
        if (dow === -1) dow = date.getUTCDay()
    } catch {
        minute = date.getUTCMinutes()
        hour = date.getUTCHours()
        dom = date.getUTCDate()
        month = date.getUTCMonth() + 1
        dow = date.getUTCDay()
    }
    const dowMatches = _matchCronField(parsed.dowField, dow, 0) || (dow === 0 && _matchCronField(parsed.dowField, 7, 0))
    return (
        _matchCronField(parsed.minuteField, minute, 0) &&
        _matchCronField(parsed.hourField, hour, 0) &&
        _matchCronField(parsed.domField, dom, 1) &&
        _matchCronField(parsed.monthField, month, 1) &&
        dowMatches
    )
}

/**
 * Computes the next Date after `after` (defaults to now) when the cron expression will fire.
 * Searches minute-by-minute, up to 1 year ahead. Returns null if no match is found.
 *
 * The Intl.DateTimeFormat instance and parsed cron fields are created once before the loop
 * to avoid repeated allocations on every iteration.
 */
export const computeNextRunAt = (cronExpression: string, timezone: string = 'UTC', after?: Date): Date | null => {
    const start = new Date(after ? after.getTime() : Date.now())
    // Snap to start of next minute so we never return the current minute
    start.setSeconds(0, 0)
    start.setMinutes(start.getMinutes() + 1)

    // Hoist allocations outside the loop
    const parsed = _parseCronFields(cronExpression)
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false
    })

    const maxIterations = 60 * 24 * 366 // up to ~1 year of minutes
    for (let i = 0; i < maxIterations; i++) {
        const candidate = new Date(start.getTime() + i * 60_000)
        if (_cronMatchesParsed(parsed, candidate, fmt)) {
            return candidate
        }
    }
    return null
}

const updateScheduleAfterRun = async (
    appDataSource: DataSource,
    scheduleRecordId: string,
    cronExpression: string,
    timezone: string = 'UTC'
): Promise<void> => {
    try {
        const lastRunAt = new Date()
        const nextRunAt = computeNextRunAt(cronExpression, timezone, lastRunAt) ?? undefined
        await appDataSource.getRepository(ScheduleRecord).update({ id: scheduleRecordId }, { lastRunAt, nextRunAt })
    } catch (error) {
        logger.error(`[ScheduleService]: updateScheduleAfterRun failed for ${scheduleRecordId}: ${getErrorMessage(error)}`)
    }
}

/**
 * Returns the current schedule record and whether it can be enabled,
 * validated against the live flowData (not the stored cron which may be a fallback).
 */
const getScheduleStatus = async (
    targetId: string,
    workspaceId: string
): Promise<{ record: ScheduleRecord | null; canEnable: boolean; reason?: string }> => {
    try {
        const appServer = getRunningExpressApp()
        const record = await appServer.AppDataSource.getRepository(ScheduleRecord).findOne({
            where: { targetId, triggerType: ScheduleTriggerType.AGENTFLOW, workspaceId }
        })

        const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOne({
            where: { id: targetId, workspaceId }
        })
        if (!chatflow?.flowData) {
            return { record, canEnable: false, reason: 'Flow not found or has no data' }
        }

        try {
            const parsedFlowData = JSON.parse(chatflow.flowData)
            const startNode = (parsedFlowData.nodes || []).find((n: any) => n.data?.name === 'startAgentflow')
            if (!startNode || startNode.data?.inputs?.startInputType !== 'scheduleInput') {
                return { record, canEnable: false, reason: 'Flow is not configured as a scheduled flow' }
            }

            const inputs = startNode.data.inputs as Record<string, any>
            const cronResult = resolveScheduleCron(inputs)
            if (!cronResult.valid) {
                return { record, canEnable: false, reason: cronResult.error || 'Invalid cron expression or timezone' }
            }

            // endDate must be in the future if set
            const endDateValue = inputs.scheduleEndDate || record?.endDate
            if (endDateValue) {
                const endDate = new Date(endDateValue)
                if (isNaN(endDate.getTime())) {
                    return { record, canEnable: false, reason: 'Invalid end date' }
                }
                if (endDate <= new Date()) {
                    return { record, canEnable: false, reason: 'End date is in the past' }
                }
            }

            // defaultInput is required for cron-based schedules since there is no user to provide a question at runtime
            const isDefaultInputValidResult = isDefaultInputValid(inputs.scheduleDefaultInput ?? record?.defaultInput)
            if (!isDefaultInputValidResult) {
                return { record, canEnable: false, reason: 'Default input is required to enable schedule' }
            }

            return { record, canEnable: true }
        } catch {
            return { record, canEnable: false, reason: 'Could not parse flow data' }
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: scheduleService.getScheduleStatus - ${getErrorMessage(error)}`
        )
    }
}

/**
 * Toggles the enabled state of a schedule record.
 * When enabling, validates the schedule config first.
 * Caller is responsible for notifying ScheduleBeat after this returns.
 */
const toggleScheduleEnabled = async (targetId: string, workspaceId: string, enabled: boolean): Promise<ScheduleRecord> => {
    try {
        const appServer = getRunningExpressApp()
        const repo = appServer.AppDataSource.getRepository(ScheduleRecord)
        const record = await repo.findOne({
            where: { targetId, triggerType: ScheduleTriggerType.AGENTFLOW, workspaceId }
        })
        if (!record) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'No schedule record found for this flow')
        }

        if (enabled) {
            const status = await getScheduleStatus(targetId, workspaceId)
            if (!status.canEnable) {
                throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, status.reason || 'Cannot enable schedule: invalid configuration')
            }
        }

        record.enabled = enabled
        const saved = await repo.save(record)
        logger.debug(`[ScheduleService]: Schedule ${record.id} toggled to ${enabled ? 'enabled' : 'disabled'}`)
        return saved
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: scheduleService.toggleScheduleEnabled - ${getErrorMessage(error)}`
        )
    }
}

// ─── Log functions ─────────────────────────────────────────────────────────────

const createTriggerLog = async (data: {
    appDataSource: DataSource
    scheduleRecordId: string
    triggerType: ScheduleTriggerType
    targetId: string
    status: ScheduleTriggerStatus
    scheduledAt: Date
    workspaceId: string
    executionId?: string
    error?: string
    elapsedTimeMs?: number
}): Promise<ScheduleTriggerLog> => {
    try {
        const repo = data.appDataSource.getRepository(ScheduleTriggerLog)
        const log = repo.create({
            id: uuidv4(),
            ...data
        })
        return await repo.save(log)
    } catch (error) {
        logger.error(`[ScheduleService]: createTriggerLog failed: ${getErrorMessage(error)}`)
        throw error
    }
}

const updateTriggerLog = async (
    appDataSource: DataSource,
    logId: string,
    update: { status: ScheduleTriggerStatus; error?: string; elapsedTimeMs?: number; executionId?: string }
): Promise<void> => {
    try {
        await appDataSource.getRepository(ScheduleTriggerLog).update({ id: logId }, update)
    } catch (error) {
        logger.error(`[ScheduleService]: updateTriggerLog failed for ${logId}: ${getErrorMessage(error)}`)
    }
}

// ─── Visual Picker helpers ──────────────────────────────────────────────────

export interface VisualPickerInput {
    scheduleFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly'
    scheduleOnMinute?: string | number
    scheduleOnTime?: string // "HH:mm"
    scheduleOnDayOfWeek?: string // comma-separated "1,3,5" (1=Mon … 7=Sun)
    scheduleOnDayOfMonth?: string // comma-separated "1,15"
}

/**
 * Validate the visual-picker fields and return errors (if any).
 */
export const validateVisualPickerFields = (input: VisualPickerInput): { valid: boolean; error?: string } => {
    const { scheduleFrequency, scheduleOnMinute, scheduleOnTime, scheduleOnDayOfWeek, scheduleOnDayOfMonth } = input

    if (!scheduleFrequency) {
        return { valid: false, error: 'Frequency is required' }
    }
    if (!['hourly', 'daily', 'weekly', 'monthly'].includes(scheduleFrequency)) {
        return { valid: false, error: `Invalid frequency: ${scheduleFrequency}` }
    }

    if (scheduleFrequency === 'hourly') {
        const minute = Number(scheduleOnMinute)
        if (scheduleOnMinute === undefined || scheduleOnMinute === '' || isNaN(minute)) {
            return { valid: false, error: 'On Minute is required for hourly frequency' }
        }
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
            return { valid: false, error: 'On Minute must be an integer between 0 and 59' }
        }
    }

    if (['daily', 'weekly', 'monthly'].includes(scheduleFrequency)) {
        if (!scheduleOnTime) {
            return { valid: false, error: 'On Time is required for daily/weekly/monthly frequency' }
        }
        if (!/^\d{2}:\d{2}$/.test(scheduleOnTime)) {
            return { valid: false, error: 'On Time must be in HH:mm format' }
        }
        const [h, m] = scheduleOnTime.split(':').map(Number)
        if (h < 0 || h > 23 || m < 0 || m > 59) {
            return { valid: false, error: 'On Time contains out-of-range values' }
        }
    }

    if (scheduleFrequency === 'weekly') {
        if (!scheduleOnDayOfWeek) {
            return { valid: false, error: 'On Day of Week is required for weekly frequency' }
        }
        const days = scheduleOnDayOfWeek
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d !== '')
        for (const d of days) {
            const n = Number(d)
            if (isNaN(n) || !Number.isInteger(n) || n < 0 || n > 7) {
                return { valid: false, error: `Invalid day of week value: ${d} (expected 0-7)` }
            }
        }
    }

    if (scheduleFrequency === 'monthly') {
        if (!scheduleOnDayOfMonth) {
            return { valid: false, error: 'On Day of Month is required for monthly frequency' }
        }
        const days = scheduleOnDayOfMonth
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d !== '')
        for (const d of days) {
            const n = Number(d)
            if (isNaN(n) || !Number.isInteger(n) || n < 1 || n > 31) {
                return { valid: false, error: `Invalid day of month value: ${d} (expected 1-31)` }
            }
        }
    }

    return { valid: true }
}

/**
 * Convert visual-picker fields into a standard 5-field cron expression.
 * Assumes fields have already been validated via validateVisualPickerFields.
 */
export const buildCronFromVisualPicker = (input: VisualPickerInput): string => {
    const { scheduleFrequency, scheduleOnMinute, scheduleOnTime, scheduleOnDayOfWeek, scheduleOnDayOfMonth } = input

    switch (scheduleFrequency) {
        case 'hourly': {
            // "<minute> * * * *"
            return `${Number(scheduleOnMinute)} * * * *`
        }
        case 'daily': {
            const [h, m] = scheduleOnTime!.split(':').map(Number)
            return `${m} ${h} * * *`
        }
        case 'weekly': {
            const [h, m] = scheduleOnTime!.split(':').map(Number)
            return `${m} ${h} * * ${scheduleOnDayOfWeek}`
        }
        case 'monthly': {
            const [h, m] = scheduleOnTime!.split(':').map(Number)
            return `${m} ${h} ${scheduleOnDayOfMonth} * *`
        }
        default:
            throw new Error(`Unsupported frequency: ${scheduleFrequency}`)
    }
}

/**
 * Unified helper: resolves the cron expression from a Start node's inputs,
 * handling both "cronExpression" and "visualPicker" schedule types.
 * Returns { valid, cronExpression?, error? }.
 */
export const resolveScheduleCron = (inputs: Record<string, any>): { valid: boolean; cronExpression?: string; error?: string } => {
    const scheduleType = (inputs.scheduleType as string) || 'cronExpression'
    const timezone = (inputs.scheduleTimezone as string) || 'UTC'

    if (scheduleType === 'visualPicker') {
        const pickerInput: VisualPickerInput = {
            scheduleFrequency: inputs.scheduleFrequency,
            scheduleOnMinute: inputs.scheduleOnMinute,
            scheduleOnTime: inputs.scheduleOnTime,
            scheduleOnDayOfWeek: inputs.scheduleOnDayOfWeek,
            scheduleOnDayOfMonth: inputs.scheduleOnDayOfMonth
        }
        const pickerResult = validateVisualPickerFields(pickerInput)
        if (!pickerResult.valid) {
            return { valid: false, error: pickerResult.error }
        }
        const cron = buildCronFromVisualPicker(pickerInput)
        // Also validate the resulting cron + timezone
        const cronResult = validateCronExpression(cron, timezone)
        if (!cronResult.valid) {
            return { valid: false, error: cronResult.error }
        }
        return { valid: true, cronExpression: cron }
    }

    // scheduleType === 'cronExpression'
    const expression = inputs.scheduleCronExpression as string
    const cronResult = validateCronExpression(expression, timezone)
    if (!cronResult.valid) {
        return { valid: false, error: cronResult.error }
    }
    return { valid: true, cronExpression: expression }
}

/**
 * Checks if the schedule can be enabled based on its inputs.
 * It is used to determine the initial enabled state when creating/updating a schedule, and also to validate when toggling enabled state.
 * Besides, the worker skips execution of schedules that are not valid.
 */
export const isDefaultInputValid = (defaultInput: string | undefined): boolean => {
    return !!defaultInput && defaultInput !== '<p></p>' // rich text empty value
}

/**
 * Determines if a schedule can be enabled based on its inputs, including the cron expression, end date, and default input.
 */
export const canScheduleEnable = (inputs: Record<string, any>): boolean => {
    const cronResult = resolveScheduleCron(inputs)
    const isEndDateValid = !inputs.scheduleEndDate || new Date(inputs.scheduleEndDate) > new Date()
    const isInputValid = isDefaultInputValid(inputs.scheduleDefaultInput)
    return cronResult.valid && isEndDateValid && isInputValid
}

export default {
    validateCronExpression,
    validateVisualPickerFields,
    buildCronFromVisualPicker,
    resolveScheduleCron,
    createOrUpdateSchedule,
    deleteScheduleForTarget,
    getEnabledSchedulesBatch,
    updateScheduleAfterRun,
    computeNextRunAt,
    createTriggerLog,
    updateTriggerLog,
    getScheduleStatus,
    toggleScheduleEnabled,
    isDefaultInputValid,
    canScheduleEnable
}
