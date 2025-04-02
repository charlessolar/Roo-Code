import { ToolArgs } from "./types"

export function getExecuteCommandDescription(args: ToolArgs): string | undefined {
	return `## execute_command
Description: Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency, e.g: \`touch ./testdata/example.file\`, \`dir ./examples/model1/data/yaml\`, or \`go test ./cmd/front --config ./cmd/front/config.yml\`. If directed by the user, you may open a terminal in a different directory by using the \`cwd\` parameter.
Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in (default: ${args.cwd})

 UNIVERSAL CRITICAL REQUIREMENT: ANY and ALL commands MUST run completely non-interactively and NEVER prompt for user input of any kind. This is a fundamental principle that applies to ALL command execution regardless of tool, language, or purpose.

 For every command you run:
 - Research and include ANY necessary flags to prevent prompts, confirmations, or interactive questions
 - If a command might ask for confirmation, find and use its non-interactive option
 - If a command might hang waiting for input, include timeout or auto-confirmation options
 - Each command must be completely autonomous with no possibility of user interaction

 Common patterns (these are just examples, this rule applies to ALL commands):
 - Package managers: Add '--yes', '-y', or '--non-interactive' flags
 - Installation tools: Use flags like '--accept-license', '--quiet', or '--silent'
 - Deployment tools: Include options like '--no-confirm', '--auto-approve'
 - Build tools: Add appropriate flags to suppress prompts
 - Command-line tools: Include any available flag to disable interactive mode

Usage:
<execute_command>
 <command>Your command here (with appropriate non-interactive flags)</command>
<cwd>Working directory path (optional)</cwd>
</execute_command>

Example:
<execute_command>
 <command>some-command --non-interactive --no-prompt</command>
</execute_command>

Example: Requesting to execute ls in a specific directory if directed
<execute_command>
<command>ls -la</command>
<cwd>/home/user/projects</cwd>
</execute_command>`
}
