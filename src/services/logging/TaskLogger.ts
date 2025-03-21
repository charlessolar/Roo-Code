import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { ClineMessage } from "../../shared/ExtensionMessage"
import { TokenUsage } from "../../exports/roo-code"

/**
 * Represents a log entry in the task log file
 */
interface TaskLogEntry {
	timestamp: number
	sessionId: string
	type: "user_input" | "ai_response" | "ai_thinking" | "new_task" | "cost_update" | "mode_switch"
	content: string
	cost?: number
	parentSessionId?: string
	mode?: string
}

/**
 * Service for logging task interactions to a persistent file
 * Captures user inputs, AI responses, session details, and cost information
 */
export class TaskLogger {
	private logFilePath: string
	private sessionId: string
	private parentSessionId?: string
	private rootSessionId?: string
	private totalCost: number = 0
	private isFirstPrompt: boolean = true
	private ready: boolean = false
	private currentMode: string = "default"
	private lastResponseTimestamp: number = 0
	private responseBuffer: string = ""
	private thinkingBuffer: string = ""

	/**
	 * Creates a new TaskLogger for a specific task
	 * @param taskId The unique ID of the task to log
	 * @param workspacePath The path to the current workspace
	 * @param parentLogger Optional parent logger for subtasks
	 */
	constructor(
		private readonly taskId: string,
		private readonly workspacePath: string,
		private readonly parentLogger?: TaskLogger,
	) {
		this.sessionId = taskId

		if (parentLogger) {
			this.parentSessionId = parentLogger.sessionId
			this.rootSessionId = parentLogger.rootSessionId || parentLogger.sessionId
		} else {
			this.rootSessionId = taskId
		}

		// Create log file path using the root session ID to group all related tasks
		const rootId = this.rootSessionId || this.sessionId
		this.logFilePath = path.join(workspacePath, ".roo-logs", `${rootId}.log`)
	}

	/**
	 * Initializes the logger, ensuring the log directory exists
	 */
	public async initialize(): Promise<void> {
		try {
			// Create logs directory if it doesn't exist
			const logsDir = path.dirname(this.logFilePath)
			await fs.mkdir(logsDir, { recursive: true })
			this.ready = true
		} catch (error) {
			console.error(`Error initializing TaskLogger: ${error}`)
		}
	}

	/**
	 * Logs a user input/prompt to the log file
	 * @param prompt The user's input text
	 */
	public async logUserInput(prompt: string): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		const entry: TaskLogEntry = {
			timestamp: Date.now(),
			sessionId: this.sessionId,
			type: "user_input",
			content: prompt,
			mode: this.currentMode,
		}

		if (this.isFirstPrompt) {
			this.isFirstPrompt = false
		}

		await this.writeLogEntry(entry)
	}

	/**
	 * Logs an AI response to the log file
	 * @param response The AI's response text
	 */
	public async logAIResponse(response: string): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		// If we received a response within the last 1 second, consider it a streaming update
		const now = Date.now()
		if (now - this.lastResponseTimestamp < 10000) {
			// Accumulate to buffer
			this.responseBuffer += response
			return
		} else {
			// New response or enough time has passed, log the complete buffer if any
			if (this.responseBuffer) {
				const completeResponse = this.responseBuffer + response
				this.responseBuffer = ""

				const entry: TaskLogEntry = {
					timestamp: now,
					sessionId: this.sessionId,
					type: "ai_response",
					content: completeResponse,
					mode: this.currentMode,
				}

				await this.writeLogEntry(entry)
			} else {
				// No previous buffer, log as new response
				const entry: TaskLogEntry = {
					timestamp: now,
					sessionId: this.sessionId,
					type: "ai_response",
					content: response,
					mode: this.currentMode,
				}

				await this.writeLogEntry(entry)
			}
		}

		this.lastResponseTimestamp = now
	}

	/**
	 * Logs an AI thinking process to the log file
	 * @param thinking The AI's thinking/reasoning text
	 */
	public async logAIThinking(thinking: string): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		// If we received a thinking within the last 1 second, consider it a streaming update
		const now = Date.now()
		if (now - this.lastResponseTimestamp < 10000) {
			// Accumulate to buffer
			this.thinkingBuffer += thinking
			return
		} else {
			// New thinking or enough time has passed, log the complete buffer if any
			if (this.thinkingBuffer) {
				const completeThinking = this.thinkingBuffer + thinking
				this.thinkingBuffer = ""

				const entry: TaskLogEntry = {
					timestamp: now,
					sessionId: this.sessionId,
					type: "ai_thinking",
					content: completeThinking,
					mode: this.currentMode,
				}

				await this.writeLogEntry(entry)
			} else {
				// No previous buffer, log as new thinking
				const entry: TaskLogEntry = {
					timestamp: now,
					sessionId: this.sessionId,
					type: "ai_thinking",
					content: thinking,
					mode: this.currentMode,
				}

				await this.writeLogEntry(entry)
			}
		}

		this.lastResponseTimestamp = now
	}

	/**
	 * Logs the creation of a new task/subtask
	 * @param slug The mode slug for the new task
	 * @param prompt The initial prompt for the new task
	 * @param newTaskId The ID of the new task
	 */
	public async logNewTask(slug: string, prompt: string, newTaskId: string): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		// Format exactly as specified in the requirements
		const formattedContent = `INFO: (Cost: $${this.totalCost.toFixed(2)}) [${newTaskId}] new_task - ${slug} - ${prompt}`

		const entry: TaskLogEntry = {
			timestamp: Date.now(),
			sessionId: this.sessionId,
			type: "new_task",
			content: formattedContent,
			cost: this.totalCost,
			parentSessionId: this.parentSessionId,
			mode: this.currentMode,
		}

		await this.writeLogEntry(entry)
	}

	/**
	 * Updates and logs the current cost of the session
	 * @param usage The token usage information including cost
	 */
	public async updateCost(usage: TokenUsage): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		// Only log if the cost has actually changed
		if (this.totalCost !== usage.totalCost) {
			const previousCost = this.totalCost
			this.totalCost = usage.totalCost

			const entry: TaskLogEntry = {
				timestamp: Date.now(),
				sessionId: this.sessionId,
				type: "cost_update",
				content: `Cost updated: $${this.totalCost.toFixed(2)} (previous: $${previousCost.toFixed(2)})`,
				cost: this.totalCost,
				mode: this.currentMode,
			}

			await this.writeLogEntry(entry)
		} else {
			// Just update the internal cost without logging
			this.totalCost = usage.totalCost
		}
	}

	/**
	 * Processes an array of ClineMessages to extract and log relevant content
	 * @param messages Array of ClineMessages to process
	 */
	public async processClineMessages(messages: ClineMessage[]): Promise<void> {
		if (messages.length === 0) return

		// Process only the last message
		const message = messages[messages.length - 1]

		// For handling mode, we can check for tools that switch modes
		if (message.type === "say" && message.say === "tool" && message.text) {
			try {
				const toolData = JSON.parse(message.text)
				if (toolData.tool === "switchMode" && toolData.mode) {
					this.currentMode = toolData.mode
				}
			} catch (e) {
				// Silently ignore parsing errors
			}
		}

		if (message.type === "ask" && message.text) {
			await this.logUserInput(message.text)
		} else if (message.type === "say") {
			switch (message.say) {
				case "text":
					if (message.text) {
						await this.logAIResponse(message.text)
					}
					break
				case "reasoning":
					if (message.text) {
						await this.logAIThinking(message.text)
					}
					break
				default:
					// Other message types not logged
					break
			}
		}
	}

	/**
	 * Creates a child logger for a subtask
	 * @param childTaskId The ID of the child/subtask
	 * @returns A new TaskLogger instance for the subtask
	 */
	public createChildLogger(childTaskId: string): TaskLogger {
		return new TaskLogger(childTaskId, this.workspacePath, this)
	}

	/**
	 * Writes a log entry to the log file
	 * @param entry The log entry to write
	 */
	private async writeLogEntry(entry: TaskLogEntry): Promise<void> {
		try {
			const formattedEntry = JSON.stringify(entry) + "\n"
			await fs.appendFile(this.logFilePath, formattedEntry, { encoding: "utf8" })
		} catch (error) {
			console.error(`Error writing to log file: ${error}`)
		}
	}

	/**
	 * Gets the current total cost for the session
	 * @returns The current total cost
	 */
	public getTotalCost(): number {
		return this.totalCost
	}

	/**
	 * Logs a mode switch event
	 * @param fromMode The previous mode
	 * @param toMode The new mode
	 * @param reason Optional reason for the mode switch
	 */
	public async logModeSwitch(fromMode: string, toMode: string, reason?: string): Promise<void> {
		if (!this.ready) {
			await this.initialize()
		}

		// Update the current mode
		this.currentMode = toMode

		const reasonText = reason ? ` (Reason: ${reason})` : ""

		const entry: TaskLogEntry = {
			timestamp: Date.now(),
			sessionId: this.sessionId,
			type: "mode_switch",
			content: `Mode switched from '${fromMode}' to '${toMode}'${reasonText}`,
			mode: toMode,
		}

		await this.writeLogEntry(entry)
	}

	/**
	 * Gets the current session ID
	 * @returns The current session ID
	 */
	public getSessionId(): string {
		return this.sessionId
	}
}
