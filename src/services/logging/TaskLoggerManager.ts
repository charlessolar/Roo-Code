import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { Cline, ClineEvents } from "../../core/Cline"
import { ClineMessage } from "../../exports/roo-code"
import { TaskLogger } from "./TaskLogger"

/**
 * Manages TaskLogger instances for all tasks and subtasks
 * Coordinates the creation, tracking, and event handling for task loggers
 */
export class TaskLoggerManager {
	private static instance: TaskLoggerManager
	private loggers: Map<string, TaskLogger> = new Map()
	private workspacePath: string
	private enabled: boolean = false

	/**
	 * Creates a new TaskLoggerManager
	 * @param context The VSCode extension context
	 */
	private constructor(private readonly context: vscode.ExtensionContext) {
		this.workspacePath = this.getWorkspacePath()
	}

	/**
	 * Gets the current workspace path or falls back to user home directory
	 * @returns The workspace path to use for log storage
	 */
	private getWorkspacePath(): string {
		// Try to get the first workspace folder
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath
		}

		// Fallback to a folder in the user's home directory
		return path.join(os.homedir(), ".roo-code-logs")
	}

	/**
	 * Gets the singleton instance of TaskLoggerManager
	 * @param context The VSCode extension context (only needed on first call)
	 * @returns The TaskLoggerManager instance
	 */
	public static getInstance(context?: vscode.ExtensionContext): TaskLoggerManager {
		if (!TaskLoggerManager.instance) {
			if (!context) {
				throw new Error("Context must be provided when first initializing TaskLoggerManager")
			}
			TaskLoggerManager.instance = new TaskLoggerManager(context)
		}
		return TaskLoggerManager.instance
	}

	/**
	 * Enables or disables logging
	 * @param enabled Whether logging should be enabled
	 */
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	/**
	 * Attaches listeners to a Cline instance to capture all relevant events
	 * @param cline The Cline instance to monitor
	 * @param parentTaskId Optional ID of the parent task if this is a subtask
	 */
	public attachToTask(cline: Cline, parentTaskId?: string): void {
		if (!this.enabled) return

		const taskId = cline.taskId
		let logger: TaskLogger

		// If this is a subtask, create a child logger
		if (parentTaskId && this.loggers.has(parentTaskId)) {
			const parentLogger = this.loggers.get(parentTaskId)!
			logger = parentLogger.createChildLogger(taskId)
		} else {
			// Create a new root logger
			logger = new TaskLogger(taskId, this.workspacePath)
		}

		// Initialize the logger
		logger.initialize().catch((error) => {
			console.error(`Failed to initialize logger for task ${taskId}: ${error}`)
		})

		// Store the logger
		this.loggers.set(taskId, logger)

		// Attach event listeners
		this.attachEventListeners(cline, logger)
	}

	/**
	 * Attaches event listeners to a Cline instance
	 * @param cline The Cline instance to monitor
	 * @param logger The TaskLogger for this task
	 */
	private attachEventListeners(cline: Cline, logger: TaskLogger): void {
		// Listen for message events (user inputs and AI responses)
		cline.on("message", ({ action, message }) => {
			this.handleMessageEvent(logger, action, message)
		})

		// Listen for token usage updates (to track costs)
		cline.on("taskTokenUsageUpdated", (taskId, usage) => {
			logger.updateCost(usage).catch((error) => {
				console.error(`Failed to update cost for task ${taskId}: ${error}`)
			})
		})

		// Listen for task completion
		cline.on("taskCompleted", (taskId, usage) => {
			logger.updateCost(usage).catch((error) => {
				console.error(`Failed to update final cost for task ${taskId}: ${error}`)
			})
		})

		// Listen for subtask creation
		cline.on("taskSpawned", (childTaskId) => {
			this.handleSubtaskCreation(cline, logger, childTaskId)
		})

		// Monitor for mode switch tool messages
		this.monitorForModeSwitch(cline, logger)
	}

	/**
	 * Handles message events from a Cline instance
	 * @param logger The TaskLogger for this task
	 * @param action The message action (created or updated)
	 * @param message The ClineMessage
	 */
	private handleMessageEvent(logger: TaskLogger, action: "created" | "updated", message: ClineMessage): void {
		if (action === "created") {
			logger.processClineMessages([message]).catch((error) => {
				console.error(`Failed to process message: ${error}`)
			})
		}
	}

	/**
	 * Monitors a Cline instance for mode switch events
	 * @param cline The Cline instance to monitor
	 * @param logger The TaskLogger for this task
	 */
	private monitorForModeSwitch(cline: Cline, logger: TaskLogger): void {
		// Watch for tool messages with switch_mode
		cline.on("message", ({ action, message }) => {
			if (action === "created" && message.type === "say" && message.say === "tool" && message.text) {
				try {
					const toolData = JSON.parse(message.text)

					if (toolData.tool === "switchMode") {
						const fromMode = toolData.previousMode || "unknown"
						const toMode = toolData.mode || "unknown"
						const reason = toolData.reason

						logger.logModeSwitch(fromMode, toMode, reason).catch((error) => {
							console.error(`Failed to log mode switch: ${error}`)
						})
					}
				} catch (error) {
					// Silently ignore parsing errors
				}
			}
		})
	}

	/**
	 * Handles the creation of a subtask
	 * @param cline The parent Cline instance
	 * @param logger The parent TaskLogger
	 * @param childTaskId The ID of the new subtask
	 */
	private handleSubtaskCreation(cline: Cline, logger: TaskLogger, childTaskId: string): void {
		// Find the new_task message to get the task details
		const newTaskMessage = cline.clineMessages.find(
			(msg) => msg.type === "say" && msg.say === "tool" && msg.text && msg.text.includes("new_task"),
		)

		if (newTaskMessage && newTaskMessage.text) {
			try {
				// Parse the tool message to extract mode and prompt
				const toolData = JSON.parse(newTaskMessage.text)

				if (toolData.tool === "newTask") {
					const mode = toolData.mode || "unknown"
					const prompt = toolData.content || toolData.message || "No prompt provided"

					// Log the new task
					logger.logNewTask(mode, prompt, childTaskId).catch((error) => {
						console.error(`Failed to log new task: ${error}`)
					})
				}
			} catch (error) {
				console.error(`Failed to parse new task message: ${error}`)
			}
		}
	}

	/**
	 * Gets the TaskLogger for a specific task
	 * @param taskId The ID of the task
	 * @returns The TaskLogger for the task, or undefined if not found
	 */
	public getLogger(taskId: string): TaskLogger | undefined {
		return this.loggers.get(taskId)
	}

	/**
	 * Removes a TaskLogger when a task is completed or aborted
	 * @param taskId The ID of the task
	 */
	public removeLogger(taskId: string): void {
		this.loggers.delete(taskId)
	}
}
