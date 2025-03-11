/***********************************************
 * FILE: schedulable-rules.ts
 * CREATED: 2025-03-11 03:16:11
 *
 * CHANGELOG:
 * - 2025-03-11 03:16:11: (Schedulable Rules - Implementation) Initial implementation with parseTimeInterval, SchedulableRule interface, and SchedulableRulesManager class
 * - 2025-03-11 03:16:58: (Schedulable Rules - Implementation) Fixed TypeScript errors related to imports and type annotations
 *
 * PURPOSE:
 * This file handles loading and management of time-based rule files (.clinerules-5m, etc.)
 * that are executed on a schedule and appended to the system prompt.
 *
 * METHODS:
 * - parseTimeInterval(): Parses time intervals from filenames
 * - SchedulableRulesManager.constructor(): Initializes a new rules manager
 * - SchedulableRulesManager.resetAllRules(): Resets all rule execution times
 * - SchedulableRulesManager.loadSchedulableRules(): Loads all schedulable rules from a directory
 * - SchedulableRulesManager.shouldExecuteRule(): Checks if a rule should be executed
 * - SchedulableRulesManager.markRuleAsExecuted(): Marks a rule as executed
 * - SchedulableRulesManager.getExecutableRules(): Gets rules that should be executed
 * - SchedulableRulesManager.getAllRules(): Gets all rules with their status for UI display
 ***********************************************/

import * as path from "path"
import * as fs from "fs/promises"
import { logger } from "../../../utils/logging"

/**
 * Interface representing a schedulable rule
 */
export interface SchedulableRule {
	filePath: string
	fileName: string
	interval: number // in milliseconds
	timeUnit: string // 's', 'm', 'h', 'd'
	displayInterval: string // Human readable (e.g., "5 minutes")
	content: string
	lastExecuted: number
}

/**
 * Time unit conversion mapping
 */
const TIME_UNITS = {
	s: { ms: 1000, name: "second" },
	m: { ms: 60 * 1000, name: "minute" },
	h: { ms: 60 * 60 * 1000, name: "hour" },
	d: { ms: 24 * 60 * 60 * 1000, name: "day" },
} as const

type TimeUnit = keyof typeof TIME_UNITS

/**
 * Parse time component from file name (e.g., "5m" => 300000ms)
 * @param timeStr - The time string to parse (e.g., "5m", "10s", "1h", "1d")
 * @returns Object containing the interval in milliseconds, unit, and display string
 * @throws Error if the time format is invalid
 */
export function parseTimeInterval(timeStr: string): { interval: number; unit: string; display: string } {
	// Match pattern like "5m", "10s", "1h", "1d"
	const match = timeStr.match(/^(\d+)([smhd])$/)
	if (!match) {
		throw new Error(`Invalid time format: ${timeStr}. Expected format: e.g., "5m", "10s", "1h", "1d"`)
	}

	const value = parseInt(match[1], 10)
	const unit = match[2] as TimeUnit

	const intervalMs = value * TIME_UNITS[unit].ms
	const unitName = TIME_UNITS[unit].name
	const display = `${value} ${unitName}${value !== 1 ? "s" : ""}`

	return {
		interval: intervalMs,
		unit,
		display,
	}
}

/**
 * Manager for schedulable rule files
 */
export class SchedulableRulesManager {
	private lastExecutionTimes: Map<string, number> = new Map()

	/**
	 * Create a new SchedulableRulesManager
	 */
	constructor() {
		this.resetAllRules()
		logger.info("SchedulableRulesManager initialized")
	}

	/**
	 * Reset all rule execution times
	 */
	public resetAllRules(): void {
		this.lastExecutionTimes.clear()
		logger.debug("All schedulable rules reset")
	}

	/**
	 * Load all schedulable rules from a directory
	 * @param cwd - The current working directory
	 * @returns Promise resolving to an array of SchedulableRule objects
	 */
	public async loadSchedulableRules(cwd: string): Promise<SchedulableRule[]> {
		try {
			logger.debug(`Loading schedulable rules from: ${cwd}`)
			const files = await fs.readdir(cwd)

			// Filter for files matching the pattern .clinerules-\d+[smhd]
			const ruleFiles = files.filter((file: string) => /^\.clinerules-\d+[smhd]$/.test(file))
			logger.debug(`Found ${ruleFiles.length} schedulable rule files`)

			const rules: SchedulableRule[] = []

			for (const file of ruleFiles) {
				try {
					const filePath = path.join(cwd, file)
					const content = await fs.readFile(filePath, "utf-8")

					// Extract the time component (e.g., "5m" from ".clinerules-5m")
					const timeComponent = file.replace(/^\.clinerules-/, "")
					const { interval, unit, display } = parseTimeInterval(timeComponent)

					rules.push({
						filePath,
						fileName: file,
						interval,
						timeUnit: unit,
						displayInterval: display,
						content: content.trim(),
						lastExecuted: this.lastExecutionTimes.get(file) || 0,
					})

					logger.debug(`Loaded rule file: ${file}, interval: ${display}`)
				} catch (err) {
					logger.error(`Failed to parse schedulable rule file ${file}:`, err)
				}
			}

			return rules
		} catch (err) {
			logger.error("Failed to load schedulable rules:", err)
			return []
		}
	}

	/**
	 * Check if a rule should be executed based on its interval
	 * @param rule - The rule to check
	 * @returns True if the rule should be executed, false otherwise
	 */
	public shouldExecuteRule(rule: SchedulableRule): boolean {
		const now = Date.now()
		const lastExecution = this.lastExecutionTimes.get(rule.fileName) || 0
		const shouldExecute = now - lastExecution >= rule.interval

		if (shouldExecute) {
			logger.debug(
				`Rule ${rule.fileName} should be executed (last executed: ${new Date(lastExecution).toISOString()})`,
			)
		}

		return shouldExecute
	}

	/**
	 * Mark a rule as executed
	 * @param rule - The rule to mark as executed
	 */
	public markRuleAsExecuted(rule: SchedulableRule): void {
		const now = Date.now()
		this.lastExecutionTimes.set(rule.fileName, now)
		logger.info(`Rule ${rule.fileName} marked as executed at ${new Date(now).toISOString()}`)
	}

	/**
	 * Get rules that should be executed
	 * @param cwd - The current working directory
	 * @returns Promise resolving to an array of rules that should be executed
	 */
	public async getExecutableRules(cwd: string): Promise<SchedulableRule[]> {
		const rules = await this.loadSchedulableRules(cwd)
		const executableRules = rules.filter((rule) => this.shouldExecuteRule(rule))
		logger.debug(`Found ${executableRules.length} executable rules out of ${rules.length} total rules`)
		return executableRules
	}

	/**
	 * Get all rules with their status (for UI display)
	 * @param cwd - The current working directory
	 * @returns Promise resolving to an array of rules with next execution time
	 */
	public async getAllRules(cwd: string): Promise<Array<SchedulableRule & { nextExecution: number }>> {
		const rules = await this.loadSchedulableRules(cwd)
		const now = Date.now()

		return rules.map((rule) => {
			const lastExecution = this.lastExecutionTimes.get(rule.fileName) || 0
			const nextExecution = lastExecution + rule.interval
			const timeRemaining = Math.max(0, nextExecution - now)

			return {
				...rule,
				lastExecuted: lastExecution,
				nextExecution: timeRemaining,
			}
		})
	}
}
