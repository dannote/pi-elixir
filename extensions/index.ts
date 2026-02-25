import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	highlightCode,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { callTool, resolveUrl, invalidateCache, stopAllEmbedded, getConnectionKind } from "./tidewave-client.ts";

function truncated(text: string) {
	const t = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!t.truncated) return t.content;
	return (
		t.content +
		`\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
	);
}

interface BridgeToolOpts {
	transformResult?: (text: string) => string;
	renderResult?: (result: any, options: any, theme: any) => any;
}

function bridgeTool(
	pi: ExtensionAPI,
	name: string,
	mcpName: string,
	label: string,
	description: string,
	parameters: ReturnType<typeof Type.Object>,
	renderCall: (args: Record<string, unknown>, theme: any) => any,
	opts?: BridgeToolOpts,
) {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const conn = await resolveUrl(ctx.cwd);
			if (!conn) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No BEAM connection for this project. Start the Phoenix server with \`mix phx.server\` or ensure mix.exs exists and the project compiles.`,
						},
					],
					isError: true,
					details: {},
				};
			}

			let { text, isError } = await callTool(conn.url, mcpName, params, signal);
			if (opts?.transformResult) text = opts.transformResult(text);
			return {
				content: [{ type: "text" as const, text: truncated(text) }],
				isError,
				details: {},
			};
		},
		renderCall,
		renderResult: opts?.renderResult,
	});
}

function renderElixirResult(result: any, _options: any, _theme: any) {
	const text = result.content?.[0]?.text ?? "";
	if (!text || result.isError) return new Text(text, 0, 0);
	return new Text(highlightCode(text, "elixir").join("\n"), 0, 0);
}

function renderMarkdownResult(result: any, _options: any, theme: any) {
	const text = result.content?.[0]?.text ?? "";
	if (!text || result.isError) return new Text(text, 0, 0);

	const lines: string[] = [];
	let inCodeBlock = false;
	let codeLang = "";
	let codeBuffer: string[] = [];

	for (const line of text.split("\n")) {
		const fenceMatch = line.match(/^```(\w*)/);
		if (fenceMatch && !inCodeBlock) {
			inCodeBlock = true;
			codeLang = fenceMatch[1] || "elixir";
			codeBuffer = [];
		} else if (line.startsWith("```") && inCodeBlock) {
			lines.push(...highlightCode(codeBuffer.join("\n"), codeLang));
			inCodeBlock = false;
		} else if (inCodeBlock) {
			codeBuffer.push(line);
		} else if (line.startsWith("# ")) {
			lines.push(theme.fg("accent", theme.bold(line)));
		} else if (line.startsWith("## ") || line.startsWith("### ")) {
			lines.push(theme.fg("accent", line));
		} else {
			lines.push(line);
		}
	}

	if (inCodeBlock && codeBuffer.length > 0) {
		lines.push(...highlightCode(codeBuffer.join("\n"), codeLang));
	}

	return new Text(lines.join("\n"), 0, 0);
}

function renderSqlResult(result: any, _options: any, _theme: any) {
	const text = result.content?.[0]?.text ?? "";
	if (!text || result.isError) return new Text(text, 0, 0);
	return new Text(highlightCode(text, "elixir").join("\n"), 0, 0);
}

function renderLogResult(result: any, _options: any, theme: any) {
	const text = result.content?.[0]?.text ?? "";
	if (!text || result.isError) return new Text(text, 0, 0);

	const lines = text.split("\n").map((line: string) => {
		if (/\[error\]/i.test(line)) return theme.fg("error", line);
		if (/\[warn(ing)?\]/i.test(line)) return theme.fg("warning", line);
		if (/\[debug\]/i.test(line)) return theme.fg("dim", line);
		return line;
	});

	return new Text(lines.join("\n"), 0, 0);
}

function formatHexSearchResults(raw: string): string {
	const countMatch = raw.match(/^Results: (\d+)/);
	const count = countMatch ? countMatch[1] : "?";

	const results: string[] = [];
	const re = /<result\s+index="(\d+)"\s+package="([^"]+)"\s+ref="([^"]+)"\s+title="([^"]*)">\n([\s\S]*?)\n<\/result>/g;
	let m;
	while ((m = re.exec(raw)) !== null) {
		const [, , pkg, ref, title, doc] = m;
		const trimmed = doc.trim();
		const url = `https://hexdocs.pm/${pkg.replace(/-([^-]+)$/, "/$1/")}${ref}`;
		results.push(`### ${title}\n${url}\n\n${trimmed}`);
	}

	if (results.length === 0) return raw;
	return `${count} results\n\n${results.join("\n\n---\n\n")}`;
}

export default function (pi: ExtensionAPI) {
	function isElixirProject(cwd: string): boolean {
		try {
			const fs = require("node:fs");
			return fs.existsSync(`${cwd}/mix.exs`);
		} catch {
			return false;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!isElixirProject(ctx.cwd)) return;

		const conn = await resolveUrl(ctx.cwd);
		const t = ctx.ui.theme;

		if (conn) {
			const label = conn.kind === "embedded" ? "BEAM (embedded)" : "BEAM";
			ctx.ui.setStatus("elixir", t.fg("success", "⬡") + " " + t.fg("muted", label));
		} else {
			ctx.ui.setStatus("elixir", t.fg("warning", "⬡") + " " + t.fg("muted", "BEAM offline"));
		}
	});

	pi.on("session_shutdown", async () => {
		stopAllEmbedded();
	});

	bridgeTool(
		pi,
		"elixir_eval",
		"project_eval",
		"Elixir Eval",
		`Evaluate Elixir code in the running application.

Runs inside the BEAM with full access to project modules, deps, Ecto repos, and IEx helpers.
Use this instead of bash for anything Elixir — test functions, introspect modules, manipulate ASTs,
query process state, read docs with h(), list exports with exports(), inspect values with i().

Output truncated to ${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)}.`,
		Type.Object({
			code: Type.String({ description: "Elixir code to evaluate" }),
			timeout: Type.Optional(Type.Integer({ description: "Timeout in ms (default: 30000)" })),
		}),
		(args, theme) => {
			const code = String(args.code ?? "");
			const preview = code.length > 120 ? code.slice(0, 117) + "…" : code;
			return new Text(
				theme.fg("toolTitle", theme.bold("elixir_eval ")) + theme.fg("accent", preview),
				0,
				0,
			);
		},
		{ renderResult: renderElixirResult },
	);

	bridgeTool(
		pi,
		"elixir_docs",
		"get_docs",
		"Elixir Docs",
		`Get documentation for a module or function from the running application.
Returns exact docs for the exact versions in mix.lock.
Accepts: Module, Module.function, Module.function/arity, c:Module.callback/arity.`,
		Type.Object({
			reference: Type.String({
				description: "e.g. Ecto.Changeset, Ecto.Changeset.cast/4, c:GenServer.init/1",
			}),
		}),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_docs ")) +
					theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
		{ renderResult: renderMarkdownResult },
	);

	bridgeTool(
		pi,
		"elixir_source",
		"get_source_location",
		"Elixir Source",
		`Get source file:line for a module or function. The BEAM knows where everything is defined.
Accepts: Module, Module.function, Module.function/arity, dep:package_name.
Prefer over grep when you know the module/function name.`,
		Type.Object({
			reference: Type.String({
				description: "e.g. MyApp.Orders.create/1, dep:phoenix",
			}),
		}),
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_source ")) +
					theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
	);

	bridgeTool(
		pi,
		"elixir_sql",
		"execute_sql_query",
		"Elixir SQL",
		`Execute SQL through the app's Ecto repo. Results limited to 50 rows.
Use to verify migrations, check data, introspect schema.`,
		Type.Object({
			query: Type.String({ description: "SQL query" }),
			arguments: Type.Optional(Type.Array(Type.Unknown(), { description: "Query params" })),
			repo: Type.Optional(Type.String({ description: "Ecto repo module (default: first)" })),
		}),
		(args, theme) => {
			const q = String(args.query ?? "");
			const preview = q.length > 100 ? q.slice(0, 97) + "…" : q;
			return new Text(
				theme.fg("toolTitle", theme.bold("elixir_sql ")) + theme.fg("accent", preview),
				0,
				0,
			);
		},
		{ renderResult: renderSqlResult },
	);

	bridgeTool(
		pi,
		"elixir_logs",
		"get_logs",
		"Elixir Logs",
		"Read server logs. Use after changes to check for compile/runtime errors.",
		Type.Object({
			tail: Type.Integer({ description: "Number of entries from the end" }),
			grep: Type.Optional(Type.String({ description: "Regex filter (case insensitive)" })),
			level: Type.Optional(Type.String({ description: "emergency|alert|critical|error|warning|notice|info|debug" })),
		}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_logs "));
			text += theme.fg("muted", `tail=${args.tail}`);
			if (args.grep) text += theme.fg("dim", ` grep=${args.grep}`);
			if (args.level) text += theme.fg("dim", ` level=${args.level}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderLogResult },
	);

	bridgeTool(
		pi,
		"elixir_hex_search",
		"search_package_docs",
		"HexDocs Search",
		`Search HexDocs filtered to your project's exact dependency versions.`,
		Type.Object({
			q: Type.String({ description: "Search query" }),
			packages: Type.Optional(Type.Array(Type.String(), { description: "Limit to specific packages" })),
		}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_hex_search "));
			text += theme.fg("accent", `"${args.q}"`);
			return new Text(text, 0, 0);
		},
		{ transformResult: formatHexSearchResults, renderResult: renderMarkdownResult },
	);

	bridgeTool(
		pi,
		"elixir_schemas",
		"get_ecto_schemas",
		"Ecto Schemas",
		"List all Ecto schema modules with file paths. Prefer over grep for schema discovery.",
		Type.Object({}),
		(_args, theme) => new Text(theme.fg("toolTitle", theme.bold("elixir_schemas")), 0, 0),
	);

	// --- Eval-based introspection tools ---
	// These send Elixir code through project_eval to provide structured BEAM introspection.

	function evalTool(
		name: string,
		label: string,
		description: string,
		parameters: ReturnType<typeof Type.Object>,
		buildCode: (params: Record<string, unknown>) => string,
		renderCall: (args: Record<string, unknown>, theme: any) => any,
		opts?: BridgeToolOpts,
	) {
		pi.registerTool({
			name,
			label,
			description,
			parameters,
			async execute(_id, params, signal, _onUpdate, ctx) {
				const conn = await resolveUrl(ctx.cwd);
				if (!conn) {
					return {
						content: [
							{
								type: "text" as const,
								text: `No BEAM connection for this project. Start the Phoenix server with \`mix phx.server\` or ensure mix.exs exists and the project compiles.`,
							},
						],
						isError: true,
						details: {},
					};
				}

				const code = buildCode(params);
				let { text, isError } = await callTool(conn.url, "project_eval", { code }, signal);
				if (opts?.transformResult) text = opts.transformResult(text);
				return {
					content: [{ type: "text" as const, text: truncated(text) }],
					isError,
					details: {},
				};
			},
			renderCall,
			renderResult: opts?.renderResult,
		});
	}

	evalTool(
		"elixir_sup_tree",
		"Supervision Tree",
		`Show the supervision tree of the running application.
Returns a tree of supervisors and their children with PIDs, restart strategies, and child types.
Use to understand application architecture and process hierarchy.`,
		Type.Object({
			root: Type.Optional(
				Type.String({
					description:
						"Root supervisor module (default: auto-detected application supervisor). e.g. MyApp.Supervisor",
				}),
			),
			depth: Type.Optional(
				Type.Integer({ description: "Maximum tree depth to display (default: unlimited)" }),
			),
		}),
		(params) => {
			const root = params.root ? String(params.root) : null;
			const depth = params.depth != null ? Number(params.depth) : null;
			const depthGuard = depth != null ? `depth < ${depth}` : "true";
			return `
defmodule PiSupTree do
  def print(sup, depth \\\\ 0) do
    indent = String.duplicate("  ", depth)
    children = try do
      Supervisor.which_children(sup)
    rescue
      _ -> []
    end

    children
    |> Enum.map(fn {id, pid, type, modules} ->
      id_str = if is_atom(id), do: inspect(id), else: "\#{inspect(id)}"
      pid_str = case pid do
        p when is_pid(p) -> inspect(p)
        :restarting -> "restarting"
        :undefined -> "undefined"
      end
      mod_str = case modules do
        :dynamic -> "dynamic"
        [m] -> inspect(m)
        ms -> inspect(ms)
      end

      line = "\#{indent}├─ \#{id_str} [\#{type}] \#{pid_str} (\#{mod_str})"

      sub = if type == :supervisor and is_pid(pid) and ${depthGuard} do
        try do
          info = Supervisor.count_children(pid)
          strategy = case :sys.get_status(pid) do
            {:status, _, _, [_, _, _, _, [header | _]]} ->
              case header do
                {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
                _ -> :unknown
              end
            _ -> :unknown
          end
          header = "\#{indent}│  strategy=\#{strategy} active=\#{info[:active]} specs=\#{info[:specs]}"
          header <> "\\n" <> print(pid, depth + 1)
        rescue
          _ -> ""
        end
      else
        ""
      end

      if sub != "", do: line <> "\\n" <> sub, else: line
    end)
    |> Enum.join("\\n")
  end
end

root = ${root ? `Module.concat([${root.split(".").map((s) => `:"${s}"`).join(", ")}])` : `
  app_module_prefix =
    Mix.Project.config()[:app]
    |> Atom.to_string()
    |> Macro.camelize()

  Process.registered()
  |> Enum.map(&to_string/1)
  |> Enum.filter(fn name ->
    String.starts_with?(name, "Elixir." <> app_module_prefix) and
    String.ends_with?(name, ".Supervisor") and
    not String.contains?(name, "PubSub")
  end)
  |> Enum.sort_by(&String.length/1)
  |> List.first()
  |> case do
    nil -> nil
    name -> String.to_existing_atom(name)
  end
`}

case root do
  nil -> "Could not auto-detect application supervisor. Pass root=MyApp.Supervisor explicitly."
  mod ->
    strategy = try do
      case :sys.get_status(Process.whereis(mod) || mod) do
        {:status, _, _, [_, _, _, _, [header | _]]} ->
          case header do
            {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
            _ -> :unknown
          end
        _ -> :unknown
      end
    rescue
      _ -> :unknown
    end
    header = "#{inspect(mod)} (strategy=#{strategy})\\n"
    header <> PiSupTree.print(Process.whereis(mod) || mod)
end
`;
		},
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_sup_tree"));
			if (args.root) text += theme.fg("accent", ` ${args.root}`);
			if (args.depth) text += theme.fg("muted", ` depth=${args.depth}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderElixirResult },
	);

	evalTool(
		"elixir_top",
		"Process Top",
		`List top BEAM processes by resource usage, like a process manager.
Shows process name/MFA, PID, memory, message queue length, reductions, and current function.
Use to find memory leaks, overloaded mailboxes, or busy processes.`,
		Type.Object({
			sort: Type.Optional(
				Type.String({
					description: "Sort by: memory (default), reductions, message_queue_len",
				}),
			),
			limit: Type.Optional(Type.Integer({ description: "Number of processes to show (default: 15)" })),
		}),
		(params) => {
			const sort = params.sort ? String(params.sort) : "memory";
			const limit = params.limit != null ? Number(params.limit) : 15;
			return `
sort_key = :${sort}
limit = ${limit}

Process.list()
|> Enum.map(fn pid ->
  info = Process.info(pid, [:registered_name, :memory, :message_queue_len, :reductions, :current_function, :initial_call, :dictionary])
  case info do
    nil -> nil
    info ->
      name = case info[:registered_name] do
        [] -> nil
        n -> n
      end
      init_call = case info[:dictionary][:"$initial_call"] do
        {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
        _ -> case info[:initial_call] do
          {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
          _ -> nil
        end
      end
      current = case info[:current_function] do
        {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
        _ -> "?"
      end
      label = cond do
        name -> inspect(name)
        init_call -> init_call
        true -> inspect(pid)
      end
      %{
        pid: inspect(pid),
        name: label,
        memory: info[:memory],
        message_queue_len: info[:message_queue_len],
        reductions: info[:reductions],
        current: current
      }
  end
end)
|> Enum.reject(&is_nil/1)
|> Enum.sort_by(& &1[sort_key], :desc)
|> Enum.take(limit)
|> Enum.with_index(1)
|> Enum.map(fn {p, i} ->
  mem = cond do
    p.memory >= 1_048_576 -> "\#{Float.round(p.memory / 1_048_576, 1)} MB"
    p.memory >= 1024 -> "\#{Float.round(p.memory / 1024, 1)} KB"
    true -> "\#{p.memory} B"
  end
  rank = String.pad_leading("\#{i}", 3)
  "\#{rank}. \#{p.pid} \#{String.pad_trailing(p.name, 48)} mem=\#{String.pad_leading(mem, 10)} msgq=\#{String.pad_leading("\#{p.message_queue_len}", 6)} reds=\#{p.reductions}"
end)
|> Enum.join("\\n")
`;
		},
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_top"));
			if (args.sort) text += theme.fg("muted", ` sort=${args.sort}`);
			if (args.limit) text += theme.fg("muted", ` limit=${args.limit}`);
			return new Text(text, 0, 0);
		},
	);

	evalTool(
		"elixir_process_info",
		"Process Info",
		`Get detailed information about a specific BEAM process.
Accepts a registered name (e.g. MyApp.Repo) or PID string (e.g. "0.500.0").
Returns: state, message queue, memory, reductions, links, monitors, current function, and more.`,
		Type.Object({
			process: Type.String({
				description:
					'Registered process name (e.g. MyApp.Repo, Elixir.MyApp.Repo) or PID (e.g. "0.500.0")',
			}),
		}),
		(params) => {
			const proc = String(params.process);
			return `
target = ${
				proc.match(/^\d+\.\d+\.\d+$/)
					? `:erlang.list_to_pid(~c"<${proc}>")`
					: `Process.whereis(Module.concat([${proc.split(".").map((s) => `:"${s}"`).join(", ")}]))`
			}

case target do
  nil -> "Process not found: ${proc}"
  pid when is_pid(pid) ->
    info = Process.info(pid, [
      :registered_name, :memory, :message_queue_len, :messages, :reductions,
      :current_function, :initial_call, :status, :links, :monitors, :monitored_by,
      :trap_exit, :dictionary, :heap_size, :stack_size, :total_heap_size
    ])
    case info do
      nil -> "Process \#{inspect(pid)} is dead"
      info ->
        name = case info[:registered_name] do
          [] -> "none"
          n -> inspect(n)
        end
        init = case info[:dictionary][:"$initial_call"] do
          {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
          _ -> case info[:initial_call] do
            {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
            _ -> "?"
          end
        end
        current = case info[:current_function] do
          {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
          _ -> "?"
        end
        mem = Float.round(info[:memory] / 1024, 1)
        msgs = info[:messages] |> Enum.take(5) |> inspect(pretty: true, limit: 3)
        links = info[:links] |> Enum.map(&inspect/1) |> Enum.join(", ")
        monitors = info[:monitors] |> Enum.take(10) |> Enum.map(fn
          {:process, p} -> inspect(p)
          other -> inspect(other)
        end) |> Enum.join(", ")

        state = try do
          s = :sys.get_state(pid)
          inspect(s, pretty: true, limit: 20, printable_limit: 1024)
        rescue
          _ -> "(not a GenServer or state unavailable)"
        end

        """
        PID:              \#{inspect(pid)}
        Registered name:  \#{name}
        Initial call:     \#{init}
        Current function: \#{current}
        Status:           \#{info[:status]}
        Memory:           \#{mem} KB
        Heap size:        \#{info[:heap_size]} words
        Stack size:       \#{info[:stack_size]} words
        Reductions:       \#{info[:reductions]}
        Message queue:    \#{info[:message_queue_len]} messages
        Messages (first 5): \#{msgs}
        Links:            \#{if links == "", do: "none", else: links}
        Monitors:         \#{if monitors == "", do: "none", else: monitors}
        Monitored by:     \#{info[:monitored_by] |> Enum.map(&inspect/1) |> Enum.join(", ") |> then(& if &1 == "", do: "none", else: &1)}
        Trap exit:        \#{info[:trap_exit]}

        State:
        \#{state}
        """
    end
end
`;
		},
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_process_info ")) +
					theme.fg("accent", String(args.process ?? "")),
				0,
				0,
			),
	);

	evalTool(
		"elixir_deps_tree",
		"Deps Tree",
		`Show compile-time dependencies for a module using Mix.Xref.
Lists modules that the given module calls (exports) and modules that call it (callers).
Use to understand coupling, find circular dependencies, and navigate unfamiliar codebases.`,
		Type.Object({
			module: Type.String({ description: "Module name, e.g. MyApp.Orders or MyAppWeb.OrderController" }),
			direction: Type.Optional(
				Type.String({
					description:
						"exports (modules this module calls, default), callers (modules that call this module), or both",
				}),
			),
		}),
		(params) => {
			const mod = String(params.module);
			const direction = params.direction ? String(params.direction) : "both";
			const modAtom = `Module.concat([${mod.split(".").map((s) => `:"${s}"`).join(", ")}])`;
			return `
target = ${modAtom}

all = Mix.Tasks.Xref.calls()

${direction === "exports" || direction === "both" ? `
exports =
  all
  |> Enum.filter(fn %{caller_module: caller} -> caller == target end)
  |> Enum.map(fn %{callee: {m, f, a}} -> {m, f, a} end)
  |> Enum.uniq()
  |> Enum.sort()
  |> Enum.group_by(&elem(&1, 0))
  |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
` : "exports = []"}

${direction === "callers" || direction === "both" ? `
callers =
  all
  |> Enum.filter(fn %{callee: {m, _, _}} -> m == target end)
  |> Enum.map(fn %{caller_module: caller, callee: {_, f, a}} -> {caller, f, a} end)
  |> Enum.uniq()
  |> Enum.sort()
  |> Enum.group_by(&elem(&1, 0))
  |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
` : "callers = []"}

format_group = fn grouped, header ->
  if grouped == [] do
    "\#{header}: (none)"
  else
    lines = Enum.map(grouped, fn {mod, funs} ->
      calls = Enum.map(funs, fn {_, f, a} -> "\#{f}/\#{a}" end) |> Enum.join(", ")
      "  \#{inspect(mod)} — \#{calls}"
    end)
    "\#{header} (\#{length(grouped)} modules):\\n" <> Enum.join(lines, "\\n")
  end
end

parts = []
${direction === "exports" || direction === "both" ? `parts = parts ++ [format_group.(exports, "Calls (this module depends on)")]` : ""}
${direction === "callers" || direction === "both" ? `parts = parts ++ [format_group.(callers, "Called by (depends on this module)")]` : ""}

"# \#{inspect(target)}\\n\\n" <> Enum.join(parts, "\\n\\n")
`;
		},
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_deps_tree "));
			text += theme.fg("accent", String(args.module ?? ""));
			if (args.direction) text += theme.fg("muted", ` ${args.direction}`);
			return new Text(text, 0, 0);
		},
	);

	evalTool(
		"elixir_types",
		"Type Info",
		`Get type specifications and behaviour callbacks for a module or function.
Shows @type, @spec, @callback definitions. Use to understand function signatures and data structures.`,
		Type.Object({
			reference: Type.String({
				description: "Module name (for all types/specs) or Module.function/arity (for specific spec)",
			}),
		}),
		(params) => {
			const ref = String(params.reference);
			const hasFun = ref.includes(".");
			const hasArity = ref.includes("/");

			if (!hasFun) {
				const modAtom = `Module.concat([${ref.split(".").map((s) => `:"${s}"`).join(", ")}])`;
				return `
mod = ${modAtom}
Code.ensure_loaded!(mod)

types = case Code.Typespec.fetch_types(mod) do
  {:ok, types} ->
    types
    |> Enum.sort_by(fn {kind, {name, _, _}} -> {kind, name} end)
    |> Enum.map(fn {kind, type_ast} ->
      "@\#{kind} \#{Macro.to_string(Code.Typespec.type_to_quoted(type_ast))}"
    end)
  :error -> []
end

specs = case Code.Typespec.fetch_specs(mod) do
  {:ok, specs} ->
    Enum.flat_map(specs, fn {{fun, arity}, spec_list} ->
      Enum.map(spec_list, fn spec ->
        "@spec \#{Macro.to_string(Code.Typespec.spec_to_quoted(fun, spec))}"
      end)
    end)
    |> Enum.sort()
  :error -> []
end

callbacks = case Code.Typespec.fetch_callbacks(mod) do
  {:ok, cbs} ->
    Enum.flat_map(cbs, fn {{fun, arity}, spec_list} ->
      Enum.map(spec_list, fn spec ->
        "@callback \#{Macro.to_string(Code.Typespec.spec_to_quoted(fun, spec))}"
      end)
    end)
    |> Enum.sort()
  :error -> []
end

parts = []
parts = if types != [], do: parts ++ ["## Types\\n" <> Enum.join(types, "\\n")], else: parts
parts = if specs != [], do: parts ++ ["## Specs\\n" <> Enum.join(specs, "\\n")], else: parts
parts = if callbacks != [], do: parts ++ ["## Callbacks\\n" <> Enum.join(callbacks, "\\n")], else: parts

if parts == [] do
  "No types, specs, or callbacks found for \#{inspect(mod)}"
else
  "# \#{inspect(mod)}\\n\\n" <> Enum.join(parts, "\\n\\n")
end
`;
			}

			const parts = ref.split(".");
			const funPart = parts.pop()!;
			const modParts = parts;
			const modAtom = `Module.concat([${modParts.map((s) => `:"${s}"`).join(", ")}])`;

			let funName: string;
			let arityFilter: string;
			if (hasArity) {
				const [f, a] = funPart.split("/");
				funName = f;
				arityFilter = `arity == ${a}`;
			} else {
				funName = funPart;
				arityFilter = "true";
			}

			return `
mod = ${modAtom}
fun = :${funName}
Code.ensure_loaded!(mod)

specs = case Code.Typespec.fetch_specs(mod) do
  {:ok, specs} ->
    Enum.flat_map(specs, fn {{f, arity}, spec_list} ->
      if f == fun and ${arityFilter} do
        Enum.map(spec_list, fn spec ->
          "@spec \#{Macro.to_string(Code.Typespec.spec_to_quoted(f, spec))}"
        end)
      else
        []
      end
    end)
  :error -> []
end

if specs == [] do
  "No specs found for \#{inspect(mod)}.\#{fun}${hasArity ? `/${funPart.split("/")[1]}` : ""}"
else
  Enum.join(specs, "\\n")
end
`;
		},
		(args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("elixir_types ")) +
					theme.fg("accent", String(args.reference ?? "")),
				0,
				0,
			),
		{ renderResult: renderElixirResult },
	);
}
