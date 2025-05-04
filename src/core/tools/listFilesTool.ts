import * as path from "path"

import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { listFiles } from "../../services/glob/list-files"
import { getReadablePath } from "../../utils/path"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { promiseTimeout } from "../../utils/promise-utils"

/**
 * Implements the list_files tool.
 *
 * @param cline - The instance of Cline that is executing this tool.
 * @param block - The block of assistant message content that specifies the
 *   parameters for this tool.
 * @param askApproval - A function that asks the user for approval to show a
 *   message.
 * @param handleError - A function that handles an error that occurred while
 *   executing this tool.
 * @param pushToolResult - A function that pushes the result of this tool to the
 *   conversation.
 * @param removeClosingTag - A function that removes a closing tag from a string.
 * @param options - Additional options for the tool, including timeout settings.
 */

export interface ListFilesToolOptions {
	timeoutMs?: number
}

export async function listFilesTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
	options: ListFilesToolOptions = {},
) {
	const { timeoutMs = 30 * 1000 } = options // Default timeout: 30 seconds
	const relDirPath: string | undefined = block.params.path
	const recursiveRaw: string | undefined = block.params.recursive
	const recursive = recursiveRaw?.toLowerCase() === "true"

	const sharedMessageProps: ClineSayTool = {
		tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relDirPath)),
	}

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!relDirPath) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("list_files")
				pushToolResult(await cline.sayAndCreateMissingParamError("list_files", "path"))
				return
			}

			cline.consecutiveMistakeCount = 0

			const absolutePath = path.resolve(cline.cwd, relDirPath)

			try {
				const [files, didHitLimit] = await promiseTimeout(
					listFiles(absolutePath, recursive, 200),
					timeoutMs,
					`List files operation timed out after ${timeoutMs / 1000} seconds`,
				)
				const { showRooIgnoredFiles = true } = (await cline.providerRef.deref()?.getState()) ?? {}

				const result = formatResponse.formatFilesList(
					absolutePath,
					files,
					didHitLimit,
					cline.rooIgnoreController,
					showRooIgnoredFiles,
				)

				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					content: result,
				} satisfies ClineSayTool)
				const didApprove = await askApproval("tool", completeMessage)

				if (!didApprove) {
					return
				}

				pushToolResult(result)
			} catch (error) {
				if (error instanceof Error && error.message.includes("timed out")) {
					// Handle timeout specifically
					const timeoutMessage = `Operation timed out when listing files in directory '${relDirPath}'. The directory might contain too many files or the operation is taking longer than ${timeoutMs / 1000} seconds.`
					await cline.say("error", timeoutMessage)
					pushToolResult(formatResponse.toolError(timeoutMessage))
					return
				}

				// Re-throw for the outer catch block to handle other errors
				throw error
			}
		}
	} catch (error) {
		await handleError("listing files", error)
	}
}
