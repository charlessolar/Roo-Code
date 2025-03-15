import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import { DecorationController } from "./DecorationController"
import * as diff from "diff"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"
import stripBom from "strip-bom"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

export class DiffViewProvider {
	editType?: "create" | "modify"
	isEditing = false
	originalContent: string | undefined
	private createdDirs: string[] = []
	private documentWasOpen = false
	private relPath?: string
	private newContent?: string
	private activeDiffEditor?: vscode.TextEditor
	private fadedOverlayController?: DecorationController
	private activeLineController?: DecorationController
	private streamedLines: string[] = []
	private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []

	constructor(private cwd: string) {}

	// Property to track if we're in readonly mode
	private readonly = true

	async open(relPath: string): Promise<void> {
		this.relPath = relPath
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, relPath)
		this.isEditing = true
		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			const existingDocument = vscode.workspace.textDocuments.find((doc) =>
				arePathsEqual(doc.uri.fsPath, absolutePath),
			)
			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}
		}

		// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
		this.preDiagnostics = vscode.languages.getDiagnostics()

		if (fileExists) {
			this.originalContent = await fs.readFile(absolutePath, "utf-8")
		} else {
			this.originalContent = ""
		}
		// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation
		this.createdDirs = await createDirectoriesForFile(absolutePath)
		// make sure the file exists before we open it
		if (!fileExists) {
			await fs.writeFile(absolutePath, "")
		}
		// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
		this.documentWasOpen = false
		// close the tab if it's open (it's already saved above)
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, absolutePath),
			)
		for (const tab of tabs) {
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
			this.documentWasOpen = true
		}
		this.activeDiffEditor = await this.openDiffEditor()
		this.fadedOverlayController = new DecorationController("fadedOverlay", this.activeDiffEditor)
		this.activeLineController = new DecorationController("activeLine", this.activeDiffEditor)
		// Apply faded overlay to all lines initially
		this.fadedOverlayController.addLines(0, this.activeDiffEditor.document.lineCount)
		this.scrollEditorToLine(0) // will this crash for new files?
		this.streamedLines = []
	}

	async update(accumulatedContent: string, isFinal: boolean) {
		if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
			throw new Error("Required values not set")
		}
		this.newContent = accumulatedContent

		// When using a virtual document in the diff view, we can't directly edit it
		// So we just update our stored content for the final save

		// Update display elements
		const diffEditor = this.activeDiffEditor
		if (!diffEditor) {
			throw new Error("User closed text editor, unable to update view...")
		}

		// Calculate where we are in the content
		const accumulatedLines = accumulatedContent.split("\n")
		if (!isFinal) {
			accumulatedLines.pop() // remove the last partial line only if it's not the final update
		}
		const endLine = accumulatedLines.length

		// Place cursor at the beginning to keep it out of the way
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Update decorations
		this.activeLineController.setActiveLine(endLine)
		this.fadedOverlayController.updateOverlayAfterLine(endLine, diffEditor.document.lineCount)

		// Scroll to the current line
		this.scrollEditorToLine(endLine)

		// Update the streamedLines with the new accumulated content
		this.streamedLines = accumulatedLines

		if (isFinal) {
			// Clear all decorations at the end
			this.fadedOverlayController.clear()
			this.activeLineController.clear()

			// For final update, open a new diff view with complete content
			await this.closeAllDiffViews()

			// Create a temp file with the final content to show the complete diff
			if (this.originalContent !== accumulatedContent) {
				const tempFinalUri = vscode.Uri.parse(
					`${DIFF_VIEW_URI_SCHEME}:final-${path.basename(this.relPath || "")}`,
				).with({
					query: Buffer.from(accumulatedContent).toString("base64"),
				})

				const originalUri = vscode.Uri.parse(
					`${DIFF_VIEW_URI_SCHEME}:original-${path.basename(this.relPath || "")}`,
				).with({
					query: Buffer.from(this.originalContent || "").toString("base64"),
				})

				await vscode.commands.executeCommand(
					"vscode.diff",
					originalUri,
					tempFinalUri,
					`${path.basename(this.relPath || "")}: Complete Changes (Readonly)`,
				)
			}
		}
	}

	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		finalContent: string | undefined
	}> {
		if (!this.relPath || !this.newContent) {
			return { newProblemsMessage: undefined, userEdits: undefined, finalContent: undefined }
		}
		const absolutePath = path.resolve(this.cwd, this.relPath)

		// For readonly mode, write directly to the file
		await fs.writeFile(absolutePath, this.stripAllBOMs(this.newContent))

		// Show the saved file
		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
		await this.closeAllDiffViews()

		// Check for new problems
		const postDiagnostics = vscode.languages.getDiagnostics()
		const newProblems = await diagnosticsToProblemsString(
			getNewDiagnostics(this.preDiagnostics, postDiagnostics),
			[
				vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting
			],
			this.cwd,
		)
		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

		// In readonly mode, no user edits are possible
		return {
			newProblemsMessage,
			userEdits: undefined,
			finalContent: this.newContent,
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.relPath) {
			return
		}
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, this.relPath)

		// Close all diff views first
		await this.closeAllDiffViews()

		if (!fileExists) {
			// If this was a new file, delete it
			await fs.unlink(absolutePath)

			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				try {
					await fs.rmdir(this.createdDirs[i])
					console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
				} catch (error) {
					console.error(`Error deleting directory ${this.createdDirs[i]}:`, error)
				}
			}
			console.log(`File ${absolutePath} has been deleted.`)
		} else {
			// If this was an existing file, revert to original content
			await fs.writeFile(absolutePath, this.originalContent ?? "")
			console.log(`File ${absolutePath} has been reverted to its original content.`)

			// If the document was open before we started, reopen it
			if (this.documentWasOpen) {
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
					preview: false,
				})
			}
		}

		// Reset the provider state
		await this.reset()
	}

	private async closeAllDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME,
			)
		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	private async openDiffEditor(): Promise<vscode.TextEditor> {
		if (!this.relPath) {
			throw new Error("No file path set")
		}
		const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath))
		const tempFileUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${path.basename(uri.fsPath)}-temp`).with({
			query: Buffer.from(this.originalContent ?? "").toString("base64"),
		})

		// If this diff editor is already open, activate it instead of opening a new diff
		const diffTab = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME,
			)
		if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
			const editor = await vscode.window.showTextDocument(diffTab.input.modified, {
				preview: false,
				viewColumn: vscode.ViewColumn.Active,
			})
			return editor
		}

		// Open new diff editor
		return new Promise<vscode.TextEditor>((resolve, reject) => {
			const fileName = path.basename(uri.fsPath)
			const fileExists = this.editType === "modify"
			const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && editor.document.uri.scheme === DIFF_VIEW_URI_SCHEME) {
					disposable.dispose()
					resolve(editor)
				}
			})

			vscode.commands.executeCommand(
				"vscode.diff",
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
					query: Buffer.from(this.originalContent ?? "").toString("base64"),
				}),
				tempFileUri,
				`${fileName}: ${fileExists ? "Original ↔ Roo's Changes" : "New File"} (Readonly)`,
			)

			// This may happen on very slow machines ie project idx
			setTimeout(() => {
				disposable.dispose()
				reject(new Error("Failed to open diff editor, please try again..."))
			}, 10_000)
		})
	}

	private scrollEditorToLine(line: number) {
		if (this.activeDiffEditor) {
			const scrollLine = line + 4
			this.activeDiffEditor.revealRange(
				new vscode.Range(scrollLine, 0, scrollLine, 0),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}

	scrollToFirstDiff() {
		if (!this.activeDiffEditor) {
			return
		}
		const currentContent = this.newContent || ""
		const diffs = diff.diffLines(this.originalContent || "", currentContent)
		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it
				this.activeDiffEditor.revealRange(
					new vscode.Range(lineCount, 0, lineCount, 0),
					vscode.TextEditorRevealType.InCenter,
				)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	private stripAllBOMs(input: string): string {
		let result = input
		let previous
		do {
			previous = result
			result = stripBom(result)
		} while (result !== previous)
		return result
	}

	// close editor if open?
	async reset() {
		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		this.createdDirs = []
		this.documentWasOpen = false
		this.activeDiffEditor = undefined
		this.fadedOverlayController = undefined
		this.activeLineController = undefined
		this.streamedLines = []
		this.preDiagnostics = []
	}
}
