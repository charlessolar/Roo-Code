import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Cog } from "lucide-react"

import { EXPERIMENT_IDS, ExperimentId } from "../../../../src/shared/experiments"

import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@/components/ui"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AdvancedSettingsProps = HTMLAttributes<HTMLDivElement> & {
	rateLimitSeconds: number
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	showRooIgnoredFiles?: boolean
	skipDiffView?: boolean
	setCachedStateField: SetCachedStateField<
		| "rateLimitSeconds"
		| "terminalOutputLineLimit"
		| "maxOpenTabsContext"
		| "diffEnabled"
		| "fuzzyMatchThreshold"
		| "showRooIgnoredFiles"
		| "skipDiffView"
	>

	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
}
export const AdvancedSettings = ({
	rateLimitSeconds,
	diffEnabled,
	fuzzyMatchThreshold,
	showRooIgnoredFiles,
	skipDiffView,
	setCachedStateField,
	experiments,
	setExperimentEnabled,
	className,
	...props
}: AdvancedSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Cog className="w-4" />
					<div>{t("settings:sections.advanced")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:advanced.rateLimit.label")}</span>
						<div className="flex items-center gap-2">
							<Slider
								min={0}
								max={60}
								step={1}
								value={[rateLimitSeconds]}
								onValueChange={([value]) => setCachedStateField("rateLimitSeconds", value)}
							/>
							<span className="w-10">{rateLimitSeconds}s</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:advanced.rateLimit.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={diffEnabled}
						onChange={(e: any) => {
							setCachedStateField("diffEnabled", e.target.checked)
							if (!e.target.checked) {
								// Reset both experimental strategies when diffs are disabled.
								setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
								setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
							}
						}}>
						<span className="font-medium">{t("settings:advanced.diff.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm">
						{t("settings:advanced.diff.description")}
					</div>
				</div>

				{diffEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:advanced.diff.strategy.label")}
							</label>
							<Select
								value={
									experiments[EXPERIMENT_IDS.DIFF_STRATEGY]
										? "unified"
										: experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE]
											? "multiBlock"
											: "standard"
								}
								onValueChange={(value) => {
									if (value === "standard") {
										setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
										setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
									} else if (value === "unified") {
										setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, true)
										setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
									} else if (value === "multiBlock") {
										setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
										setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, true)
									}
								}}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="standard">
										{t("settings:advanced.diff.strategy.options.standard")}
									</SelectItem>
									<SelectItem value="multiBlock">
										{t("settings:advanced.diff.strategy.options.multiBlock")}
									</SelectItem>
									<SelectItem value="unified">
										{t("settings:advanced.diff.strategy.options.unified")}
									</SelectItem>
								</SelectContent>
							</Select>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will be able to edit files more quickly and will automatically reject
						truncated full-file writes. Works best with the latest Claude 3.7 Sonnet model.
					</p>

					<div className="mt-3">
						<VSCodeCheckbox
							checked={skipDiffView}
							onChange={(e: any) => {
								setCachedStateField("skipDiffView", e.target.checked)
							}}>
							<span className="font-medium">Skip diff view when editing files</span>
						</VSCodeCheckbox>
						<p className="text-vscode-descriptionForeground text-sm mt-0">
							When enabled, Roo will skip showing the diff view during file edits, applying changes
							directly. This can improve performance but reduces visibility of changes being made.
						</p>
					</div>
					{diffEnabled && (
						<div className="flex flex-col gap-2 mt-3 mb-2 pl-3 border-l-2 border-vscode-button-background">
							<div className="flex flex-col gap-2">
								<span className="font-medium">Diff strategy</span>
								<select
									value={
										experiments[EXPERIMENT_IDS.DIFF_STRATEGY]
											? "unified"
											: experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE]
												? "multiBlock"
												: "standard"
									}
									onChange={(e) => {
										const value = e.target.value
										if (value === "standard") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
										} else if (value === "unified") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, true)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
										} else if (value === "multiBlock") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, true)
										}
									}}
									className="p-2 rounded w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border outline-none focus:border-vscode-focusBorder">
									<option value="standard">Standard (Single block)</option>
									<option value="multiBlock">Experimental: Multi-block diff</option>
									<option value="unified">Experimental: Unified diff</option>
								</select>
							</div>

							{/* Description for selected strategy */}
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{!experiments[EXPERIMENT_IDS.DIFF_STRATEGY] &&
									!experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE] &&
									t("settings:advanced.diff.strategy.descriptions.standard")}
								{experiments[EXPERIMENT_IDS.DIFF_STRATEGY] &&
									t("settings:advanced.diff.strategy.descriptions.unified")}
								{experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE] &&
									t("settings:advanced.diff.strategy.descriptions.multiBlock")}
							</div>
						</div>

						<div>
							<label className="block font-medium mb-1">
								{t("settings:advanced.diff.matchPrecision.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.8}
									max={1}
									step={0.005}
									value={[fuzzyMatchThreshold ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("fuzzyMatchThreshold", value)}
								/>
								<span className="w-10">{Math.round((fuzzyMatchThreshold || 1) * 100)}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:advanced.diff.matchPrecision.description")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
