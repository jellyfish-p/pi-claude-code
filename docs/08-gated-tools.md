# 未加载的内置工具 / 历史工具

> Claude Code `2.1.316` · 由 `scripts/build-docs.mjs` 自动生成 · 请勿手改

`BUILTIN_TOOL_NAMES` 是二进制里那份"内置工具名单"（用于 `Tool(pattern)` 权限规则校验），
共 22 个名字。它和本次会话实际启用的 24 个工具（见 07）**并不重合**：

- 会话里有、名单里没有：`CronCreate` `CronDelete` `CronList` `EnterWorktree` `ExitWorktree`
  `Monitor` `SendMessage` `ListAgents` `ReportFindings` `ScheduleWakeup` `Workflow`
- 名单里有、会话里没有：`TodoWrite` `TaskCreate` `TaskGet` `TaskList` `TaskUpdate`
  `REPL` `JavaScript` `AskUserQuestion` `SendUserMessage`

后者被远端 feature gate 关掉了（例如 TodoWrite 的开关 `tengu_humble_zephyr` 默认 false）。

**结论**：在 `2.1.316` 的 `-p` 路径里，这些工具根本不会发给模型。所以
「Claude 在 pi 里应该看到 TodoWrite」这个假设**不成立**——除非 pi 自己想提供。

```text
BUILTIN_TOOL_NAMES = ["Bash","Read","Write","Edit","Glob","Grep","NotebookEdit","WebFetch","WebSearch","Task","TodoWrite","TaskCreate","TaskUpdate","TaskGet","TaskList","TaskStop","Skill","REPL","JavaScript","AskUserQuestion","ToolSearch","SendUserMessage"]
```

| 工具 | 本次会话 |
| --- | --- |
| `Bash` | ✅ 本次发送 |
| `Read` | ✅ 本次发送 |
| `Write` | ✅ 本次发送 |
| `Edit` | ✅ 本次发送 |
| `Glob` | ✅ 本次发送 |
| `Grep` | ✅ 本次发送 |
| `NotebookEdit` | ✅ 本次发送 |
| `WebFetch` | ✅ 本次发送 |
| `WebSearch` | ✅ 本次发送 |
| `Task` | ❌ 未启用 |
| `TodoWrite` | ❌ 未启用 |
| `TaskCreate` | ❌ 未启用 |
| `TaskUpdate` | ❌ 未启用 |
| `TaskGet` | ❌ 未启用 |
| `TaskList` | ❌ 未启用 |
| `TaskStop` | ✅ 本次发送 |
| `Skill` | ✅ 本次发送 |
| `REPL` | ❌ 未启用 |
| `JavaScript` | ❌ 未启用 |
| `AskUserQuestion` | ❌ 未启用 |
| `ToolSearch` | ✅ 本次发送 |
| `SendUserMessage` | ❌ 未启用 |

未启用的：`TodoWrite`、`TaskCreate`、`TaskUpdate`、`TaskGet`、`TaskList`、`REPL`、`JavaScript`、`AskUserQuestion`、`SendUserMessage`

## 附：TodoWrite 提示词（二进制内静态提取）

虽然本次运行没有加载，但提示词完整存在于二进制里：从某个偏移量连续 stitch（跳过短二进制
间隙）得到，以 `</example>` 结尾，因此可确认没有被截断。pi 想实现 Claude Code 风格的
todo 工具时，这份文本最接近参考。

```text
Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: *Creates todo list with the following items:*
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: *Uses grep or search tools to locate all instances of getCwd in the codebase*
I've found 15 instances of 'getCwd' across 8 different files.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. First, the assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains code consistency
</reasoning>
</example>


<example>
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: *Creates a todo list breaking down each feature into specific tasks based on the project architecture*
Let's start with user registration. This will involve creating database models, API endpoints, and frontend forms that integrate with your existing authentication system.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple complex features to implement in a comma separated list
2. The todo list helps organize these large features into manageable tasks
3. This approach allows for tracking progress across the entire implementation
</reasoning>
</example>

<example>
User: Can you help optimize my React application? It's rendering slowly and has performance issues.
Assistant: *Reviews component structure, render patterns, state management, and data fetching*
After analyzing your codebase, I've identified several performance issues.
*Creates todo list with items like: 1) Implementing memoization for expensive calculations in ProductList, 2) Adding virtualization for long lists in Dashboard, 3) Optimizing image loading in Gallery component, 4) Fixing state update loops in ShoppingCart, 5) Reviewing bundle size and implementing code splitting*
Let's start by implementing memoization for the expensive calculations in your ProductList component.

<reasoning>
The assistant used the todo list because:
1. First, the assistant examined the codebase to identify specific performance issues
2. Based on this analysis, it identified multiple optimization opportunities
3. Performance optimization is a non-trivial task requiring multiple steps
4. The todo list helps methodically track improvements across different components
5. This systematic approach ensures all performance bottlenecks are addressed
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

This will output the text "Hello World" to the console when executed.

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area. It displays which changes have been staged, which haven't, and which files aren't being tracked by Git. This is a fundamental command for understanding the current state of your repository before making commits.

<reasoning>
The assistant did not use the todo list because this is an informational request with no actual coding task to complete. The user is simply asking for an explanation, not for the assistant to perform multiple steps or tasks.
</reasoning>
</example>

<example>
User: Can you add a comment to the calculateTotal function to explain what it does?
Assistant: Sure, let me add a comment to the calculateTotal function to explain what it does.
* Uses the F
 tool to add a comment to the calculateTotal function *

<reasoning>
The assistant did not use the todo list because this is a single, straightforward task confined to one location in the code. Adding a comment doesn't require tracking multiple steps or systematic organization.
</reasoning>
</example>

<example>
User: Run npm install for me and tell me what happens.
Assistant: I'll run the npm install command for you.

*Executes: npm install*

The command completed successfully. Here's the output:
[Output of npm install command]

All dependencies have been installed according to your package.json file.

<reasoning>
The assistant did not use the todo list because this is a single command execution with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward task.
</reasoning>
</example>
```

---
