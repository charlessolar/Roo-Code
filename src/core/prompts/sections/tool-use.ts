export function getSharedToolUseSection(): string {
	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

When executing a tool, ONLY the tool call itself must be wrapped in <roo_action> tags. Your response can include regular text, thinking tags, and other content outside of these tags. Here's the structure for tool calls:

<roo_action>
<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>
</roo_action>

For example:

 I'll read the main file to understand its structure.

 <roo_action>
 <read_file>
 <path>src/main.js</path>
 </read_file>
 </roo_action>

 Always adhere to this format for the tool use to ensure proper parsing and execution. When a tool call is present, your response will be cut off after the closing </roo_action> tag, so ensure any reasoning directly related to the tool usage is placed before the opening <roo_action> tag.`
}
